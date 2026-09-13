/**
 * Minimal 5-field cron parser (minute hour day-of-month month day-of-week)
 * used by the session cron scheduler. Supports wildcard, step values,
 * ranges and lists, and plain numbers. Weekday 0 and 7 both mean Sunday.
 */

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday; 7 normalized to 0)
];

function parseField(field: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) return null;

    let body = trimmed;
    let step = 1;
    const slashIndex = body.indexOf('/');
    if (slashIndex >= 0) {
      const stepPart = body.slice(slashIndex + 1);
      step = Number.parseInt(stepPart, 10);
      if (!Number.isFinite(step) || step < 1) return null;
      body = body.slice(0, slashIndex);
    }

    let start = min;
    let end = max;
    if (body !== '*') {
      const rangeMatch = /^(\d+)-(\d+)$/.exec(body);
      if (rangeMatch) {
        start = Number.parseInt(rangeMatch[1], 10);
        end = Number.parseInt(rangeMatch[2], 10);
      } else if (/^\d+$/.test(body)) {
        start = Number.parseInt(body, 10);
        end = slashIndex >= 0 ? max : start;
      } else {
        return null;
      }
      if (start < min || end > max || start > end) return null;
    }
    if (slashIndex >= 0 && body === '*') {
      start = min;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return values;
}

/** Parses a cron expression into per-field allowed-value sets, or null when invalid. */
export function parseCronExpression(expr: string): Set<number>[] | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i += 1) {
    const [min, max] = FIELD_RANGES[i];
    const values = parseField(fields[i], min, max);
    if (!values || values.size === 0) return null;
    if (i === 4 && values.has(7)) {
      // 7 is an accepted alias for Sunday.
      values.delete(7);
      values.add(0);
    }
    sets.push(values);
  }
  return sets;
}

/** Returns the next fire time strictly after `from`, or null after ~2 years of stepping. */
export function nextCronFire(expr: string, from: Date = new Date()): Date | null {
  const sets = parseCronExpression(expr);
  if (!sets) return null;
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = sets;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = new Date(from.getTime() + 2 * 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    if (!months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = daysOfMonth.has(cursor.getDate());
    const dowOk = daysOfWeek.has(cursor.getDay());
    // Standard cron semantics: when both DOM and DOW are restricted, either may match.
    const bothRestricted = daysOfMonth.size !== 31 || daysOfWeek.size !== 7;
    const dayOk = bothRestricted ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (minutes.has(cursor.getMinutes())) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
