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

import cluster from 'cluster';
import os from 'os';
import logger from './utils/logger';

// Determine the number of logical CPU cores available for clustering.
const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  // Log the PID of the primary (master) process.
  logger.info(`Primary process ${process.pid} is running with ${numCPUs} workers`);

  // Fork a worker process for each CPU core.
  for (let i = 0; i < numCPUs; i++) {
    const worker = cluster.fork();
    logger.info(`Forked worker ${worker.process.pid}`);

    // Designate the first worker to initiate blockchain event monitoring.
    if (i === 0) {
      logger.event(`Worker ${worker.process.pid} assigned to start monitoring`);
      worker.send({ type: 'start-monitoring' });
    }
  }

  // Handle worker exit events and automatically restart failed workers.
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Worker ${worker.process.pid} exited with code ${code} and signal ${signal}`);
    const newWorker = cluster.fork();
    logger.info(`Restarted worker ${newWorker.process.pid}`);
  });
} else {
  // Load the Express server and plugin engine in each worker process.
  logger.info(`Worker ${process.pid} initializing server`);
  require('./server');
}
