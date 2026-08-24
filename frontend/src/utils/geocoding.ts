/**
 * Geocoding utilities — place search & reverse geocoding.
 *
 * Uses OpenStreetMap Nominatim (free, no API key) as the geocoder,
 * the same open data source Google Maps-style search boxes commonly
 * wrap for demo/open-source apps.
 *
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 * We debounce requests in the UI and keep result counts small.
 */

export interface PlaceResult {
  id: string;
  /** Primary label, e.g. "Central Park". */
  label: string;
  /** Secondary context, e.g. "Manhattan, New York County, USA". */
  sublabel: string;
  lng: number;
  lat: number;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

interface NominatimPlace {
  place_id: number | string;
  display_name: string;
  name?: string;
  lat: string | number;
  lon: string | number;
}

/** Split a Nominatim display_name into primary label + secondary context. */
function splitDisplayName(displayName: string, name?: string): { label: string; sublabel: string } {
  const parts = displayName.split(", ");
  if (name && parts.length > 1) {
    return { label: name, sublabel: parts.slice(1).join(", ") };
  }
  if (parts.length === 1) {
    return { label: parts[0], sublabel: "" };
  }
  // Drop the trailing country for a cleaner two-line layout when possible.
  const label = parts[0];
  const rest = parts.slice(1);
  if (rest.length > 2) rest.pop();
  return { label, sublabel: rest.join(", ") };
}

function toPlaceResult(p: NominatimPlace): PlaceResult {
  const { label, sublabel } = splitDisplayName(p.display_name, p.name);
  return {
    id: String(p.place_id),
    label,
    sublabel,
    lng: Number(p.lon),
    lat: Number(p.lat),
  };
}

/** Full-text place search (autocomplete-style). Returns up to `limit` results. */
export async function searchPlaces(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: String(options.limit ?? 6),
    q: trimmed,
  });

  const res = await fetch(`${NOMINATIM_BASE}/search?${params.toString()}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Geocoding request failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as NominatimPlace[];
  return data.map(toPlaceResult);
}

/** Reverse geocode coordinates into the nearest named place. */
export async function reverseGeocode(
  lng: number,
  lat: number,
  options: { signal?: AbortSignal } = {}
): Promise<PlaceResult> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
  });

  try {
    const res = await fetch(`${NOMINATIM_BASE}/reverse?${params.toString()}`, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as NominatimPlace & { error?: string };
      if (!data.error && data.display_name) {
        return toPlaceResult(data);
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // fall through to pin fallback
  }

  return {
    id: `pin:${lng.toFixed(5)},${lat.toFixed(5)}`,
    label: "Dropped pin",
    sublabel: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lng,
    lat,
  };
}
