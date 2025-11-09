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
 * @file utils/pluginRegistry.ts
 * @summary Dynamically loads and manages plugins for activities, notifications, and stats.
 * @description This module scans the plugin directory, loads available plugins at runtime,
 *              and exposes access methods for retrieving them by type and name.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger';
import { ActivityPlugin, NotificationPlugin, StatsPlugin } from '../types/pluginTypes';

const plugins: {
  activities: { [name: string]: ActivityPlugin };
  notifications: { [name: string]: NotificationPlugin };
  stats: { [name: string]: StatsPlugin };
} = {
  activities: {},
  notifications: {},
  stats: {},
};

// Singleton flag to prevent duplicate loading
let pluginsLoaded = false;

export function loadPlugins(): void {
  // Skip if already loaded
  if (pluginsLoaded) {
    logger.info('Plugins already loaded, skipping...');
    return;
  }

  const pluginDir = path.join(__dirname, '../plugins');
  logger.info(`Scanning plugin directory: ${pluginDir}`);

  ['activities', 'notifications', 'stats'].forEach((type) => {
    const typeDir = path.join(pluginDir, type);
    if (!fs.existsSync(typeDir)) {
      logger.warn(`Plugin type directory not found: ${typeDir}`);
      return;
    }

    const files = fs.readdirSync(typeDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    logger.info(`Found ${files.length} ${type} plugin files`);

    files.forEach((file) => {
      const pluginPath = path.join(typeDir, file);
      try {
        // Clear require cache to ensure fresh load
        delete require.cache[require.resolve(pluginPath)];
        
        const pluginModule = require(pluginPath);
        const plugin = pluginModule.default || pluginModule;

        if (!plugin || typeof plugin !== 'object') {
          logger.error(`Invalid plugin export in ${file}`);
          return;
        }

        const pluginName = plugin.name;
        if (!pluginName || typeof pluginName !== 'string') {
          logger.error(`Plugin in ${file} missing .name`);
          return;
        }

        // Validate plugin structure based on type
        if (type === 'notifications') {
          const notifPlugin = plugin as NotificationPlugin;
          
          // Check required methods
          if (typeof notifPlugin.init !== 'function') {
            logger.error(`Notification plugin ${pluginName} missing init() method`);
            return;
          }
          if (typeof notifPlugin.execute !== 'function') {
            logger.error(`Notification plugin ${pluginName} missing execute() method`);
            return;
          }
          if (typeof notifPlugin.validateConfig !== 'function') {
            logger.error(`Notification plugin ${pluginName} missing validateConfig() method`);
            return;
          }

          // Initialize notification plugins
          try {
            notifPlugin.init();
            logger.info(`Initialized notification plugin: ${pluginName}`);
          } catch (err: any) {
            logger.error(`Failed to init ${pluginName}: ${err.message}`);
            return;
          }
        } else if (type === 'activities') {
          const actPlugin = plugin as ActivityPlugin;
          
          // Check required methods
          if (typeof actPlugin.filter !== 'function') {
            logger.error(`Activity plugin ${pluginName} missing filter() method`);
            return;
          }
          if (typeof actPlugin.log !== 'function') {
            logger.error(`Activity plugin ${pluginName} missing log() method`);
            return;
          }
          if (typeof actPlugin.formatMessage !== 'function') {
            logger.error(`Activity plugin ${pluginName} missing formatMessage() method`);
            return;
          }
        } else if (type === 'stats') {
          const statsPlugin = plugin as StatsPlugin;
          
          // Check required methods
          if (typeof statsPlugin.compute !== 'function') {
            logger.error(`Stats plugin ${pluginName} missing compute() method`);
            return;
          }
        }

        // Store by .name
        plugins[type as keyof typeof plugins][pluginName] = plugin;

        logger.event(`Loaded ${type} plugin: ${pluginName}`);
      } catch (err: any) {
        logger.error(`Failed to load plugin ${file}: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
      }
    });
  });

  pluginsLoaded = true;
  logger.info('Plugin registry initialized');
  logger.info(`Loaded plugins: ${JSON.stringify({
    activities: Object.keys(plugins.activities),
    notifications: Object.keys(plugins.notifications),
    stats: Object.keys(plugins.stats)
  })}`);
}

/**
 * Ensures plugins are loaded before accessing them
 * Call this in contexts where plugins might not be loaded yet
 */
export function ensurePluginsLoaded(): void {
  if (!pluginsLoaded) {
    loadPlugins();
  }
}

/**
 * Check if plugins have been loaded
 */
export function arePluginsLoaded(): boolean {
  return pluginsLoaded;
}

/**
 * Force reload all plugins (useful for testing or hot-reload scenarios)
 */
export function reloadPlugins(): void {
  pluginsLoaded = false;
  // Clear the plugins object
  Object.keys(plugins.activities).forEach(k => delete plugins.activities[k]);
  Object.keys(plugins.notifications).forEach(k => delete plugins.notifications[k]);
  Object.keys(plugins.stats).forEach(k => delete plugins.stats[k]);
  
  loadPlugins();
}

export function getPlugin(
  type: 'activities' | 'notifications' | 'stats',
  name: string
): ActivityPlugin | NotificationPlugin | StatsPlugin | undefined {
  // Ensure plugins are loaded before accessing
  ensurePluginsLoaded();
  
  const plugin = plugins[type][name];
  if (!plugin) {
    logger.warn(`Plugin not found: ${type}/${name}. Available: ${Object.keys(plugins[type]).join(', ')}`);
  }
  return plugin;
}

export function getPlugins(type: 'activities' | 'notifications' | 'stats') {
  // Ensure plugins are loaded before accessing
  ensurePluginsLoaded();
  
  return plugins[type] || {};
}

export { plugins };
