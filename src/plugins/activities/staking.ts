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
 * @file plugins/activities/staking.ts
 * @summary Activity plugin for detecting staking events on the Polkadot blockchain.
 * @description Filters `staking.*` events (Rewarded, Slashed), enriches them with
 *              validator identity and era data, and formats human-readable notifications.
 */

import { ActivityPlugin } from '../../types/pluginTypes';
import { ApiPromise } from '@polkadot/api';
import { u8aToString } from '@polkadot/util';
import logger from '../../utils/logger';
import storage from '../../utils/storage';

// ============================================================================
// Type Definitions
// ============================================================================

interface ValidatorInfo {
  display?: string;
  legal?: string;
  email?: string;
  web?: string;
  riot?: string;
}

interface ValidatorData {
  address: string;
  name: string;
  identity: ValidatorInfo;
}

interface StakingLogEntry {
  timestamp: string;
  type: 'staking';
  direction: 'rewarded' | 'slashed';
  amount: number;
  amountPlanck: string;
  validator: ValidatorData;
  era: number;
  totalEraStake: number;
  blockNumber: number;
  blockHash: string;
  address: string;
}

// ============================================================================
// Constants
// ============================================================================

const PLANCK_TO_DOT = 1e12;
const SUPPORTED_METHODS = ['Rewarded', 'Slashed'] as const;
const VALIDATOR_CACHE_TTL = 300000; // 5 minutes
const ADDRESS_TRUNCATE_LENGTH = 8;

// ============================================================================
// Cache
// ============================================================================

// Simple in-memory cache for validator identities to reduce API calls
const validatorCache = new Map<string, { data: ValidatorInfo; timestamp: number }>();

/**
 * Clears expired entries from the validator cache
 */
function cleanValidatorCache(): void {
  const now = Date.now();
  for (const [key, value] of validatorCache.entries()) {
    if (now - value.timestamp > VALIDATOR_CACHE_TTL) {
      validatorCache.delete(key);
    }
  }
}

// Clean cache periodically
setInterval(cleanValidatorCache, VALIDATOR_CACHE_TTL);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely extracts a string value from identity field
 * @param field - Identity field that may contain Raw data
 * @returns Extracted string or undefined
 */
function extractRawString(field: any): string | undefined {
  if (!field) return undefined;
  
  try {
    if (typeof field === 'string') return field;
    if (field.Raw) return u8aToString(field.Raw);
    if (field.raw) return u8aToString(field.raw);
    return undefined;
  } catch (err) {
    logger.info(`Failed to extract raw string: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

/**
 * Fetches validator identity from chain with caching
 * @param api - Polkadot API instance
 * @param validatorAddress - Validator's address
 * @returns Validator identity information
 */
async function getValidatorIdentity(
  api: ApiPromise,
  validatorAddress: string
): Promise<ValidatorInfo> {
  // Check cache first
  const cached = validatorCache.get(validatorAddress);
  if (cached && Date.now() - cached.timestamp < VALIDATOR_CACHE_TTL) {
    return cached.data;
  }

  try {
    const identity = await api.query.identity.identityOf(validatorAddress);
    
    if (!identity || !(identity as any).isSome) {
      return {};
    }

    const identityData = identity.toJSON() as any;
    const info = identityData?.info || {};

    const validatorInfo: ValidatorInfo = {
      display: extractRawString(info.display),
      legal: extractRawString(info.legal),
      email: extractRawString(info.email),
      web: extractRawString(info.web),
      riot: extractRawString(info.riot),
    };

    // Cache the result
    validatorCache.set(validatorAddress, {
      data: validatorInfo,
      timestamp: Date.now(),
    });

    return validatorInfo;
  } catch (err) {
    logger.error(`Error fetching validator identity for ${validatorAddress}: ${err instanceof Error ? err.message : err}`);
    return {};
  }
}

/**
 * Finds the validator that a nominator is currently backing
 * @param api - Polkadot API instance
 * @param nominatorAddress - Nominator's address
 * @param eraIndex - Era index to search (defaults to current active era)
 * @returns Validator data including address, name, and identity
 */
async function findValidatorForNominator(
  api: ApiPromise,
  nominatorAddress: string,
  eraIndex?: number
): Promise<ValidatorData> {
  try {
    // Get active era if not provided
    let activeEraIndex = eraIndex;
    if (activeEraIndex === undefined) {
      const activeEra = await api.query.staking.activeEra();
      activeEraIndex = (activeEra as any)?.isSome 
        ? (activeEra as any).unwrap().index.toNumber() 
        : 0;
    }

    // Fetch all validators and their nominators for this era
    const eraStakers = await api.query.staking.erasStakers.entries(activeEraIndex);

    for (const [key, exposure] of eraStakers) {
      const validatorAddress = key.args[1].toString();
      const exposureData = (exposure as any).toJSON ? (exposure as any).toJSON() : exposure;

      // Check if the nominator is backing this validator
      if (exposureData?.others && Array.isArray(exposureData.others)) {
        const hasNominator = exposureData.others.some((nominator: any) => {
          if (typeof nominator === 'object' && nominator !== null) {
            return nominator.who === nominatorAddress;
          }
          if (Array.isArray(nominator)) {
            return nominator[0] === nominatorAddress;
          }
          return false;
        });

        if (hasNominator) {
          const identity = await getValidatorIdentity(api, validatorAddress);
          const displayName = identity.display 
            || identity.legal 
            || `${validatorAddress.slice(0, ADDRESS_TRUNCATE_LENGTH)}...`;

          return {
            address: validatorAddress,
            name: displayName,
            identity,
          };
        }
      }
    }

    logger.warn(`No validator found for nominator ${nominatorAddress} in era ${activeEraIndex}`);
    return {
      address: '',
      name: 'Unknown Validator',
      identity: {},
    };
  } catch (err) {
    logger.error(`Error finding validator for nominator: ${err instanceof Error ? err.message : err}`);
    return {
      address: '',
      name: 'Unknown Validator',
      identity: {},
    };
  }
}

/**
 * Fetches era-related data including active era index and total stake
 * @param api - Polkadot API instance
 * @returns Era index and total stake in DOT
 */
async function getEraData(api: ApiPromise): Promise<{ activeEraIndex: number; totalStake: number }> {
  try {
    const activeEra = await api.query.staking.activeEra();
    const activeEraIndex = (activeEra as any)?.isSome 
      ? (activeEra as any).unwrap().index.toNumber() 
      : 0;

    const totalStake = await api.query.staking.erasTotalStake(activeEraIndex);
    const totalStakeBigInt = BigInt((totalStake as any).toString());
    const totalStakeDot = Number(totalStakeBigInt) / PLANCK_TO_DOT;

    return {
      activeEraIndex,
      totalStake: totalStakeDot,
    };
  } catch (err) {
    logger.error(`Error fetching era data: ${err instanceof Error ? err.message : err}`);
    return {
      activeEraIndex: 0,
      totalStake: 0,
    };
  }
}

/**
 * Formats a DOT amount with appropriate precision
 * @param amount - Amount in DOT
 * @param decimals - Number of decimal places (default: 4)
 * @returns Formatted amount string
 */
function formatDotAmount(amount: number, decimals: number = 4): string {
  return amount.toFixed(decimals);
}

// ============================================================================
// Plugin Implementation
// ============================================================================

const staking: ActivityPlugin = {
  name: 'staking',

  /**
   * Filters blockchain events for relevant staking activities
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns True if event is relevant to the address
   */
  async filter(record: any, address: string): Promise<boolean> {
    try {
      // Validate record structure
      const event = record?.event;
      if (!event || event.section !== 'staking') {
        return false;
      }

      const { method } = event;
      
      // Only process supported staking events
      if (!SUPPORTED_METHODS.includes(method as any)) {
        return false;
      }

      // Extract event data
      const eventData = event.data.toJSON();
      
      // Validate data structure
      if (!Array.isArray(eventData) || eventData.length < 2) {
        logger.warn(`Invalid event data structure for staking.${method}`);
        return false;
      }

      // Check if the address matches the staker
      const stakerAddress = eventData[0];
      const isMatch = stakerAddress === address;

      if (isMatch) {
        logger.event(`Staking event matched: ${method} for ${address}`);
      }

      return isMatch;
    } catch (err) {
      logger.error(`Error in staking filter: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  },

  /**
   * Enriches a matching event with validator and era information
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Enriched log entry with validator and era data
   */
  async log(record: any, address: string): Promise<StakingLogEntry | null> {
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
      if (!Array.isArray(eventData) || eventData.length < 2) {
        logger.error('Invalid event data structure in log function');
        return null;
      }

      // Extract block information
      const blockHash = record.blockHash?.toHex() || '';
      const blockNumber = record.blockNumber?.toNumber() || 0;

      // Parse amount
      const amountPlanck = eventData[1] || 0;
      const amountDot = Number(amountPlanck) / PLANCK_TO_DOT;
      const direction = method === 'Rewarded' ? 'rewarded' : 'slashed';

      // Get tenant configuration for API access
      const config = await storage.loadConfig(address);
      if (!config?.api) {
        logger.warn(`No API instance available for tenant ${address}`);
        return null;
      }

      const api: ApiPromise = config.api;

      // Fetch validator and era data in parallel for efficiency
      const [validatorData, eraData] = await Promise.all([
        findValidatorForNominator(api, address),
        getEraData(api),
      ]);

      // Construct enriched log entry
      const logEntry: StakingLogEntry = {
        timestamp: new Date().toISOString(),
        type: 'staking',
        direction: direction as 'rewarded' | 'slashed',
        amount: amountDot,
        amountPlanck: String(amountPlanck),
        validator: validatorData,
        era: eraData.activeEraIndex,
        totalEraStake: eraData.totalStake,
        blockNumber,
        blockHash,
        address,
      };

      logger.info(`Staking log created for ${address}: ${direction} ${amountDot} DOT`);

      return logEntry;
    } catch (err) {
      logger.error(`Failed to enrich staking event: ${err instanceof Error ? err.message : err}`);
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
      if (!logEntry || typeof logEntry.amount !== 'number') {
        logger.warn('Missing or invalid log entry for message formatting');
        return '💰 Staking event occurred';
      }

      const { direction, amount, validator, totalEraStake, era, blockNumber } = logEntry;

      // Format amounts
      const formattedAmount = formatDotAmount(amount);
      const totalStakeFormatted = totalEraStake 
        ? formatDotAmount(totalEraStake, 2) 
        : 'N/A';

      // Format validator info
      const validatorName = validator?.name || 'Unknown Validator';
      const validatorId = validator?.address 
        ? ` (${validator.address.slice(0, 6)}...${validator.address.slice(-4)})` 
        : '';

      // Format era info
      const eraInfo = era ? ` [Era ${era}]` : '';
      const blockInfo = blockNumber ? ` at block #${blockNumber}` : '';

      // Create appropriate message based on event type
      if (direction === 'rewarded') {
        return `🎁 Staking Reward: ${formattedAmount} DOT received from validator '${validatorName}'${validatorId}${eraInfo}${blockInfo}. Total era stake: ${totalStakeFormatted} DOT.`;
      } else if (direction === 'slashed') {
        return `⚠️ Staking Slash: ${formattedAmount} DOT slashed by validator '${validatorName}'${validatorId}${eraInfo}${blockInfo}. Total era stake: ${totalStakeFormatted} DOT.`;
      } else {
        return `💰 Staking event: ${formattedAmount} DOT${eraInfo}${blockInfo}`;
      }
    } catch (err) {
      logger.error(`Error formatting staking message: ${err instanceof Error ? err.message : err}`);
      return '💰 Staking event occurred';
    }
  },
};

export default staking;