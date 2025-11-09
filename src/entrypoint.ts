// src/entrypoint.ts
import cluster from 'cluster';
import type { Worker } from 'cluster';
import os from 'os';
import logger from './utils/logger';
import { loadPlugins } from './utils/pluginRegistry';
import { CHAINS } from './config';

loadPlugins();

const numCPUs = os.cpus().length;

// ──────────────────────────────────────────────────────────────
// ENV DETECTION — FIXED LOGIC
// ──────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';
const forceCluster = process.env.FORCE_CLUSTER === 'true';
const forceSingle = process.env.FORCE_SINGLE === 'true';

const isPaaS = !!(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RENDER_INSTANCE_ID ||
  process.env.FLY_APP_NAME ||
  process.env.HEROKU_DYNO ||
  process.env.VERCEL ||
  process.env.NETLIFY
);

const shouldCluster = (() => {
  if (forceSingle) return false;
  if (forceCluster) return true;
  if (isDev) return false;
  if (isPaaS) return false;
  return true;
})();

logger.info(`[ENTRYPOINT] CPUs: ${numCPUs} | Dev: ${isDev} | PaaS: ${isPaaS} | ForceCluster: ${forceCluster} | ForceSingle: ${forceSingle}`);
logger.info(`[ENTRYPOINT] → CLUSTER MODE: ${shouldCluster ? 'ENABLED' : 'DISABLED'}`);

// ──────────────────────────────────────────────────────────────
// SINGLE PROCESS MODE
// ──────────────────────────────────────────────────────────────
if (!shouldCluster) {
  logger.info('Starting in SINGLE-PROCESS mode');
  startWorker();
}

// ──────────────────────────────────────────────────────────────
// CLUSTER MODE
// ──────────────────────────────────────────────────────────────
else if (cluster.isPrimary) {
  logger.info(`PRIMARY ${process.pid} → Spawning ${numCPUs} workers`);

  const numRest = Math.max(1, numCPUs - CHAINS.length);
  logger.info(`Forking ${numRest} REST workers + ${CHAINS.length} monitoring workers`);

  const monitoringWorkers: Worker[] = [];

  // Fork REST workers
  for (let i = 0; i < numRest; i++) {
    cluster.fork({ WORKER_TYPE: 'rest' });
  }

  // Fork monitoring workers
  for (let i = 0; i < CHAINS.length; i++) {
    const worker = cluster.fork({ WORKER_TYPE: 'monitor' });
    monitoringWorkers.push(worker);
  }

  // Assign chains
  cluster.on('online', (worker) => {
    if (monitoringWorkers.includes(worker)) {
      const chain = CHAINS.find(c => !c.assignedWorkerId);
      if (chain) {
        chain.assignedWorkerId = worker.id;
        worker.send({
          type: 'start-monitoring',
          payload: JSON.stringify(chain)
        });
        logger.event(`Assigned ${chain.name} → Worker ${worker.process.pid}`);
      }
    }
  });

  cluster.on('exit', (deadWorker, code, signal) => {
    if (!deadWorker.exitedAfterDisconnect) {
      logger.warn(`Worker ${deadWorker.process.pid} died (${signal || code}) — Restarting...`);

      // FIX: Properly access env vars
      const workerType = (deadWorker as any).process?.env?.WORKER_TYPE || 'rest';
      const newWorker = cluster.fork({ WORKER_TYPE: workerType });

      // Re-assign chain if it was monitoring
      const chain = CHAINS.find(c => c.assignedWorkerId === deadWorker.id);
      if (chain && workerType === 'monitor') {
        chain.assignedWorkerId = newWorker.id;
        newWorker.send({
          type: 'start-monitoring',
          payload: JSON.stringify(chain)
        });
        logger.event(`Re-assigned ${chain.name} → Worker ${newWorker.process.pid}`);
      }
    }
  });

  // Keep primary alive
  setInterval(() => {}, 1 << 30);
}

// ──────────────────────────────────────────────────────────────
// WORKER
// ──────────────────────────────────────────────────────────────
else {
  startWorker();
}

function startWorker() {
  const workerType = process.env.WORKER_TYPE || 'rest';
  logger.info(`WORKER ${process.pid} starting... (type: ${workerType})`);
  import('./server').catch(err => {
    logger.error(`Worker ${process.pid} import failed: ${err}`);
    process.exit(1);
  });
}
