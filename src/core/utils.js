export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

export function fmt(n, dec = 0) {
  if (!Number.isFinite(Number(n))) return "-";
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: dec,
    minimumFractionDigits: dec
  }).format(Number(n));
}

export function searchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function coordBounds(geometry, bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity }) {
  if (!geometry) return bounds;
  const scan = coords => {
    if (typeof coords?.[0] === "number") {
      bounds.minLon = Math.min(bounds.minLon, coords[0]);
      bounds.maxLon = Math.max(bounds.maxLon, coords[0]);
      bounds.minLat = Math.min(bounds.minLat, coords[1]);
      bounds.maxLat = Math.max(bounds.maxLat, coords[1]);
      return;
    }
    coords?.forEach(scan);
  };
  scan(geometry.coordinates);
  return bounds;
}

export function centerFromGeometry(geometry) {
  const b = coordBounds(geometry);
  if (!Number.isFinite(b.minLon)) return { lon: 0, lat: 0 };
  return { lon: (b.minLon + b.maxLon) / 2, lat: (b.minLat + b.maxLat) / 2 };
}

export function squareAround(lon, lat, km = 4) {
  const latDelta = km / 111;
  const lonDelta = km / (111 * Math.max(0.25, Math.cos(lat * Math.PI / 180)));
  return [[
    [lon - lonDelta, lat - latDelta],
    [lon + lonDelta, lat - latDelta],
    [lon + lonDelta, lat + latDelta],
    [lon - lonDelta, lat + latDelta],
    [lon - lonDelta, lat - latDelta]
  ]];
}
