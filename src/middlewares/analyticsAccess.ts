import { checkAnalyticsAccess } from '../billing/analytics';

export function requireAnalyticsFeature(feature: string) {
  return async (req: any, res: any, next: any) => {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const access = await checkAnalyticsAccess(tenantId, feature as any);
    
    if (!access.allowed) {
      return res.status(402).json({
        error: 'Payment required',
        feature,
        message: access.upgradeRequired,
        upgradeUrl: 'https://nani.dev/upgrade'
      });
    }

    req.analyticsAccess = access;
    next();
  };
}
