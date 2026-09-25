import { getHaloKv } from './halopsa-kv';

const MARKER_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days
const memoryMarkers = new Map<string, string>();

function markerKey(deviceId: string): string {
  return `halopsa:device-noncompliant-since:${deviceId}`;
}

/**
 * Tracks when a device became noncompliant (the Device row has no such
 * column). Stored in Upstash when configured, otherwise in process memory
 * (single-instance self-hosting; a restart only delays the alert).
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

  const existing = memoryMarkers.get(key);
  if (existing) return new Date(existing);
  memoryMarkers.set(key, now.toISOString());
  return now;
}

/** Tests only. */
export function clearDeviceMarkersForTests(): void {
  memoryMarkers.clear();
}
