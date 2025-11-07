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
 * @file cluster.ts
 * @summary Initializes a multi-process Node.js cluster for scalable event monitoring.
 * @description This module uses Node.js's native `cluster` API to fork worker processes
 *              across available CPU cores. One designated worker is assigned to start
 *              blockchain event monitoring via Polkadot API (PAPI), the rest serve requests.
 */
// cluster.ts
import cluster from 'cluster';
import os from 'os';
import logger from './utils/logger';
import { loadPlugins, plugins } from './utils/pluginRegistry';
import { CHAINS } from './config';

loadPlugins();

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  logger.info(`Primary ${process.pid} with ${numCPUs} cores`);

  const numRest = Math.max(1, numCPUs - CHAINS.length);
  logger.info(`Forking ${numRest} REST workers`);
  for (let i = 0; i < numRest; i++) cluster.fork();

  logger.info(`Forking ${CHAINS.length} monitoring workers`);
  CHAINS.forEach(() => cluster.fork());

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork(); // Always ensure workers are running
  });

  cluster.on('online', (worker) => {
    const freeChain = CHAINS.find(c => !c.assignedWorkerId);
    if (freeChain) {
      freeChain.assignedWorkerId = worker.id;
      worker.send({ type: 'start-monitoring', payload: JSON.stringify(freeChain) });
      logger.event(`Assigned worker ${worker.process.pid} → ${freeChain.name}`);
    }
  });

  setInterval(() => {
    // This empty interval keeps the Node.js event loop active
    // and prevents the primary process from exiting normally.
  }, 1000 * 60 * 60); // Check in every hour, just to keep loop open.
} else {
  logger.info(`Worker ${process.pid} starting...`);
  
  import('./server').catch((err) => {
    logger.error(`Worker ${process.pid} CRITICAL IMPORT FAILURE:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Error name: ${err.name}`);
    logger.error(`Stack trace: ${err.stack}`);
    
    // Log the current directory and available files
    const fs = require('fs');
    const path = require('path');
    logger.error(`Current __dirname: ${__dirname}`);
    logger.error(`Files in dist/: ${fs.readdirSync(path.join(__dirname, '../')).join(', ')}`);
    
    process.exit(1);
  });
}
