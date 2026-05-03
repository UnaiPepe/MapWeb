function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function squareAround(lon, lat, km = 4) {
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

function score(value, max) {
  return clamp(Math.log10(Number(value || 0) + 1) / Math.log10(Number(max || 1) + 1), 0, 1);
}

function buildGrid({ units, cell, metricId, maxMetric }) {
  const cells = new Map();
  for (const unit of units) {
    const lon = Number(unit.lon);
    const lat = Number(unit.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const x = Math.floor(lon / cell);
    const y = Math.floor(lat / cell);
    const key = `${x}:${y}`;
    const prev = cells.get(key) || { x, y, value: 0, area: 0, population: 0, count: 0 };
    const value = Number(unit.metrics?.[metricId] ?? unit[metricId] ?? 0);
    prev.value += value;
    prev.area += Number(unit.area || 0);
    prev.population += Number(unit.metrics?.population ?? unit.population ?? 0);
    prev.count += 1;
    cells.set(key, prev);
  }
  return {
    type: "FeatureCollection",
    features: [...cells.values()].map(c => {
      const west = c.x * cell;
      const south = c.y * cell;
      const value = c.value / Math.max(1, c.count);
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west, south],
            [west + cell, south],
            [west + cell, south + cell],
            [west, south + cell],
            [west, south]
          ]]
        },
        properties: {
          id: `${c.x}:${c.y}`,
          name: `${c.count} unidades`,
          value,
          score: score(value, maxMetric),
          population: Math.round(c.population),
          area: c.area,
          count: c.count
        }
      };
    })
  };
}

function buildCubes({ units, metricId, maxMetric, maxPopulation, heightMax }) {
  return {
    type: "FeatureCollection",
    features: units.map(unit => {
      const value = Number(unit.metrics?.[metricId] ?? unit[metricId] ?? 0);
      const metricScore = score(value, maxMetric);
      const popScore = score(unit.metrics?.population ?? unit.population, maxPopulation);
      const areaSide = Number(unit.area) > 0 ? Math.sqrt(Number(unit.area)) : 1;
      const areaHint = clamp(areaSide * 0.08, 0.35, 2.4);
      const populationHint = Math.pow(popScore, 1.55) * 5.2;
      const denseNarrowing = 1 - metricScore * 0.34;
      const footprintKm = clamp((0.65 + areaHint + populationHint) * denseNarrowing, 0.45, 6.4);
      return {
        type: "Feature",
        id: unit.id,
        geometry: { type: "Polygon", coordinates: squareAround(Number(unit.lon), Number(unit.lat), footprintKm) },
        properties: {
          ...unit,
          value,
          score: metricScore,
          populationScore: popScore,
          footprintKm,
          height: Math.round(1200 + Math.pow(metricScore, 1.18) * heightMax)
        }
      };
    })
  };
}

function rank({ units, metricId }) {
  return [...units]
    .filter(unit => Number.isFinite(Number(unit.metrics?.[metricId] ?? unit[metricId])) && Number(unit.metrics?.[metricId] ?? unit[metricId]) !== 0)
    .sort((a, b) => Number(b.metrics?.[metricId] ?? b[metricId]) - Number(a.metrics?.[metricId] ?? a[metricId]))
    .slice(0, 50);
}

self.addEventListener("message", event => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === "grid") result = buildGrid(payload);
    else if (type === "cubes") result = buildCubes(payload);
    else if (type === "rank") result = rank(payload);
    else throw new Error(`Unknown worker task: ${type}`);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
});
