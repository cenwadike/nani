// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event monitoring and notifications service.
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

import { formatDistanceToNow } from 'date-fns';
import { ActivityPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

const transfers: ActivityPlugin = {
  name: 'transfers',

  /** --------------------------------------------------------------
   *  FILTER – does this transfer involve the tenant?
   *  -------------------------------------------------------------- */
  filter(event: any, address: string, chainId: string): boolean {
    logger.info(`[TRANSFERS] Filter called with chainId: ${chainId}, address: ${address}`);

    // Only process on supported chains
    const supportedChains = ['westend', 'asset-hub-westend'];
    if (!supportedChains.includes(chainId)) {
      logger.info(`[TRANSFERS] Chain not supported: ${chainId}`);
      return false;
    }

    // Event is already serialized with section/method at top level
    const eventSection = event.section;
    const eventMethod = event.method;
    const eventData = event.data;

    logger.info(`[TRANSFERS] Event: ${eventSection}.${eventMethod}`);

    if (eventSection !== 'balances' || eventMethod !== 'Transfer') {
      logger.info(`[TRANSFERS] Not a transfer → ${eventSection}.${eventMethod}`);
      return false;
    }

    const [from, to, amount] = eventData;
    logger.event(`[TRANSFERS] Transfer detected: ${from} → ${to} (amount: ${amount})`);
    logger.event(`[TRANSFERS] Checking against tenant address: ${address}`);

    const match = from === address || to === address;
    
    if (match) {
      logger.event(`[TRANSFERS] ✓ MATCH! Address ${address} is involved in this transfer`);
    } else {
      logger.info(`[TRANSFERS] ✗ No match. From: ${from}, To: ${to}, Tenant: ${address}`);
    }
    
    return match;
  },

  /** --------------------------------------------------------------
   *  LOG – build a rich log entry
   *  -------------------------------------------------------------- */
  log(
    event: any,
    address: string,
    chainId: string,
    tokenSymbol: string
  ): any {
    logger.info(`[TRANSFERS] Building log entry for ${address} on ${chainId}`);

    // Handle both ChainEvent format and raw event format
    const eventData = event.data || event.event?.data;
    const [from, to, amount] = eventData;

    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'transfer',
      chain: chainId,
      token: tokenSymbol,
      from,
      to,
      amount,
      direction: from === address ? 'outgoing' : 'incoming',
      blockNumber: event.blockNumber || 'unknown',
    };

    logger.info(`[TRANSFERS] Log entry created: ${JSON.stringify(logEntry, null, 2)}`);
    return logEntry;
  },

  /** --------------------------------------------------------------
   *  MESSAGE – human readable notification
   *  -------------------------------------------------------------- */
  formatMessage(logEntry: any, tokenSymbol: string): string {
    logger.info(`[TRANSFERS] Formatting message for notification`);

    const { direction, amount, token, from, to, timestamp } = logEntry;
    const other = direction === 'outgoing' ? to : from;
    const shortAddr = `${other.slice(0, 6)}...${other.slice(-4)}`;
    const prettyAmount = (amount / 1e12).toFixed(4).replace(/\.?0+$/, '');
    const timeAgo = formatDistanceToNow(new Date(timestamp), { addSuffix: true });

    const icon = direction === 'incoming' ? '💰' : '💸';
    const arrow = direction === 'incoming' ? 'from' : 'to';

    const message = `${icon} ${direction.toUpperCase()} Transfer: ${prettyAmount} ${token} ${arrow} ${shortAddr} ${timeAgo}`;
    
    logger.event(`[TRANSFERS] Message formatted: ${message}`);
    return message;
  },
};

export default transfers;
