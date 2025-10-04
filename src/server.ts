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
 * @summary Initializes the Express application and event monitoring engine.
 * @description This file sets up the loads plugins, configures middleware, HTTP server,
 *              and starts blockchain event monitoring using Polkadot API (PAPI).
 */

import { loadPlugins } from './utils/pluginRegistry';
loadPlugins(); // Dynamically load all activity, notification, and stats plugins

import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import { getApi } from './utils/papi';
import storage from './utils/storage';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import statsRouter from './routes/stats';
import exportRouter from './routes/export';
import workerpool from 'workerpool';
import os from 'os';
import logger from './utils/logger';

// Create a worker pool for plugin execution, scaled to available CPU cores
const numCores = os.cpus().length;
const pool = workerpool.pool(__dirname + '/utils/pluginWorker.ts', {
  maxWorkers: numCores
});

const app: Application = express();

// Apply security and rate-limiting middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);

logger.info(`Worker ${process.pid} initializing Express server...`);

// Log incoming requests with process ID for debugging
app.use((req: Request, res: Response, next: Function) => {
  logger.info(`Worker ${process.pid} received ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// Mount API routes
app.use('/auth', authRouter);
app.use('/setup', verifyToken, setupRouter);
app.use('/stats', verifyToken, statsRouter);
app.use('/export', verifyToken, exportRouter);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use(errorHandler);

// Start Express server
const port = config.port;
app.listen(port, () => {
  logger.info(`Worker ${process.pid} running on port ${port}`);
});

// Listen for IPC messages from the cluster master
process.on('message', (msg: any) => {
  if (msg?.type === 'start-monitoring') {
    logger.event(`Worker ${process.pid} received start-monitoring signal`);
    startMonitoring();
  }
});

let isMonitoring = false;

/**
 * @function startMonitoring
 * @description Subscribes to Polkadot system events and dispatches plugin tasks per tenant.
 */
async function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    logger.event(`Worker ${process.pid} initiating Polkadot event monitoring...`);
    const api = await getApi();
    if (!api) throw new Error('Failed to connect to Polkadot API');

    // Subscribe to system events
    api.query.system.events(async (events: any[]) => {
      logger.event(`Worker ${process.pid} received ${events.length} system events`);
      const tenantIds = await storage.getAllTenants();

      // Load tenant configurations
      const tenantConfigs = await Promise.all(
        tenantIds.map(async (tenantId) => {
          const config = await storage.loadConfig(tenantId);
          return config ? { tenantId, config } : null;
        })
      );

      const tasks: Promise<any>[] = [];

      // Dispatch plugin tasks for each tenant and event
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

      // Wait for all plugin tasks to settle
      await Promise.allSettled(tasks);
    });
    logger.event(`Worker ${process.pid} completed plugin dispatch for current event batch`);
  } catch (error) {
    logger.error(`Failed to start monitoring: ${error}`);
    isMonitoring = false;
  }
}
