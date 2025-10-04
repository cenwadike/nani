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
 * @file routes/stats.ts
 * @summary Computes analytics from tenant logs using pluggable stats plugins.
 * @description This route allows authenticated tenants to request computed statistics
 *              from their event logs using a selected stats plugin. Results are returned
 *              in JSON format along with plugin metadata and log count.
 */

import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import { getPlugin } from '../utils/pluginRegistry';
import { StatsPlugin } from '../types/pluginTypes';

const router = Router();

/**
 * @route GET /stats
 * @description Computes and returns statistics from tenant logs using the specified plugin.
 *              Defaults to the 'basic' stats plugin if none is provided.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any;
    const { plugin = 'basic' } = req.query as { plugin?: string };

    // Load tenant logs from encrypted storage
    const logs = await storage.loadLogs(tenantId);

    // Retrieve the requested stats plugin
    const statsPlugin = getPlugin('stats', plugin) as StatsPlugin;
    if (!statsPlugin) {
      return res.status(400).json({ error: `Unknown stats plugin: ${plugin}` });
    }

    // Compute statistics using the plugin
    const stats = statsPlugin.compute(logs);

    // Return computed stats and metadata
    res.json({
      plugin,
      stats,
      logsCount: logs.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
