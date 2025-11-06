import os from 'os';
import fs from 'fs';
import { getApi } from '../utils/papi';
import storage from '../utils/storage';
import logger from '../utils/logger';
import { CHAINS } from '../config';
import cluster from 'cluster';
import { Router, Request, Response } from 'express';
import { promises as fsPromises } from 'fs';

const router = Router();

// ──────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────────────────────────────────
/**
 * @route GET /health
 *
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 papi:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 *                     example: connected
 *                 stats:
 *                   type: object
 *                   properties:
 *                     activeTenants:
 *                       type: integer
 *                       example: 5
 *                     eventsProcessed24h:
 *                       type: integer
 *                       example: 1500
 *                     notificationsSent24h:
 *                       type: integer
 *                       example: 1450
 *                     uptimeHours:
 *                       type: number
 *                       example: 12.5
 *                 system:
 *                   type: object
 *                   properties:
 *                     memoryUsageMB:
 *                       type: integer
 *                       example: 256
 *                     cpuPercent:
 *                       type: number
 *                       example: 15.3
 *                 cluster:
 *                   type: object
 *                   properties:
 *                     workerId:
 *                       type: integer
 *                       example: 2
 *                     pid:
 *                       type: integer
 *                       example: 12345
 *                     role:
 *                       type: string
 *                       example: monitoring
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 error:
 *                   type: string
 *                   example: Health check failed
 *                 details:
 *                   type: string
 *                   example: Database connection timeout
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // 1. Timestamp
    const timestamp = new Date().toISOString();

    // 2. PAPI Connection Status
    const papiStatus: Record<string, string> = {};
    for (const chain of CHAINS) {
      try {
        const api = await getApi(chain.name, chain.rpcUrls);
        papiStatus[chain.name] = api.isConnected ? 'connected' : 'disconnected';
      } catch {
        papiStatus[chain.name] = 'disconnected';
      }
    }

    // 3. Stats from storage & logs
    const tenants = await storage.getAllTenants();
    const activeTenants = tenants.length;

    // Count events & notifications from today's log files
    let eventsProcessed24h = 0;
    let notificationsSent24h = 0;

    for (const tenantId of tenants) {
      const logFile = storage.getLogFilePath(tenantId); // uses today's date
      if (fs.existsSync(logFile)) {
        const content = await fsPromises.readFile(logFile, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const enc of lines) {
          try {
            const decrypted = storage.decrypt(enc);
            const log = JSON.parse(decrypted);
            if (log.type === 'event') eventsProcessed24h++;
            if (log.type === 'notification') notificationsSent24h++;
          } catch {
            // Skip corrupted lines
          }
        }
      }
    }

    // 4. System metrics
    const memoryUsageMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const cpuPercent = Math.round((os.loadavg()[0] / os.cpus().length) * 1000) / 10; // 1min load avg

    // 5. Uptime
    const uptimeHours = Math.round(process.uptime() / 36) / 100; // in hours, 1 decimal

    // Final response
    res.json({
      status: 'ok',
      timestamp,
      papi: {
        ...papiStatus
      },
      stats: {
        activeTenants,
        eventsProcessed24h,
        notificationsSent24h,
        uptimeHours
      },
      system: {
        memoryUsageMB,
        cpuPercent
      },
      cluster: cluster.isWorker ? {
        workerId: cluster.worker?.id,
        pid: process.pid,
        role: CHAINS.some(c => c.assignedWorkerId === cluster.worker?.id) ? 'monitoring' : 'rest'
      } : undefined
    });
  } catch (err: any) {
    logger.error(`Health check failed: ${err.message}`);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      details: err.message
    });
  }
});

export default router;
