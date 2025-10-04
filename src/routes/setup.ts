import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import { getPlugin, loadPlugins } from '../utils/pluginRegistry';
import { isValidPolkadotAddress } from '../utils/validate';
import { NotificationPlugin } from '../types/pluginTypes';

loadPlugins();

const router = Router();

router.post('/', async(req: Request, res: Response) => {
  try {
    // Log the entire request body for debugging
    console.log('Full request body:', JSON.stringify(req.body, null, 2));

    const { address, plugins } = req.body;
    const { tenantId } = req as any; // Extended from verifyToken

    console.log('Parsed address:', address);
    console.log('Parsed plugins:', plugins);

    // Check if req.body is empty or undefined
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log('Request body is empty or undefined');
      return res.status(400).json({ error: 'Request body is empty or malformed' });
    }

    // Validate address for Polkadot
    const { isValid, polkadotAddress } = isValidPolkadotAddress(address);
    if (!address || !isValid || !polkadotAddress) {
      console.log('Address validation failed for:', address);
      return res.status(400).json({ error: 'Invalid Polkadot address' });
    }

    // Validate plugins structure
    if (!plugins || !plugins.activities || !Array.isArray(plugins.activities)) {
      return res.status(400).json({ error: 'Invalid activities configuration' });
    }
    if (!plugins.notifications || !Array.isArray(plugins.notifications)) {
      return res.status(400).json({ error: 'Invalid notifications configuration' });
    }

    // Validate each activity plugin (existence only, no config for activities)
    for (const act of plugins.activities) {
      const plugin = getPlugin('activities', act);
      if (!plugin) {
        return res.status(400).json({ error: `Unknown activity plugin: ${act}` });
      }
    }

    // Validate each notification plugin
    for (const notif of plugins.notifications) {
      const plugin = getPlugin('notifications', notif.type) as NotificationPlugin;
      if (!plugin) {
        return res.status(400).json({ error: `Unknown notification plugin: ${notif.type}` });
      }
      plugin.validateConfig(notif.config);
    }

    // Load existing config and update
    const configData = await storage.loadConfig(tenantId) || {};
    configData.address = polkadotAddress; // Use Polkadot-formatted address
    configData.plugins = plugins;
    configData.updatedAt = new Date().toISOString();

    storage.saveConfig(tenantId, configData);

    res.json({
      success: true,
      message: 'Configuration saved',
      address: polkadotAddress, // Return Polkadot-formatted address
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
