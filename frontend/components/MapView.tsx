"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { INDIA_BOUNDS, statesUrl } from "@/lib/api";

export type Overlay = { url: string; bounds: [number, number, number, number]; opacity?: number };
export type GeoLayer = { data: any; color: any; opacity?: number; outline?: boolean };

type Props = {
  image?: Overlay | null;
  geo?: GeoLayer | null;
  points?: [number, number][];
  marker?: [number, number] | null;
  onClick?: (lat: number, lon: number, props?: any) => void;
  fit?: [[number, number], [number, number]] | null;
  className?: string;
};

const BASEMAPS: Record<string, any> = {
  none: null,
  osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
};

export default function MapView({ image, geo, points, marker, onClick, fit, className = "h-[70vh]" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const mk = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState("osm");
  const [showStates, setShowStates] = useState(true);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef1f4" } }] },
      bounds: INDIA_BOUNDS,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => {
      m.addSource("states", { type: "geojson", data: statesUrl() });
      setReady(true);
    });
    m.on("click", (e) => {
      const f = m.getLayer("geo-fill") ? m.queryRenderedFeatures(e.point, { layers: ["geo-fill"] })[0] : undefined;
      click.current?.(e.lngLat.lat, e.lngLat.lng, f?.properties);
    });
    map.current = m;
    return () => m.remove();
  }, []);

  // basemap
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (m.getLayer("base")) m.removeLayer("base");
    if (m.getSource("base")) m.removeSource("base");
    if (BASEMAPS[base]) {
      m.addSource("base", BASEMAPS[base]);
      m.addLayer({ id: "base", type: "raster", source: "base", paint: { "raster-saturation": -0.8, "raster-opacity": 0.7 } }, m.getLayer("img") ? "img" : undefined);
    }
  }, [ready, base]);

  // raster overlay
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (m.getLayer("img")) m.removeLayer("img");
    if (m.getSource("img")) m.removeSource("img");
    if (image) {
      const [w, s, e, n] = image.bounds;
      m.addSource("img", { type: "image", url: image.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
      m.addLayer({ id: "img", type: "raster", source: "img", paint: { "raster-opacity": image.opacity ?? 0.85, "raster-resampling": "nearest" } },
        m.getLayer("geo-fill") ? "geo-fill" : undefined);
    }
  }, [ready, image?.url, image?.opacity]);

  // vector (IMD grid) layer
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const l of ["geo-line", "geo-fill"]) if (m.getLayer(l)) m.removeLayer(l);
    if (m.getSource("geo")) m.removeSource("geo");
    if (geo?.data) {
      m.addSource("geo", { type: "geojson", data: geo.data });
      m.addLayer({ id: "geo-fill", type: "fill", source: "geo", paint: { "fill-color": geo.color, "fill-opacity": geo.opacity ?? 0.8 } });
      if (geo.outline) m.addLayer({ id: "geo-line", type: "line", source: "geo", paint: { "line-color": "#ffffff", "line-width": 0.2 } });
    }
  }, [ready, geo?.data, JSON.stringify(geo?.color), geo?.opacity]);

  // landslide points
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (m.getLayer("pts")) m.removeLayer("pts");
    if (m.getSource("pts")) m.removeSource("pts");
    if (points?.length) {
      m.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: points.map(([la, lo]) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lo, la] } })) } });
      m.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": 1.6, "circle-color": "#111", "circle-opacity": 0.6 } });
    }
  }, [ready, points]);

  // state boundaries on top
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (m.getLayer("states")) m.removeLayer("states");
    if (showStates) m.addLayer({ id: "states", type: "line", source: "states", paint: { "line-color": "#444", "line-width": 0.6, "line-opacity": 0.7 } });
  }, [ready, showStates, image?.url, geo?.data, points]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    mk.current?.remove();
    if (marker) mk.current = new maplibregl.Marker({ color: "#3b4a8c" }).setLngLat([marker[1], marker[0]]).addTo(m);
  }, [marker?.[0], marker?.[1]]);

  useEffect(() => {
    if (ready && fit) map.current?.fitBounds(fit, { padding: 30, duration: 0 });
  }, [ready, JSON.stringify(fit)]);

  return (
    <div className={`relative ${className}`}>
      <div ref={box} className="w-full h-full rounded border border-line" />
      <div className="absolute top-2 left-2 bg-white/90 border border-line rounded px-2 py-1 text-xs space-x-2">
        <label>Basemap{" "}
          <select value={base} onChange={(e) => setBase(e.target.value)} className="border border-line rounded">
            <option value="osm">OpenStreetMap (grey)</option>
            <option value="none">None</option>
          </select>
        </label>
        <label><input type="checkbox" checked={showStates} onChange={(e) => setShowStates(e.target.checked)} /> State boundaries</label>
      </div>
    </div>
  );
}

export function Legend({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div className="text-xs">
      <div className="font-semibold mb-1">{title}</div>
      {items.map(([c, l]) => (
        <div key={l} className="flex items-center gap-2"><span className="inline-block w-4 h-3 border border-line" style={{ background: c }} />{l}</div>
      ))}
    </div>
  );
}
