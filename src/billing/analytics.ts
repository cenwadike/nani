import { AnalyticsTier } from '../types/billingTypes';
import storage from '../utils/storage';

export const ANALYTICS_TIERS: Record<string, AnalyticsTier> = {
  free: {
    basic: true,
    advanced: false,
    ai: false,
    export: false,
    historical: 7,
    realtime: false,
    customMetrics: 0,
    apiAccess: false,
    customFilters: 0,
  },
  pro: {
    basic: true,
    advanced: true,
    ai: false,
    export: true,
    historical: 90,
    realtime: true,
    customMetrics: 5,
    apiAccess: false,
    customFilters: 10,
  },
  enterprise: {
    basic: true,
    advanced: true,
    ai: true,
    export: true,
    historical: 365,
    realtime: true,
    customMetrics: 25,
    apiAccess: true,
    customFilters: 100,
  },
  x402: {
    basic: true,
    advanced: false,
    ai: true,
    export: true,
    historical: 30,
    realtime: false,
    customMetrics: 0,
    apiAccess: true,
    customFilters: 5,
  }
};

export async function checkAnalyticsAccess(
  tenantId: string,
  feature: keyof AnalyticsTier
): Promise<{ allowed: boolean; tier: string; upgradeRequired?: string }> {
  const billing = await storage.loadChainConfig(tenantId, 'billing');
  const trial = await storage.loadChainConfig(tenantId, 'trial');
  
  let tier: keyof typeof ANALYTICS_TIERS = 'free';
  
  if (trial && (trial as any).status === 'active') {
    tier = (trial as any).tier;
  } else if (billing) {
    tier = (billing as any).tier || 'free';
  }

  const access = ANALYTICS_TIERS[tier];
  const allowed = access[feature] === true || 
                  (typeof access[feature] === 'number' && access[feature] > 0);

  if (!allowed) {
    return { 
      allowed: false, 
      tier, 
      upgradeRequired: getUpgradeMessage(feature, tier) 
    };
  }

  return { allowed: true, tier };
}

function getUpgradeMessage(feature: string, currentTier: string): string {
  const messages: Record<string, string> = {
    advanced: 'Advanced analytics require Pro tier ($49.99/mo) or higher.',
    ai: 'AI analytics require Enterprise tier ($199.99/mo) or x402 payments.',
    export: 'Data export requires Pro tier ($49.99/mo) or higher.',
    realtime: 'Real-time dashboards require Pro tier ($49.99/mo) or higher.',
    apiAccess: 'Analytics API requires Enterprise tier ($199.99/mo) or higher.',
    customFilters: 'More custom filters require plan upgrade.'
  };
  return messages[feature] || 'This feature requires a paid plan.';
}
