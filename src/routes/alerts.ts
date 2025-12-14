import { Router, Request, Response } from 'express';
import { alertManager } from '../utils/alertSystem';

const router = Router();

// Get all alerts
router.get('/', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId;
  const alerts = tenantId ? alertManager.getUnreadAlerts() : [];
  
  res.json({
    alerts,
    stats: alertManager.getStats()
  });
});

// Get unread alerts
router.get('/unread', (req: Request, res: Response) => {
  const alerts = alertManager.getUnreadAlerts();
  res.json({ alerts, count: alerts.length });
});

// Mark alert as read
router.post('/:alertId/read', (req: Request, res: Response) => {
  const { alertId } = req.params;
  const success = alertManager.markAsRead(alertId);
  
  if (success) {
    res.json({ success: true, message: 'Alert marked as read' });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Dismiss alert
router.post('/:alertId/dismiss', (req: Request, res: Response) => {
  const { alertId } = req.params;
  const success = alertManager.dismiss(alertId);
  
  if (success) {
    res.json({ success: true, message: 'Alert dismissed' });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Get alert statistics
router.get('/stats', (req: Request, res: Response) => {
  res.json(alertManager.getStats());
});

export default router;
