import os from 'os';
import storage from '../utils/storage';
import adapterPool from '../utils/adapterPool';
import eventQueue from '../utils/eventQueue';
import { alertManager } from '../utils/alertSystem';
import { stripe } from '../billing/stripe';
import { HealthStatus, ServiceStatus } from '../types/monitoringTypes';

export async function getHealthStatus(): Promise<HealthStatus> {
  const services = await checkAllServices();
  const metrics = await collectMetrics();
  const alertStats = alertManager.getStats();

  const status = determineOverallStatus(services);

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services,
    metrics,
    alerts: {
      unread: alertStats.unread,
      critical: alertStats.byLevel.critical
    }
  };
}

async function checkAllServices(): Promise<HealthStatus['services']> {
  const [database, adapters, queue, stripeCheck] = await Promise.allSettled([
    checkDatabaseHealth(),
    checkAdaptersHealth(),
    checkQueueHealth(),
    checkStripeHealth()
  ]);

  return {
    database: database.status === 'fulfilled' ? database.value : 
      { status: 'down', lastCheck: new Date().toISOString(), error: 'Check failed' },
    adapters: adapters.status === 'fulfilled' ? adapters.value : 
      { status: 'down', lastCheck: new Date().toISOString(), error: 'Check failed' },
    queue: queue.status === 'fulfilled' ? queue.value : 
      { status: 'down', lastCheck: new Date().toISOString(), error: 'Check failed' },
    stripe: stripeCheck.status === 'fulfilled' ? stripeCheck.value : 
      { status: 'down', lastCheck: new Date().toISOString(), error: 'Check failed' }
  };
}

async function checkDatabaseHealth(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await storage.getDb();
    return { 
      status: 'up', 
      latency: Date.now() - start, 
      lastCheck: new Date().toISOString() 
    };
  } catch (error: any) {
    return { 
      status: 'down', 
      lastCheck: new Date().toISOString(), 
      error: error.message 
    };
  }
}

async function checkAdaptersHealth(): Promise<ServiceStatus> {
  const stats = adapterPool.getStats();
  const status = stats.healthy > 0 ? 'up' : stats.total > 0 ? 'degraded' : 'down';
  
  return {
    status,
    lastCheck: new Date().toISOString(),
    error: stats.unhealthy > 0 ? `${stats.unhealthy} adapters unhealthy` : undefined
  };
}

async function checkQueueHealth(): Promise<ServiceStatus> {
  const health = eventQueue.getHealth();
  return {
    status: health.healthy ? 'up' : 'degraded',
    lastCheck: new Date().toISOString(),
    error: health.reason
  };
}

async function checkStripeHealth(): Promise<ServiceStatus> {
  try {
    await stripe.paymentIntents.list({ limit: 1 });
    return { status: 'up', lastCheck: new Date().toISOString() };
  } catch (error: any) {
    return { 
      status: 'down', 
      lastCheck: new Date().toISOString(), 
      error: error.message 
    };
  }
}

async function collectMetrics(): Promise<HealthStatus['metrics']> {
  const mem = process.memoryUsage();
  const queueStats = eventQueue.getStats();

  return {
    memory: {
      used: mem.heapUsed,
      total: mem.heapTotal,
      percentage: (mem.heapUsed / mem.heapTotal) * 100
    },
    cpu: {
      usage: os.loadavg()[0],
      cores: os.cpus().length
    },
    eventQueue: {
      pending: queueStats.size,
      processing: 0,
      failed: queueStats.dropped,
      deduplicated: queueStats.deduplicated
    }
  };
}

function determineOverallStatus(
  services: HealthStatus['services']
): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = Object.values(services).map(s => s.status);
  
  if (statuses.every(s => s === 'up')) return 'healthy';
  if (statuses.some(s => s === 'down')) return 'unhealthy';
  return 'degraded';
}
