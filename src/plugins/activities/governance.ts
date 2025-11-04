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
  'Submitted',        // New referendum submitted
  'DecisionDepositPlaced',  // Decision deposit placed
  'Voted',           // Vote cast on referendum
  'Approved',        // Referendum approved
  'Rejected',        // Referendum rejected (Disapproved)
  'Executed',        // Referendum executed
  'Cancelled',       // Referendum cancelled
  'Killed',          // Referendum killed
  'TimedOut',        // Referendum timed out
  'ConfirmStarted',  // Confirmation period started
  'ConfirmAborted',  // Confirmation aborted
  'Confirmed',       // Referendum confirmed
] as const;

// Map of methods to user-friendly actions
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
// Cache
// ============================================================================

interface CachedReferendum {
  info: ReferendumInfo;
  timestamp: number;
}

const referendumCache = new Map<string, CachedReferendum>();

/**
 * Cleans expired referendum cache entries
 */
function cleanReferendumCache(): void {
  const now = Date.now();
  for (const [key, value] of referendumCache.entries()) {
    if (now - value.timestamp > REFERENDUM_CACHE_TTL) {
      referendumCache.delete(key);
    }
  }
}

// Clean cache periodically
setInterval(cleanReferendumCache, REFERENDUM_CACHE_TTL);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if a value is a valid address
 * @param value - Value to check
 * @returns True if value looks like a Polkadot address
 */
function isAddress(value: any): boolean {
  if (typeof value !== 'string') return false;
  // Polkadot addresses typically start with 1, 5, or other network-specific prefixes
  return value.length >= 47 && value.length <= 48;
}

/**
 * Recursively searches event data for an address
 * @param data - Event data to search
 * @param address - Target address
 * @returns True if address is found
 */
function findAddressInData(data: any, address: string): boolean {
  if (data === address) return true;
  
  if (Array.isArray(data)) {
    return data.some(item => findAddressInData(item, address));
  }
  
  if (typeof data === 'object' && data !== null) {
    return Object.values(data).some(value => findAddressInData(value, address));
  }
  
  return false;
}

/**
 * Extracts vote data from event data
 * @param eventData - Raw event data
 * @param method - Event method name
 * @returns Parsed vote data or undefined
 */
function extractVoteData(eventData: any[], method: string): VoteData | undefined {
  if (method !== 'Voted' || eventData.length < 3) return undefined;

  try {
    const voteField = eventData[2];
    
    // Vote can be in different formats depending on the runtime
    if (typeof voteField === 'object' && voteField !== null) {
      // Standard vote format: { aye: boolean, conviction: number }
      if ('aye' in voteField || 'Aye' in voteField) {
        return {
          aye: voteField.aye || voteField.Aye || false,
          conviction: voteField.conviction || voteField.Conviction,
          balance: eventData[3] || voteField.balance || voteField.Balance,
        };
      }
      
      // Split vote format
      if ('Split' in voteField) {
        return {
          aye: true, // Split votes are complex, simplify to "aye"
          balance: voteField.Split?.aye || voteField.Split?.Aye,
        };
      }
    }
    
    // Boolean vote
    if (typeof voteField === 'boolean') {
      return {
        aye: voteField,
        balance: eventData[3],
      };
    }
  } catch (err) {
    logger.warn(`Failed to extract vote data: ${err instanceof Error ? err.message : err}`);
  }
  
  return undefined;
}

/**
 * Fetches referendum information from chain
 * @param api - Polkadot API instance
 * @param referendumId - Referendum ID
 * @returns Referendum info
 */
async function getReferendumInfo(
  api: ApiPromise,
  referendumId: string | number
): Promise<ReferendumInfo> {
  // Check cache first
  const cacheKey = String(referendumId);
  const cached = referendumCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < REFERENDUM_CACHE_TTL) {
    return cached.info;
  }

  const info: ReferendumInfo = {
    id: referendumId,
  };

  try {
    // Try to fetch referendum info from chain
    const refInfo = await api.query.referenda?.referendumInfoFor(referendumId);
    
    if (refInfo && (refInfo as any).isSome) {
      const refData = refInfo.toJSON() as any;
      
      // Extract track (origin)
      if (refData?.ongoing?.track !== undefined) {
        info.track = refData.ongoing.track;
      } else if (refData?.Ongoing?.track !== undefined) {
        info.track = refData.Ongoing.track;
      }
      
      // Extract status
      if (refData?.ongoing) {
        info.status = 'ongoing';
      } else if (refData?.approved) {
        info.status = 'approved';
      } else if (refData?.rejected) {
        info.status = 'rejected';
      } else if (refData?.cancelled) {
        info.status = 'cancelled';
      }
    }
  } catch (err) {
    logger.info(`Could not fetch referendum info for #${referendumId}: ${err instanceof Error ? err.message : err}`);
  }

  // Cache the result
  referendumCache.set(cacheKey, {
    info,
    timestamp: Date.now(),
  });

  return info;
}

/**
 * Gets track name from track ID
 * @param trackId - Track ID number
 * @returns Human-readable track name
 */
function getTrackName(trackId: string | number | undefined): string {
  if (trackId === undefined) return '';
  
  const trackMap: Record<number, string> = {
    0: 'Root',
    1: 'Whitelisted Caller',
    10: 'Staking Admin',
    11: 'Treasurer',
    12: 'Lease Admin',
    13: 'Fellowship Admin',
    14: 'General Admin',
    15: 'Auction Admin',
    20: 'Referendum Canceller',
    21: 'Referendum Killer',
    30: 'Small Tipper',
    31: 'Big Tipper',
    32: 'Small Spender',
    33: 'Medium Spender',
    34: 'Big Spender',
  };
  
  const trackNum = typeof trackId === 'number' ? trackId : Number(trackId);
  return trackMap[trackNum] || `Track ${trackId}`;
}

/**
 * Formats balance for display
 * @param balance - Balance in planck
 * @returns Formatted DOT amount
 */
function formatBalance(balance: string | number | undefined): string {
  if (!balance) return '';
  
  try {
    const planck = typeof balance === 'string' ? BigInt(balance) : BigInt(balance);
    const dot = Number(planck) / 1e12;
    return dot >= 0.01 ? `${dot.toFixed(2)} DOT` : `${dot.toFixed(4)} DOT`;
  } catch {
    return '';
  }
}

// ============================================================================
// Plugin Implementation
// ============================================================================

const governance: ActivityPlugin = {
  name: 'governance',

  /**
   * Filters blockchain events for relevant governance activities
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns True if event is relevant to the address
   */
  async filter(record: any, address: string): Promise<boolean> {
    try {
      // Validate record structure
      const event = record?.event;
      if (!event || event.section !== 'referenda') {
        return false;
      }

      const { method, data } = event;

      // Only process supported governance events
      if (!SUPPORTED_METHODS.includes(method as any)) {
        return false;
      }

      // Extract event data
      const eventData = data.toJSON();
      
      // Validate data structure
      if (!Array.isArray(eventData) || eventData.length === 0) {
        logger.warn(`Invalid event data structure for referenda.${method}`);
        return false;
      }

      // Check if address is involved in the event
      const involvesAddress = findAddressInData(eventData, address);

      if (involvesAddress) {
        logger.event(`Governance event matched: ${method} for ${address}`);
      }

      return involvesAddress;
    } catch (err) {
      logger.error(`Error in governance filter: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  },

  /**
   * Enriches a matching event with referendum details
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Enriched log entry with referendum data
   */
  async log(record: any, address: string): Promise<GovernanceLogEntry | null> {
    try {
      // Validate record
      const event = record?.event;
      if (!event) {
        logger.error('Invalid record: missing event');
        return null;
      }

      const { method, data } = event;
      const eventData = data.toJSON();

      // Validate event data structure
      if (!Array.isArray(eventData) || eventData.length === 0) {
        logger.error('Invalid event data structure in log function');
        return null;
      }

      // Extract block information
      const blockHash = record.blockHash?.toHex() || '';
      const blockNumber = record.blockNumber?.toNumber() || 0;
      
      // Extract extrinsic index if available
      let extrinsicIndex: number | undefined;
      if (record.phase?.isApplyExtrinsic) {
        extrinsicIndex = record.phase.asApplyExtrinsic.toNumber();
      }

      // Extract referendum ID (usually first field)
      const referendumId = eventData[0] !== undefined ? eventData[0] : 'unknown';

      // Determine action from method
      const action = METHOD_TO_ACTION[method] || method.toLowerCase();

      // Get tenant configuration for API access
      const config = await storage.loadConfig(address);
      let referendum: ReferendumInfo = { id: referendumId };
      
      if (config?.api) {
        const api: ApiPromise = config.api;
        referendum = await getReferendumInfo(api, referendumId);
      } else {
        logger.warn(`No API instance available for tenant ${address}`);
      }

      // Extract vote data if this is a vote event
      const vote = extractVoteData(eventData, method);

      // Construct enriched log entry
      const logEntry: GovernanceLogEntry = {
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
        details: eventData.slice(1), // Store remaining fields
      };

      logger.info(`Governance log created for ${address}: ${action} on referendum #${referendumId}`);

      return logEntry;
    } catch (err) {
      logger.error(`Failed to enrich governance event: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  },

  /**
   * Formats a log entry into a human-readable notification message
   * @param logEntry - Structured log entry
   * @returns Formatted notification message
   */
  async formatMessage(logEntry: any): Promise<string> {
    try {
      // Validate required fields
      if (!logEntry || !logEntry.action) {
        logger.warn('Missing or invalid log entry for message formatting');
        return '🏛️ Governance event occurred';
      }

      const { action, referendum, vote, blockNumber, method } = logEntry;
      const refId = referendum?.id || 'unknown';
      
      // Get track info if available
      const trackName = getTrackName(referendum?.track);
      const trackInfo = trackName ? ` (${trackName})` : '';
      
      // Format block info
      const blockInfo = blockNumber ? ` at block #${blockNumber}` : '';

      // Create appropriate message based on action type
      switch (action) {
        case 'submitted':
        case 'proposed':
          return `📝 New Referendum #${refId}${trackInfo} submitted${blockInfo}`;

        case 'voted':
          if (vote) {
            const voteType = vote.aye ? '✅ Aye' : '❌ Nay';
            const conviction = vote.conviction ? ` with ${vote.conviction}x conviction` : '';
            const amount = vote.balance ? ` (${formatBalance(vote.balance)})` : '';
            return `🗳️ Voted ${voteType} on Referendum #${refId}${trackInfo}${conviction}${amount}${blockInfo}`;
          }
          return `🗳️ Voted on Referendum #${refId}${trackInfo}${blockInfo}`;

        case 'approved':
          if (method === 'Confirmed') {
            return `✅ Referendum #${refId}${trackInfo} confirmed${blockInfo}`;
          }
          return `✅ Referendum #${refId}${trackInfo} approved${blockInfo}`;

        case 'rejected':
          return `❌ Referendum #${refId}${trackInfo} rejected${blockInfo}`;

        case 'executed':
          return `⚡ Referendum #${refId}${trackInfo} executed successfully${blockInfo}`;

        case 'cancelled':
          return `🚫 Referendum #${refId}${trackInfo} cancelled${blockInfo}`;

        case 'killed':
          return `💀 Referendum #${refId}${trackInfo} killed${blockInfo}`;

        case 'timedout':
          return `⏱️ Referendum #${refId}${trackInfo} timed out${blockInfo}`;

        default:
          return `🏛️ Referendum #${refId}${trackInfo}: ${action}${blockInfo}`;
      }
    } catch (err) {
      logger.error(`Error formatting governance message: ${err instanceof Error ? err.message : err}`);
      return '🏛️ Governance event occurred';
    }
  },
};

export default governance;