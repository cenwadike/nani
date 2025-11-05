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
// Cache & Interval Management
// ============================================================================

const validatorCache = new Map<string, { data: ValidatorInfo; timestamp: number }>();

function cleanValidatorCache(): void {
  const now = Date.now();
  for (const [key, value] of validatorCache.entries()) {
    if (now - value.timestamp > VALIDATOR_CACHE_TTL) {
      validatorCache.delete(key);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Start / Stop API for testing
// ──────────────────────────────────────────────────────────────────────
let validatorCleanupInterval: NodeJS.Timeout | null = null;

export function startValidatorCacheCleanup(): void {
  if (validatorCleanupInterval) return;
  validatorCleanupInterval = setInterval(cleanValidatorCache, VALIDATOR_CACHE_TTL);
}

export function stopValidatorCacheCleanup(): void {
  if (validatorCleanupInterval) {
    clearInterval(validatorCleanupInterval);
    validatorCleanupInterval = null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

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

async function getValidatorIdentity(
  api: ApiPromise,
  validatorAddress: string
): Promise<ValidatorInfo> {
  const cached = validatorCache.get(validatorAddress);
  if (cached && Date.now() - cached.timestamp < VALIDATOR_CACHE_TTL) {
    return cached.data;
  }

  try {
    const identity = await api.query.identity.identityOf(validatorAddress);
    if (!identity || !(identity as any).isSome) return {};

    const identityData = identity.toJSON() as any;
    const info = identityData?.info || {};

    const validatorInfo: ValidatorInfo = {
      display: extractRawString(info.display),
      legal: extractRawString(info.legal),
      email: extractRawString(info.email),
      web: extractRawString(info.web),
      riot: extractRawString(info.riot),
    };

    validatorCache.set(validatorAddress, { data: validatorInfo, timestamp: Date.now() });
    return validatorInfo;
  } catch (err) {
    logger.error(`Error fetching validator identity for ${validatorAddress}: ${err instanceof Error ? err.message : err}`);
    return {};
  }
}

async function findValidatorForNominator(
  api: ApiPromise,
  nominatorAddress: string,
  eraIndex?: number
): Promise<ValidatorData> {
  try {
    let activeEraIndex = eraIndex;
    if (activeEraIndex === undefined) {
      const activeEra = await api.query.staking.activeEra();
      activeEraIndex = (activeEra as any)?.isSome ? (activeEra as any).unwrap().index.toNumber() : 0;
    }

    const eraStakers = await api.query.staking.erasStakers.entries(activeEraIndex);

    for (const [key, exposure] of eraStakers) {
      const validatorAddress = key.args[1].toString();
      const exposureData = (exposure as any).toJSON ? (exposure as any).toJSON() : exposure;

      if (exposureData?.others && Array.isArray(exposureData.others)) {
        const hasNominator = exposureData.others.some((nominator: any) => {
          if (typeof nominator === 'object' && nominator !== null) return nominator.who === nominatorAddress;
          if (Array.isArray(nominator)) return nominator[0] === nominatorAddress;
          return false;
        });

        if (hasNominator) {
          const identity = await getValidatorIdentity(api, validatorAddress);
          const displayName = identity.display || identity.legal || `${validatorAddress.slice(0, ADDRESS_TRUNCATE_LENGTH)}...`;
          return { address: validatorAddress, name: displayName, identity };
        }
      }
    }

    return { address: '', name: 'Unknown Validator', identity: {} };
  } catch (err) {
    logger.error(`Error finding validator for nominator: ${err instanceof Error ? err.message : err}`);
    return { address: '', name: 'Unknown Validator', identity: {} };
  }
}

async function getEraData(api: ApiPromise): Promise<{ activeEraIndex: number; totalStake: number }> {
  try {
    const activeEra = await api.query.staking.activeEra();
    const activeEraIndex = (activeEra as any)?.isSome ? (activeEra as any).unwrap().index.toNumber() : 0;
    const totalStake = await api.query.staking.erasTotalStake(activeEraIndex);
    const totalStakeBigInt = BigInt((totalStake as any).toString());
    const totalStakeDot = Number(totalStakeBigInt) / PLANCK_TO_DOT;
    return { activeEraIndex, totalStake: totalStakeDot };
  } catch (err) {
    logger.error(`Error fetching era data: ${err instanceof Error ? err.message : err}`);
    return { activeEraIndex: 0, totalStake: 0 };
  }
}

function formatDotAmount(amount: number, decimals: number = 4): string {
  return amount.toFixed(decimals);
}

// ============================================================================
// Plugin Implementation
// ============================================================================

const staking: ActivityPlugin = {
  name: 'staking',

  filter(record: any, address: string, chainId: string): boolean {
    try {
      const event = record?.event;
      if (!event || event.section !== 'staking') return false;
      if (!SUPPORTED_METHODS.includes(event.method as any)) return false;
      const [staker] = event.data.toJSON();
      return staker === address;
    } catch {
      return false;
    }
  },

  async log(
    record: any,
    address: string,
    chainId: string,
    tokenSymbol?: string
  ): Promise<StakingLogEntry | null> {
    try {
      const event = record?.event;
      if (!event) return null;

      const { method, data } = event;
      const [staker, amountPlanck] = data.toJSON();
      if (staker !== address) return null;

      const amountDot = Number(amountPlanck) / 1e12;
      const direction = method === 'Rewarded' ? 'rewarded' : 'slashed';
      const blockNumber = record.blockNumber?.toNumber() || 0;
      const blockHash = record.blockHash?.toHex() || '';

      const tenantId = address;
      const chainConfig = await storage.loadChainConfig(tenantId, chainId);
      if (!chainConfig?.api) return null;

      const api: ApiPromise = chainConfig.api;
      const [validatorData, eraData] = await Promise.all([
        findValidatorForNominator(api, address),
        getEraData(api),
      ]);

      return {
        timestamp: new Date().toISOString(),
        type: 'staking',
        direction,
        amount: amountDot,
        amountPlanck: String(amountPlanck),
        validator: validatorData,
        era: eraData.activeEraIndex,
        totalEraStake: eraData.totalStake,
        blockNumber,
        blockHash,
        address,
      };
    } catch (err: any) {
      logger.error(`Staking log error: ${err.message}`);
      return null;
    }
  },

  async formatMessage(logEntry: any): Promise<string> {
    try {
      if (!logEntry || typeof logEntry.amount !== 'number') return 'Staking event occurred';

      const { direction, amount, validator, totalEraStake, era, blockNumber } = logEntry;
      const formattedAmount = formatDotAmount(amount);
      const totalStakeFormatted = totalEraStake ? formatDotAmount(totalEraStake, 2) : 'N/A';
      const validatorName = validator?.name || 'Unknown Validator';
      const validatorId = validator?.address
        ? ` (${validator.address.slice(0, 6)}...${validator.address.slice(-4)})`
        : '';
      const eraInfo = era ? ` [Era ${era}]` : '';
      const blockInfo = blockNumber ? ` at block #${blockNumber}` : '';

      return direction === 'rewarded'
        ? `Staking Reward: ${formattedAmount} DOT received from validator '${validatorName}'${validatorId}${eraInfo}${blockInfo}. Total era stake: ${totalStakeFormatted} DOT.`
        : `Staking Slash: ${formattedAmount} DOT slashed by validator '${validatorName}'${validatorId}${eraInfo}${blockInfo}. Total era stake: ${totalStakeFormatted} DOT.`;
    } catch (err) {
      logger.error(`Error formatting staking message: ${err instanceof Error ? err.message : err}`);
      return 'Staking event occurred';
    }
  },
};

export default staking;
