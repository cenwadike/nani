import fs from 'fs';
import path from 'path';
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

function loadPlugins() {
  const pluginDir = path.join(__dirname, '../plugins');

  ['activities', 'notifications', 'stats'].forEach((type) => {
    const typeDir = path.join(pluginDir, type);
    if (!fs.existsSync(typeDir)) return;

    const files = fs.readdirSync(typeDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

    files.forEach((file) => {
      const pluginPath = path.join(typeDir, file);
      const pluginName = path.basename(file, path.extname(file));

      try {
        const plugin = require(pluginPath).default;
        plugins[type as keyof typeof plugins][pluginName] = plugin;
        console.log(`Loaded ${type} plugin: ${pluginName}`);
      } catch (error: any) {
        console.error(`Failed to load plugin ${file}:`, error.message);
      }
    });
  });
}

function getPlugin(type: keyof typeof plugins, name: string) {
  return plugins[type]?.[name];
}

function getPlugins(type: keyof typeof plugins) {
  return plugins[type] || {};
}

export { loadPlugins, getPlugin, getPlugins, plugins };
