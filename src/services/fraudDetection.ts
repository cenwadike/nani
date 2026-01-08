import crypto from 'crypto';
import storage from '../utils/storage';
import logger from '../utils/logger';

// ——————————————————————————————————————
// FINGERPRINTING & DETECTION
// ——————————————————————————————————————

export interface DeviceFingerprint {
  userAgent: string;
  ip: string;
  acceptLanguage: string;
  acceptEncoding: string;
  fingerprintHash: string;
}

export interface TrialRecord {
  tenantId: string;
  email?: string;
  address?: string;
  fingerprintHash: string;
  ip: string;
  createdAt: string;
  status: 'active' | 'expired' | 'converted' | 'blocked';
}

export interface FraudCheckResult {
  allowed: boolean;
  reason?: string;
  riskScore: number; // 0-100
  previousTrials?: TrialRecord[];
}

// ——————————————————————————————————————
// CREATE DEVICE FINGERPRINT
// ——————————————————————————————————————

export function createFingerprint(req: any): DeviceFingerprint {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = getClientIp(req);
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';

  // Create composite fingerprint
  const fingerprintData = [
    userAgent,
    ip.split('.').slice(0, 3).join('.'), // Use /24 subnet
    acceptLanguage,
    acceptEncoding
  ].join('|');

  const fingerprintHash = crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex')
    .slice(0, 16);

  return {
    userAgent,
    ip,
    acceptLanguage,
    acceptEncoding,
    fingerprintHash
  };
}

function getClientIp(req: any): string {
  // Check various headers for real IP (proxy/CDN aware)
  return (
    req.headers['cf-connecting-ip'] || // Cloudflare
    req.headers['x-real-ip'] || // Nginx
    req.headers['x-forwarded-for']?.split(',')[0] || // Standard proxy
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ——————————————————————————————————————
// CHECK FOR TRIAL ABUSE
// ——————————————————————————————————————

export async function checkTrialAbuse(
  identifier: string, // email or address
  fingerprint: DeviceFingerprint
): Promise<FraudCheckResult> {
  let riskScore = 0;
  const reasons: string[] = [];

  // 1. Check if this exact identifier already has a trial
  const existingTrial = await loadTrialRecord(identifier);
  if (existingTrial) {
    if (existingTrial.status === 'active') {
      return {
        allowed: false,
        reason: 'You already have an active trial',
        riskScore: 100,
        previousTrials: [existingTrial]
      };
    }

    if (existingTrial.status === 'blocked') {
      return {
        allowed: false,
        reason: 'Your account has been blocked due to abuse',
        riskScore: 100,
        previousTrials: [existingTrial]
      };
    }

    // Expired or converted - check cooldown (30 days)
    const daysSinceLastTrial = Math.floor(
      (Date.now() - new Date(existingTrial.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastTrial < 30) {
      return {
        allowed: false,
        reason: `You can start a new trial ${30 - daysSinceLastTrial} days from now`,
        riskScore: 80,
        previousTrials: [existingTrial]
      };
    }
  }

  // 2. Check fingerprint for multiple trials
  const fingerprintTrials = await getTrialsByFingerprint(fingerprint.fingerprintHash);
  
  if (fingerprintTrials.length > 0) {
    riskScore += Math.min(fingerprintTrials.length * 20, 60);
    reasons.push(`${fingerprintTrials.length} trial(s) from this device`);

    // Block if more than 3 trials from same device
    if (fingerprintTrials.length >= 3) {
      await blockFingerprint(fingerprint.fingerprintHash);
      return {
        allowed: false,
        reason: 'Too many trials from this device. Please contact support.',
        riskScore: 100,
        previousTrials: fingerprintTrials
      };
    }

    // Check if any recent trials (last 7 days)
    const recentTrials = fingerprintTrials.filter(t => {
      const age = Date.now() - new Date(t.createdAt).getTime();
      return age < 7 * 24 * 60 * 60 * 1000;
    });

    if (recentTrials.length > 0) {
      riskScore += 30;
      reasons.push(`${recentTrials.length} recent trial(s) from this device`);
    }
  }

  // 3. Check IP for multiple trials
  const ipTrials = await getTrialsByIp(fingerprint.ip);
  
  if (ipTrials.length > 0) {
    riskScore += Math.min(ipTrials.length * 15, 40);
    reasons.push(`${ipTrials.length} trial(s) from this IP`);

    // Block if more than 5 trials from same IP
    if (ipTrials.length >= 5) {
      await blockIp(fingerprint.ip);
      return {
        allowed: false,
        reason: 'Too many trials from your network. Please contact support.',
        riskScore: 100,
        previousTrials: ipTrials
      };
    }
  }

  // 4. Check for disposable email domains
  if (identifier.includes('@')) {
    const isDisposable = await isDisposableEmail(identifier);
    if (isDisposable) {
      riskScore += 40;
      reasons.push('Disposable email detected');
    }
  }

  // 5. Check for suspicious patterns
  if (identifier.match(/test|demo|fake|temp|throwaway/i)) {
    riskScore += 20;
    reasons.push('Suspicious identifier pattern');
  }

  // Decision
  if (riskScore >= 80) {
    logger.warn(`Trial blocked for ${identifier}: ${reasons.join(', ')} (score: ${riskScore})`);
    return {
      allowed: false,
      reason: 'Unable to create trial. Please contact support.',
      riskScore,
      previousTrials: [...fingerprintTrials, ...ipTrials]
    };
  }

  if (riskScore >= 50) {
    logger.warn(`High risk trial for ${identifier}: ${reasons.join(', ')} (score: ${riskScore})`);
  }

  return {
    allowed: true,
    riskScore,
    previousTrials: [...fingerprintTrials, ...ipTrials]
  };
}

// ——————————————————————————————————————
// TRIAL RECORD MANAGEMENT
// ——————————————————————————————————————

export async function loadTrialRecord(identifier: string): Promise<TrialRecord | null> {
  try {
    const tenantId = crypto
      .createHash('sha256')
      .update(identifier.toLowerCase())
      .digest('hex')
      .slice(0, 16);

    const record = await storage.loadChainConfig(tenantId, 'trial_record');
    return record as TrialRecord | null;
  } catch {
    return null;
  }
}

export async function saveTrialRecord(record: TrialRecord): Promise<void> {
  const tenantId = crypto
    .createHash('sha256')
    .update((record.email || record.address)!.toLowerCase())
    .digest('hex')
    .slice(0, 16);

  await storage.saveChainConfig(tenantId, 'trial_record', record as any);
}

async function getTrialsByFingerprint(fingerprintHash: string): Promise<TrialRecord[]> {
  try {
    // Query MongoDB configs collection for trial records with this fingerprint
    const db = storage.getDb();
    const collection = db.collection('configs');
    
    // Find all documents where chainId is 'trial_record'
    const docs = await collection
      .find({ chainId: 'trial_record' })
      .toArray();

    const trials: TrialRecord[] = [];
    
    for (const doc of docs) {
      try {
        if (doc.encryptedData) {
          const decrypted = storage.decrypt(doc.encryptedData) as TrialRecord;
          if (decrypted.fingerprintHash === fingerprintHash) {
            trials.push(decrypted);
          }
        }
      } catch (err) {
        logger.warn(`Failed to decrypt trial record ${doc._id}: ${err}`);
      }
    }

    return trials;
  } catch (error: any) {
    logger.error(`Error fetching trials by fingerprint: ${error.message}`);
    return [];
  }
}

async function getTrialsByIp(ip: string): Promise<TrialRecord[]> {
  try {
    const db = storage.getDb();
    const collection = db.collection('configs');
    
    // Find all trial records
    const docs = await collection
      .find({ chainId: 'trial_record' })
      .toArray();

    const trials: TrialRecord[] = [];
    
    for (const doc of docs) {
      try {
        if (doc.encryptedData) {
          const decrypted = storage.decrypt(doc.encryptedData) as TrialRecord;
          if (decrypted.ip === ip) {
            trials.push(decrypted);
          }
        }
      } catch (err) {
        logger.warn(`Failed to decrypt trial record ${doc._id}: ${err}`);
      }
    }

    return trials;
  } catch (error: any) {
    logger.error(`Error fetching trials by IP: ${error.message}`);
    return [];
  }
}

async function blockFingerprint(fingerprintHash: string): Promise<void> {
  await storage.saveChainConfig(
    `blocked_fingerprint_${fingerprintHash}`,
    'block',
    {
      fingerprintHash,
      blockedAt: new Date().toISOString(),
      reason: 'Multiple trial abuse'
    } as any
  );

  logger.event(`Blocked fingerprint: ${fingerprintHash}`);
}

async function blockIp(ip: string): Promise<void> {
  await storage.saveChainConfig(
    `blocked_ip_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16)}`,
    'block',
    {
      ip,
      blockedAt: new Date().toISOString(),
      reason: 'Multiple trial abuse'
    } as any
  );

  logger.event(`Blocked IP: ${ip}`);
}

// ——————————————————————————————————————
// DISPOSABLE EMAIL DETECTION
// ——————————————————————————————————————

const DISPOSABLE_DOMAINS = new Set([
  'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
  'throwaway.email', 'maildrop.cc', 'temp-mail.org', 'getnada.com',
  'trashmail.com', 'yopmail.com', 'fakeinbox.com', 'sharklasers.com'
]);

async function isDisposableEmail(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  // Check local list
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return true;
  }

  // Optional: Check external API (e.g., https://open.kickbox.com/v1/disposable/example.com)
  try {
    const response = await fetch(`https://open.kickbox.com/v1/disposable/${domain}`);
    const data = await response.json();
    return data.disposable === true;
  } catch {
    return false;
  }
}

// ——————————————————————————————————————
// RATE LIMITING PER IP
// ——————————————————————————————————————

const trialAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkTrialRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const existing = trialAttempts.get(ip);

  if (existing && now < existing.resetAt) {
    if (existing.count >= 5) {
      return {
        allowed: false,
        retryAfter: Math.ceil((existing.resetAt - now) / 1000)
      };
    }
    existing.count++;
  } else {
    trialAttempts.set(ip, {
      count: 1,
      resetAt: now + 60 * 60 * 1000 // 1 hour
    });
  }

  return { allowed: true };
}

// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of trialAttempts.entries()) {
    if (now > data.resetAt) {
      trialAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

// ——————————————————————————————————————
// EXPORTS
// ——————————————————————————————————————

export default {
  createFingerprint,
  checkTrialAbuse,
  checkTrialRateLimit,
  saveTrialRecord,
  loadTrialRecord
};
