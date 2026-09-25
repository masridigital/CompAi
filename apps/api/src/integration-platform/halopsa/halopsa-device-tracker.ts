import { getHaloKv } from './halopsa-kv';

const MARKER_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days
/** In-memory fallback cap; the oldest markers are evicted first. */
export const MAX_MEMORY_MARKERS = 10_000;

interface MemoryMarker {
  since: string;
  expiresAt: number;
}
const memoryMarkers = new Map<string, MemoryMarker>();

function readMemoryMarker({ key, now }: { key: string; now: Date }): string | null {
  const marker = memoryMarkers.get(key);
  if (!marker) return null;
  if (marker.expiresAt <= now.getTime()) {
    memoryMarkers.delete(key);
    return null;
  }
  return marker.since;
}

function writeMemoryMarker({ key, now }: { key: string; now: Date }): void {
  while (memoryMarkers.size >= MAX_MEMORY_MARKERS) {
    const oldest = memoryMarkers.keys().next().value;
    if (oldest === undefined) break;
    memoryMarkers.delete(oldest);
  }
  memoryMarkers.set(key, {
    since: now.toISOString(),
    expiresAt: now.getTime() + MARKER_TTL_SECONDS * 1000,
  });
}

function markerKey(deviceId: string): string {
  return `halopsa:device-noncompliant-since:${deviceId}`;
}

/**
 * Tracks when a device became noncompliant (the Device row has no such
 * column). Stored in Upstash when configured, otherwise in process memory
 * (single-instance self-hosting; a restart only delays the alert), bounded
 * by the same 60-day TTL and MAX_MEMORY_MARKERS entries.
 * Returns the start of the current noncompliant streak, or null when compliant.
 */
export async function resolveNonCompliantSince({
  deviceId,
  compliant,
  now = new Date(),
}: {
  deviceId: string;
  compliant: boolean;
  now?: Date;
}): Promise<Date | null> {
  const key = markerKey(deviceId);
  const kv = getHaloKv();

  if (compliant) {
    memoryMarkers.delete(key);
    if (kv) await kv.del(key);
    return null;
  }

  if (kv) {
    await kv.set(key, now.toISOString(), { nx: true, ex: MARKER_TTL_SECONDS });
    const stored = await kv.get<string>(key);
    const parsed = stored ? new Date(stored) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
  }

  const existing = readMemoryMarker({ key, now });
  if (existing) return new Date(existing);
  writeMemoryMarker({ key, now });
  return now;
}

/** Tests only. */
export function clearDeviceMarkersForTests(): void {
  memoryMarkers.clear();
}

/** Tests only. */
export function deviceMarkerCountForTests(): number {
  return memoryMarkers.size;
}
