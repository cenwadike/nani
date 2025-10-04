// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
//
// Copyright (c) 2025 Nani Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including but not limited to the rights
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
 * @file utils/pluginWorker.ts
 * @summary Executes plugin tasks in isolated worker threads.
 * @description This module is registered with `workerpool` to handle plugin execution
 *              for activity filtering and notification dispatching. It ensures tenant-specific
 *              logic is processed concurrently without blocking the main event loop.
 */

import workerpool from 'workerpool';
import { getPlugin } from '../utils/pluginRegistry';
import { ActivityPlugin, NotificationPlugin } from '../types/pluginTypes';
import logger from './logger';

/**
 * @function processPluginTask
 * @description Processes a blockchain event for a specific tenant using configured plugins.
 *              Filters relevant activity events, formats messages, and dispatches notifications.
 * @param task - Contains the event record, tenant ID, and plugin configuration
 * @returns {Promise<any[]>} Array of settled notification promises
 */
async function processPluginTask(task: {
  record: any;
  tenantId: string;
  config: any;
}): Promise<any[]> {
  const { record, tenantId, config } = task;
  const { address, plugins } = config;
  const results: Promise<any>[] = [];

  if (!address || !plugins) {
    logger.error(`Skipping plugin task: missing config for tenant ${tenantId}`);
    return [];
  }

  logger.event(`Processing event for tenant ${tenantId} with ${plugins.activities?.length || 0} activity plugins`);

  const activities = plugins.activities || [];

  for (const act of activities) {
    const plugin = getPlugin('activities', act) as ActivityPlugin;
    if (!plugin) {
      logger.error(`Activity plugin not found: ${act}`);
      continue;
    }

    const isRelevant = await plugin.filter(record, address);
    if (!isRelevant) continue;

    logger.event(`Activity matched: ${act} for tenant ${tenantId}`);

    try {
      const logEntry = await plugin.log(record, address);
      const message = await plugin.formatMessage(logEntry, address);

      const notifications = plugins.notifications || [];

      for (const notif of notifications) {
        const notifPlugin = getPlugin('notifications', notif.type) as NotificationPlugin;
        if (!notifPlugin) {
          logger.error(`Notification plugin not found: ${notif.type}`);
          continue;
        }

        logger.event(`Dispatching notification via ${notif.type} for tenant ${tenantId}`);
        results.push(notifPlugin.execute(message, notif.config));
      }
    } catch (error: any) {
      logger.error(`Plugin execution failed for ${act}: ${error.message}`);
    }
  }

  logger.info(`Completed plugin task for tenant ${tenantId}`);
  return Promise.allSettled(results);
}

// Register the worker function with workerpool
workerpool.worker({ processPluginTask });
