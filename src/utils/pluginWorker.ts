import workerpool from 'workerpool';
import { getPlugin } from '../utils/pluginRegistry';
import { ActivityPlugin, NotificationPlugin } from '../types/pluginTypes';

async function processPluginTask(task: {
  record: any;
  tenantId: string;
  config: any;
}) {
  const { record, tenantId, config } = task;
  const { address, plugins } = config;
  const results: Promise<any>[] = [];

  if (!address || !plugins) return [];

  const activities = plugins.activities || [];

  for (const act of activities) {
    const plugin = getPlugin('activities', act) as ActivityPlugin;
    if (!plugin || !plugin.filter(record, address)) continue;

    const logEntry = plugin.log(record, address);
    const message = await plugin.formatMessage(logEntry, address);

    const notifications = plugins.notifications || [];
    for (const notif of notifications) {
      const notifPlugin = getPlugin('notifications', notif.type) as NotificationPlugin;
      if (notifPlugin) {
        results.push(notifPlugin.execute(message, notif.config));
      }
    }
  }

  return Promise.allSettled(results);
}

workerpool.worker({ processPluginTask });

