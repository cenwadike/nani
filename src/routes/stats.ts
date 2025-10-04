import { Router, Request, Response } from 'express';
import storage from '../utils/storage';
import { getPlugin } from '../utils/pluginRegistry';
import { StatsPlugin } from '../types/pluginTypes';

const router = Router();

router.get('/', async(req: Request, res: Response) => {
  try {
    const { tenantId } = req as any;
    const { plugin = 'basic' } = req.query as { plugin?: string };

    // Load logs
    const logs = await storage.loadLogs(tenantId);

    // Get stats plugin
    const statsPlugin = getPlugin('stats', plugin) as StatsPlugin;
    if (!statsPlugin) {
      return res.status(400).json({ error: `Unknown stats plugin: ${plugin}` });
    }

    // Compute stats
    const stats = statsPlugin.compute(logs);

    res.json({
      plugin,
      stats,
      logsCount: logs.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
