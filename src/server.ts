// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
//
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
 * @summary Starts the Express server and event monitoring engine.
 * @description This file sets up the HTTP server, and starts 
 *              blockchain event monitoring using Polkadot API (PAPI).
 */

import app from './app';
import config from './config';
import { getApi } from './utils/papi';
import storage from './utils/storage';
import workerpool from 'workerpool';
import os from 'os';
import logger from './utils/logger';
import { ChainConfig } from './config';
import { startReferendumCacheCleanup } from './plugins/activities/governance';
import { startValidatorCacheCleanup } from './plugins/activities/staking';
import { ensurePluginsLoaded } from './utils/pluginRegistry';

const numCores = os.cpus().length;
const pool = workerpool.pool(__dirname + '/utils/pluginWorker.js', { maxWorkers: numCores });

let isMonitoring = false;
let serverInstance: any = null;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // 1. Load plugins FIRST
      logger.info(`Worker ${process.pid} loading plugins...`);
      ensurePluginsLoaded();
      logger.info(`Worker ${process.pid} plugins loaded successfully`);

      // 2. THEN start HTTP server
      const port = config.port;
      // Capture the server instance
      serverInstance = app.listen(port, '0.0.0.0', () => {
        logger.info(`Worker ${process.pid} listening on 0.0.0.0:${port}`);
        resolve();
      });

      // Handle server errors (e.g., address already in use)
      serverInstance.on('error', (error: any) => {
        logger.error(`Worker ${process.pid} server error: ${error.message}`);
        reject(error); // <-- Reject the promise on error
        process.exit(1);
      });

      // 4. Listen for monitoring assignments from primary
      process.on('message', (msg: any) => {
        if (msg?.type === 'start-monitoring' && msg?.payload) {
          const chain: ChainConfig = JSON.parse(msg.payload);
          if (!isMonitoring) {
            logger.info(`Worker ${process.pid} received monitoring assignment for ${chain.name}`);
            startMonitoring(chain);
          }
        }
      });

      // 5. Graceful shutdown
      process.on('SIGTERM', async () => {
        logger.info(`Worker ${process.pid} received SIGTERM, shutting down gracefully...`);
        serverInstance.close(() => {
          logger.info(`Worker ${process.pid} HTTP server closed`);
          pool.terminate();
          process.exit(0);
        });
      });
  } catch (error: any) {
    logger.error(`Worker ${process.pid} startup failed: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    process.exit(1);
  }
  });
}

(async () => {
    try {
        await startServer();
    } catch (error) {
        logger.error(`Server startup failed outside of promise: ${error}`);
        process.exit(1);
    }
})();

async function startMonitoring(chain: ChainConfig) {
  if (isMonitoring) return;
  isMonitoring = true;

  startReferendumCacheCleanup();
  startValidatorCacheCleanup();

  try {
    logger.event(`Worker ${process.pid} monitoring ${chain.name} (${chain.tokenSymbol})`);

    const api = await getApi(chain.name, chain.rpcUrls);
    if (!api) throw new Error('API connection failed');

    await api.query.system.events(async (events: any[]) => {
      if (events.length === 0) return;

      logger.event(`Worker ${process.pid} → ${chain.name}: ${events.length} events`);

      // ──────────────────────────────────────────────────────────────────
      // 1. Get all tenants
      // ──────────────────────────────────────────────────────────────────
      const tenantIds = await storage.getAllTenants();

      // ──────────────────────────────────────────────────────────────────
      // 2. Load per-chain config for each tenant
      // ──────────────────────────────────────────────────────────────────
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
        logger.info(`No tenants configured for chain ${chain.name}`);
        return;
      }

      logger.event(`Processing ${validTenants.length} tenant(s) on ${chain.name}`);

      // ──────────────────────────────────────────────────────────────────
      // 3. Dispatch plugin tasks
      // ──────────────────────────────────────────────────────────────────
      const tasks: Promise<any>[] = [];

      for (const record of events) {
        for (const tenant of validTenants) {
          tasks.push(
            pool.exec('processPluginTask', [
              {
                record,
                tenantId: tenant.tenantId,
                config: tenant.config,
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
    logger.error(`Monitoring failed on ${chain.name}: ${err.message}`);
    isMonitoring = false;
  }
}
