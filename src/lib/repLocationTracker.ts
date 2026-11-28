import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import { fetchWithFallback, getFullApiUrl, isNetworkConnected } from './apiConfig';
import { captureDeviceLocation, checkGeolocationPermission } from './geolocationHelper';
import { SalesRepresentative } from '../types';

export interface RepLiveLocation {
  repId: string;
  repName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  battery: number | null;
  address: string | null;
  updatedAt: string;
  secondsAgo: number;
  isOnline: boolean;
  phone?: string | null;
  avatarUrl?: string | null;
  role?: string | null;
}

const ONLINE_TTL_SECONDS = 120;
const MIN_UPLOAD_INTERVAL_MS = 15000;
const MIN_RAPID_MOVE_INTERVAL_MS = 5000;
const SIGNIFICANT_MOVE_METERS = 20;

export function escapeHtml(input: string | null | undefined): string {
  const str = String(input ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeRepName(name?: string | null): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function isExcludedAdminOrSelfRep(
  candidate: { repId?: string | null; repName?: string | null; role?: string | null },
  currentRep?: Pick<SalesRepresentative, 'id' | 'name' | 'role'> | null,
  allReps?: SalesRepresentative[]
): boolean {
  const cleanId = String(candidate?.repId ?? '').trim();
  const normName = normalizeRepName(candidate?.repName);

  if (candidate?.role === 'admin') return true;
  if (cleanId === 'rep-1') return true;
  if (normName && (normName === 'ضياء المحاسب' || normName.includes('ضياء المحاسب'))) {
    return true;
  }

  if (currentRep) {
    if (currentRep.id && cleanId && String(currentRep.id).trim() === cleanId) return true;
    const currNorm = normalizeRepName(currentRep.name);
    if (currNorm && normName && currNorm === normName) return true;
  }

  if (Array.isArray(allReps)) {
    for (const r of allReps) {
      if (!r || r.role !== 'admin') continue;
      if (r.id && cleanId && String(r.id).trim() === cleanId) return true;
      const rNorm = normalizeRepName(r.name);
      if (rNorm && normName && rNorm === normName) return true;
    }
  }

  return false;
}

function calcDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function normalizeRepLiveLocation(raw: any): RepLiveLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const repId = String(raw.repId || raw.rep_id || raw.id || '').trim();
  if (!repId) return null;

  const lat = Number(raw.latitude);
  const lng = Number(raw.longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }

  const updatedAt = String(raw.updatedAt || raw.updated_at || '');
  const parsedMs = Date.parse(updatedAt);
  const secondsAgo =
    typeof raw.secondsAgo === 'number' && Number.isFinite(raw.secondsAgo)
      ? Math.max(0, Math.round(raw.secondsAgo))
      : Number.isFinite(parsedMs)
      ? Math.max(0, Math.round((Date.now() - parsedMs) / 1000))
      : 999999;

  const explicitOnline = raw.is_online !== false && raw.isOnline !== false;
  const isOnline =
    typeof raw.isOnline === 'boolean'
      ? raw.isOnline
      : explicitOnline && secondsAgo <= ONLINE_TTL_SECONDS;

  const repName = String(raw.current_rep_name || raw.repName || raw.rep_name || 'مندوب').trim();

  return {
    repId,
    repName,
    latitude: lat,
    longitude: lng,
    accuracy: raw.accuracy != null && Number.isFinite(Number(raw.accuracy)) ? Number(raw.accuracy) : null,
    speed: raw.speed != null && Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : null,
    battery: raw.battery != null && Number.isFinite(Number(raw.battery)) ? Number(raw.battery) : null,
    address: raw.address || null,
    updatedAt,
    secondsAgo,
    isOnline,
    phone: raw.rep_phone || raw.phone || null,
    avatarUrl: raw.avatar_url || raw.avatarUrl || null,
    role: raw.rep_role || raw.role || null,
  };
}

export function formatLastSeen(secondsAgo: number, isAr: boolean): string {
  if (!Number.isFinite(secondsAgo) || secondsAgo > 900000) {
    return isAr ? 'غير معروف' : 'Unknown';
  }
  if (secondsAgo <= 25) {
    return isAr ? 'الآن' : 'Just now';
  }
  if (secondsAgo < 60) {
    return isAr ? `منذ ${secondsAgo} ث` : `${secondsAgo}s ago`;
  }
  const mins = Math.floor(secondsAgo / 60);
  if (mins < 60) {
    return isAr ? `منذ ${mins} د` : `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return isAr ? `منذ ${hours} س` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return isAr ? `منذ ${days} ي` : `${days}d ago`;
}

export async function fetchRepLiveLocations(
  onlineOnly: boolean = false,
  requesterRepId?: string,
  options?: {
    currentRep?: Pick<SalesRepresentative, 'id' | 'name' | 'role'> | null;
    reps?: SalesRepresentative[];
  }
): Promise<RepLiveLocation[]> {
  try {
    const connected = await isNetworkConnected();
    if (!connected) return [];

    const params = new URLSearchParams();
    if (onlineOnly) params.set('onlineOnly', 'true');
    if (requesterRepId) params.set('requesterRepId', requesterRepId);
    const queryStr = params.toString();
    const query = queryStr ? `?${queryStr}` : '';
    const headers: Record<string, string> = {};
    if (requesterRepId) {
      headers['x-rep-id'] = requesterRepId;
    }

    const res = await fetchWithFallback(
      `/api/reps/locations${query}`,
      { method: 'GET', cache: 'no-store', headers },
      9000
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    if (!Array.isArray(data)) return [];

    return data
      .map(normalizeRepLiveLocation)
      .filter((item): item is RepLiveLocation => item !== null)
      .filter((item) => !requesterRepId || item.repId !== requesterRepId)
      .filter((item) => !isExcludedAdminOrSelfRep(item, options?.currentRep, options?.reps))
      .filter((item) => !onlineOnly || item.isOnline)
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.secondsAgo - b.secondsAgo;
      });
  } catch {
    return [];
  }
}

async function readDeviceBatteryPercent(): Promise<number | null> {
  try {
    if (typeof navigator !== 'undefined' && typeof (navigator as any).getBattery === 'function') {
      const bat = await (navigator as any).getBattery();
      if (bat && typeof bat.level === 'number' && Number.isFinite(bat.level)) {
        return Math.max(0, Math.min(100, Math.round(bat.level * 100)));
      }
    }
  } catch {
    // Battery API unavailable on some browsers/WebViews
  }
  return null;
}

export async function sendRepLiveLocation(
  rep: Pick<SalesRepresentative, 'id' | 'name' | 'role'>,
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
  }
): Promise<boolean> {
  if (!rep?.id || isExcludedAdminOrSelfRep({ repId: rep.id, repName: rep.name, role: rep.role })) {
    return false;
  }
  const lat = Number(coords.latitude);
  const lng = Number(coords.longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return false;
  }

  try {
    const connected = await isNetworkConnected();
    if (!connected) return false;

    const battery = await readDeviceBatteryPercent();
    const res = await fetchWithFallback(
      '/api/reps/location',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repId: rep.id,
          repName: rep.name || 'مندوب',
          latitude: lat,
          longitude: lng,
          accuracy: coords.accuracy != null && Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
          speed: coords.speed != null && Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : null,
          battery,
        }),
      },
      8000
    );
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

export async function markRepOffline(repId: string, useBeacon = false): Promise<void> {
  if (!repId) return;
  try {
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const url = getFullApiUrl('/api/reps/location/offline');
      const blob = new Blob([JSON.stringify({ repId })], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
    const connected = await isNetworkConnected();
    if (!connected) return;
    await fetchWithFallback(
      '/api/reps/location/offline',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repId }),
        keepalive: true,
      },
      5000
    ).catch(() => {});
  } catch {
    // ignore offline beacon failures
  }
}

/**
 * Starts automatic live GPS location broadcasting for the logged-in representative
 * strictly while internet connectivity is active. Returns a cleanup function.
 */
export function startRepLiveLocationBroadcast(rep: SalesRepresentative): () => void {
  if (!rep?.id || isExcludedAdminOrSelfRep({ repId: rep.id, repName: rep.name, role: rep.role })) {
    return () => {};
  }

  let stopped = false;
  let lastUploadedAt = 0;
  let lastUploadedCoords: { lat: number; lng: number } | null = null;
  let latestCoords: { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null } | null = null;
  let isUploading = false;
  let webWatchId: number | null = null;
  let nativeWatchId: string | null = null;
  let networkListenerHandle: any = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const maybeUpload = async (
    coords: { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null },
    force = false
  ) => {
    if (stopped || isUploading) return;
    const connected = await isNetworkConnected();
    if (!connected || stopped) return;

    const now = Date.now();
    const elapsed = now - lastUploadedAt;
    const movedMeters = lastUploadedCoords
      ? calcDistanceMeters(lastUploadedCoords.lat, lastUploadedCoords.lng, coords.latitude, coords.longitude)
      : 9999;

    const shouldUpload =
      force ||
      lastUploadedAt === 0 ||
      elapsed >= MIN_UPLOAD_INTERVAL_MS ||
      (movedMeters >= SIGNIFICANT_MOVE_METERS && elapsed >= MIN_RAPID_MOVE_INTERVAL_MS);

    if (!shouldUpload) return;

    isUploading = true;
    try {
      const ok = await sendRepLiveLocation(rep, coords);
      if (ok && !stopped) {
        lastUploadedAt = Date.now();
        lastUploadedCoords = { lat: coords.latitude, lng: coords.longitude };
      }
    } finally {
      isUploading = false;
    }
  };

  const captureAndUploadNow = async (force = false) => {
    if (stopped) return;
    const connected = await isNetworkConnected();
    if (!connected || stopped) return;

    const perm = await checkGeolocationPermission().catch(() => 'prompt' as const);
    if (perm === 'denied') return;

    const res = await captureDeviceLocation();
    if (res.location && !stopped) {
      const coords = {
        latitude: res.location.latitude,
        longitude: res.location.longitude,
        accuracy: res.location.accuracy ?? null,
        speed: null,
      };
      latestCoords = coords;
      await maybeUpload(coords, force);
    }
  };

  const startWatchers = async () => {
    if (stopped) return;
    const perm = await checkGeolocationPermission().catch(() => 'prompt' as const);
    if (perm === 'denied') return;

    // Initial immediate capture if online
    await captureAndUploadNow(true);
    if (stopped) return;

    if (Capacitor.isNativePlatform()) {
      try {
        nativeWatchId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 10000,
          },
          (pos, err) => {
            if (stopped || err || !pos) return;
            const coords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
              speed: pos.coords.speed ?? null,
            };
            latestCoords = coords;
            void maybeUpload(coords, false);
          }
        );
      } catch {
        // Fallback to web geolocation below
      }
    }

    if (!nativeWatchId && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        webWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (stopped) return;
            const coords = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
              speed: pos.coords.speed ?? null,
            };
            latestCoords = coords;
            void maybeUpload(coords, false);
          },
          () => {
            // Ignore transient GPS watch warnings; heartbeat will retry
          },
          {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 15000,
          }
        );
      } catch {
        // ignore
      }
    }
  };

  void startWatchers();

  // Periodic heartbeat while online & active so stationary online reps stay marked live
  heartbeatTimer = setInterval(() => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (latestCoords) {
      void maybeUpload(latestCoords, false);
    } else {
      void captureAndUploadNow(false);
    }
  }, 18000);

  const handleOnline = () => {
    if (stopped) return;
    void captureAndUploadNow(true);
  };

  const handleVisibility = () => {
    if (stopped) return;
    if (document.visibilityState === 'visible') {
      void captureAndUploadNow(false);
    }
  };

  const handlePageHide = () => {
    if (!stopped) {
      void markRepOffline(rep.id, true);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  try {
    if (Network && typeof Network.addListener === 'function') {
      Network.addListener('networkStatusChange', (status) => {
        if (!stopped && status.connected) {
          void captureAndUploadNow(true);
        }
      })
        .then((handle) => {
          if (stopped && handle && typeof handle.remove === 'function') {
            handle.remove();
          } else {
            networkListenerHandle = handle;
          }
        })
        .catch(() => {});
    }
  } catch {
    // ignore
  }

  return () => {
    stopped = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(webWatchId);
      } catch {}
      webWatchId = null;
    }
    if (nativeWatchId !== null) {
      try {
        void Geolocation.clearWatch({ id: nativeWatchId });
      } catch {}
      nativeWatchId = null;
    }
    if (networkListenerHandle && typeof networkListenerHandle.remove === 'function') {
      try {
        networkListenerHandle.remove();
      } catch {}
      networkListenerHandle = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageHide);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
  };
}
