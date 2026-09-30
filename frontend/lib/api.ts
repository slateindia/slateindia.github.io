import { dataUrl, route } from "./engine";

/** If NEXT_PUBLIC_API is set, calls go to the FastAPI backend; otherwise (static deployment) to the in-browser engine. */
export const API = process.env.NEXT_PUBLIC_API ?? "";
const STATIC = !API;

export async function get<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const p = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  if (STATIC) return route(path, p) as Promise<T>;
  const r = await fetch(API + path + (params ? "?" + new URLSearchParams(p).toString() : ""));
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail ?? `Request failed (${r.status})`);
  return body as T;
}

export async function post<T = any>(path: string, data: unknown): Promise<T> {
  if (STATIC) return route(path, {}, data) as Promise<T>;
  const r = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Invalid input");
  return body as T;
}

export const suscPng = (model: string, mode: string) => (STATIC ? dataUrl(`susc/png/${model}_${mode}.png`) : `${API}/api/susceptibility/map.png?model=${model}&mode=${mode}`);
export const statesUrl = () => (STATIC ? dataUrl("states.geojson") : `${API}/api/boundaries/states`);
export const downloadUrl = (path: string) => (STATIC ? dataUrl(`downloads/${path}`) : `${API}/api/download/${path}`);

export const fmt = (v: any, d = 3) =>
  v === null || v === undefined || Number.isNaN(v) ? "n/a" : typeof v === "number" ? v.toFixed(d) : String(v);

export const INDIA_BOUNDS: [[number, number], [number, number]] = [[67.5, 6.5], [98.0, 37.6]];

// shared sequential ramps (light to dark), matching the backend PNG ramp
export const SUSC_COLORS = ["#fff7ec", "#fdd49e", "#fc8d59", "#d7301f", "#7f0000"];
export const RAIN_STOPS: [number, string][] = [[0, "#f7fbff"], [5, "#c6dbef"], [25, "#6baed6"], [75, "#2171b5"], [150, "#08306b"]];
export const CAT_COLORS: Record<number, string> = { 1: "#e7e9ee", 2: "#c3c6e0", 3: "#7b7fb8", 4: "#2f2a6b" };
