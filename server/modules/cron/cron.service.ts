import { getConnection } from '@/modules/database/connection.js';
import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { nextCronFire, parseCronExpression } from '@/shared/cron-parse.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type CronRow = {
  id: number;
  session_id: string;
  name: string;
  prompt: string;
  schedule: string;
  active: number;
  run_count: number;
  last_run_at: string | null;
  last_status: string | null;
  next_fire_at: string | null;
  created_at: string;
};

function rowToCron(row: CronRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    prompt: row.prompt,
    schedule: row.schedule,
    active: Boolean(row.active),
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    nextFireAt: row.next_fire_at,
    createdAt: row.created_at,
  };
}

function computeNextFire(schedule: string, from: Date): string | null {
  const next = nextCronFire(schedule, from);
  return next ? next.toISOString() : null;
}

function recordCronRun(cronId: number, status: string, detail: string | null): void {
  getConnection().prepare(
    `INSERT INTO cron_runs (cron_id, started_at, status, detail) VALUES (?, ?, ?, ?)`,
  ).run(cronId, new Date().toISOString(), status, detail);
}

async function triggerCronRun(cronId: number, row: CronRow, prompt: string): Promise<string> {
  const sessionId = row.session_id;
  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    return 'session_not_found';
  }
  if (chatRunRegistry.isProcessing(sessionId)) {
    return 'busy';
  }

  const provider = session.provider as LLMProvider;
  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id ?? null,
    // Cron runs have no live websocket; a no-op connection keeps the
    // registry's writer happy while events are buffered for replay.
    connection: { readyState: 1, send: () => {} },
    userId: null,
  });
  if (!run) {
    return 'busy';
  }

  try {
    const runtimeOptions = {
      sessionId,
      cwd: session.project_path ?? undefined,
      projectPath: session.project_path ?? undefined,
    };
    await providerRuntimeService.run(provider, prompt, runtimeOptions, run.writer);
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 0 });
    return 'ok';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Cron] Run for cron #${cronId} failed:`, message);
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });
    return 'error';
  }
}

async function fireDueCrons(): Promise<void> {
  const db = getConnection();
  const now = new Date();
  const dueRows = db.prepare(
    `SELECT * FROM crons WHERE active = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?`,
  ).all(now.toISOString()) as CronRow[];

  for (const row of dueRows) {
    let status = 'ok';
    try {
      status = await triggerCronRun(row.id, row, row.prompt);
    } catch (error) {
      status = 'error';
      console.error('[Cron] Unexpected fire failure:', error);
    }
    if (status === 'busy') {
      // Session occupied: push the next attempt a scheduler tick out instead
      // of consuming the occurrence.
      const retryAt = new Date(now.getTime() + 60_000).toISOString();
      db.prepare(`UPDATE crons SET next_fire_at = ? WHERE id = ?`).run(retryAt, row.id);
      continue;
    }

    const nextFireAt = computeNextFire(row.schedule, now);
    db.prepare(
      `UPDATE crons SET run_count = run_count + 1, last_run_at = ?, last_status = ?, next_fire_at = ? WHERE id = ?`,
    ).run(new Date().toISOString(), status, nextFireAt, row.id);
    recordCronRun(row.id, status, status === 'ok' ? null : `run ended with ${status}`);
    if (!nextFireAt) {
      // One-shot expression exhausted: disable so it stops being scanned.
      db.prepare(`UPDATE crons SET active = 0 WHERE id = ?`).run(row.id);
    }
  }
}

export const cronScheduler = {
  start(intervalMs = 30_000): void {
    // Recompute any missing next_fire_at (e.g. after a server-side clock jump),
    // then scan on the tick.
    const db = getConnection();
    const rows = db.prepare(`SELECT id, schedule, next_fire_at FROM crons WHERE active = 1`).all() as Array<{
      id: number;
      schedule: string;
      next_fire_at: string | null;
    }>;
    for (const row of rows) {
      if (!row.next_fire_at) {
        db.prepare(`UPDATE crons SET next_fire_at = ? WHERE id = ?`)
          .run(computeNextFire(row.schedule, new Date()), row.id);
      }
    }

    const timer = setInterval(() => {
      void fireDueCrons();
    }, intervalMs);
    timer.unref?.();
  },
};

export const cronService = {
  listCrons() {
    const rows = getConnection().prepare(`SELECT * FROM crons ORDER BY id DESC`).all() as CronRow[];
    return rows.map(rowToCron);
  },

  getCronRuns(cronId: number) {
    const rows = getConnection().prepare(
      `SELECT id, started_at, status, detail FROM cron_runs WHERE cron_id = ? ORDER BY id DESC LIMIT 30`,
    ).all(cronId) as Array<{ id: number; started_at: string; status: string; detail: string | null }>;
    return rows.map((row) => ({ id: row.id, startedAt: row.started_at, status: row.status, detail: row.detail }));
  },

  createCron(input: { sessionId: string; prompt: string; schedule: string; name?: string }) {
    const session = sessionsDb.getSessionById(input.sessionId);
    if (!session) {
      throw new AppError(`Session "${input.sessionId}" was not found.`, {
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (!parseCronExpression(input.schedule)) {
      throw new AppError(`Invalid cron expression "${input.schedule}" (5 fields: minute hour day month weekday).`, {
        code: 'INVALID_CRON_EXPRESSION',
        statusCode: 400,
      });
    }
    if (!input.prompt.trim()) {
      throw new AppError('prompt is required.', { code: 'CRON_PROMPT_REQUIRED', statusCode: 400 });
    }

    const db = getConnection();
    const info = db.prepare(
      `INSERT INTO crons (session_id, name, prompt, schedule, active, next_fire_at) VALUES (?, ?, ?, ?, 1, ?)`,
    ).run(
      input.sessionId,
      input.name?.trim() || '',
      input.prompt.trim(),
      input.schedule.trim(),
      computeNextFire(input.schedule, new Date()),
    );
    return this.getCronById(info.lastInsertRowid as number);
  },

  getCronById(id: number) {
    const row = getConnection().prepare(`SELECT * FROM crons WHERE id = ?`).get(id) as CronRow | undefined;
    if (!row) {
      throw new AppError(`Cron "${id}" was not found.`, { code: 'CRON_NOT_FOUND', statusCode: 404 });
    }
    return rowToCron(row);
  },

  setCronActive(id: number, active: boolean) {
    const db = getConnection();
    const row = db.prepare(`SELECT * FROM crons WHERE id = ?`).get(id) as CronRow | undefined;
    if (!row) {
      throw new AppError(`Cron "${id}" was not found.`, { code: 'CRON_NOT_FOUND', statusCode: 404 });
    }
    const nextFireAt = active ? computeNextFire(row.schedule, new Date()) : null;
    db.prepare(`UPDATE crons SET active = ?, next_fire_at = ? WHERE id = ?`).run(active ? 1 : 0, nextFireAt, id);
    return this.getCronById(id);
  },

  async runCronNow(id: number) {
    const db = getConnection();
    const row = db.prepare(`SELECT * FROM crons WHERE id = ?`).get(id) as CronRow | undefined;
    if (!row) {
      throw new AppError(`Cron "${id}" was not found.`, { code: 'CRON_NOT_FOUND', statusCode: 404 });
    }
    const status = await triggerCronRun(row.id, row, row.prompt);
    recordCronRun(row.id, status, 'manual run');
    if (status !== 'busy') {
      const nextFireAt = computeNextFire(row.schedule, new Date());
      db.prepare(
        `UPDATE crons SET run_count = run_count + 1, last_run_at = ?, last_status = ?, next_fire_at = ? WHERE id = ?`,
      ).run(new Date().toISOString(), status, nextFireAt, id);
    }
    return { status };
  },

  deleteCron(id: number): boolean {
    const db = getConnection();
    db.prepare(`DELETE FROM cron_runs WHERE cron_id = ?`).run(id);
    const result = db.prepare(`DELETE FROM crons WHERE id = ?`).run(id);
    return result.changes > 0;
  },
};
