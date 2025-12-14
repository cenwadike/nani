import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-11-17.clover',
});

export const PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO!,
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!,
  accelerator: process.env.STRIPE_PRICE_ACCELERATOR!
};

export async function createCustomer(
  email: string,
  paymentMethodId: string,
  metadata: Record<string, string>
): Promise<Stripe.Customer> {
  return stripe.customers.create({
    email,
    payment_method: paymentMethodId,
    invoice_settings: { default_payment_method: paymentMethodId },
    metadata
  });
}

export async function createSubscription(
  customerId: string,
  priceId: string,
  metadata: Record<string, string>
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata
  });
}

export async function cancelSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.cancel(subscriptionId);
}

export async function updateSubscription(
  subscriptionId: string,
  priceId: string
): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return stripe.subscriptions.update(subscriptionId, {
    items: [{
      id: subscription.items.data[0].id,
      price: priceId
    }]
  });
}
