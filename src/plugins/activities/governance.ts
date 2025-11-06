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
 * @file plugins/activities/governance.ts
 * @summary Activity plugin for detecting governance events on the Polkadot blockchain.
 * @description Filters referenda events (proposals, votes, decisions), enriches them
 *              with referendum details, and formats human-readable notifications.
 */

import { ActivityPlugin } from '../../types/pluginTypes';
import { ApiPromise } from '@polkadot/api';
import logger from '../../utils/logger';
import storage from '../../utils/storage';

// ============================================================================
// Type Definitions
// ============================================================================

interface VoteData {
  aye: boolean;
  conviction?: string | number;
  balance?: string | number;
}

interface ReferendumInfo {
  id: string | number;
  title?: string;
  track?: string | number;
  status?: string;
}

interface GovernanceLogEntry {
  timestamp: string;
  type: 'governance';
  section: 'referenda';
  method: string;
  action: GovernanceAction;
  blockNumber: number;
  blockHash: string;
  extrinsicIndex?: number;
  address: string;
  referendum: ReferendumInfo;
  vote?: VoteData;
  details: any[];
}

type GovernanceAction = 
  | 'proposed' 
  | 'voted' 
  | 'approved' 
  | 'rejected' 
  | 'executed' 
  | 'submitted'
  | 'cancelled'
  | 'killed'
  | 'timedout';

// ============================================================================
// Constants
// ============================================================================

const SUPPORTED_METHODS = [
  'Submitted', 'DecisionDepositPlaced', 'Voted', 'Approved', 'Rejected',
  'Executed', 'Cancelled', 'Killed', 'TimedOut', 'ConfirmStarted',
  'ConfirmAborted', 'Confirmed',
] as const;

const METHOD_TO_ACTION: Record<string, GovernanceAction> = {
  'Submitted': 'submitted',
  'DecisionDepositPlaced': 'proposed',
  'Voted': 'voted',
  'Approved': 'approved',
  'Rejected': 'rejected',
  'Executed': 'executed',
  'Cancelled': 'cancelled',
  'Killed': 'killed',
  'TimedOut': 'timedout',
  'ConfirmStarted': 'approved',
  'Confirmed': 'approved',
};

const REFERENDUM_CACHE_TTL = 600000; // 10 minutes

// ============================================================================
// Cache & Interval Management
// ============================================================================

interface CachedReferendum {
  info: ReferendumInfo;
  timestamp: number;
}

const referendumCache = new Map<string, CachedReferendum>();

function cleanReferendumCache(): void {
  const now = Date.now();
  for (const [key, value] of referendumCache.entries()) {
    if (now - value.timestamp > REFERENDUM_CACHE_TTL) {
      referendumCache.delete(key);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Start / Stop API for testing
// ──────────────────────────────────────────────────────────────────────
let referendumCleanupInterval: NodeJS.Timeout | null = null;

export function startReferendumCacheCleanup(): void {
  if (referendumCleanupInterval) return;
  referendumCleanupInterval = setInterval(cleanReferendumCache, REFERENDUM_CACHE_TTL);
}

export function stopReferendumCacheCleanup(): void {
  if (referendumCleanupInterval) {
    clearInterval(referendumCleanupInterval);
    referendumCleanupInterval = null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function findAddressInData(data: any, address: string): boolean {
  if (data === address) return true;
  if (Array.isArray(data)) return data.some(item => findAddressInData(item, address));
  if (typeof data === 'object' && data !== null) {
    return Object.values(data).some(value => findAddressInData(value, address));
  }
  return false;
}

function extractVoteData(eventData: any[], method: string): VoteData | undefined {
  if (method !== 'Voted' || eventData.length < 3) return undefined;

  try {
    const voteField = eventData[2];
    if (typeof voteField === 'object' && voteField !== null) {
      if ('aye' in voteField || 'Aye' in voteField) {
        return {
          aye: voteField.aye || voteField.Aye || false,
          conviction: voteField.conviction || voteField.Conviction,
          balance: eventData[3] || voteField.balance || voteField.Balance,
        };
      }
      if ('Split' in voteField) {
        return { aye: true, balance: voteField.Split?.aye || voteField.Split?.Aye };
      }
    }
    if (typeof voteField === 'boolean') {
      return { aye: voteField, balance: eventData[3] };
    }
  } catch (err) {
    logger.warn(`Failed to extract vote data: ${err instanceof Error ? err.message : err}`);
  }
  return undefined;
}

async function getReferendumInfo(
  api: ApiPromise,
  referendumId: string | number
): Promise<ReferendumInfo> {
  const cacheKey = String(referendumId);
  const cached = referendumCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REFERENDUM_CACHE_TTL) {
    return cached.info;
  }

  const info: ReferendumInfo = { id: referendumId };

  try {
    const refInfo = await api.query.referenda?.referendumInfoFor(referendumId);
    if (refInfo && (refInfo as any).isSome) {
      const refData = refInfo.toJSON() as any;
      if (refData?.ongoing?.track !== undefined) info.track = refData.ongoing.track;
      else if (refData?.Ongoing?.track !== undefined) info.track = refData.Ongoing.track;

      if (refData?.ongoing) info.status = 'ongoing';
      else if (refData?.approved) info.status = 'approved';
      else if (refData?.rejected) info.status = 'rejected';
      else if (refData?.cancelled) info.status = 'cancelled';
    }
  } catch (err) {
    logger.info(`Could not fetch referendum info for #${referendumId}: ${err instanceof Error ? err.message : err}`);
  }

  referendumCache.set(cacheKey, { info, timestamp: Date.now() });
  return info;
}

function getTrackName(trackId: string | number | undefined): string {
  if (trackId === undefined) return '';
  const trackMap: Record<number, string> = {
    0: 'Root', 1: 'Whitelisted Caller', 10: 'Staking Admin', 11: 'Treasurer',
    12: 'Lease Admin', 13: 'Fellowship Admin', 14: 'General Admin', 15: 'Auction Admin',
    20: 'Referendum Canceller', 21: 'Referendum Killer', 30: 'Small Tipper',
    31: 'Big Tipper', 32: 'Small Spender', 33: 'Medium Spender', 34: 'Big Spender',
  };
  const num = typeof trackId === 'number' ? trackId : Number(trackId);
  return trackMap[num] || `Track ${trackId}`;
}

function formatBalance(balance: string | number | undefined, tokenSymbol: string): string {
  if (!balance) return '';
  try {
    const planck = typeof balance === 'string' ? BigInt(balance) : BigInt(balance);
    const dot = Number(planck) / 1e12;
    return dot >= 0.01 ? `${dot.toFixed(2)} ${tokenSymbol}` : `${dot.toFixed(4)} ${tokenSymbol}`;
  } catch {
    return '';
  }
}

// ============================================================================
// Plugin Implementation
// ============================================================================

const governance: ActivityPlugin = {
  name: 'governance',

  filter(record: any, address: string, chainId: string): boolean {
    try {
      const event = record?.event;
      if (!event || event.section !== 'referenda') return false;
      if (!SUPPORTED_METHODS.includes(event.method as any)) return false;
      return findAddressInData(event.data.toJSON(), address);
    } catch {
      return false;
    }
  },

  async log(
    record: any,
    address: string,
    chainId: string,
    tokenSymbol: string
  ): Promise<GovernanceLogEntry | null> {
    try {
      const event = record?.event;
      if (!event) return null;

      const { method, data } = event;
      const eventData = data.toJSON();
      if (!Array.isArray(eventData)) return null;

      const referendumId = eventData[0] ?? 'unknown';
      const action = METHOD_TO_ACTION[method] || method.toLowerCase();
      const blockNumber = record.blockNumber?.toNumber() || 0;
      const blockHash = record.blockHash?.toHex() || '';
      let extrinsicIndex: number | undefined;
      if (record.phase?.isApplyExtrinsic) {
        extrinsicIndex = record.phase.asApplyExtrinsic.toNumber();
      }

      const tenantId = address;
      const chainConfig = await storage.loadChainConfig(tenantId, chainId);
      let referendum: ReferendumInfo = { id: referendumId };

      if (chainConfig?.api) {
        const api: ApiPromise = chainConfig.api;
        referendum = await getReferendumInfo(api, referendumId);
      }

      const vote = extractVoteData(eventData, method);

      return {
        timestamp: new Date().toISOString(),
        type: 'governance',
        section: 'referenda',
        method,
        action: action as GovernanceAction,
        blockNumber,
        blockHash,
        extrinsicIndex,
        address,
        referendum,
        vote,
        details: eventData.slice(1),
      };
    } catch (err: any) {
      logger.error(`Governance log error: ${err.message}`);
      return null;
    }
  },

  async formatMessage(logEntry: any, tokenSymbol: string): Promise<string> {
    try {
      if (!logEntry || !logEntry.action) return 'Governance event occurred';

      const { action, referendum, vote, blockNumber, method } = logEntry;
      const refId = referendum?.id || 'unknown';
      const trackName = getTrackName(referendum?.track);
      const trackInfo = trackName ? ` (${trackName})` : '';
      const blockInfo = blockNumber ? ` at block #${blockNumber}` : '';

      switch (action) {
        case 'submitted':
        case 'proposed':
          return `New Referendum #${refId}${trackInfo} submitted${blockInfo}`;
        case 'voted':
          if (vote) {
            const voteType = vote.aye ? 'Aye' : 'Nay';
            const conviction = vote.conviction ? ` with ${vote.conviction}x conviction` : '';
            const amount = vote.balance ? ` (${formatBalance(vote.balance, tokenSymbol)})` : '';
            return `Voted ${voteType} on Referendum #${refId}${trackInfo}${conviction}${amount}${blockInfo}`;
          }
          return `Voted on Referendum #${refId}${trackInfo}${blockInfo}`;
        case 'approved':
          return method === 'Confirmed'
            ? `Referendum #${refId}${trackInfo} confirmed${blockInfo}`
            : `Referendum #${refId}${trackInfo} approved${blockInfo}`;
        case 'rejected':
          return `Referendum #${refId}${trackInfo} rejected${blockInfo}`;
        case 'executed':
          return `Referendum #${refId}${trackInfo} executed successfully${blockInfo}`;
        case 'cancelled':
          return `Referendum #${refId}${trackInfo} cancelled${blockInfo}`;
        case 'killed':
          return `Referendum #${refId}${trackInfo} killed${blockInfo}`;
        case 'timedout':
          return `Referendum #${refId}${trackInfo} timed out${blockInfo}`;
        default:
          return `Referendum #${refId}${trackInfo}: ${action}${blockInfo}`;
      }
    } catch (err) {
      logger.error(`Error formatting governance message: ${err instanceof Error ? err.message : err}`);
      return 'Governance event occurred';
    }
  },
};

export default governance;
