import { checkTrialStatus } from '../billing/freeTrial';

export async function enforceTrialLimits(
  req: any, 
  res: any, 
  next: any
): Promise<void> {
  const tenantId = req.user?.tenantId;
  
  if (!tenantId) {
    return next();
  }

  const trialStatus = await checkTrialStatus(tenantId);
  
  if (!trialStatus.isValid && trialStatus.status === 'expired') {
    return res.status(402).json({
      error: 'Trial expired',
      message: 'Your 7-day trial has ended. Upgrade to continue using Nani.',
      upgradeUrl: 'https://nani.dev/upgrade',
      comebackOffer: {
        code: 'COMEBACK50',
        discount: '50% off first month'
      }
    });
  }

  req.trial = trialStatus;
  next();
}
