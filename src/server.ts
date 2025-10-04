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
import { plugins } from './utils/pluginRegistry';

process.on('message', (msg: any) => {
  if (msg?.type === 'plugin-init') {
    Object.assign(plugins, JSON.parse(msg.payload));
    logger.info(`Worker ${process.pid} initialized plugins from master`);
  }
});

const numCores = os.cpus().length;
const pool = workerpool.pool(__dirname + '/utils/pluginWorker.ts', {
  maxWorkers: numCores
});

const port = config.port;
app.listen(port, () => {
  logger.info(`Worker ${process.pid} running on port ${port}`);
});

process.on('message', (msg: any) => {
  if (msg?.type === 'start-monitoring') {
    logger.event(`Worker ${process.pid} received start-monitoring signal`);
    startMonitoring();
  }
});

let isMonitoring = false;

async function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    logger.event(`Worker ${process.pid} initiating Polkadot event monitoring...`);
    const api = await getApi();
    if (!api) throw new Error('Failed to connect to Polkadot API');

    api.query.system.events(async (events: any[]) => {
      logger.event(`Worker ${process.pid} received ${events.length} system events`);
      const tenantIds = await storage.getAllTenants();

      const tenantConfigs = await Promise.all(
        tenantIds.map(async (tenantId) => {
          const config = await storage.loadConfig(tenantId);
          return config ? { tenantId, config } : null;
        })
      );

      const tasks: Promise<any>[] = [];

      for (const record of events) {
        for (const tenant of tenantConfigs.filter(Boolean)) {
          tasks.push(
            pool.exec('processPluginTask', [
              {
                record,
                tenantId: tenant!.tenantId,
                config: tenant!.config
              }
            ])
          );
        }
      }

      await Promise.allSettled(tasks);
    });

    logger.event(`Worker ${process.pid} completed plugin dispatch for current event batch`);
  } catch (error) {
    logger.error(`Failed to start monitoring: ${error}`);
    isMonitoring = false;
  }
}
