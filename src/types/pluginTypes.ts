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
 * @file types/pluginTypes.ts
 * @summary Defines interfaces for plugin architecture used in the Nani event engine.
 * @description These interfaces specify the required structure and behavior for activity,
 *              notification, and stats plugins. Each plugin type is dynamically loaded
 *              and executed based on tenant configuration.
 */

/**
 * @interface ActivityPlugin
 * @description Interface for plugins that filter and process blockchain activity events.
 */
export interface ActivityPlugin {
  // Unique name of the plugin
  name: string;

  /**
   * @function filter
   * @description Determines whether a given event record is relevant to the specified address.
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Boolean or Promise<boolean> indicating match
   */
  filter(record: any, address: string): Promise<boolean> | boolean;

  /**
   * @function log
   * @description Extracts and formats log data from a matching event.
   * @param record - Blockchain event record
   * @param address - Tenant's Polkadot address
   * @returns Structured log entry
   */
  log(record: any, address: string): Promise<any> | any;

  /**
   * @function formatMessage
   * @description Converts a log entry into a human-readable message for notifications.
   * @param logEntry - Structured log data
   * @param address - Tenant's Polkadot address
   * @returns Notification message string
   */
  formatMessage(logEntry: any, address: string): Promise<string> | string;
}

/**
 * @interface NotificationPlugin
 * @description Interface for plugins that deliver messages via external channels (e.g., SMS, Discord).
 */
export interface NotificationPlugin {
  // Unique name of the plugin
  name: string;

  /**
   * @function init
   * @description Initializes the plugin (e.g., sets up API clients or credentials).
   */
  init(): void;

  /**
   * @function execute
   * @description Sends a formatted message using the plugin's delivery method.
   * @param message - Notification message
   * @param pluginConfig - Plugin-specific configuration object
   */
  execute(message: string, pluginConfig: any): Promise<void>;

  /**
   * @function validateConfig
   * @description Validates the plugin configuration provided by the tenant.
   * @param pluginConfig - Plugin-specific configuration object
   * @returns Boolean indicating whether the config is valid
   */
  validateConfig(pluginConfig: any): boolean;
}

/**
 * @interface StatsPlugin
 * @description Interface for plugins that compute analytics or summaries from event logs.
 */
export interface StatsPlugin {
  // Unique name of the plugin
  name: string;

  /**
   * @function compute
   * @description Processes an array of log entries and returns computed statistics.
   * @param logs - Array of log entries
   * @returns Computed stats object
   */
  compute(logs: any[]): any;
}
