import { Router, Request, Response } from 'express';
import { 
  verifyX402Payment, 
  getX402PaymentInfo, 
  trackX402Usage,
  getX402UsageStats,
  X402PaymentProof 
} from '../billing/x402';
import { checkAnalyticsAccess } from '../billing/analytics';
import logger from '../utils/logger';

const router = Router();

// ——————————————————————————————————————
// GET PAYMENT INFO FOR FEATURE
// ——————————————————————————————————————
router.get('/payment-info/:feature', (req: Request, res: Response) => {
  try {
    const { feature } = req.params;
    
    const validFeatures = [
      'aiAnalyticsQuery',
      'advancedAnalyticsQuery',
      'dataExport',
      'customFilter'
    ];

    if (!validFeatures.includes(feature)) {
      return res.status(400).json({ 
        error: 'Invalid feature',
        validFeatures 
      });
    }

    const paymentInfo = getX402PaymentInfo(feature as any);
    
    res.json({
      feature,
      ...paymentInfo,
      note: 'Complete payment on any supported chain and submit proof to verify endpoint'
    });

  } catch (error: any) {
    logger.error(`X402 payment info error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get payment info' });
  }
});

// ——————————————————————————————————————
// VERIFY PAYMENT PROOF
// ——————————————————————————————————————
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const proof: Omit<X402PaymentProof, 'verified'> = req.body;

    // Validate proof structure
    if (!proof.chain || !proof.txHash || !proof.from || !proof.amount || !proof.feature) {
      return res.status(400).json({ 
        error: 'Invalid proof structure',
        required: ['chain', 'txHash', 'from', 'amount', 'feature']
      });
    }

    // Verify payment
    const result = await verifyX402Payment(proof, proof.feature as any);

    if (!result.valid) {
      return res.status(402).json({
        verified: false,
        error: result.error
      });
    }

    // Track usage if tenantId provided
    const tenantId = (req as any).user?.tenantId;
    if (tenantId) {
      await trackX402Usage(
        tenantId,
        proof.feature,
        result.amount!,
        proof.txHash
      );
    }

    res.json({
      verified: true,
      amount: result.amount,
      message: `Payment verified for ${proof.feature}`,
      txHash: proof.txHash
    });

  } catch (error: any) {
    logger.error(`X402 verification error: ${error.message}`);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ——————————————————————————————————————
// GET USER'S X402 USAGE STATISTICS
// ——————————————————————————————————————
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { startDate, endDate } = req.query;

    const stats = await getX402UsageStats(
      tenantId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    res.json({
      tenantId,
      period: {
        start: startDate || 'beginning',
        end: endDate || 'now'
      },
      ...stats
    });

  } catch (error: any) {
    logger.error(`X402 usage stats error: ${error.message}`);
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

// ——————————————————————————————————————
// CHECK IF USER CAN USE X402 FOR FEATURE
// ——————————————————————————————————————
router.get('/check-access/:feature', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { feature } = req.params;

    // Check if they have subscription access
    const access = await checkAnalyticsAccess(tenantId, feature as any);

    if (access.allowed) {
      return res.json({
        accessType: 'subscription',
        tier: access.tier,
        message: 'Feature included in your subscription',
        x402Required: false
      });
    }

    // They don't have subscription access, show x402 option
    const paymentInfo = getX402PaymentInfo(feature as any);

    res.json({
      accessType: 'x402',
      x402Required: true,
      message: 'Pay per use with X402',
      payment: paymentInfo,
      upgradeOption: {
        message: access.upgradeRequired,
        url: 'https://nani.dev/upgrade'
      }
    });

  } catch (error: any) {
    logger.error(`X402 access check error: ${error.message}`);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

export default router;
