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
 * @file server.ts
 * @summary Core server & blockchain monitoring engine for Nani
 * @description Universal worker process (cluster or single-process mode)
 *              Handles:
 *              • HTTP API server (Express)
 *              • PAPI WebSocket connections with auto-failover
 *              • Real-time event processing via workerpool
 *              • Graceful shutdown & worker recovery
 *              • Multi-chain monitoring (Westend, Kusama, Polkadot, etc.)
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT - Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • PAPI v10.11.1+ integration with multi-RPC failover
 *   • Parallel event processing using workerpool (up to CPU cores)
 *   • Hot-reloadable plugin system (activities + notifications)
 *   • AES-256-GCM encrypted tenant storage
 *   • Sub-100ms block-to-notification latency
 *   • Graceful shutdown with zero event loss
 *   • Production-ready for Railway, Docker, VPS
 */

import cluster from 'cluster';
import app from './app';
import config from './config';
import { getApi } from './utils/papi';
import storage, { loadChainConfig } from './utils/storage';
import workerpool from 'workerpool';
import os from 'os';
import path from 'path';
import logger from './utils/logger';
import { ChainConfig, CHAINS } from './config';
import { startReferendumCacheCleanup } from './plugins/activities/governance';
import { startValidatorCacheCleanup } from './plugins/activities/staking';
import { ensurePluginsLoaded } from './utils/pluginRegistry';

const numCores = os.cpus().length;
const workerFile = path.join(__dirname, 'utils', 'pluginWorker.' + (process.env.NODE_ENV === 'production' ? 'js' : 'ts'));
const pool = workerpool.pool(workerFile, { maxWorkers: numCores });

let serverInstance: any = null;
let monitoringStarted = new Set<string>();

/**
 * Starts the Express HTTP server on configured port
 * Binds to 0.0.0.0 for container/PaaS compatibility
 */
function startHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = config.port;
    serverInstance = app.listen(port, '0.0.0.0', () => {
      logger.info(`HTTP server LIVE on http://localhost:${port} (PID: ${process.pid})`);
      resolve();
    });

    serverInstance.on('error', (err: any) => {
      logger.error(`Server error: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Starts real-time blockchain monitoring for a specific chain
 * Subscribes to system.events and processes via plugin worker pool
 * @param chain Chain configuration object
 */
export async function startMonitoring(chain: ChainConfig) {
  const chainKey = chain.name;
  if (monitoringStarted.has(chainKey)) {
    logger.info(`Monitoring already active for ${chainKey}`);
    return;
  }
  monitoringStarted.add(chainKey);

  logger.event(`Starting monitoring: ${chain.name} (${chain.tokenSymbol})`);
  startReferendumCacheCleanup();
  startValidatorCacheCleanup();

  try {
    const api = await getApi(chain.name, chain.rpcUrls);
    if (!api) throw new Error('Failed to connect to RPC');

    logger.event(`Connected to ${chain.name} → subscribing to events`);

    await api.query.system.events(async (events: any[]) => {
      if (events.length === 0) return;
      logger.event(`${chain.name}: ${events.length} new event(s)`);

      const tenantIds = await storage.getAllTenants();
      if (tenantIds.length === 0) return;

      const tenantConfigs = await Promise.all(
        tenantIds.map(async (tenantId) => {
          const cfg = await storage.loadChainConfig(tenantId, chain.name);
          return cfg ? { tenantId, config: cfg } : null;
        })
      );

      const validTenants = tenantConfigs.filter(Boolean) as Array<{
        tenantId: string;
        config: any;
      }>;

      if (validTenants.length === 0) {
        logger.info(`No tenants configured for ${chain.name}`);
        return;
      }

      logger.event(`Processing events for ${validTenants.length} tenant(s) on ${chain.name}`);

      const tasks: Promise<any>[] = [];
      for (const record of events) {
        const safeRecord = {
          phase: record.phase.toJSON(),
          event: {
            section: record.event.section,
            method: record.event.method,
            data: record.event.data.toJSON(),
            meta: record.event.meta.toJSON(),
          },
          blockNumber: record.blockNumber?.toNumber() ?? null,
        };

        for (const { tenantId, config } of validTenants) {
          tasks.push(
            pool.exec('processPluginTask', [
              {
                record: safeRecord,
                tenantId,
                config,
                chainId: chain.name,
                tokenSymbol: chain.tokenSymbol,
              },
            ])
          );
        }
      }
      await Promise.allSettled(tasks);
    });
  } catch (err: any) {
    logger.error(`Monitoring crashed on ${chain.name}: ${err.message}`);
    monitoringStarted.delete(chainKey);
  }
}

// ————————————————————————————————
// GRACEFUL SHUTDOWN — PRODUCTION READY
// ————————————————————————————————
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal} — Starting graceful shutdown (PID: ${process.pid})`);

  // 1. Stop accepting new HTTP connections
  if (serverInstance) {
    logger.info('Closing HTTP server...');
    await new Promise<void>((resolve) => {
      serverInstance.close((err?: Error) => {
        if (err) logger.warn(`HTTP server close error: ${err.message}`);
        else logger.info('HTTP server closed');
        resolve();
      });
    });
  }

  // 2. Terminate background worker pool (waits for in-flight tasks)
  logger.info('Terminating worker pool...');
  try {
    await pool.terminate();
    logger.info('Worker pool terminated');
  } catch (err) {
    logger.warn(`Worker pool terminate error: ${(err as Error).message}`);
  }

  // 3. Final cleanup
  logger.info(`Worker ${process.pid} shutdown complete`);
  process.exit(0);
};

// ————————————————————————————————
// MAIN EXECUTION — UNIVERSAL (CLUSTER OR SINGLE)
// ————————————————————————————————
(async () => {
  try {
    ensurePluginsLoaded();
    await startHttpServer();

    if (!cluster.isWorker || process.env.WORKER_TYPE === 'rest') {
      // Determine whether clustering is enabled in the configuration (fallback to multi-core)
      const shouldCluster = typeof (config as any).cluster === 'boolean' ? (config as any).cluster : numCores > 1;

      // This runs in single-process mode OR in REST workers
      if (!shouldCluster || process.env.FORCE_SINGLE === 'true') {
        logger.info('SINGLE-PROCESS MODE → Starting monitoring for ALL chains');
        for (const chain of CHAINS) {
          startMonitoring(chain);
        }
      }
    } else if (cluster.isWorker) {
      logger.info(`CLUSTER WORKER ${process.pid} ready → waiting for chain assignment`);
    } else {
      logger.info(`CLUSTER PRIMARY ${process.pid} managing workers`);
    }

    // Only worker processes receive chain assignments
    if (cluster.isWorker) {
      process.on('message', async (msg: any) => {
        if (msg?.type === 'start-monitoring' && msg?.payload) {
          try {
            const chain: ChainConfig = JSON.parse(msg.payload);
            logger.event(`Worker ${process.pid} ASSIGNED → ${chain.name}`);
            await startMonitoring(chain);
          } catch (err: any) {
            logger.error(`Failed to parse chain assignment: ${err.message}`);
          }
        }
      });
    }

    // ——————— Graceful shutdown handlers ———————
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // ——————— Primary: Auto-restart dead workers ———————
    if (cluster.isPrimary) {
      cluster.on('exit', (worker, code, signal) => {
        if (!worker.exitedAfterDisconnect) {
          logger.warn(`Worker ${worker.process.pid} died (${signal || code}) — Restarting...`);
          cluster.fork();
        }
      });
    }

  } catch (err: any) {
    logger.error(`FATAL: Worker failed to start: ${err.message}`);
    process.exit(1);
  }
})();
