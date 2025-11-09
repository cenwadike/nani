// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event notifications service.
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
 * @file routes/export.ts
 * @summary Exports tenant-specific event logs in CSV or JSON format.
 * @description This route allows authenticated tenants to download their encrypted event logs
 *              in either CSV or JSON format. The CSV output is formatted for readability and analysis.
 */
// SPDX-License-Identifier: MIT
// routes/export.ts
/**
 * @file routes/export.ts
 * @summary Export logs with per-type CSV files + time/chain filtering
 * @description
 *   • ?chainId=westend&type=governance → westend-gov.csv
 *   • ?chainId=westend&type=transfer,staking → westend-transfer+staking.csv
 *   • ?chainId=westend → westend.csv (all types)
 *   • ?from=2025-11-01&to=2025-11-05
 */

import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import logger from '../utils/logger';

const router = Router();

/**
 * @route GET /export
 * @query { chainId?, type?, format=csv, from?, to? }
 * @description
 *   • ?chainId=westend&type=governance → westend-gov.csv  
 *   • ?chainId=westend&type=transfer,staking → ZIP with transfer+staking CSVs  
 *   • ?from=2025-11-01&to=2025-11-05 → date range filter
 *
 * @openapi
 * /export:
 *   get:
 *     summary: Export tenant event logs (CSV / JSON / ZIP)
 *     tags:
 *       - Export
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chainId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filter by chain (e.g. westend, polkadot)
 *         example: westend
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         required: false
 *         description: Comma-separated event types. Omit for all.
 *         example: transfer,staking
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *           default: csv
 *         required: false
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: Inclusive start date (YYYY-MM-DD)
 *         example: 2025-11-01
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: Inclusive end date (YYYY-MM-DD)
 *         example: 2025-11-05
 *     responses:
 *       '200':
 *         description: |
 *           - **CSV**: Single file or ZIP (one CSV per type)  
 *           - **JSON**: `{ logs: [...] }`  
 *           Filename set via `Content-Disposition`
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EventLog'
 *       '400':
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid "from" date
 *       '404':
 *         description: No logs match filters
 *         content:
 *           application/json:
 *             example:
 *               error: No logs for requested type(s)
 *       '500':
 *         description: Internal error
 */
router.get('/', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const {
    chainId,
    type: typeParam,
    format = 'csv',
    from: fromStr,
    to: toStr,
  } = req.query as {
    chainId?: string;
    type?: string;
    format?: 'csv' | 'json';
    from?: string;
    to?: string;
  };

  try {
    // ──────────────────────────────────────────────────────────────
    // 1. Parse time range
    // ──────────────────────────────────────────────────────────────
    let fromDate: Date | null = null;
    let toDate: Date | null = null;

    if (fromStr) {
      fromDate = new Date(fromStr);
      if (isNaN(fromDate.getTime())) return res.status(400).json({ error: 'Invalid "from" date' });
      fromDate.setHours(0, 0, 0, 0);
    }
    if (toStr) {
      toDate = new Date(toStr);
      if (isNaN(toDate.getTime())) return res.status(400).json({ error: 'Invalid "to" date' });
      toDate.setHours(23, 59, 59, 999);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ error: '"from" must be before "to"' });
    }

    // ──────────────────────────────────────────────────────────────
    // 2. Load & filter logs
    // ──────────────────────────────────────────────────────────────
    const allLogs = await storage.loadLogs(tenantId);
    const filtered = allLogs.filter((log) => {
      const logTime = new Date(log.timestamp).getTime();
      if (chainId && log.chain !== chainId) return false;
      if (fromDate && logTime < fromDate.getTime()) return false;
      if (toDate && logTime > toDate.getTime()) return false;
      return true;
    });

    if (filtered.length === 0) {
      const err = Buffer.from(JSON.stringify({ error: 'No logs match filters' }));
      return sendFile(res, err, `nani-${tenantId}-no-data.json`, 'application/json');
    }

    // ──────────────────────────────────────────────────────────────
    // 3. Determine export mode
    // ──────────────────────────────────────────────────────────────
    const requestedTypes = typeParam
      ? typeParam.split(',').map(t => t.trim().toLowerCase())
      : null;

    const typesToExport = requestedTypes
      ? [...new Set(filtered.map(l => l.type).filter(t => requestedTypes.includes(t.toLowerCase())))]
      : [...new Set(filtered.map(l => l.type))];

    if (typesToExport.length === 0) {
      return res.status(404).json({ error: 'No logs for requested type(s)' });
    }

    const dateRange = fromStr && toStr ? `${fromStr}_to_${toStr}` : '';
    const chainPart = chainId ? `-${chainId}` : '';

    // ──────────────────────────────────────────────────────────────
    // 4. CSV: One file per type (or one combined)
    // ──────────────────────────────────────────────────────────────
    if (format === 'csv') {

      // Single file: all types
      if (!requestedTypes || typesToExport.length === 1) {
        const type = typesToExport[0];
        const logs = requestedTypes ? filtered.filter(l => l.type === type) : filtered;
        const filename = requestedTypes
          ? `nani-${tenantId}${chainPart}-${type}${dateRange ? '-' + dateRange : ''}.csv`
          : `nani-${tenantId}${chainPart}${dateRange ? '-' + dateRange : ''}.csv`;

        const csv = buildCsv(logs, typesToExport);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csv);
      }

      // Multiple files: ZIP with one CSV per type
      const { default: archiver } = await import('archiver');
      const archive = archiver('zip', { zlib: { level: 9 } });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="nani-${tenantId}${chainPart}-export${dateRange ? '-' + dateRange : ''}.zip"`);
      archive.pipe(res);

      for (const type of typesToExport) {
        const logs = filtered.filter(l => l.type === type);
        const csv = buildCsv(logs, [type]);
        const filename = `nani-${tenantId}${chainPart}-${type}.csv`;
        archive.append(csv, { name: filename });
      }

      await archive.finalize();
      return;
    }

    // ──────────────────────────────────────────────────────────────
    // 5. JSON: Always one file
    // ──────────────────────────────────────────────────────────────
    if (format === 'json') {
      const filename = `nani-${tenantId}${chainPart}${requestedTypes ? '-' + typesToExport.join('+') : ''}${dateRange ? '-' + dateRange : ''}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json({ logs: filtered.filter(l => typesToExport.includes(l.type)) });
    }

    return res.status(400).json({ error: 'Invalid format' });
  } catch (err: any) {
    logger.error(`Export failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────
// Helper: Build CSV for given logs and types
// ──────────────────────────────────────────────────────────────────
function buildCsv(logs: any[], types: string[]): string {
  const baseHeaders = ['Timestamp', 'Chain', 'Token', 'Type'];
  const typeColumns: Record<string, string[]> = {
    transfer: ['Direction', 'From', 'To', 'Amount (Token)', 'Amount (Planck)'],
    staking: ['Direction', 'Validator', 'Reward (Token)', 'Reward (Planck)', 'Era', 'Total Era Stake'],
    governance: ['Action', 'Referendum', 'Vote', 'Track'],
    extrinsic: ['Signer', 'Section', 'Method'],
  };

  const extraHeaders = types.flatMap(t => typeColumns[t] || []);
  const headers = [...baseHeaders, ...extraHeaders, 'Block'];

  const rows = logs.map(log => {
    const row: string[] = [log.timestamp, log.chain ?? '', log.token ?? '', log.type];

    switch (log.type) {
      case 'transfer':
        row.push(
          log.direction ?? '',
          log.from ?? '',
          log.to ?? '',
          log.amount != null ? (log.amount / 1e12).toFixed(6) : '',
          log.amount?.toString() ?? ''
        );
        break;
      case 'staking':
        row.push(
          log.direction ?? '',
          log.validator?.name ?? log.validator?.address ?? '',
          log.amount != null ? (log.amount / 1e12).toFixed(6) : '',
          log.amountPlanck?.toString() ?? '',
          log.era?.toString() ?? '',
          log.totalEraStake != null ? log.totalEraStake.toFixed(2) : ''
        );
        break;
      case 'governance':
        row.push(
          log.action ?? '',
          log.referendum?.id?.toString() ?? '',
          log.vote?.aye !== undefined ? (log.vote.aye ? 'Aye' : 'Nay') : '',
          log.referendum?.track != null ? log.referendum.track.toString() : ''
        );
        break;
      case 'extrinsic':
        row.push(
          log.signer ?? '',
          log.section ?? '',
          log.method ?? ''
        );
        break;
      default:
        row.push(...Array(extraHeaders.length).fill(''));
    }

    row.push(log.blockNumber?.toString() ?? '');
    return row;
  });

  return [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${c}"`).join(',')),
  ].join('\n');
}

function sendFile(res: Response, buffer: Buffer, filename: string, mime: string) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

export default router;
