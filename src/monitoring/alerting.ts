import * as Sentry from '@sentry/node';
import logger from '../utils/logger';
import { alertManager, AlertLevel, AlertCategory } from '../utils/alertSystem';
import { getHealthStatus } from './health';

export async function checkAndAlert(): Promise<void> {
  const health = await getHealthStatus();

  if (health.status === 'unhealthy') {
    await sendAlert('critical', 'Service unhealthy', health);
    await alertManager.createAlert({
      level: AlertLevel.CRITICAL,
      category: AlertCategory.SYSTEM,
      title: 'System Health Critical',
      message: 'One or more core services are down. Engineers have been notified.',
      chainId: 'system'
    });
  }

  if (health.metrics.memory.percentage > 80) {
    await sendAlert('warning', 
      `High memory usage: ${health.metrics.memory.percentage.toFixed(2)}%`, 
      health
    );
  }

  if (health.metrics.eventQueue.failed > 100) {
    await sendAlert('critical', 
      `${health.metrics.eventQueue.failed} events failed`, 
      health
    );
  }
}

export async function sendAlert(
  severity: 'info' | 'warning' | 'critical',
  message: string,
  context: any
): Promise<void> {
  logger.error(`[ALERT ${severity.toUpperCase()}] ${message}`);

  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(message, {
      level: severity === 'critical' ? 'error' : 'warning',
      extra: context
    });
  }

  if (process.env.SLACK_ALERT_WEBHOOK) {
    await fetch(process.env.SLACK_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 *${severity.toUpperCase()}*: ${message}`,
        attachments: [{
          color: severity === 'critical' ? 'danger' : 'warning',
          text: JSON.stringify(context, null, 2).slice(0, 500)
        }]
      })
    });
  }

  if (severity === 'critical' && process.env.PAGERDUTY_INTEGRATION_KEY) {
    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: process.env.PAGERDUTY_INTEGRATION_KEY,
        event_action: 'trigger',
        payload: {
          summary: message,
          severity: 'critical',
          source: 'nani-monitoring',
          custom_details: context
        }
      })
    });
  }
}
