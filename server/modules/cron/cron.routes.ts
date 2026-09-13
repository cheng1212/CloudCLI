import express, { Request, Response } from 'express';

import { cronScheduler, cronService } from './cron.service.js';
import { AppError, asyncHandler } from '@/shared/utils.js';

const router = express.Router();

function parseCronId(raw: string | string[]): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id) || id < 1) {
    throw new AppError('Invalid cron id', { code: 'INVALID_CRON_ID', statusCode: 400 });
  }
  return id;
}

router.get('/', (_req: Request, res: Response) => {
  res.json({ data: cronService.listCrons() });
});

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = cronService.createCron({
      sessionId: String(body.sessionId ?? ''),
      prompt: String(body.prompt ?? ''),
      schedule: String(body.schedule ?? ''),
      name: typeof body.name === 'string' ? body.name : undefined,
    });
    res.status(201).json({ data: result });
  }),
);

router.post(
  '/:id/run',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await cronService.runCronNow(parseCronId(req.params.id));
    res.json({ data: result });
  }),
);

router.get(
  '/:id/runs',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: cronService.getCronRuns(parseCronId(req.params.id)) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = cronService.setCronActive(parseCronId(req.params.id), Boolean(body.active));
    res.json({ data: result });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: { deleted: cronService.deleteCron(parseCronId(req.params.id)) } });
  }),
);

export function startCronScheduler(): void {
  cronScheduler.start();
}

export default router;
