// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event notifications service.
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
 * @file utils/papi.ts
 * @summary Manages connection lifecycle to the Polkadot API (PAPI).
 * @description Establishes and maintains a resilient WebSocket connection to the Polkadot blockchain
 *              using PAPI. Includes automatic reconnection logic and shared API access.
 */
// utils/papi.ts
import { ApiPromise, WsProvider } from '@polkadot/api';
import logger from './logger';

// Global cache: chainName → { api, url, reconnectAttempts }
const chainCache = new Map<string, {
  api: ApiPromise;
  url: string;
  reconnectAttempts: number;
}>();

const MAX_RECONNECT_DELAY = 30000;

/**
 * Connect to a specific chain using its RPC URLs
 */
async function connectChain(chainName: string, rpcUrls: string[]): Promise<ApiPromise> {
  const cached = chainCache.get(chainName);
  if (cached?.api?.isConnected) {
    logger.info(`Using cached API for ${chainName}`);
    return cached.api;
  }

  for (const url of rpcUrls) {
    try {
      logger.event(`Connecting to ${chainName} at ${url}`);
      const provider = new WsProvider(url, 5000, {}, 60_000);
      const api = await ApiPromise.create({ provider });
      await api.isReady;

      const entry = { api, url, reconnectAttempts: 0 };
      chainCache.set(chainName, entry);

      provider.on('disconnected', () => {
        logger.warn(`Disconnected from ${url}. Reconnecting...`);
        chainCache.delete(chainName);
        reconnectChain(chainName, rpcUrls);
      });

      logger.info(`Connected to ${chainName} at ${url}`);
      return api;
    } catch (err: any) {
      logger.error(`Failed ${url}: ${err.message}`);
    }
  }

  throw new Error(`All endpoints failed for ${chainName}`);
}

async function reconnectChain(chainName: string, rpcUrls: string[]) {
  const entry = chainCache.get(chainName);
  const attempts = (entry?.reconnectAttempts || 0) + 1;
  const delay = Math.min(1000 * Math.pow(2, attempts), MAX_RECONNECT_DELAY);

  logger.event(`Reconnect ${chainName} attempt ${attempts}, delay ${delay}ms`);
  await new Promise(r => setTimeout(r, delay));

  try {
    const api = await connectChain(chainName, rpcUrls);
    chainCache.set(chainName, { api, url: '', reconnectAttempts: attempts });
  } catch {
    reconnectChain(chainName, rpcUrls);
  }
}

/**
 * Overloaded getApi
 * - getApi() → legacy single chain
 * - getApi(chainName, rpcUrls) → multi-chain
 */
async function getApi(chainName: string, rpcUrls: string[]): Promise<ApiPromise> {
    if (!chainCache.has(chainName) || !chainCache.get(chainName)?.api.isConnected) {
    logger.info('Polkadot API not connected, initiating connection...');
    await connectChain(chainName, rpcUrls);
  }
  return chainCache.get(chainName)?.api!;
}


export { getApi };
