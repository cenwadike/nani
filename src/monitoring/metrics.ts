import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import logger from '../utils/logger';

export function initializeMonitoring(): void {
  if (!process.env.SENTRY_DSN) {
    logger.warn('SENTRY_DSN not set - monitoring disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.GIT_COMMIT || 'unknown',
  });

  logger.info('Sentry monitoring initialized');
}

