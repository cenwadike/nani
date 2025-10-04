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
 * @file plugins/activities/transfers.ts
 * @summary Activity plugin for detecting balance transfers on the Polkadot blockchain.
 * @description Filters `balances.Transfer` events, logs relevant data, and formats messages
 *              for notification dispatch. Supports both incoming and outgoing transfers.
 */

import { ActivityPlugin } from '../../types/pluginTypes';

const transfers: ActivityPlugin = {
  name: 'transfers',

  /**
   * @function filter
   * @description Determines if the event is a `balances.Transfer` involving the tenant's address.
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Boolean indicating whether the event is relevant
   */
  async filter(record: any, address: string): Promise<boolean> {
    const event = record.event;
    if (!event || event.section !== 'balances') return false;
    if (event.method !== 'Transfer') return false;

    const data = event.data.toJSON();
    const from = data[0] || data.from;
    const to = data[1] || data.to;

    return from === address || to === address;
  },

  /**
   * @function log
   * @description Extracts structured log data from a transfer event.
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Log entry object with metadata
   */
  async log(record: any, address: string): Promise<any> {
    const event = record.event;
    const data = event.data.toJSON();
    const from = data[0] || data.from;
    const to = data[1] || data.to;
    const amount = data[2] || data.amount;

    return {
      timestamp: new Date().toISOString(),
      type: 'transfer',
      from,
      to,
      amount,
      blockNumber: record.phase?.asApplyExtrinsic || 'unknown',
      direction: from === address ? 'outgoing' : 'incoming',
    };
  },

  /**
   * @function formatMessage
   * @description Converts a log entry into a human-readable transfer message.
   * @param logEntry - Structured log data
   * @param address - Tenant's Polkadot address
   * @returns Formatted message string
   */
  async formatMessage(logEntry: any, address: string): Promise<string> {
    const direction = logEntry.direction;
    const other = direction === 'outgoing' ? logEntry.to : logEntry.from;
    const amountFormatted = (logEntry.amount / 1e12).toFixed(4); // Convert planck to WND

    return `${direction.toUpperCase()} Transfer: ${amountFormatted} WND ${direction === 'outgoing' ? 'to' : 'from'} ${other.substring(0, 10)}...`;
  },
};

export default transfers;
