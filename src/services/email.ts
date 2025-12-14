import logger from '../utils/logger';
import storage from '../utils/storage';
import { checkTrialStatus } from '../billing/freeTrial';

export async function sendTrialWelcomeEmail(
  email: string,
  tier: string,
  endDate: Date
): Promise<void> {
  const subject = `Welcome to Nani ${tier.charAt(0).toUpperCase() + tier.slice(1)} Trial! 🚀`;
  const body = `
Hi there!

Your 7-day free trial of Nani ${tier.charAt(0).toUpperCase() + tier.slice(1)} starts now!

What you get:
✓ Full access to ${tier} features
✓ No credit card required
✓ Setup support via Slack/Email
✓ 7 days to explore everything

Trial ends: ${endDate.toLocaleDateString()}

🎯 Quick Start:
1. Create your first monitoring setup
2. Add notification plugins
3. Test with live transactions

Questions? Reply to this email!

Best,
Nani Team
  `.trim();

  logger.info(`[EMAIL] Trial welcome sent to ${email}`);
  // TODO: Integrate with SendGrid, Postmark, etc.
}

export async function scheduleTrialEmails(
  tenantId: string,
  email: string,
  trialEndDate: Date
): Promise<void> {
  // Day 3: Check-in
  setTimeout(async () => {
    const status = await checkTrialStatus(tenantId);
    if (status.isValid && status.status === 'active') {
      await sendTrialCheckInEmail(email, tenantId);
    }
  }, 3 * 24 * 60 * 60 * 1000);

  // Day 5: Upgrade reminder
  setTimeout(async () => {
    const status = await checkTrialStatus(tenantId);
    if (status.isValid && status.status === 'active') {
      await sendTrialReminderEmail(email, 2);
    }
  }, 5 * 24 * 60 * 60 * 1000);

  // Day 7: Last chance
  setTimeout(async () => {
    const status = await checkTrialStatus(tenantId);
    if (status.isValid && status.status === 'active') {
      await sendTrialExpiringEmail(email);
    }
  }, 7 * 24 * 60 * 60 * 1000);
}

async function sendTrialCheckInEmail(
  email: string,
  tenantId: string
): Promise<void> {
  const trialConfig = await storage.loadChainConfig(tenantId, 'trial') as any;
  const usage = trialConfig?.usageTracking || {};

  logger.info(`[EMAIL] Trial check-in sent to ${email}`);
  // TODO: Send actual email with usage stats
}

async function sendTrialReminderEmail(
  email: string,
  daysLeft: number
): Promise<void> {
  logger.info(`[EMAIL] Trial reminder sent to ${email} (${daysLeft} days left)`);
  // TODO: Send upgrade reminder
}

async function sendTrialExpiringEmail(email: string): Promise<void> {
  logger.info(`[EMAIL] Trial expiring sent to ${email}`);
  // TODO: Send expiring email with offer
}
