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
import storage from '../utils/storage';
import { getPlugin, loadPlugins } from '../utils/pluginRegistry';
import { isValidPolkadotAddress } from '../utils/validate';
import { NotificationPlugin } from '../types/pluginTypes';

loadPlugins(); // Ensure plugins are loaded before handling requests

const router = Router();

/**
 * @route POST /setup
 * @description Accepts tenant configuration for monitored address and plugins.
 *              Validates plugin types and saves configuration to encrypted storage.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // Log full request body for debugging
    console.log('Full request body:', JSON.stringify(req.body, null, 2));

    const { address, plugins } = req.body;
    const { tenantId } = req as any; // Injected by verifyToken middleware

    console.log('Parsed address:', address);
    console.log('Parsed plugins:', plugins);

    // Validate request body structure
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('Request body is empty or undefined');
      return res.status(400).json({ error: 'Request body is empty or malformed' });
    }

    // Validate Polkadot address format
    const { isValid, polkadotAddress } = isValidPolkadotAddress(address);
    if (!address || !isValid || !polkadotAddress) {
      console.log('Address validation failed for:', address);
      return res.status(400).json({ error: 'Invalid Polkadot address' });
    }

    // Validate plugin structure
    if (!plugins || !plugins.activities || !Array.isArray(plugins.activities)) {
      return res.status(400).json({ error: 'Invalid activities configuration' });
    }
    if (!plugins.notifications || !Array.isArray(plugins.notifications)) {
      return res.status(400).json({ error: 'Invalid notifications configuration' });
    }

    // Validate existence of each activity plugin
    for (const act of plugins.activities) {
      const plugin = getPlugin('activities', act);
      if (!plugin) {
        return res.status(400).json({ error: `Unknown activity plugin: ${act}` });
      }
    }

    // Validate each notification plugin and its config
    for (const notif of plugins.notifications) {
      const plugin = getPlugin('notifications', notif.type) as NotificationPlugin;
      if (!plugin) {
        return res.status(400).json({ error: `Unknown notification plugin: ${notif.type}` });
      }
      plugin.validateConfig(notif.config); // Throws if invalid
    }

    // Load existing config and update with new values
    const configData = await storage.loadConfig(tenantId) || {};
    configData.address = polkadotAddress;
    configData.plugins = plugins;
    configData.updatedAt = new Date().toISOString();

    // Save updated configuration to encrypted tenant storage
    storage.saveConfig(tenantId, configData);

    // Return confirmation response
    res.json({
      success: true,
      message: 'Configuration saved',
      address: polkadotAddress,
      plugins: {
        activities: plugins.activities,
        notifications: plugins.notifications.map((n: any) => n.type),
      },
    });
  } catch (error: any) {
    console.error('Setup error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

export default router;
