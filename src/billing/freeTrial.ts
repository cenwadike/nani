import storage from '../utils/storage';
import logger from '../utils/logger';
import { alertManager, AlertLevel, AlertCategory } from '../utils/alertSystem';
import { TrialConfig } from '../types/billingTypes';
import { sendTrialWelcomeEmail, scheduleTrialEmails } from '../services/email';

export async function startFreeTrial(
  email: string,
  tenantId: string,
  tier: 'pro' | 'enterprise' | 'accelerator'
): Promise<TrialConfig> {
  const trialStartDate = new Date();
  const trialEndDate = new Date(trialStartDate);
  trialEndDate.setDate(trialEndDate.getDate() + 7);

  const trialConfig: TrialConfig = {
    tenantId,
    email,
    tier,
    trialStartDate: trialStartDate.toISOString(),
    trialEndDate: trialEndDate.toISOString(),
    status: 'active',
    usageTracking: {
      eventsProcessed: 0,
      subscriptionsCreated: 0,
      daysActive: 0
    },
    filters: []
  };

  await storage.saveChainConfig(tenantId, 'trial', trialConfig as any);
  await sendTrialWelcomeEmail(email, tier, trialEndDate);
  await scheduleTrialEmails(tenantId, email, trialEndDate);

  await alertManager.createAlert({
    level: AlertLevel.SUCCESS,
    category: AlertCategory.SYSTEM,
    title: '7-Day Free Trial Started',
    message: `Welcome to Nani ${tier.toUpperCase()}! Your trial is active until ${trialEndDate.toLocaleDateString()}`,
    chainId: 'system',
    metadata: {
      suggestedAction: 'Complete setup by configuring your first chain monitoring'
    }
  });

  logger.event(`Free trial started: ${email} (${tier}, 7 days)`);
  return trialConfig;
}

export async function checkTrialStatus(tenantId: string): Promise<{
  isValid: boolean;
  daysRemaining: number;
  status: string;
  usage?: TrialConfig['usageTracking'];
}> {
  const trialConfig = await storage.loadChainConfig(tenantId, 'trial') as any;
  
  if (!trialConfig) {
    const billing = await storage.loadChainConfig(tenantId, 'billing');
    if (billing && (billing as any).status === 'active') {
      return { isValid: true, daysRemaining: 999, status: 'paid' };
    }
    return { isValid: false, daysRemaining: 0, status: 'none' };
  }

  const now = new Date();
  const endDate = new Date(trialConfig.trialEndDate);
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (trialConfig.status === 'converted') {
    return { 
      isValid: true, 
      daysRemaining: 999, 
      status: 'converted',
      usage: trialConfig.usageTracking 
    };
  }

  if (daysRemaining <= 0 || trialConfig.status === 'expired') {
    trialConfig.status = 'expired';
    await storage.saveChainConfig(tenantId, 'trial', trialConfig);
    
    await alertManager.createAlert({
      level: AlertLevel.WARNING,
      category: AlertCategory.SYSTEM,
      title: 'Trial Expired',
      message: 'Your 7-day trial has ended. Upgrade to continue using Nani.',
      chainId: 'system',
      metadata: {
        actionUrl: 'https://nani.dev/upgrade',
        suggestedAction: 'Upgrade now with code COMEBACK50 for 50% off'
      }
    });

    return { isValid: false, daysRemaining: 0, status: 'expired' };
  }

  const startDate = new Date(trialConfig.trialStartDate);
  trialConfig.usageTracking.daysActive = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  await storage.saveChainConfig(tenantId, 'trial', trialConfig);

  return { 
    isValid: true, 
    daysRemaining, 
    status: 'active',
    usage: trialConfig.usageTracking
  };
}

export async function updateTrialUsage(
  tenantId: string,
  updates: Partial<TrialConfig['usageTracking']>
): Promise<void> {
  const trialConfig = await storage.loadChainConfig(tenantId, 'trial') as any;
  if (!trialConfig) return;

  Object.assign(trialConfig.usageTracking, updates);
  await storage.saveChainConfig(tenantId, 'trial', trialConfig);
}