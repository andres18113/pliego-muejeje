import { MaterialSymbol } from "@/shared/ui/MaterialSymbol";
import type { ReactNode } from "react";
import classes from "./pickup.module.css";

/** The only map-provider boundary. Consumers pass geographic coordinates, never SDK objects or place IDs. */
export interface LocationMapProps { latitude: number; longitude: number; label: string; callout?: ReactNode; linkLabel?: string }
export function LocationMap({ latitude, longitude, label, callout, linkLabel = "Ver ubicación en el mapa" }: LocationMapProps) {
  // Bounds describe the map viewport only; the marker is the exact backend coordinate.
  const parameters = new URLSearchParams({
    bbox: [longitude - .006, latitude - (callout ? .002 : .004), longitude + .006, latitude + (callout ? .006 : .004)].join(","),
    layer: "mapnik", marker: `${latitude},${longitude}`,
  });
  const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
  return <div className={classes.map}>
    {callout ? <div className={classes.mapFrame}>
      <iframe title={`Mapa de ${label}`} src={`https://www.openstreetmap.org/export/embed.html?${parameters}`} loading="lazy" referrerPolicy="no-referrer" />
      <div className={classes.mapCallout}>{callout}</div>
    </div> : <iframe title={`Mapa de ${label}`} src={`https://www.openstreetmap.org/export/embed.html?${parameters}`} loading="lazy" referrerPolicy="no-referrer" />}
    <a className={classes.mapLink} href={mapUrl} target="_blank" rel="noopener noreferrer">
      <MaterialSymbol name="location_on" size={20} /><span>{linkLabel} <span className="visually-hidden">(se abre en otra pestaña)</span></span>
    </a>
  </div>;
}
