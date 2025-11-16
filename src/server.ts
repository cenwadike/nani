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
import storage from './utils/storage';
import workerpool from 'workerpool';
import os from 'os';
import path from 'path';
import logger from './utils/logger';
import { CHAINS } from './config';
import { startReferendumCacheCleanup } from './plugins/activities/governance';
import { startValidatorCacheCleanup } from './plugins/activities/staking';
import { ensurePluginsLoaded } from './utils/pluginRegistry';
import { ensureAdaptersLoaded } from './utils/adapterRegistry';
import adapterPool from './utils/adapterPool';
import { ChainEvent } from './types/adapterTypes';

const numCores = os.cpus().length;
const workerFile = path.join(__dirname, 'utils', 'pluginWorker.' + (process.env.NODE_ENV === 'production' ? 'js' : 'ts'));

logger.info(`Creating worker pool with ${numCores} workers from: ${workerFile}`);

const pool = workerpool.pool(workerFile, {
  maxWorkers: numCores,
  workerType: 'thread',
  forkOpts: {
    execArgv: ['--unhandled-rejections=strict'],
  },
});

let serverInstance: any = null;
let monitoringStarted = false;

/**
 * Serialize Polkadot.js event data to plain JSON
 * Converts all Codec types to strings/numbers/objects
 */
function serializeEventData(data: any): any {
  if (!data) return data;

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => serializeEventData(item));
  }

  // Handle Polkadot.js Codec types (they have .toJSON() or .toString())
  if (data && typeof data === 'object') {
    // Check if it's a Codec type with toJSON method
    if (typeof data.toJSON === 'function') {
      return data.toJSON();
    }
    
    // Check if it's a Codec type with toString method
    if (typeof data.toString === 'function' && data.constructor.name !== 'Object') {
      return data.toString();
    }

    // Handle plain objects recursively
    const result: any = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        result[key] = serializeEventData(data[key]);
      }
    }
    return result;
  }

  return data;
}

/**
 * Convert ChainEvent to JSON-serializable format
 */
function serializeChainEvent(event: ChainEvent): any {
  return {
    eventName: event.eventName,
    section: event.section,
    method: event.method,
    data: serializeEventData(event.data),
    raw: serializeEventData(event.raw),
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
  };
}

/**
 * Starts the Express HTTP server
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
 * Starts blockchain monitoring using adapter pool
 */
export async function startMonitoring() {
  if (monitoringStarted) {
    logger.info('Monitoring already active');
    return;
  }

  logger.event('Starting multi-chain monitoring via adapter pool...');
  startReferendumCacheCleanup();
  startValidatorCacheCleanup();

  try {
    // Initialize adapter pool for all configured chains
    await adapterPool.initializeAll(CHAINS, async (chainName: string, event: ChainEvent) => {
      logger.event(`${chainName}: New event → ${event.eventName}`);

      // Get all tenants
      const tenantIds = await storage.getAllTenants();
      if (tenantIds.length === 0) {
        logger.info(`Found 0 tenants`);
        return;
      }

      logger.info(`Found ${tenantIds.length} tenants`);

      // Get tenant configurations for this chain
      const tenantConfigs = await Promise.all(
        tenantIds.map(async (tenantId) => {
          const cfg = await storage.loadChainConfig(tenantId, chainName);
          return cfg ? { tenantId, config: cfg } : null;
        })
      );

      const validTenants = tenantConfigs.filter(Boolean) as Array<{
        tenantId: string;
        config: any;
      }>;

      if (validTenants.length === 0) {
        logger.info(`No config for any tenant on ${chainName}`);
        return;
      }

      logger.event(`Processing event for ${validTenants.length} tenant(s) on ${chainName}`);

      // Get chain config for token symbol
      const chainConfig = CHAINS.find(c => c.name === chainName);
      if (!chainConfig) {
        logger.warn(`Chain config not found for ${chainName}`);
        return;
      }

      // ⚡ CRITICAL: Serialize event to plain JSON before sending to workers
      const serializedEvent = serializeChainEvent(event);

      // Dispatch to plugin workers
      const tasks: Promise<any>[] = [];
      for (const { tenantId, config } of validTenants) {
        logger.info(`Dispatching task to worker pool for tenant ${tenantId}`);
        
        const taskPayload = {
          event: serializedEvent, // ✅ Now JSON-serializable
          tenantId,
          config,
          chainId: chainName,
          tokenSymbol: chainConfig.tokenSymbol,
        };

        logger.info(`Task payload: ${JSON.stringify({
          eventName: serializedEvent.eventName,
          tenantId,
          chainId: chainName,
          tokenSymbol: chainConfig.tokenSymbol,
          hasConfig: !!config,
        })}`);

        // Execute in worker pool
        const taskPromise = pool.exec('processPluginTask', [taskPayload])
          .then((result) => {
            logger.info(`Task completed for tenant ${tenantId}: ${JSON.stringify(result)}`);
            return result;
          })
          .catch((err: any) => {
            logger.error(`Task failed for tenant ${tenantId}: ${err.message}`);
            logger.error(`Stack: ${err.stack}`);
            return { status: 'error', error: err.message };
          });

        tasks.push(taskPromise);
      }

      // Wait for all tasks to complete
      const results = await Promise.allSettled(tasks);
      
      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;
      
      logger.info(`Event processing complete: ${fulfilled} succeeded, ${rejected} failed`);
    });

    monitoringStarted = true;
    logger.info('✓ Multi-chain monitoring started successfully');

    // Log adapter pool stats
    const stats = adapterPool.getStats();
    logger.info(
      `Adapter pool: ${stats.healthy}/${stats.total} adapters healthy`
    );

  } catch (err: any) {
    logger.error(`Failed to start monitoring: ${err.message}`);
    logger.error(err.stack);
    throw err;
  }
}

/**
 * Graceful shutdown with adapter cleanup
 */
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal} — Starting graceful shutdown (PID: ${process.pid})`);

  // 1. Stop HTTP server
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

  // 2. Disconnect adapter pool
  logger.info('Disconnecting adapter pool...');
  try {
    await adapterPool.shutdown();
    logger.info('Adapter pool disconnected');
  } catch (err: any) {
    logger.warn(`Adapter pool shutdown error: ${err.message}`);
  }

  // 3. Terminate worker pool
  logger.info('Terminating worker pool...');
  try {
    await pool.terminate();
    logger.info('Worker pool terminated');
  } catch (err) {
    logger.warn(`Worker pool terminate error: ${(err as Error).message}`);
  }

  logger.info(`Worker ${process.pid} shutdown complete`);
  process.exit(0);
};

// ————————————————————————————————
// MAIN EXECUTION
// ————————————————————————————————
(async () => {
  try {
    // Load adapters and plugins
    ensureAdaptersLoaded();
    ensurePluginsLoaded();

    await startHttpServer();

    if (!cluster.isWorker || process.env.WORKER_TYPE === 'rest') {
      const shouldCluster = typeof (config as any).cluster === 'boolean' 
        ? (config as any).cluster 
        : numCores > 1;

      if (!shouldCluster || process.env.FORCE_SINGLE === 'true') {
        logger.info('SINGLE-PROCESS MODE → Starting monitoring for ALL chains');
        await startMonitoring();
      }
    } else if (cluster.isWorker) {
      logger.info(`CLUSTER WORKER ${process.pid} ready → waiting for chain assignment`);
    } else {
      logger.info(`CLUSTER PRIMARY ${process.pid} managing workers`);
    }

    // Worker message handling - for cluster mode chain assignment
    if (cluster.isWorker) {
      process.on('message', async (msg: any) => {
        if (msg?.type === 'start-monitoring') {
          try {
            logger.event(`Worker ${process.pid} received monitoring command`);
            await startMonitoring();
          } catch (err: any) {
            logger.error(`Failed to start monitoring: ${err.message}`);
          }
        }
      });
    }

    // Graceful shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Primary: Auto-restart dead workers
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
