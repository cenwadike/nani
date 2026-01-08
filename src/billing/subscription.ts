import storage from '../utils/storage';
import logger from '../utils/logger';
import { alertManager, AlertLevel, AlertCategory } from '../utils/alertSystem';
import { BillingConfig } from '../types/billingTypes';
import { createCustomer, createSubscription, PRICE_IDS } from './stripe';

export async function convertTrialToPaid(
  tenantId: string,
  paymentMethodId: string
): Promise<{ subscriptionId: string; status: string }> {
  const trialConfig = await storage.loadChainConfig(tenantId, 'trial') as any;
  if (!trialConfig) throw new Error('No active trial found');

  const customer = await createCustomer(
    trialConfig.email,
    paymentMethodId,
    {
      tenantId,
      tier: trialConfig.tier,
      convertedFromTrial: 'true'
    }
  );

  const subscription = await createSubscription(
    customer.id,
    PRICE_IDS[trialConfig.tier as keyof typeof PRICE_IDS],
    { tenantId, tier: trialConfig.tier }
  );

  trialConfig.status = 'converted';
  await storage.saveChainConfig(tenantId, 'trial', trialConfig);

  const billingConfig: BillingConfig = {
    stripeCustomerId: customer.id,
    stripeSubscriptionId: subscription.id,
    tier: trialConfig.tier,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    address: '',
    chainId: 'billing',
    tokenSymbol: 'USD',
    plugins: { activities: [], notifications: [] }
  };

  await storage.saveChainConfig(tenantId, 'billing', billingConfig as any);

  await alertManager.createAlert({
    level: AlertLevel.SUCCESS,
    category: AlertCategory.SYSTEM,
    title: 'Subscription Activated',
    message: `Welcome to Nani ${trialConfig.tier.toUpperCase()}! Your subscription is now active.`,
    chainId: 'system'
  });

  logger.event(`Trial converted to paid: ${tenantId} (${trialConfig.tier})`);
  return { subscriptionId: subscription.id, status: subscription.status };
}
