import express, { Request, Response } from 'express';

import { buildUsageSummary } from './usage.service.js';
import { asyncHandler } from '@/shared/utils.js';

const router = express.Router();

router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const raw = Array.isArray(req.query.days) ? req.query.days[0] : req.query.days;
    const parsed = Number.parseInt(String(raw ?? '30'), 10);
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
    res.json({ data: await buildUsageSummary(days) });
  }),
);

export default router;
