// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Nani Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * @file entrypoint.ts
 * @summary Nani - Real-Time Blockchain Event Notifications Platform
 * @description Main entry point for the Polkadot Cloud Nani application.
 *              • 100% open-source (MIT)
 *              • Plugin-based architecture
 *              • PAPI-powered with auto-failover
 *              • Multi-tenant, self-hosted, production-ready
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT - Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Intelligent cluster/single-process detection
 *   • PaaS-aware (Railway, Render, Fly.io, etc.)
 *   • Dedicated monitoring workers per chain
 *   • Automatic worker restart & chain re-assignment
 *   • Zero-downtime deployment ready
 */

import cluster from 'cluster';
import type { Worker } from 'cluster';
import os from 'os';
import logger from './utils/logger';
import { loadPlugins } from './utils/pluginRegistry';
import { CHAINS, ChainConfig } from './config';

// Extend ChainConfig to track worker assignment (in-memory only)
interface AssignedChainConfig extends ChainConfig {
  assignedWorkerId?: number;
}

// Cast CHAINS to allow mutation for worker assignment tracking
const assignedChains = CHAINS as AssignedChainConfig[];

// Load all plugins at startup (hot-reload ready)
loadPlugins();

const numCPUs = os.cpus().length;

// ──────────────────────────────────────────────────────────────
// ENVIRONMENT DETECTION & CLUSTERING STRATEGY
// ──────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';
const forceCluster = process.env.FORCE_CLUSTER === 'true';
const forceSingle = process.env.FORCE_SINGLE === 'true';

const isPaaS = !!(
  process.env.RAILWAY_ENVIRONMENT_NAME ||
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

logger.info(`[ENTRYPOINT] Runtime: CPUs=${numCPUs} | Dev=${isDev} | PaaS=${isPaaS} | ForceCluster=${forceCluster} | ForceSingle=${forceSingle}`);
logger.info(`[ENTRYPOINT] CLUSTER MODE: ${shouldCluster ? 'ENABLED (Production-grade)' : 'DISABLED (Dev/PaaS)'}`);

// ──────────────────────────────────────────────────────────────
// SINGLE PROCESS MODE (Dev, PaaS, or Forced)
// ──────────────────────────────────────────────────────────────
if (!shouldCluster) {
  logger.info('Starting in SINGLE-PROCESS mode (optimized for development and PaaS)');
  startWorker();
}

// ──────────────────────────────────────────────────────────────
// CLUSTER MODE: PRIMARY PROCESS
// ──────────────────────────────────────────────────────────────
else if (cluster.isPrimary) {
  logger.info(`PRIMARY PROCESS ${process.pid} → Initializing ${numCPUs} workers`);
  logger.info(`Strategy: ${Math.max(1, numCPUs - assignedChains.length)} REST workers + ${assignedChains.length} monitoring workers`);

  const monitoringWorkers: Worker[] = [];

  // Fork REST-only workers (handle HTTP API)
  const numRestWorkers = Math.max(1, numCPUs - assignedChains.length);
  for (let i = 0; i < numRestWorkers; i++) {
    cluster.fork({ WORKER_TYPE: 'rest' });
  }

  // Fork dedicated monitoring workers (one per chain)
  for (let i = 0; i < assignedChains.length; i++) {
    const worker = cluster.fork({ WORKER_TYPE: 'monitor' });
    monitoringWorkers.push(worker);
  }

  // Assign chains to monitoring workers as they come online
  cluster.on('online', (worker) => {
    if ((worker as any).process?.env?.WORKER_TYPE === 'monitor') {
      const unassignedChain = assignedChains.find(c => c.assignedWorkerId === undefined);
      if (unassignedChain) {
        unassignedChain.assignedWorkerId = worker.id;
        worker.send({
          type: 'start-monitoring',
          payload: JSON.stringify(unassignedChain)
        });
        logger.event(`Assigned ${unassignedChain.name} → Worker ${worker.process.pid} (ID: ${worker.id})`);
      }
    }
  });

  // Handle worker crashes with automatic restart and chain re-assignment
  cluster.on('exit', (deadWorker, code, signal) => {
    if (!deadWorker.exitedAfterDisconnect) {
      logger.warn(`Worker ${deadWorker.process.pid} died (signal: ${signal || code}) → Restarting...`);

      const workerType = (deadWorker as any).process?.env?.WORKER_TYPE || 'rest';
      const newWorker = cluster.fork({ WORKER_TYPE: workerType });

      // Re-assign chain if this was a monitoring worker
      const orphanedChain = assignedChains.find(c => c.assignedWorkerId === deadWorker.id);
      if (orphanedChain && workerType === 'monitor') {
        orphanedChain.assignedWorkerId = newWorker.id;
        newWorker.on('online', () => {
          newWorker.send({
            type: 'start-monitoring',
            payload: JSON.stringify(orphanedChain)
          });
          logger.event(`Re-assigned ${orphanedChain.name} → Worker ${newWorker.process.pid} (recovery)`);
        });
      }
    }
  });

  // Prevent primary from exiting
  setInterval(() => {}, 1 << 30);
}

// ──────────────────────────────────────────────────────────────
// WORKER PROCESS (REST or MONITOR)
// ──────────────────────────────────────────────────────────────
else {
  startWorker();
}

/**
 * Starts a worker process (shared logic for REST and MONITOR workers)
 * Dynamically imports './server' to initialize HTTP + monitoring
 */
function startWorker() {
  const workerType = process.env.WORKER_TYPE || 'rest';
  logger.info(`WORKER ${process.pid} starting → Type: ${workerType.toUpperCase()}`);

  import('./server')
    .then(() => {
      logger.event(`Worker ${process.pid} fully initialized (${workerType})`);
    })
    .catch(err => {
      logger.error(`Worker ${process.pid} failed to initialize: ${err.message}`);
      logger.error(err.stack);
      process.exit(1);
    });
}
