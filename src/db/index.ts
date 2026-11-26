import dotenv from 'dotenv';
dotenv.config({ override: true });
import os from 'os';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _preferLocalhostPg: boolean | undefined;
}

function isHostAddressLocal(hostname: string): boolean {
  const clean = (hostname || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean === '127.0.0.1' || clean === 'localhost' || clean === '::1') return true;
  try {
    const nets = os.networkInterfaces();
    for (const ifaceList of Object.values(nets)) {
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (iface.address && iface.address.toLowerCase() === clean) {
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

function rewriteDbUrlToLocalhost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hostname = '127.0.0.1';
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return rawUrl.replace(/@[^:/?#]+/, '@127.0.0.1');
  }
}

function isPlaceholderDbUrl(rawUrl: string): boolean {
  const lower = (rawUrl || '').toLowerCase();
  return (
    !rawUrl ||
    lower.includes('supabase.co') ||
    lower.includes('postgresql://user:password@') ||
    lower.includes('[password]') ||
    lower.includes('[your-password]') ||
    lower.includes('your-password') ||
    /\/database(\?|$)/i.test(rawUrl)
  );
}

export const resetPool = () => {
  if (global._postgresPool) {
    try {
      global._postgresPool.end().catch(() => {});
    } catch (e) {}
    global._postgresPool = undefined;
  }
};

export const createPool = (forceLocalhost = false): Pool | null => {
  if (forceLocalhost) {
    global._preferLocalhostPg = true;
  }
  if (global._postgresPool) {
    return global._postgresPool;
  }

  const shouldUseLocalhost = Boolean(forceLocalhost || global._preferLocalhostPg);

  let dbUrl = '';
  if (process.env.DATABASE_URL && !isPlaceholderDbUrl(process.env.DATABASE_URL)) {
    dbUrl = process.env.DATABASE_URL;
    try {
      const parsed = new URL(dbUrl);
      if (shouldUseLocalhost || isHostAddressLocal(parsed.hostname)) {
        dbUrl = rewriteDbUrlToLocalhost(dbUrl);
      }
    } catch (e) {}
  } else if (process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    const rawHost = process.env.DB_HOST || '127.0.0.1';
    const targetHost = shouldUseLocalhost || isHostAddressLocal(rawHost) ? '127.0.0.1' : rawHost;
    dbUrl = `postgresql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD)}@${targetHost}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`;
  } else if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    const targetHost = shouldUseLocalhost || isHostAddressLocal(process.env.SQL_HOST) ? '127.0.0.1' : process.env.SQL_HOST;
    dbUrl = `postgresql://${encodeURIComponent(process.env.SQL_USER)}:${encodeURIComponent(process.env.SQL_PASSWORD || '')}@${targetHost}:${process.env.SQL_PORT || 5432}/${process.env.SQL_DB_NAME}`;
  } else {
    return null;
  }

  let isLocalTarget = false;
  try {
    const parsed = new URL(dbUrl);
    isLocalTarget = isHostAddressLocal(parsed.hostname);
  } catch (e) {}

  const useSsl = !isLocalTarget && process.env.DB_SSL === 'true';

  if (!useSsl) {
    try {
      const parsed = new URL(dbUrl);
      if (parsed.searchParams.has('sslmode')) {
        parsed.searchParams.delete('sslmode');
        dbUrl = parsed.toString();
      }
    } catch (e) {}
  }

  const newPool = new Pool({
    connectionString: dbUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 3000,
    statement_timeout: 15000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
  });

  newPool.on('error', (err) => {
    console.warn('PostgreSQL pool client connection warning:', err?.message || err);
    // Reset pool reference so next query gets a fresh connection
    resetPool();
  });

  global._postgresPool = newPool;
  return global._postgresPool;
};

const pool = createPool();
export const db = pool ? drizzle(pool, { schema }) : (undefined as any);
