import { Router, Request, Response } from 'express';
import storage from '../utils/storage';

const router = Router();

router.get('/', async(req: Request, res: Response) => {
  try {
    const { tenantId } = req as any;
    const { format = 'csv' } = req.query as { format?: string };

    const logs = await storage.loadLogs(tenantId);

    if (logs.length === 0) {
      return res.status(404).json({ error: 'No logs found' });
    }

    if (format === 'csv') {
      // Generate CSV
      const headers = ['Timestamp', 'Type', 'Direction', 'From', 'To', 'Amount', 'Block'];
      const rows = logs.map((log: any) => [
        log.timestamp,
        log.type,
        log.direction,
        log.from,
        log.to,
        (log.amount / 1e12).toFixed(4),
        log.blockNumber,
      ]);

      const csv = [
        headers.join(','),
        ...rows.map((row: string[]) => row.map((cell) => `"${cell}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="nani-logs-${tenantId}.csv"`);
      res.send(csv);
    } else if (format === 'json') {
      res.json({ logs });
    } else {
      res.status(400).json({ error: 'Invalid format. Use csv or json' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
