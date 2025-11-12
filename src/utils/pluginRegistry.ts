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
 * @file utils/pluginRegistry.ts
 * @summary Enterprise-grade, hot-reloadable plugin system for Nani
 * @description Production-ready plugin orchestrator with zero-downtime loading, strict validation,
 *              automatic initialization, and runtime introspection. Supports three plugin types:
 *              • activities   → real-time event filtering & formatting
 *              • notifications → SMS, Discord, Email, Telegram, etc.
 *              • stats        → on-chain analytics & dashboards
 *              Features full lifecycle management, cache busting, and defensive error handling.
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT – Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Zero-downtime plugin loading (safe in cluster workers)
 *   • Automatic `init()` execution for notification plugins
 *   • Strict contract validation (missing methods → rejected)
 *   • Hot-reload support via `reloadPlugins()` (dev + testing)
 *   • Cache-busting on every load (fresh exports guaranteed)
 *   • Runtime introspection: list all loaded plugins
 *   • Fail-fast with detailed error context + stack traces
 *   • Type-safe access via `getPlugin()` and `getPlugins()`
 *   • Thread-safe singleton pattern (idempotent loading)
 *   • Railway / Docker / Fly.io / Kubernetes ready
 *   • Used by workerpool tasks and HTTP API routes
 */

import fs from 'fs';
import path from 'path';
import logger from './logger';
import { ActivityPlugin, NotificationPlugin, StatsPlugin } from '../types/pluginTypes';

// ——————————————————————————————————————
// PLUGIN REGISTRY — Central in-memory store
// ——————————————————————————————————————
const plugins: {
  activities: { [name: string]: ActivityPlugin };
  notifications: { [name: string]: NotificationPlugin };
  stats: { [name: string]: StatsPlugin };
} = {
  activities: {},
  notifications: {},
  stats: {},
};

// Singleton guard — prevents double-loading in cluster forks
let pluginsLoaded = false;

// ——————————————————————————————————————
// CORE LOADER — Secure, validated, observable
// ——————————————————————————————————————
/**
 * Dynamically discovers and loads all plugins from /plugins/**
 * Validates contracts, runs init(), and registers by name
 * Idempotent — safe to call multiple times
 */
export function loadPlugins(): void {
  if (pluginsLoaded) {
    logger.info('Plugins already loaded → skipping redundant scan');
    return;
  }

  const pluginDir = path.join(__dirname, '../plugins');
  logger.info(`Scanning plugin directory: ${pluginDir}`);

  // Supported plugin categories
  ['activities', 'notifications', 'stats'].forEach((type) => {
    const typeDir = path.join(pluginDir, type);
    if (!fs.existsSync(typeDir)) {
      logger.warn(`Plugin directory missing: ${typeDir}`);
      return;
    }

    const files = fs.readdirSync(typeDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .filter(f => !f.endsWith('.d.ts')); // Exclude type definitions

    logger.info(`Found ${files.length} ${type} plugin(s) in ${type}/`);

    files.forEach((file) => {
      const pluginPath = path.join(typeDir, file);
      const pluginKey = `${type}/${file}`;

      try {
        // Force fresh require() — critical for hot-reload
        delete require.cache[require.resolve(pluginPath)];
        
        const pluginModule = require(pluginPath);
        const plugin = pluginModule.default || pluginModule;

        if (!plugin || typeof plugin !== 'object') {
          logger.error(`Invalid export in ${pluginKey} → must export an object`);
          return;
        }

        const pluginName: string = plugin.name;
        if (!pluginName || typeof pluginName !== 'string') {
          logger.error(`Plugin ${pluginKey} missing valid .name property`);
          return;
        }

        // ——— NOTIFICATION PLUGINS — Require init(), execute(), validateConfig() ———
        if (type === 'notifications') {
          const notif = plugin as NotificationPlugin;

          if (typeof notif.init !== 'function') {
            logger.error(`Notification plugin ${pluginName} → missing init()`);
            return;
          }
          if (typeof notif.execute !== 'function') {
            logger.error(`Notification plugin ${pluginName} → missing execute()`);
            return;
          }
          if (typeof notif.validateConfig !== 'function') {
            logger.error(`Notification plugin ${pluginName} → missing validateConfig()`);
            return;
          }

          // Auto-initialize on load
          try {
            notif.init();
            logger.event(`Initialized notification plugin: ${pluginName}`);
          } catch (err: any) {
            logger.error(`Failed to init ${pluginName}: ${err.message}`);
            return;
          }
        }

        // ——— ACTIVITY PLUGINS — Require filter(), log(), formatMessage() ———
        else if (type === 'activities') {
          const act = plugin as ActivityPlugin;

          if (typeof act.filter !== 'function') {
            logger.error(`Activity plugin ${pluginName} → missing filter()`);
            return;
          }
          if (typeof act.log !== 'function') {
            logger.error(`Activity plugin ${pluginName} → missing log()`);
            return;
          }
          if (typeof act.formatMessage !== 'function') {
            logger.error(`Activity plugin ${pluginName} → missing formatMessage()`);
            return;
          }
        }

        // ——— STATS PLUGINS — Require compute() ———
        else if (type === 'stats') {
          const stat = plugin as StatsPlugin;

          if (typeof stat.compute !== 'function') {
            logger.error(`Stats plugin ${pluginName} → missing compute()`);
            return;
          }
        }

        // Register plugin
        plugins[type as keyof typeof plugins][pluginName] = plugin;
        logger.event(`Loaded ${type} plugin → ${pluginName}`);

      } catch (err: any) {
        logger.error(`Failed to load plugin ${pluginKey}: ${err.message}`);
        logger.error(`Stack: ${err.stack}`);
      }
    });
  });

  pluginsLoaded = true;
  logger.info('Plugin registry fully initialized');

  // Summary for observability
  logger.info(`Active plugins → Activities: [${Object.keys(plugins.activities).join(', ')}]`);
  logger.info(`Active plugins → Notifications: [${Object.keys(plugins.notifications).join(', ')}]`);
  logger.info(`Active plugins → Stats: [${Object.keys(plugins.stats).join(', ')}]`);
}

// ——————————————————————————————————————
// LIFECYCLE & INTROSPECTION UTILITIES
// ——————————————————————————————————————
/**
 * Ensures plugins are loaded — safe to call anywhere
 * Used by server.ts, worker tasks, and API routes
 */
export function ensurePluginsLoaded(): void {
  if (!pluginsLoaded) {
    logger.info('ensurePluginsLoaded() triggered → loading now');
    loadPlugins();
  }
}

/**
 * Check current load state
 */
export function arePluginsLoaded(): boolean {
  return pluginsLoaded;
}

/**
 * Force reload all plugins — for testing or live hot-reload
 * Clears cache and re-scans disk
 */
export function reloadPlugins(): void {
  logger.warn('Reloading ALL plugins (hot-reload triggered)');
  pluginsLoaded = false;

  // Clear registry
  Object.keys(plugins.activities).forEach(k => delete plugins.activities[k]);
  Object.keys(plugins.notifications).forEach(k => delete plugins.notifications[k]);
  Object.keys(plugins.stats).forEach(k => delete plugins.stats[k]);

  loadPlugins();
}

// ——————————————————————————————————————
// SAFE ACCESSORS — With fallback logging
// ——————————————————————————————————————
/**
 * Retrieve a single plugin by type and name
 * @param type Plugin category
 * @param name Plugin.name value
 * @returns Plugin instance or undefined
 */
export function getPlugin(
  type: 'activities' | 'notifications' | 'stats',
  name: string
): ActivityPlugin | NotificationPlugin | StatsPlugin | undefined {
  ensurePluginsLoaded();

  const plugin = plugins[type][name];
  if (!plugin) {
    const available = Object.keys(plugins[type]).join(', ') || 'none';
    logger.warn(`Plugin not found: ${type}/${name} → Available: ${available}`);
  }
  return plugin;
}

/**
 * Get all plugins of a given type
 * @param type Plugin category
 * @returns Object map of name → plugin
 */
export function getPlugins(type: 'activities' | 'notifications' | 'stats') {
  ensurePluginsLoaded();
  return { ...plugins[type] }; // Shallow clone for safety
}

// ——————————————————————————————————————
// EXPORT RAW REGISTRY (internal use only)
// ——————————————————————————————————————
export { plugins };
