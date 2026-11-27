import { createPool, resetPool } from './index.ts';
import { fileDb } from './fileDb.ts';

let pgReachable: boolean | null = null;
let lastPgFailureAt = 0;
let lastFailureCooldownMs = 60_000;
let activeProbePromise: Promise<boolean> | null = null;
const PG_RETRY_COOLDOWN_MS = 60_000;
const PG_AUTH_RETRY_COOLDOWN_MS = 30 * 60_000;

function isAuthOrAclError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  return (
    code === '28000' ||
    code === '28P01' ||
    msg.includes('pg_hba.conf') ||
    msg.includes('rejects connection') ||
    msg.includes('password authentication failed')
  );
}

export function isConnectionLevelError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    code === '28000' ||
    code === '28P01' ||
    msg.includes('pg_hba.conf') ||
    msg.includes('rejects connection') ||
    msg.includes('timeout') ||
    msg.includes('connection terminated') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('ehostunreach') ||
    msg.includes('postgresql unavailable') ||
    msg.includes('connect')
  );
}

export const hasPgEnvConfigured = (): boolean => {
  const rawUrl = (process.env.DATABASE_URL || '').trim();
  const lower = rawUrl.toLowerCase();
  const isProd = process.env.NODE_ENV === 'production' || process.env.HOSTINGER === 'true';
  // In development preview (AI Studio), ignore remote VPS database URLs unless running locally on loopback
  if (!isProd && rawUrl && !lower.includes('127.0.0.1') && !lower.includes('localhost')) {
    return false;
  }
  const hasRealUrl = Boolean(
    rawUrl &&
    !lower.includes('supabase.co') &&
    !lower.includes('postgresql://user:password@') &&
    !lower.includes('[password]') &&
    !lower.includes('[your-password]') &&
    !lower.includes('your-password') &&
    !/\/database(\?|$)/i.test(rawUrl)
  );
  if (hasRealUrl) return true;
  if (process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) return true;
  if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) return true;
  return false;
};

export const isPgConfigured = (): boolean => {
  return pgReachable === true;
};

export async function probePgConnection(): Promise<boolean> {
  if (pgReachable === false && Date.now() - lastPgFailureAt < lastFailureCooldownMs) {
    return false;
  }
  if (activeProbePromise) return activeProbePromise;

  activeProbePromise = (async () => {
    try {
      const currentPool = createPool(false);
      if (!currentPool) {
        pgReachable = false;
        return false;
      }
      await Promise.race([
        currentPool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('PG probe timeout')), 2500)),
      ]);
      pgReachable = true;
      return true;
    } catch (err: any) {
      resetPool();
      // If configured with a public IP while running on the same server, retry locally via 127.0.0.1 (DB_SSL=false)
      try {
        const localPool = createPool(true);
        if (localPool) {
          await Promise.race([
            localPool.query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('PG local probe timeout')), 1500)),
          ]);
          pgReachable = true;
          return true;
        }
      } catch (_localErr) {
        resetPool();
      }
      pgReachable = false;
      lastPgFailureAt = Date.now();
      lastFailureCooldownMs = isAuthOrAclError(err) ? PG_AUTH_RETRY_COOLDOWN_MS : PG_RETRY_COOLDOWN_MS;
      return false;
    } finally {
      activeProbePromise = null;
    }
  })();

  return activeProbePromise;
}

class AsyncSemaphore {
  private tasks: (() => void)[] = [];
  private count = 0;
  private max: number;
  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    await new Promise<void>((resolve) => this.tasks.push(resolve));
    this.count++;
  }

  release(): void {
    this.count--;
    if (this.tasks.length > 0) {
      const next = this.tasks.shift();
      if (next) next();
    }
  }
}

const pgSemaphore = new AsyncSemaphore(8);

export async function executePgStrict(sql: string, params: any[] = []): Promise<any[]> {
  if (!isPgConfigured()) {
    throw new Error('PostgreSQL unavailable - using local fileDb');
  }
  await pgSemaphore.acquire();
  try {
    const currentPool = createPool();
    if (!currentPool) {
      throw new Error('PostgreSQL unavailable - using local fileDb');
    }
    const res = await currentPool.query(sql, params);
    pgReachable = true;
    return res.rows || [];
  } catch (e: any) {
    if (isConnectionLevelError(e)) {
      pgReachable = false;
      lastPgFailureAt = Date.now();
      lastFailureCooldownMs = isAuthOrAclError(e) ? PG_AUTH_RETRY_COOLDOWN_MS : PG_RETRY_COOLDOWN_MS;
      resetPool();
    }
    throw e;
  } finally {
    pgSemaphore.release();
  }
}

export async function executePg(sql: string, params: any[] = []): Promise<any[]> {
  if (!isPgConfigured()) {
    return [];
  }
  await pgSemaphore.acquire();
  try {
    const currentPool = createPool();
    if (!currentPool) {
      return [];
    }
    const res = await currentPool.query(sql, params);
    pgReachable = true;
    return res.rows || [];
  } catch (e: any) {
    if (isConnectionLevelError(e)) {
      pgReachable = false;
      lastPgFailureAt = Date.now();
      lastFailureCooldownMs = isAuthOrAclError(e) ? PG_AUTH_RETRY_COOLDOWN_MS : PG_RETRY_COOLDOWN_MS;
      resetPool();
    }
    // Silently return empty array on connection or query error to allow local fileDb fallback
    return [];
  } finally {
    pgSemaphore.release();
  }
}

export const dbStore = fileDb;
