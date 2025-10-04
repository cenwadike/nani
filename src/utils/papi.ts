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
 * @file utils/papi.ts
 * @summary Manages connection lifecycle to the Polkadot API (PAPI).
 * @description Establishes and maintains a resilient WebSocket connection to the Polkadot blockchain
 *              using PAPI. Includes automatic reconnection logic and shared API access.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import config from '../config';
import logger from './logger';

// Cached API instance shared across the application
let api: ApiPromise | null = null;

// Flag to prevent concurrent connection attempts
let isConnecting = false;

// Tracks exponential backoff attempts for reconnection
let reconnectAttempts = 0;

// Maximum delay between reconnection attempts (in milliseconds)
const MAX_RECONNECT_DELAY = 30000;

// List of fallback endpoints (primary first)
const endpoints = [config.papiWs, ...(config.backupPapiWs || [])];

/**
 * @function connect
 * @description Attempts to connect to the Polkadot API using available endpoints.
 *              Tries each endpoint in order until successful.
 * @returns {ApiPromise} Connected API instance
 */
async function connect(): Promise<ApiPromise> {
  if (api && api.isConnected) {
    logger.info('Polkadot API already connected');
    return api;
  }

  if (isConnecting) {
    logger.info('Waiting for existing Polkadot API connection attempt');
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return api!;
  }

  isConnecting = true;

  for (const endpoint of endpoints) {
    try {
      logger.event(`Attempting connection to Polkadot API at ${endpoint}`);
      const provider = new WsProvider(endpoint);
      api = await ApiPromise.create({ provider });

      logger.info(`Connected to Polkadot API at ${endpoint}`);
      reconnectAttempts = 0;
      isConnecting = false;

      api.on('disconnected', () => {
        logger.error(`Disconnected from ${endpoint}, attempting reconnect...`);
        reconnect();
      });

      return api;
    } catch (error: any) {
      logger.error(`Connection failed for ${endpoint}: ${error.message}`);
    }
  }

  isConnecting = false;
  throw new Error('All Polkadot API endpoints failed');
}

/**
 * @function reconnect
 * @description Implements exponential backoff strategy to reconnect to PAPI.
 *              Retries indefinitely until a successful connection is established.
 */
async function reconnect(): Promise<void> {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);

  logger.event(`Reconnect attempt ${reconnectAttempts}, waiting ${delay}ms...`);
  await new Promise((resolve) => setTimeout(resolve, delay));

  try {
    await connect();
  } catch (error: any) {
    logger.error(`Reconnect failed: ${error.message}`);
    reconnect(); // Recursive retry
  }
}

/**
 * @function getApi
 * @description Returns a connected Polkadot API instance, establishing a connection if needed.
 * @returns {ApiPromise} Connected API instance
 */
async function getApi(): Promise<ApiPromise> {
  if (!api || !api.isConnected) {
    logger.info('Polkadot API not connected, initiating connection...');
    await connect();
  }
  return api!;
}

export { connect, getApi };
