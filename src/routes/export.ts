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
 * @file routes/export.ts
 * @summary Exports tenant-specific event logs in CSV or JSON format.
 * @description This route allows authenticated tenants to download their encrypted event logs
 *              in either CSV or JSON format. The CSV output is formatted for readability and analysis.
 */

import { Router, Request, Response } from 'express';
import storage from '../utils/storage';

const router = Router();

/**
 * @route GET /export
 * @description Returns tenant logs in the requested format (`csv` or `json`).
 *              Defaults to CSV if no format is specified.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any;
    const { format = 'csv' } = req.query as { format?: string };

    // Load logs from encrypted tenant storage
    const logs = await storage.loadLogs(tenantId);

    if (logs.length === 0) {
      return res.status(404).json({ error: 'No logs found' });
    }

    if (format === 'csv') {
      // Define CSV headers
      const headers = ['Timestamp', 'Type', 'Direction', 'From', 'To', 'Amount', 'Block'];

      // Format each log entry into a CSV row
      const rows = logs.map((log: any) => [
        log.timestamp,
        log.type,
        log.direction,
        log.from,
        log.to,
        (log.amount / 1e12).toFixed(4), // Convert planck to DOT
        log.blockNumber,
      ]);

      // Assemble CSV string
      const csv = [
        headers.join(','),
        ...rows.map((row: string[]) => row.map((cell) => `"${cell}"`).join(',')),
      ].join('\n');

      // Set response headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="nani-logs-${tenantId}.csv"`);
      res.send(csv);
    } else if (format === 'json') {
      // Return logs as JSON
      res.json({ logs });
    } else {
      // Unsupported format
      res.status(400).json({ error: 'Invalid format. Use csv or json' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
