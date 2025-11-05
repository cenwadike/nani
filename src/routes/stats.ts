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
 */// SPDX-License-Identifier: MIT
/**
 * @file routes/stats.ts
 * @summary Storage-aware analytics endpoint
 *
 *  ?plugin=basic          → default stats plugin
 *  ?chainId=westend       → limit to one chain
 *  ?from=2025-11-01
 *  ?to=2025-11-05
 */

import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import { getPlugin } from '../utils/pluginRegistry';
import { StatsPlugin } from '../types/pluginTypes';
import path from 'path';
import { promises as fsp, existsSync } from 'fs';

const router = Router();

/* --------------------------------------------------------------------- */
/* Helper – load logs for a *single* chain (optional)                     */
/* --------------------------------------------------------------------- */
async function loadChainLogs(
  tenantId: string,
  chainId: string | undefined,
  from?: Date,
  to?: Date
): Promise<any[]> {
  // 1. Load *all* logs (the existing implementation already walks the whole
  //    `logs/` tree and decrypts line-by-line)
  const all = await storage.loadLogs(tenantId);

  // 2. Filter by chain + optional date window
  return all.filter((log) => {
    if (chainId && log.chain !== chainId) return false;
    const ts = new Date(log.timestamp).getTime();
    if (from && ts < from.getTime()) return false;
    if (to && ts > to.getTime()) return false;
    return true;
  });
}

/* --------------------------------------------------------------------- */
/* Helper – collect storage statistics                                   */
/* --------------------------------------------------------------------- */
interface ChainStat {
  chainId: string;
  logCount: number;
  sizeBytes: number;
}
interface StorageMeta {
  totalSizeBytes: number;
  logFileCount: number;
  chainCount: number;
  chains: ChainStat[];
}

async function getStorageMeta(tenantId: string, logs: any[]): Promise<StorageMeta> {
const tenantDir = storage.getTenantDir(tenantId);
  const logsDir = path.join(tenantDir, 'logs');

  const meta: StorageMeta = {
    totalSizeBytes: 0,
    logFileCount: 0,
    chainCount: 0,
    chains: [],
  };

  // ---- chain list ----------------------------------------------------
  const chainIds = await storage.getChainIdsForTenant(tenantId);
  meta.chainCount = chainIds.length;

  // ---- per-chain log count & approximate size ------------------------
  for (const cid of chainIds) {
    const chainLogs = logs.filter((l) => l.chain === cid);
    const size = chainLogs.reduce((s, l) => s + JSON.stringify(l).length, 0);
    meta.chains.push({ chainId: cid, logCount: chainLogs.length, sizeBytes: size });
  }

  // ---- walk the actual log files to get exact on-disk size ----------
  if (existsSync(logsDir)) {
    const months = await fsp.readdir(logsDir);
    for (const month of months) {
      const monthPath = path.join(logsDir, month);
      const days = await fsp.readdir(monthPath);
      meta.logFileCount += days.length;
      for (const day of days) {
        const file = path.join(monthPath, day);
        const st = await fsp.stat(file);
        meta.totalSizeBytes += st.size;
      }
    }
  }

  return meta;
}

/* --------------------------------------------------------------------- */
/* GET /stats                                                            */
/* --------------------------------------------------------------------- */
/**
 * @route GET /stats
 * @query { plugin=basic, chainId?, from?, to? }
 * @description
 *   • ?plugin=basic → default stats plugin  
 *   • ?chainId=westend → limit to one chain  
 *   • ?from=2025-11-01&to=2025-11-05 → date range filter
 *
 * @openapi
 * /stats:
 *   get:
 *     summary: Compute analytics using a pluggable stats plugin
 *     description: |
 *       Returns computed statistics from tenant logs using the specified `stats` plugin.
 *       Includes:
 *       - Filtered log count
 *       - Plugin-specific `stats` result
 *       - On-disk storage metadata (file count, size per chain)
 *     tags:
 *       - Stats
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: plugin
 *         schema:
 *           type: string
 *           default: basic
 *         required: false
 *         description: Name of the registered stats plugin
 *         example: basic
 *       - in: query
 *         name: chainId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter logs to a single chain
 *         example: westend
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: Inclusive start date (UTC, YYYY-MM-DD)
 *         example: 2025-11-01
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: Inclusive end date (UTC, YYYY-MM-DD)
 *         example: 2025-11-05
 *     responses:
 *       '200':
 *         description: Analytics computed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StatsResponse'
 *             examples:
 *               basic-plugin:
 *                 summary: Basic stats for westend (last 5 days)
 *                 value:
 *                   plugin: basic
 *                   filters:
 *                     chainId: westend
 *                     from: 2025-11-01
 *                     to: 2025-11-05
 *                   result:
 *                     logsProcessed: 842
 *                     stats:
 *                       totalTransfers: 320
 *                       totalStaked: "124500000000000"
 *                       uniqueValidators: 12
 *                   storage:
 *                     totalSizeBytes: 2841293
 *                     totalSizeMB: 2.71
 *                     logFileCount: 5
 *                     chainCount: 1
 *                     chains:
 *                       - chainId: westend
 *                         logCount: 842
 *                         sizeBytes: 2841293
 *                   generatedAt: "2025-11-05T14:22:10.123Z"
 *       '400':
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid "from" date
 *       '500':
 *         description: Internal server error
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any;
    const {
      plugin: pluginName = 'basic',
      chainId,
      from: fromStr,
      to: toStr,
    } = req.query as {
      plugin?: string;
      chainId?: string;
      from?: string;
      to?: string;
    };

    // ---- 1. parse optional date window --------------------------------
    let from: Date | undefined;
    let to: Date | undefined;
    if (fromStr) {
      from = new Date(fromStr);
      if (isNaN(from.getTime())) return res.status(400).json({ error: 'Invalid "from" date' });
      from.setHours(0, 0, 0, 0);
    }
    if (toStr) {
      to = new Date(toStr);
      if (isNaN(to.getTime())) return res.status(400).json({ error: 'Invalid "to" date' });
      to.setHours(23, 59, 59, 999);
    }
    if (from && to && from > to) {
      return res.status(400).json({ error: '"from" must be before "to"' });
    }

    // ---- 2. load (and filter) logs ------------------------------------
    const logs = await loadChainLogs(tenantId, chainId, from, to);

    // ---- 3. storage metadata -------------------------------------------
    const storageMeta = await getStorageMeta(tenantId, logs);

    // ---- 4. run the requested stats plugin ----------------------------
    const plugin = getPlugin('stats', pluginName) as StatsPlugin | undefined;
    if (!plugin) {
      return res.status(400).json({ error: `Unknown stats plugin: ${pluginName}` });
    }
    const computed = plugin.compute(logs);

    // ---- 5. final payload ---------------------------------------------
    res.json({
      plugin: pluginName,
      filters: {
        chainId: chainId ?? null,
        from: fromStr ?? null,
        to: toStr ?? null,
      },
      result: {
        logsProcessed: logs.length,
        stats: computed,
      },
      storage: {
        ...storageMeta,
        totalSizeMB: Number((storageMeta.totalSizeBytes / (1024 * 1024)).toFixed(2)),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
