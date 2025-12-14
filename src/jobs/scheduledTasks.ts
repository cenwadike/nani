import cron from 'node-cron';
import logger from '../utils/logger';
import { checkAndAlert, sendAlert } from '../monitoring/alerting';
import { performanceMonitor } from '../monitoring/performance';
import storage from '../utils/storage';

// Health check every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    await checkAndAlert();
  } catch (error: any) {
    logger.error(`Health check failed: ${error.message}`);
  }
});

// Performance metrics report every hour
cron.schedule('0 * * * *', async () => {
  const stats = performanceMonitor.getAllStats();
  logger.info(`Performance metrics: ${JSON.stringify(stats)}`);

  for (const [operation, metrics] of Object.entries(stats)) {
    if (metrics && (metrics as any).p99 > 500) {
      await sendAlert('warning', 
        `High latency for ${operation}: ${(metrics as any).p99}ms`, 
        metrics
      );
    }
  }
});

// Daily metrics snapshot
cron.schedule('0 0 * * *', async () => {
  const tenants = await storage.getAllTenants();
  
  logger.info(`Daily report: ${tenants.length} active tenants`);
  
  // Store daily metrics
  await storage.appendLog('metrics_daily', {
    timestamp: new Date().toISOString(),
    tenantCount: tenants.length,
    performance: performanceMonitor.getAllStats()
  });
});

