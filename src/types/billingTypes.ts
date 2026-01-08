export interface TrialConfig {
  tenantId: string;
  email: string;
  tier: 'pro' | 'enterprise' | 'accelerator';
  trialStartDate: string;
  trialEndDate: string;
  status: 'active' | 'expired' | 'converted' | 'cancelled';
  usageTracking: {
    eventsProcessed: number;
    subscriptionsCreated: number;
    daysActive: number;
  };
  filters?: any[];
}

export interface BillingConfig {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  tier: string;
  status: 'active' | 'cancelled' | 'past_due';
  createdAt: string;
  updatedAt: string;
  address: string;
  chainId: string;
  tokenSymbol: string;
  plugins: {
    activities: any[];
    notifications: any[];
  };
}

export interface AnalyticsTier {
  basic: boolean;
  advanced: boolean;
  ai: boolean;
  export: boolean;
  historical: number;
  realtime: boolean;
  customMetrics: number;
  apiAccess: boolean;
  customFilters: number;
}
