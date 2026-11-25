import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * Centralized API & Server Endpoint Resolver for Web and Android APK
 */

export const HOSTINGER_DEFAULT_SERVER = 'http://72.62.158.128:3000';

export const CANDIDATE_SERVERS: string[] = [
  'http://72.62.158.128:3000',
];

const DEFAULT_REMOTE_SERVER = 'http://72.62.158.128:3000';
const SERVER_URL_STORAGE_KEY = 'alkarrar_backend_server_url';

function isAiStudioTempOrDeadUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('5x4c6bq6p4ul7njqnkzon5') ||
    lower.includes('asc5xuvnur4hlmpl5rfxpz') ||
    lower.includes('alkarar.baghdad.dev') ||
    lower.includes('ais-dev-') ||
    lower.includes('ais-pre-')
  );
}

function isLocalhostUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.startsWith('capacitor://') ||
    lower.startsWith('file://')
  );
}

export function getCustomServerUrl(): string {
  try {
    const custom = localStorage.getItem(SERVER_URL_STORAGE_KEY);
    if (custom && (custom.startsWith('http://') || custom.startsWith('https://'))) {
      const clean = custom.trim().replace(/\/+$/, '');
      if (isAiStudioTempOrDeadUrl(clean) || clean !== HOSTINGER_DEFAULT_SERVER) {
        // Auto-clear stale/manual overrides so the exact Hostinger link is always used automatically
        localStorage.removeItem(SERVER_URL_STORAGE_KEY);
        return '';
      }
      return clean;
    }
  } catch (e) {}
  return '';
}

export function getHostingerServerUrl(): string {
  // Always return the exact configured Hostinger server automatically
  getCustomServerUrl();
  return HOSTINGER_DEFAULT_SERVER;
}

export function setCustomServerUrl(_url: string) {
  try {
    localStorage.setItem(SERVER_URL_STORAGE_KEY, HOSTINGER_DEFAULT_SERVER);
  } catch (e) {}
}

export function setHostingerServerUrl(_url: string) {
  setCustomServerUrl(HOSTINGER_DEFAULT_SERVER);
}

let activeWorkingServer = '';

export function setActiveWorkingServer(url: string) {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    const clean = url.trim().replace(/\/+$/, '');
    if (isLocalhostUrl(clean) || clean.includes('ais-dev-') || clean.includes('5x4c6bq6p4ul7njqnkzon5') || clean.includes('asc5xuvnur4hlmpl5rfxpz') || clean.includes('alkarar.baghdad.dev')) {
      return;
    }
    activeWorkingServer = clean;
  }
}

export function isNativeOrApkEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
      return true;
    }
  } catch (e) {}
  return (
    window.location.protocol === 'file:' ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:' ||
    window.location.protocol === 'content:' ||
    !!(window as any).Capacitor?.isNativePlatform?.() ||
    (window as any).Capacitor?.getPlatform?.() === 'android' ||
    (window.location.hostname === 'localhost' && window.location.port !== '3000' && window.location.port !== '5173') ||
    (window.location.origin && window.location.origin.includes('localhost') && !window.location.port)
  );
}

export function getApiBaseUrl(): string {
  const isNative = isNativeOrApkEnvironment();
  let base = '';
  if (!isNative && typeof window !== 'undefined' && window.location.origin &&
      (window.location.origin.startsWith('http://') || window.location.origin.startsWith('https://')) &&
      !isLocalhostUrl(window.location.origin)) {
    base = window.location.origin;
  } else {
    const custom = getCustomServerUrl();
    if (custom && !isLocalhostUrl(custom)) {
      base = custom;
    } else if (activeWorkingServer && !isLocalhostUrl(activeWorkingServer) && !activeWorkingServer.includes('ais-dev-')) {
      base = activeWorkingServer;
    } else {
      base = DEFAULT_REMOTE_SERVER;
    }
  }
  return base.replace(/\/+$/, '');
}

export function getPublicShareBaseUrl(): string {
  const custom = getCustomServerUrl();
  if (custom && !isLocalhostUrl(custom)) {
    return custom.replace(/\/+$/, '');
  }
  if (activeWorkingServer && !isLocalhostUrl(activeWorkingServer)) {
    return activeWorkingServer.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location.origin &&
      (window.location.origin.startsWith('http://') || window.location.origin.startsWith('https://')) &&
      !isLocalhostUrl(window.location.origin)) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return DEFAULT_REMOTE_SERVER;
}

export function getFullApiUrl(endpoint: string, baseOverride?: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const base = baseOverride !== undefined ? baseOverride : getApiBaseUrl();
  if (!base) return cleanEndpoint;
  return `${base}${cleanEndpoint}`;
}

import { Network } from '@capacitor/network';

export async function isNetworkConnected(): Promise<boolean> {
  try {
    const status = await Network.getStatus();
    if (typeof status?.connected === 'boolean') {
      return status.connected;
    }
  } catch (e) {}
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

async function executeNativeCapacitorHttp(
  url: string,
  options: RequestInit | undefined,
  timeoutMs: number
): Promise<Response | null> {
  if (!CapacitorHttp || typeof CapacitorHttp.request !== 'function') {
    return null;
  }

  const method = ((options?.method || 'GET') as string).toUpperCase();
  const reqHeaders: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
  };

  if (options?.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => {
        reqHeaders[k] = v;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [k, v] of options.headers) {
        reqHeaders[k] = v;
      }
    } else {
      Object.assign(reqHeaders, options.headers);
    }
  }

  let parsedData: any = undefined;
  if (method !== 'GET' && method !== 'HEAD' && options?.body !== undefined && options?.body !== null) {
    if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (typeof options.body === 'string') {
      try {
        parsedData = JSON.parse(options.body);
      } catch {
        parsedData = options.body;
      }
    } else {
      parsedData = options.body;
    }
  } else {
    // Avoid sending Content-Type on GET/HEAD requests
    delete reqHeaders['Content-Type'];
    delete reqHeaders['content-type'];
  }

  const nativeRes = await Promise.race([
    CapacitorHttp.request({
      url,
      method,
      headers: reqHeaders,
      data: parsedData,
      connectTimeout: Math.min(timeoutMs, 12000),
      readTimeout: timeoutMs,
      responseType: 'text',
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Native HTTP timeout after ${timeoutMs}ms`)), timeoutMs + 500)
    ),
  ]);

  const status = Number(nativeRes?.status) || 0;
  if (status < 200 || status > 599) {
    throw new Error(`Invalid native HTTP status: ${status}`);
  }

  const headerMap = new Headers();
  if (nativeRes?.headers && typeof nativeRes.headers === 'object') {
    for (const [k, v] of Object.entries(nativeRes.headers)) {
      if (k && k !== 'null' && v !== undefined && v !== null) {
        try {
          headerMap.set(k, String(v));
        } catch (e) {}
      }
    }
  }

  const rawBody =
    nativeRes?.data === undefined || nativeRes?.data === null
      ? ''
      : typeof nativeRes.data === 'string'
        ? nativeRes.data
        : JSON.stringify(nativeRes.data);

  const syntheticResponse = new Response(status === 204 ? null : rawBody, {
    status,
    headers: headerMap,
  });

  try {
    Object.defineProperty(syntheticResponse, 'url', {
      value: nativeRes?.url || url,
    });
  } catch (e) {}

  return syntheticResponse;
}

/**
 * Universal fetch that automatically tries candidate servers and local endpoints with fallback
 */
export async function fetchWithFallback(
  endpoint: string,
  options?: RequestInit,
  timeoutMs: number = 12000
): Promise<Response> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const isNative = isNativeOrApkEnvironment();

  const urlsToTry: string[] = [];

  if (isNative) {
    // In native APK / Capacitor environment, NEVER try localhost or relative URLs because there is no API server on the device!
    const custom = getCustomServerUrl();
    if (custom && !isLocalhostUrl(custom)) {
      const customUrl = `${custom}${cleanEndpoint}`;
      if (!urlsToTry.includes(customUrl)) urlsToTry.push(customUrl);
    }
    if (activeWorkingServer && !isLocalhostUrl(activeWorkingServer) && !activeWorkingServer.includes('ais-dev-')) {
      const activeUrl = `${activeWorkingServer}${cleanEndpoint}`;
      if (!urlsToTry.includes(activeUrl)) urlsToTry.push(activeUrl);
    }
    for (const server of CANDIDATE_SERVERS) {
      const candidateUrl = `${server}${cleanEndpoint}`;
      if (!urlsToTry.includes(candidateUrl)) {
        urlsToTry.push(candidateUrl);
      }
    }
  } else {
    // 1. If in browser / web mode, try relative and origin URLs first
    if (typeof window !== 'undefined' && window.location.origin && (window.location.origin.startsWith('http://') || window.location.origin.startsWith('https://'))) {
      if (!urlsToTry.includes(cleanEndpoint)) {
        urlsToTry.push(cleanEndpoint);
      }
      const originUrl = `${window.location.origin}${cleanEndpoint}`;
      if (!urlsToTry.includes(originUrl)) {
        urlsToTry.push(originUrl);
      }
    } else {
      if (!urlsToTry.includes(cleanEndpoint)) {
        urlsToTry.push(cleanEndpoint);
      }
    }

    // 2. Add configured URL and candidate servers (skip raw http:// when browser is on https:// to avoid Mixed Content)
    const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const addWebCandidate = (candidate: string) => {
      if (!candidate) return;
      if (isHttpsPage && candidate.startsWith('http://')) return;
      if (!urlsToTry.includes(candidate)) urlsToTry.push(candidate);
    };
    if (activeWorkingServer) {
      addWebCandidate(`${activeWorkingServer}${cleanEndpoint}`);
    }
    const primaryUrl = getFullApiUrl(cleanEndpoint);
    addWebCandidate(primaryUrl);
    for (const server of CANDIDATE_SERVERS) {
      addWebCandidate(`${server}${cleanEndpoint}`);
    }
  }

  let lastError: any = null;
  const method = ((options?.method || 'GET') as string).toUpperCase();

  for (const url of urlsToTry) {
    const perUrlTimeout = isNative ? Math.max(timeoutMs || 12000, 12000) : (timeoutMs || 8000);

    // On Android/iOS APK, try direct native CapacitorHttp.request first (immune to CORS & Mixed Content & proxy bugs)
    if (isNative) {
      try {
        const nativeRes = await executeNativeCapacitorHttp(url, options, perUrlTimeout);
        if (nativeRes) {
          if (nativeRes.ok) {
            const contentType = (nativeRes.headers.get('content-type') || '').toLowerCase();
            if (!contentType.includes('text/html') && !(nativeRes.url && nativeRes.url.includes('accounts.google.com'))) {
              try {
                setActiveWorkingServer(new URL(url).origin);
              } catch (e) {}
              return nativeRes;
            }
          } else if (
            nativeRes.status === 400 ||
            nativeRes.status === 401 ||
            nativeRes.status === 403 ||
            nativeRes.status === 404 ||
            nativeRes.status === 409 ||
            nativeRes.status === 422
          ) {
            const contentType = (nativeRes.headers.get('content-type') || '').toLowerCase();
            if (!contentType.includes('text/html')) {
              return nativeRes;
            }
          }
        }
      } catch (nativeErr: any) {
        lastError = nativeErr;
      }
    }

    // Fallback (and primary in Web browser): standard fetch
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), perUrlTimeout);
      const fetchHeaders: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
      };
      if (method !== 'GET' && method !== 'HEAD') {
        fetchHeaders['Content-Type'] = 'application/json';
      }
      if (options?.headers) {
        if (options.headers instanceof Headers) {
          options.headers.forEach((v, k) => {
            fetchHeaders[k] = v;
          });
        } else if (Array.isArray(options.headers)) {
          for (const [k, v] of options.headers) {
            fetchHeaders[k] = v;
          }
        } else {
          Object.assign(fetchHeaders, options.headers);
        }
      }

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: fetchHeaders,
      });
      clearTimeout(timer);

      if (res.ok) {
        // Verify that it is not an HTML fallback page or Google Auth redirect for an API route
        if (res.url && res.url.includes('accounts.google.com')) {
          continue;
        }
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) {
          continue;
        }

        if (isNative && url.startsWith('http')) {
          try {
            const urlObj = new URL(url);
            setActiveWorkingServer(urlObj.origin);
          } catch (e) {}
        }
        return res;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404 || res.status === 409 || res.status === 422) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html') && !(res.url && res.url.includes('accounts.google.com'))) {
          return res;
        }
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Network fetch failed for ${endpoint}`);
}

export async function universalApiFetch(
  endpoint: string,
  options?: RequestInit
): Promise<Response> {
  return fetchWithFallback(endpoint, options, 12000);
}

export async function checkServerHealth(url?: string): Promise<{ ok: boolean; status?: string; database?: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  const isNative = isNativeOrApkEnvironment();
  const baseUrl = url ? url.trim().replace(/\/+$/, '') : getApiBaseUrl();

  // In HTTPS web browser mode, checking an http:// VPS URL directly triggers Mixed Content blocking;
  // proxy the check through the current backend's /api/upstream/test endpoint instead.
  const isHttpsPageTestingHttpTarget =
    !isNative &&
    typeof window !== 'undefined' &&
    window.location?.protocol === 'https:' &&
    baseUrl.startsWith('http://');

  const targetUrl = isHttpsPageTestingHttpTarget
    ? `/api/upstream/test?url=${encodeURIComponent(baseUrl)}`
    : (baseUrl ? `${baseUrl}/api/health` : '/api/health');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10500);
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html') || (res.url && res.url.includes('accounts.google.com'))) {
        return {
          ok: false,
          latencyMs,
          error: 'استجابة السيرفر غير صالحة (تم إرجاع صفحة HTML بدلاً من JSON)',
        };
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return {
          ok: false,
          latencyMs,
          error: 'تعذر قراءة بيانات فحص السيرفر',
        };
      }
      if (isHttpsPageTestingHttpTarget && data.ok === false) {
        return {
          ok: false,
          latencyMs: data.latencyMs || latencyMs,
          error: data.error || 'تعذر الاتصال بالسيرفر',
        };
      }
      if (!isNative && !url && data.database === 'filedb' && data.upstreamConnected === false && data.pgConfigured === false) {
        return {
          ok: false,
          status: 'local-only',
          database: 'filedb',
          latencyMs,
          error: 'الموقع يعمل حالياً بالذاكرة المحلية فقط لأن السيرفر الرئيسي غير متصل',
        };
      }
      return {
        ok: true,
        status: data.status || 'ok',
        database: data.database || 'postgresql',
        latencyMs: data.latencyMs || latencyMs,
      };
    } else {
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      latencyMs,
      error: err.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم (Timeout)' : (err.message || 'تعذر الاتصال بالخادم'),
    };
  }
}

