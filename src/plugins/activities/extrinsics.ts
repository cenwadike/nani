// SPDX-License-Identifier: MIT
// plugins/activities/extrinsic.ts
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
 * @file plugins/activities/extrinsic.ts
 * @summary Activity plugin that matches ANY extrinsic signed by the tenant address.
 * @description Works with the shape of `record` produced by your block listener:
 *              - `record.extrinsic` → the signed extrinsic
 *              - `record.events`   → array of events in the block
 */
// SPDX-License-Identifier: MIT
// plugins/activities/extrinsic.ts

import { ActivityPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

/**
 * @file plugins/activities/extrinsic.ts
 * @summary Multichain activity plugin that matches ANY extrinsic signed by the tenant address.
 * @description Works on any Polkadot-based chain (westend, asset-hub-westend, kusama, etc.).
 *              Uses `record.extrinsic` from block listener.
 */

const extrinsics: ActivityPlugin = {
  name: 'extrinsics',

  /**
   * @function filter
   * @param record - Block listener record
   * @param address - Tenant address (SS58)
   * @param chainId - Chain name (e.g., "westend")
   * @param tokenSymbol - Native token (e.g., "WND")
   * @returns true if extrinsic was signed by address
   */
  filter(
    record: any,
    address: string,
    chainId: string,
    tokenSymbol?: string
  ): boolean {
    try {
      const ext = record.extrinsic;
      if (!ext?.signature?.signer) return false;

      const signer = ext.signature.signer.toString();
      const isMatch = signer === address;

      if (isMatch) {
        logger.event(`[${chainId}] Extrinsic matched: ${signer} → ${methodString(ext)}`);
      }

      return isMatch;
    } catch (err: any) {
      logger.error(`[${chainId}] extrinsic.filter error: ${err.message}`);
      return false;
    }
  },

  /**
   * @function log
   * @returns Enriched log entry with chain context
   */
  async log(
    record: any,
    address: string,
    chainId: string,
    tokenSymbol: string
  ): Promise<any> {
    const ext = record.extrinsic;
    const method = ext?.method;

    const blockNumber = record.blockNumber?.toNumber() ?? 'unknown';
    const blockHash = record.blockHash?.toHex() ?? 'unknown';
    const extrinsicIndex = record.phase?.isApplyExtrinsic
      ? record.phase.asApplyExtrinsic.toNumber()
      : undefined;

    return {
      timestamp: new Date().toISOString(),
      type: 'extrinsic',
      chainId,
      tokenSymbol,
      section: method?.section ?? 'unknown',
      method: method?.method ?? 'unknown',
      signer: ext?.signature?.signer?.toString() ?? 'unknown',
      blockNumber,
      blockHash,
      extrinsicIndex,
      args: method?.args?.toHuman?.() ?? method?.args?.toJSON?.() ?? null,
    };
  },

  /**
   * @function formatMessage
   * @param logEntry - Structured log from `log()`
   * @returns Human-readable message with chain context
   */
  async formatMessage(logEntry: any): Promise<string> {
    const {
      chainId,
      tokenSymbol,
      section,
      method,
      signer,
      blockNumber,
    } = logEntry;

    const shortSigner = signer ? `${signer.slice(0, 6)}…${signer.slice(-4)}` : 'unknown';
    const blockInfo = blockNumber !== 'unknown' ? ` #${blockNumber}` : '';
    const chainBadge = chainId === 'westend' ? 'WESTEND' : chainId.toUpperCase();

    return `EXTRINSIC [${chainBadge}] ${section}.${method} by ${shortSigner}${blockInfo}`;
  },
};

// ──────────────────────────────────────────────────────────────────────
// Helper: Human-readable method string
// ──────────────────────────────────────────────────────────────────────
function methodString(ext: any): string {
  const m = ext?.method;
  if (!m) return 'unknown';
  return `${m.section}.${m.method}`;
}

export default extrinsics;
