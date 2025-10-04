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
 * @file plugins/stats/basic.ts
 * @summary Basic stats plugin for summarizing tenant event logs.
 * @description Computes simple metrics from blockchain activity logs, including event counts,
 *              directional breakdowns, total amounts, and timestamps. Converts amounts from planck to WND.
 */

import { StatsPlugin } from '../../types/pluginTypes';

const basic: StatsPlugin = {
  name: 'basic',

  /**
   * @function compute
   * @description Aggregates statistics from a list of log entries.
   * @param logs - Array of log objects containing transfer metadata
   * @returns Object with computed stats including totals, breakdowns, and timestamps
   */
  compute(logs: any[]) {
    const stats = {
      totalEvents: logs.length,
      incoming: 0,
      outgoing: 0,
      totalAmountIn: 0,
      totalAmountOut: 0,
      firstEvent: null,
      lastEvent: null,
    };

    if (logs.length === 0) return stats;

    // Tally incoming/outgoing transfers and accumulate amounts
    logs.forEach((log: any) => {
      if (log.direction === 'incoming') {
        stats.incoming++;
        stats.totalAmountIn += log.amount;
      } else if (log.direction === 'outgoing') {
        stats.outgoing++;
        stats.totalAmountOut += log.amount;
      }
    });

    // Capture timestamps of first and last events
    stats.firstEvent = logs[0].timestamp;
    stats.lastEvent = logs[logs.length - 1].timestamp;

    // Convert amounts from planck to WND (1e12 planck = 1 WND)
    stats.totalAmountIn = (stats.totalAmountIn / 1e12).toFixed(4) as any as number;
    stats.totalAmountOut = (stats.totalAmountOut / 1e12).toFixed(4) as any as number;

    return stats;
  },
};

export default basic;
