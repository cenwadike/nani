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

import { ActivityPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

const extrinsic: ActivityPlugin = {
  name: 'extrinsic',

  /**
   * @function filter
   * @description Returns true if the extrinsic was signed by the tenant address.
   */
  async filter(record: any, address: string): Promise<boolean> {
    try {
      const signer = record.extrinsic?.signature?.signer?.toString();
      const match = signer === address;
      if (match) logger.event(`Extrinsic matched: signer ${signer}`);
      return match;
    } catch (err) {
      logger.error(`extrinsic.filter error: ${err}`);
      return false;
    }
  },

  /**
   * @function log
   * @description Extracts useful metadata from the extrinsic.
   */
  async log(record: any, address: string): Promise<any> {
    const ext = record.extrinsic;
    const method = ext?.method;
    return {
      timestamp: new Date().toISOString(),
      type: 'extrinsic',
      section: method?.section || 'unknown',
      method: method?.method || 'unknown',
      signer: ext?.signature?.signer?.toString() || 'unknown',
      blockNumber: record.phase?.asApplyExtrinsic || 'unknown',
    };
  },

  /**
   * @function formatMessage
   * @description Human-readable summary.
   */
  async formatMessage(logEntry: any): Promise<string> {
    const { section, method, signer } = logEntry;
    const short = signer.substring(0, 8) + '…';
    return `EXTRINSIC: ${section}.${method} by ${short}`;
  },
};

export default extrinsic;