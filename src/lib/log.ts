import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

let logPathCache: string | null = null;
let warnedAboutWriteOnce = false;

function logDir(): string {
  // Co-located with the database so packaged builds ship a single
  // `data/` directory. Override via UNFCK_LOG_DIR for tests / setups
  // that want logs elsewhere.
  return resolve(process.env.UNFCK_LOG_DIR ?? './data/logs');
}

function logFilePath(): string {
  if (logPathCache) return logPathCache;
  const dir = logDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort: if we can't create the dir we still want stdout output
  }
  const today = new Date().toISOString().slice(0, 10);
  logPathCache = resolve(dir, `app-${today}.log`);
  return logPathCache;
}

/**
 * Append-only structured logger. JSON Lines format so a non-technical user
 * can copy-paste a slice and we (or any tool) can parse it back. Errors
 * during write are swallowed: a logger that crashes the process is worse
 * than missing log lines.
 *
 * Always also emits to console at the matching level so docker/dev users
 * still see things in real time.
 */
export function log(
  level: LogLevel,
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry: LogEvent = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  try {
    appendFileSync(logFilePath(), line, { encoding: 'utf-8' });
  } catch (err) {
    if (!warnedAboutWriteOnce) {
      warnedAboutWriteOnce = true;
      // eslint-disable-next-line no-console
      console.warn('[log] file write failed; further write errors silenced:', err);
    }
  }
  const consoleMethod =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  // eslint-disable-next-line no-console
  consoleMethod(`[${scope}] ${message}`, data ?? '');
}

export const logger = {
  debug: (scope: string, message: string, data?: Record<string, unknown>) =>
    log('debug', scope, message, data),
  info: (scope: string, message: string, data?: Record<string, unknown>) =>
    log('info', scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) =>
    log('warn', scope, message, data),
  error: (scope: string, message: string, data?: Record<string, unknown>) =>
    log('error', scope, message, data),
};

/**
 * Read the most recent log lines from disk for the diagnostics endpoint.
 * Returns up to `limit` lines from the current day's file. Older days are
 * intentionally not stitched together — the endpoint is for "what just
 * went wrong", not history. Failures return an empty array.
 */
export function readRecentLog(limit = 100): LogEvent[] {
  void mkdirSync; // keep import alive when only this function is called
  let raw = '';
  try {
    // Late require avoids hoisting unused fs sync work into module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = logFilePath();
    if (!fs.existsSync(path)) return [];
    raw = fs.readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.trim().split('\n').slice(-limit);
  const out: LogEvent[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as LogEvent);
    } catch {
      // skip malformed lines (e.g. partial flush during crash)
    }
  }
  return out;
}
