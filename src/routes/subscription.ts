// src/routes/subscription.ts

import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import logger from '../utils/logger';
import { alertManager, AlertLevel, AlertCategory } from '../utils/alertSystem';
import { BillingConfig } from '../types/billingTypes';
import { createCustomer, createSubscription, PRICE_IDS } from '../billing/stripe';

const router = Router();

// POST /subscribe
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      tenantId,
      email,
      paymentMethodId,
      plan,
      metadata = {}
    } = req.body;

    if (!tenantId || !email || !paymentMethodId || !plan) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: tenantId, email, paymentMethodId, plan'
      });
    }

    if (!PRICE_IDS[plan as keyof typeof PRICE_IDS]) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan: ${plan}. Must be one of: pro, enterprise, accelerator`
      });
    }

    const existingBilling = await storage.loadChainConfig(tenantId, 'billing');
    if (existingBilling && (existingBilling as any).status === 'active') {
      return res.status(409).json({
        success: false,
        error: 'Tenant already has an active subscription. Use update endpoint to change plans.'
      });
    }

    const customer = await createCustomer(email, paymentMethodId, {
      tenantId,
      tier: plan,
      ...metadata
    });

    logger.info(`Created Stripe customer: ${customer.id} for tenant: ${tenantId}`);

    const subscription = await createSubscription(customer.id, PRICE_IDS[plan as keyof typeof PRICE_IDS], {
      tenantId,
      tier: plan,
      ...metadata
    });

    logger.info(`Created subscription: ${subscription.id} for tenant: ${tenantId}`);

    const billingConfig: BillingConfig = {
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      tier: plan,
      status: subscription.status as 'active' | 'cancelled' | 'past_due',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      address: '',
      chainId: 'billing',
      tokenSymbol: 'USD',
      plugins: { activities: [], notifications: [] }
    };

    await storage.saveChainConfig(tenantId, 'billing', billingConfig as any);

    await alertManager.createAlert({
      level: AlertLevel.SUCCESS,
      category: AlertCategory.SYSTEM,
      title: 'Subscription Created',
      message: `Successfully subscribed to ${plan.toUpperCase()} plan!`,
      chainId: 'system'
    });

    logger.event(`New subscription created: ${tenantId} (${plan})`);

    return res.status(201).json({
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status
    });

  } catch (error: any) {
    logger.error(`Subscription error: ${error.message}`);

    await alertManager.createAlert({
      level: AlertLevel.WARNING,
      category: AlertCategory.SYSTEM,
      title: 'Subscription Failed',
      message: `Failed to create subscription: ${error.message}`,
      chainId: 'system'
    });

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create subscription'
    });
  }
});

// GET /subscribe/:tenantId
router.get('/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        error: 'Missing tenantId parameter'
      });
    }

    const billingConfig = await storage.loadChainConfig(tenantId, 'billing');

    if (!billingConfig) {
      return res.status(404).json({
        success: false,
        error: 'No subscription found for this tenant'
      });
    }

    const config = billingConfig as any;

    return res.json({
      success: true,
      subscription: {
        customerId: config.stripeCustomerId,
        subscriptionId: config.stripeSubscriptionId,
        tier: config.tier,
        status: config.status,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      }
    });
  } catch (error: any) {
    logger.error(`Get subscription error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve subscription'
    });
  }
});

// GET /subscribe/plans
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const plans = {
      pro: { id: 'pro', name: 'Pro', priceId: PRICE_IDS.pro },
      enterprise: { id: 'enterprise', name: 'Enterprise', priceId: PRICE_IDS.enterprise },
      accelerator: { id: 'accelerator', name: 'Accelerator', priceId: PRICE_IDS.accelerator }
    };

    return res.json({ success: true, plans });
  } catch (error: any) {
    logger.error(`Get plans error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve plans'
    });
  }
});

export default router;