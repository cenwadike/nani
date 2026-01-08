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
 * @file routes/setup.ts
 * @summary Nuclear-grade `/setup` endpoint – The configuration powerhouse of Nani
 * @description **Batch atomic tenant provisioning** for 1–100 chains in a single request.
 *              Validates everything:
 *              • Chain existence
 *              • SS58 address (canonicalized)
 *              • Activity plugin registration
 *              • Notification plugin + `validateConfig()` enforcement
 *              • Zero-downtime plugin hot-loading
 *              Used by:
 *              • Web dashboard
 *              • Mobile app
 *              • CLI tool
 *              • Enterprise onboarding flows
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT – Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Full batch processing with per-chain success/failure reporting
 *   • Real-time plugin validation via registry + `validateConfig()`
 *   • Automatic address detection and validation
 *   • Encrypted per-chain config storage
 */
// routes/setup.ts – Updated with full multi-chain address validation

import { Router, Request, Response } from 'express';
import { MonitoringMode, saveChainConfig, TenantConfig } from '../utils/storage';
import { ensurePluginsLoaded, getPlugin } from '../utils/pluginRegistry';
import { validateAddress } from '../utils/validateAddress'; // ← NEW: generalized validator
import { NotificationPlugin } from '../types/pluginTypes';
import { CHAINS } from '../config';
import logger from '../utils/logger';
import { validateFilter, FilterConfig } from '../utils/filterEngine';
import tenantCache from '../utils/tenantCache';

ensurePluginsLoaded();

const router = Router();

interface SetupResult {
  chainId: string;
  success: boolean;
  data?: {
    addresses: string[];
    monitoringMode: MonitoringMode;
    tokenSymbol: string;
    activities: string[];
    notificationsCount: number;
    filtersCount?: number;
  };
  error?: string;
}

router.post('/', async (req: Request, res: Response) => {
  const tenantId = (req as any).tenantId;
  const { setups } = req.body;

  logger.info(`Batch setup request → tenant ${tenantId} → ${setups?.length || 0} chain(s)`);

  if (!Array.isArray(setups) || setups.length === 0) {
    return res.status(400).json({
      success: false,
      error: '"setups" must be a non-empty array of chain configurations',
    });
  }

  const results: SetupResult[] = [];

  for (const [index, setup] of setups.entries()) {
    const prefix = `[${index}] ${setup.chainId || '??'}`;
    const result: SetupResult = { chainId: setup.chainId || 'unknown', success: false };

    try {
      // 1. Chain ID validation
      if (!setup.chainId || typeof setup.chainId !== 'string') {
        throw new Error('chainId is required and must be string');
      }
      const chain = CHAINS.find(c => c.name === setup.chainId.trim());
      if (!chain) {
        throw new Error(`Invalid chainId. Valid: [${CHAINS.map(c => c.name).join(', ')}]`);
      }

      // 2. Monitoring mode
      const monitoringMode: MonitoringMode =
        setup.monitoringMode === 'global' ? 'global' : 'personal';

      if (!['personal', 'global'].includes(monitoringMode)) {
        throw new Error('monitoringMode must be "personal" or "global"');
      }

      // 3. Address handling based on mode
      let normalizedAddresses: string[] | undefined = undefined;

      if (monitoringMode === 'personal') {
        if (!Array.isArray(setup.addresses) || setup.addresses.length === 0) {
          throw new Error('At least one address required in personal monitoring mode');
        }

        normalizedAddresses = [];
        for (const rawAddr of setup.addresses) {
          if (typeof rawAddr !== 'string' || !rawAddr.trim()) {
            throw new Error('All addresses must be non-empty strings');
          }

          // Use generalized multi-chain validator
          const validation = validateAddress(
            rawAddr.trim(),
            chain.name,
            chain.adapterType,
            chain.adapterType.toLowerCase() === 'cosmos' ? { hrp: chain.hrp } : undefined
          );

          if (!validation.isValid || !validation.normalizedAddress) {
            throw new Error(`Invalid address for chain ${chain.name} (${chain.adapterType}): ${rawAddr}`);
          }

          normalizedAddresses.push(validation.normalizedAddress);
        }

        // Deduplicate
        normalizedAddresses = [...new Set(normalizedAddresses)];

      } else { // global mode
        if (setup.addresses && Array.isArray(setup.addresses) && setup.addresses.length > 0) {
          logger.warn(`${prefix} → addresses provided in global mode – will be ignored`);
        }
      }

      // 4. Plugins validation
      if (!setup.plugins || typeof setup.plugins !== 'object') {
        throw new Error('plugins object is required');
      }
      if (!Array.isArray(setup.plugins.activities) || setup.plugins.activities.length === 0) {
        throw new Error('At least one activity plugin required');
      }
      for (const act of setup.plugins.activities) {
        const name = act?.trim();
        if (!name) throw new Error('Activity plugin name cannot be empty');
        if (!getPlugin('activities', name)) {
          throw new Error(`Unknown activity plugin: ${name}`);
        }
      }

      if (!Array.isArray(setup.plugins.notifications)) {
        throw new Error('notifications must be array (can be empty)');
      }
      for (const notif of setup.plugins.notifications) {
        if (!notif?.type || typeof notif.type !== 'string') {
          throw new Error('Notification type is required');
        }
        if (!notif.config || typeof notif.config !== 'object') {
          throw new Error(`Config object required for notification ${notif.type}`);
        }
        const plugin = getPlugin('notifications', notif.type) as NotificationPlugin;
        if (!plugin) throw new Error(`Unknown notification plugin: ${notif.type}`);
        if (!plugin.validateConfig(notif.config)) {
          throw new Error(`Invalid config for ${notif.type} – failed validateConfig()`);
        }
      }

      // 5. Filters validation
      let validatedFilters: FilterConfig[] = [];
      if (setup.filters) {
        if (!Array.isArray(setup.filters)) throw new Error('filters must be an array');
        if (setup.filters.length > 0) {
          for (const [fIdx, filter] of setup.filters.entries()) {
            if (!filter || typeof filter !== 'object') throw new Error(`Filter #${fIdx} must be an object`);
            if (!filter.name || typeof filter.name !== 'string') throw new Error(`Filter #${fIdx} missing valid 'name'`);
            if (typeof filter.enabled !== 'boolean') filter.enabled = true;
            if (!filter.expression || typeof filter.expression !== 'object') {
              throw new Error(`Filter "${filter.name}" missing 'expression'`);
            }
            const validation = validateFilter(filter.expression);
            if (!validation.valid) throw new Error(`Filter "${filter.name}" invalid: ${validation.error}`);
          }
          validatedFilters = setup.filters.map((f: any) => ({
            name: f.name.trim(),
            description: f.description?.trim(),
            enabled: !!f.enabled,
            expression: f.expression,
          }));
          logger.info(`${prefix} → ${validatedFilters.length} safe filter(s) validated`);
        }
      }

      // 6. Save config
      const configData: TenantConfig = {
        addresses: normalizedAddresses,
        monitoringMode,
        chainId: chain.name,
        tokenSymbol: chain.tokenSymbol,
        plugins: {
          activities: setup.plugins.activities.map((a: string) => a.trim()),
          notifications: setup.plugins.notifications,
        },
        filters: validatedFilters,
        updatedAt: new Date().toISOString(),
      };

      await saveChainConfig(tenantId, chain.name, configData);
      await tenantCache.refreshTenantChain(tenantId, chain.name);

      logger.event(
        `${prefix} → Config saved | mode: ${monitoringMode} | addresses: ${normalizedAddresses?.length || 0} | filters: ${validatedFilters.length}`
      );

      result.success = true;
      result.data = {
        addresses: normalizedAddresses || [],
        monitoringMode,
        tokenSymbol: chain.tokenSymbol,
        activities: setup.plugins.activities.map((a: string) => a.trim()),
        notificationsCount: setup.plugins.notifications.length,
        filtersCount: validatedFilters.length,
      };
    } catch (err: any) {
      const msg = err.message || 'Unknown validation error';
      logger.error(`${prefix} → Setup failed: ${msg}`);
      result.error = msg;
    }

    results.push(result);
  }

  // Final response
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    return res.status(400).json({
      success: false,
      message: `${failed.length} config(s) failed validation`,
      results,
    });
  }

  res.json({
    success: true,
    message: 'All chain configurations saved successfully',
    results,
  });
});

export default router;
