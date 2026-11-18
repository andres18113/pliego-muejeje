import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import classes from "./pickup.module.css";

/** The only map-provider boundary. Consumers pass geographic coordinates, never SDK objects or place IDs. */
export interface LocationMapProps { latitude: number; longitude: number; label: string; callout?: ReactNode; linkLabel?: string }

const TILE = 256;
const MIN_ZOOM = 13;
const MAX_ZOOM = 18;
const DEFAULT_ZOOM = 16;
/** OpenStreetMap's standard raster layer: the same tiles its embed drew, requested directly (no embed page or map script). */
export const osmTileUrl = (zoom: number, x: number, y: number) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

type Tile = { url: string; left: number; top: number };
type TileStatus = "loaded" | "failed";

/** Web Mercator, in pixels of the whole world at `zoom`. */
function worldPixel(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  return { x: ((longitude + 180) / 360) * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
}

/** Only the tiles the frame shows, placed so the exact backend coordinate lands on the marker's anchor. */
export function visibleTiles(latitude: number, longitude: number, zoom: number, width: number, height: number, anchorY: number): Tile[] {
  const point = worldPixel(latitude, longitude, zoom);
  const left = point.x - width / 2;
  const top = point.y - height * anchorY;
  const count = 2 ** zoom;
  const tiles: Tile[] = [];
  for (let y = Math.max(0, Math.floor(top / TILE)); y <= Math.min(count - 1, Math.floor((top + height - 1) / TILE)); y++) {
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + width - 1) / TILE); x++) {
      tiles.push({ url: osmTileUrl(zoom, ((x % count) + count) % count, y), left: Math.round(x * TILE - left), top: Math.round(y * TILE - top) });
    }
  }
  return tiles;
}

/**
 * A light map of one place: the point's own tiles and a PLIEGO marker, with zoom centred on that point. The map
 * stays a quiet field until its tiles have arrived and then appears whole, marker included, so the marker never
 * floats on an empty ground. A zoom level keeps showing until the next one is ready. A failure is said, not hidden,
 * and the link to the full map is always there.
 */
export function LocationMap({ latitude, longitude, label, callout, linkLabel = "Ver ubicación en el mapa" }: LocationMapProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [shownZoom, setShownZoom] = useState<number | null>(null);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, TileStatus>>(() => new Map());
  // With a callout over the top-left, the point sits lower so both stay visible.
  const anchorY = callout ? 0.72 : 0.5;

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize((current) => current && Math.round(current.width) === Math.round(width) && Math.round(current.height) === Math.round(height)
        ? current : width > 0 && height > 0 ? { width, height } : current);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const layer = useCallback((level: number) => size ? visibleTiles(latitude, longitude, level, size.width, size.height, anchorY) : [], [anchorY, latitude, longitude, size]);
  const requested = useMemo(() => layer(zoom), [layer, zoom]);
  const shown = useMemo(() => shownZoom === null || shownZoom === zoom ? null : layer(shownZoom), [layer, shownZoom, zoom]);
  const settled = requested.length > 0 && requested.every((tile) => statuses.has(tile.url));
  const anyLoaded = requested.some((tile) => statuses.get(tile.url) === "loaded");
  // Derived during render: the requested level replaces the shown one only once it can be seen.
  if (settled && anyLoaded && shownZoom !== zoom) setShownZoom(zoom);
  const failed = settled && !anyLoaded;
  const ready = shownZoom !== null;

  const record = useCallback((url: string, status: TileStatus) => {
    setStatuses((current) => current.get(url) === status ? current : new Map(current).set(url, status));
  }, []);
  // An image the browser already holds can finish before React listens; read it once it is attached.
  const attach = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete) record(node.currentSrc || node.src, node.naturalWidth > 0 ? "loaded" : "failed");
  }, [record]);

  const changeZoom = (step: number) => setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (shownZoom ?? current) + step)));
  const zoomBusy = ready && shownZoom !== zoom && !failed;
  const renderTiles = (tiles: Tile[]) => tiles.map((tile) => <img key={tile.url} ref={attach} src={tile.url} alt="" width={TILE} height={TILE}
    decoding="async" draggable={false} style={{ left: tile.left, top: tile.top }}
    onLoad={() => record(tile.url, "loaded")} onError={() => record(tile.url, "failed")} />);

  const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
  return <div className={classes.map}>
    <div className={classes.mapFrame} ref={frame} data-location-map data-state={ready ? "ready" : failed ? "failed" : "loading"} aria-busy={!ready && !failed ? true : undefined}>
      <div className={classes.mapCanvas} role="img" aria-label={`Mapa de ${label}`}>
        {/* The level being shown stays under the one loading, so a zoom never blanks the map. */}
        {shown && <div className={classes.mapTiles} data-shown>{renderTiles(shown)}</div>}
        <div className={classes.mapTiles} data-shown={shownZoom === zoom || undefined}>{renderTiles(requested)}</div>
        {ready && <span className={classes.mapMarker} style={{ top: `${anchorY * 100}%` }} aria-hidden="true"><MaterialSymbol name="location_on" size={40} fill /></span>}
      </div>
      {!ready && !failed && <p className={classes.mapStatus} aria-hidden="true">Cargando mapa…</p>}
      {failed && !ready && <p className={classes.mapStatus} data-tone="error">
        <MaterialSymbol name="error" size={20} aria-hidden="true" /><span>No pudimos cargar el mapa. Puedes verlo con el enlace de abajo.</span>
      </p>}
      {callout && <div className={classes.mapCallout}>{callout}</div>}
      {ready && <div className={classes.mapZoom}>
        <button type="button" aria-label="Acercar el mapa" aria-disabled={zoom >= MAX_ZOOM || zoomBusy || undefined}
          onClick={() => { if (zoom < MAX_ZOOM && !zoomBusy) changeZoom(1); }}><MaterialSymbol name="add" size={22} /></button>
        <button type="button" aria-label="Alejar el mapa" aria-disabled={zoom <= MIN_ZOOM || zoomBusy || undefined}
          onClick={() => { if (zoom > MIN_ZOOM && !zoomBusy) changeZoom(-1); }}><MaterialSymbol name="remove" size={22} /></button>
      </div>}
      {zoom !== shownZoom && settled && !anyLoaded && ready && <p className={classes.mapNotice} role="status">No pudimos cargar ese nivel del mapa.</p>}
      <a className={classes.mapAttribution} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap<span className="visually-hidden"> (se abre en otra pestaña)</span>
      </a>
    </div>
    <a className={classes.mapLink} href={mapUrl} target="_blank" rel="noopener noreferrer">
      <MaterialSymbol name="location_on" size={20} /><span>{linkLabel} <span className="visually-hidden">(se abre en otra pestaña)</span></span>
    </a>
  </div>;
}
