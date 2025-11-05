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
 * @file routes/setup.ts
 * @summary Handles tenant configuration for monitored address and plugin setup.
 * @description This route validates and stores tenant-specific plugin configuration,
 *              including activity filters and notification channels. It ensures all plugins
 *              are registered and properly configured before saving.
 */

import { Router, Request, Response } from 'express';
import { saveChainConfig } from '../utils/storage';
import { ensurePluginsLoaded, getPlugin } from '../utils/pluginRegistry';
import { isValidPolkadotAddress } from '../utils/validateAddress';
import { NotificationPlugin } from '../types/pluginTypes';
import { CHAINS } from '../config';
import logger from '../utils/logger';

ensurePluginsLoaded();
const router = Router();

/**
 * @route POST /setup
 * @body { setups: ChainSetup[] }
 */
interface ChainSetup {
  chainId: string;
  address: string;
  plugins: {
    activities: string[];
    notifications: { type: string; config: any }[];
  };
}

interface SetupResult {
  chainId: string;
  success: boolean;
  address?: string;
  tokenSymbol?: string;
  error?: string;
}

router.post('/', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { setups } = req.body;

  logger.info(`Batch fan-out setup for tenant ${tenantId} → ${setups?.length || 0} chains`);

  // ──────────────────────────────────────────────────────────────────
  // 1. Validate root
  // ──────────────────────────────────────────────────────────────────
  if (!Array.isArray(setups) || setups.length === 0) {
    return res.status(400).json({
      error: '"setups" must be a non-empty array'
    });
  }

  const results: SetupResult[] = [];

  // ──────────────────────────────────────────────────────────────────
  // 2. Process each chain config
  // ──────────────────────────────────────────────────────────────────
  for (const [i, setup] of setups.entries()) {
    const prefix = `[${i}] chainId: ${setup.chainId || '??'}`;
    const result: SetupResult = { chainId: setup.chainId || 'unknown', success: false };

    try {
      // ---- chainId ----
      if (typeof setup.chainId !== 'string' || !setup.chainId.trim()) {
        throw new Error('chainId is required');
      }
      const chain = CHAINS.find(c => c.name === setup.chainId);
      if (!chain) {
        throw new Error(`Invalid chainId. Valid: [${CHAINS.map(c => c.name).join(', ')}]`);
      }

      // ---- address ----
      if (typeof setup.address !== 'string' || !setup.address.trim()) {
        throw new Error('address is required');
      }
      const { isValid, polkadotAddress } = isValidPolkadotAddress(setup.address);
      if (!isValid) throw new Error('Invalid SS58 address');

      // ---- plugins ----
      if (!setup.plugins || typeof setup.plugins !== 'object') {
        throw new Error('plugins object is required');
      }

      // ---- activities ----
      if (!Array.isArray(setup.plugins.activities) || setup.plugins.activities.length === 0) {
        throw new Error('activities must be non-empty array');
      }
      for (const act of setup.plugins.activities) {
        if (typeof act !== 'string' || !act.trim()) {
          throw new Error(`Activity plugin must be string: ${act}`);
        }
        if (!getPlugin('activities', act)) {
          throw new Error(`Unknown activity plugin: ${act}`);
        }
      }

      // ---- notifications ----
      if (!Array.isArray(setup.plugins.notifications)) {
        throw new Error('notifications must be array');
      }
      for (const notif of setup.plugins.notifications) {
        if (!notif || typeof notif !== 'object') throw new Error('Invalid notification object');
        if (typeof notif.type !== 'string' || !notif.type.trim()) throw new Error('Notification type required');
        if (!notif.config || typeof notif.config !== 'object') {
          throw new Error(`Config required for ${notif.type}`);
        }
        const plugin = getPlugin('notifications', notif.type) as NotificationPlugin;
        if (!plugin) throw new Error(`Unknown notification: ${notif.type}`);
        if (!plugin.validateConfig(notif.config)) {
          throw new Error(`Invalid config for ${notif.type}`);
        }
      }

      // ──────────────────────────────────────────────────────────────
      // Save per-chain config
      // ──────────────────────────────────────────────────────────────
      const configData = {
        address: polkadotAddress,
        chainId: chain.name,
        tokenSymbol: chain.tokenSymbol,
        plugins: {
          activities: setup.plugins.activities,
          notifications: setup.plugins.notifications,
        },
        updatedAt: new Date().toISOString(),
      };

      await saveChainConfig(tenantId, chain.name, configData);
      logger.info(`${prefix} → saved`);

      result.success = true;
      result.address = polkadotAddress ?? undefined;
      result.tokenSymbol = chain.tokenSymbol;
    } catch (err: any) {
      const msg = err.message;
      logger.error(`${prefix} → ${msg}`);
      result.error = msg;
    }

    results.push(result);
  }

  // ──────────────────────────────────────────────────────────────────
  // 3. Response
  // ──────────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    return res.status(400).json({
      success: false,
      message: `${failed.length} config(s) failed`,
      results
    });
  }

  res.json({
    success: true,
    message: 'All chain configs saved',
    results
  });
});

export default router;
