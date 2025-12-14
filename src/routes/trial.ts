import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { startFreeTrial, checkTrialStatus } from '../billing/freeTrial';
import { convertTrialToPaid } from '../billing/subscription';
import { 
  createFingerprint, 
  checkTrialAbuse, 
  checkTrialRateLimit,
  saveTrialRecord,
  loadTrialRecord,
} from '../services/fraudDetection';
import { alertManager, AlertLevel, AlertCategory } from '../utils/alertSystem';
import logger from '../utils/logger';

const router = Router();

// Start free trial with abuse prevention
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { email, tier = 'pro' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // 1. Rate limiting check
    const xForwardedFor = req.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor?.split(',')[0];
    const ip = (req.headers['cf-connecting-ip'] || 
                req.headers['x-real-ip'] || 
                forwardedIp || 
                req.connection?.remoteAddress) as string;

    const rateLimit = checkTrialRateLimit(ip);
    if (!rateLimit.allowed) {
      logger.warn(`Trial rate limit exceeded for IP: ${ip}`);
      return res.status(429).json({
        error: 'Too many trial attempts',
        message: `Please try again in ${rateLimit.retryAfter} seconds`,
        retryAfter: rateLimit.retryAfter
      });
    }

    // 2. Create device fingerprint
    const fingerprint = createFingerprint(req);

    // 3. Check for abuse
    const fraudCheck = await checkTrialAbuse(email, fingerprint);
    
    if (!fraudCheck.allowed) {
      logger.warn(
        `Trial blocked for ${email}: ${fraudCheck.reason} (risk: ${fraudCheck.riskScore})`
      );

      // Create alert for blocked trial attempt
      await alertManager.createAlert({
        level: AlertLevel.WARNING,
        category: AlertCategory.SECURITY,
        title: 'Trial Signup Blocked',
        message: `Blocked trial attempt: ${fraudCheck.reason}`,
        chainId: 'system',
        metadata: {
          email: email.substring(0, 3) + '***',
          riskScore: fraudCheck.riskScore,
          ip: fingerprint.ip
        }
      });

      return res.status(403).json({
        error: 'Trial not available',
        message: fraudCheck.reason,
        support: 'Contact support@nani.dev if you believe this is an error'
      });
    }

    // 4. Create tenant ID
    const tenantId = crypto.createHash('sha256')
      .update(email.toLowerCase())
      .digest('hex')
      .slice(0, 16);

    // 5. Save trial record for fraud tracking
    await saveTrialRecord({
      tenantId,
      email: email.toLowerCase(),
      fingerprintHash: fingerprint.fingerprintHash,
      ip: fingerprint.ip,
      createdAt: new Date().toISOString(),
      status: 'active'
    });

    // 6. Create JWT token
    const token = jwt.sign(
      { tenantId, email, tier: 'trial' },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // 7. Start trial
    const trialConfig = await startFreeTrial(email, tenantId, tier);

    // 8. Log successful trial with risk score
    logger.event(
      `Trial started: ${email} → ${tenantId} (risk: ${fraudCheck.riskScore})`
    );

    res.json({
      success: true,
      token,
      tenantId,
      trial: trialConfig,
      message: 'Your 7-day trial has started! Check your email for setup instructions.',
      riskScore: fraudCheck.riskScore // For debugging (remove in production)
    });

  } catch (error: any) {
    logger.error(`Trial start failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

// Check trial status (existing code)
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const status = await checkTrialStatus(tenantId);
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check trial status' });
  }
});

// Convert trial to paid (existing code)
router.post('/convert', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    const { paymentMethodId } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'Payment method required' });
    }

    const result = await convertTrialToPaid(tenantId, paymentMethodId);

    // Update trial record status
    const record = await loadTrialRecord(tenantId);
    if (record) {
      record.status = 'converted';
      await saveTrialRecord(record);
    }

    res.json({
      success: true,
      ...result,
      message: 'Welcome to Nani! Your subscription is now active.'
    });

  } catch (error: any) {
    logger.error(`Trial conversion failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to convert trial' });
  }
});

export default router;
