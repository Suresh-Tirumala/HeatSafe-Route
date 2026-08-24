import "@testing-library/jest-dom";
import { vi } from "vitest";

// ── Source-tagged setData tracking ────────────────────────────────
// Each source name maps to an array of payloads passed to setData.
const _sourceDataCalls: Map<string, any[][]> = new Map();

/** Get all setData payloads for a specific source name. */
export function getSetDataCalls(sourceName: string): any[][] {
  return _sourceDataCalls.get(sourceName) || [];
}

/** Get the last setData payload for a specific source name. */
export function getLastSetDataPayload(sourceName: string): any | undefined {
  const calls = getSetDataCalls(sourceName);
  return calls.length > 0 ? calls[calls.length - 1] : undefined;
}

// ── Shared mock spies ─────────────────────────────────────────────
export const mockAddSource = vi.fn();
export const mockAddLayer = vi.fn();
export const mockSetPaintProperty = vi.fn();
export const mockFitBounds = vi.fn();
export const mockRemove = vi.fn();
export const mockOn = vi.fn();
export const mockSetStyle = vi.fn();
export const mockOnce = vi.fn();
export const mockGetCanvas = vi.fn(() => ({ style: {} }));
export const mockIsStyleLoaded = vi.fn(() => true);

function resetMockState() {
  _sourceDataCalls.clear();
  mockAddSource.mockClear();
  mockAddLayer.mockClear();
  mockSetPaintProperty.mockClear();
  mockFitBounds.mockClear();
  mockRemove.mockClear();
  mockOn.mockReset();
  mockSetStyle.mockClear();
  mockOnce.mockClear();
  mockGetCanvas.mockClear();
  mockIsStyleLoaded.mockReset();
  mockIsStyleLoaded.mockReturnValue(true);
}

// Stub MapLibre GL to avoid WebGL in test environment
vi.mock("maplibre-gl", () => {
  const createMapInstance = () => {
    resetMockState();

    // Default: invoke "load" callback synchronously so sources/layers are
    // registered before the component's updateRoutes useEffect runs.
    mockOn.mockImplementation((event: string, cb: (...args: any[]) => void) => {
      if (event === "load") cb();
      return mapInstance;
    });

    const mapInstance = {
      on: mockOn,
      once: mockOnce,
      addSource: mockAddSource,
      addLayer: mockAddLayer,
      addControl: vi.fn(),
      fitBounds: mockFitBounds,
      setPaintProperty: mockSetPaintProperty,
      setStyle: mockSetStyle,
      getSource: vi.fn((sourceName: string) => ({
        setData: (payload: any) => {
          if (!_sourceDataCalls.has(sourceName)) {
            _sourceDataCalls.set(sourceName, []);
          }
          _sourceDataCalls.get(sourceName)!.push(payload);
        },
      })),
      isStyleLoaded: mockIsStyleLoaded,
      getCanvas: mockGetCanvas,
      remove: mockRemove,
    };
    return mapInstance;
  };

  return {
    Map: vi.fn(() => createMapInstance()),
    Popup: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
    })),
    NavigationControl: vi.fn(),
    ScaleControl: vi.fn(),
  };
});
