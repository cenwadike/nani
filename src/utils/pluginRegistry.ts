// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
//
// Copyright (c) 2025 Nani Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including but not limited to the rights
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
 * @file utils/pluginRegistry.ts
 * @summary Dynamically loads and manages plugins for activities, notifications, and stats.
 * @description This module scans the plugin directory, loads available plugins at runtime,
 *              and exposes access methods for retrieving them by type and name.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger';
import { ActivityPlugin, NotificationPlugin, StatsPlugin } from '../types/pluginTypes';

// Central plugin registry object, categorized by plugin type
const plugins: {
  activities: { [name: string]: ActivityPlugin };
  notifications: { [name: string]: NotificationPlugin };
  stats: { [name: string]: StatsPlugin };
} = {
  activities: {},
  notifications: {},
  stats: {},
};

/**
 * @function loadPlugins
 * @description Loads all plugins from the `plugins` directory into memory.
 *              Supports three plugin types: activities, notifications, and stats.
 *              Each plugin must export a default object conforming to its respective interface.
 */
function loadPlugins(): void {
  const pluginDir = path.join(__dirname, '../plugins');
  logger.info(`Scanning plugin directory: ${pluginDir}`);

  ['activities', 'notifications', 'stats'].forEach((type) => {
    const typeDir = path.join(pluginDir, type);
    if (!fs.existsSync(typeDir)) {
      logger.error(`Plugin type directory not found: ${typeDir}`);
      return;
    }

    const files = fs.readdirSync(typeDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    logger.info(`Found ${files.length} ${type} plugin files`);

    files.forEach((file) => {
      const pluginPath = path.join(typeDir, file);
      const pluginName = path.basename(file, path.extname(file));

      try {
        const plugin = require(pluginPath).default;
        plugins[type as keyof typeof plugins][pluginName] = plugin;
        logger.event(`Loaded ${type} plugin: ${pluginName}`);
      } catch (error: any) {
        logger.error(`Failed to load plugin ${file}: ${error.message}`);
      }
    });
  });

  logger.info('Plugin registry initialized');
}

/**
 * @function getPlugin
 * @description Retrieves a specific plugin by type and name.
 * @param type - Plugin category: 'activities', 'notifications', or 'stats'
 * @param name - Plugin name (filename without extension)
 * @returns The plugin instance or undefined if not found
 */
function getPlugin(type: keyof typeof plugins, name: string) {
  const plugin = plugins[type]?.[name];
  if (!plugin) {
    logger.error(`Plugin not found: type=${type}, name=${name}`);
  }
  return plugin;
}

/**
 * @function getPlugins
 * @description Retrieves all plugins of a given type.
 * @param type - Plugin category: 'activities', 'notifications', or 'stats'
 * @returns A dictionary of plugins keyed by name
 */
function getPlugins(type: keyof typeof plugins) {
  const all = plugins[type] || {};
  logger.info(`Retrieved ${Object.keys(all).length} plugins of type ${type}`);
  return all;
}

export { loadPlugins, getPlugin, getPlugins, plugins };
