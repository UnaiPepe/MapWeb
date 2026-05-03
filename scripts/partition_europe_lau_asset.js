const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "data", "europe_lau_2024.min.json");
const outRoot = path.join(root, "data", "geographies", "europe-lau");
const countriesDir = path.join(outRoot, "countries");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function arcIndex(value) {
  return value < 0 ? ~value : value;
}

function rewriteArcs(value, mapping) {
  if (typeof value === "number") {
    const mapped = mapping.get(arcIndex(value));
    return value < 0 ? ~mapped : mapped;
  }
  return value.map(item => rewriteArcs(item, mapping));
}

function collectArcs(value, out = new Set()) {
  if (typeof value === "number") {
    out.add(arcIndex(value));
  } else if (Array.isArray(value)) {
    value.forEach(item => collectArcs(item, out));
  }
  return out;
}

function decodeArc(arc, transform) {
  let x = 0;
  let y = 0;
  return arc.map(point => {
    x += point[0];
    y += point[1];
    return [
      x * transform.scale[0] + transform.translate[0],
      y * transform.scale[1] + transform.translate[1]
    ];
  });
}

function geometryCenter(geometry, arcs, transform) {
  const used = [...collectArcs(geometry.arcs)];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const index of used) {
    for (const [lon, lat] of decodeArc(arcs[index], transform)) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  return {
    lon: Number.isFinite(minLon) ? (minLon + maxLon) / 2 : 0,
    lat: Number.isFinite(minLat) ? (minLat + maxLat) / 2 : 0
  };
}

function compactGeometry(geometry, mapping) {
  return {
    type: geometry.type,
    arcs: rewriteArcs(geometry.arcs, mapping),
    id: geometry.id,
    properties: geometry.properties
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 0), "utf8");
}

function main() {
  ensureDir(countriesDir);
  const topo = JSON.parse(fs.readFileSync(input, "utf8"));
  const collection = topo.objects.lau;
  const byCountry = new Map();
  for (const geometry of collection.geometries) {
    const country = geometry.properties?.country || "XX";
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(geometry);
  }

  const countries = [];
  for (const [country, geometries] of [...byCountry.entries()].sort()) {
    const arcSet = new Set();
    geometries.forEach(geometry => collectArcs(geometry.arcs, arcSet));
    const oldIndexes = [...arcSet].sort((a, b) => a - b);
    const mapping = new Map(oldIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const countryTopo = {
      type: "Topology",
      transform: topo.transform,
      arcs: oldIndexes.map(index => topo.arcs[index]),
      objects: {
        lau: {
          type: "GeometryCollection",
          geometries: geometries.map(geometry => compactGeometry(geometry, mapping))
        }
      },
      metadata: {
        ...(topo.metadata || {}),
        country,
        units: geometries.length,
        unitsWithData: geometries.filter(g => g.properties?.hasData).length
      }
    };
    writeJson(path.join(countriesDir, `${country}.json`), countryTopo);
    countries.push({
      code: country,
      units: countryTopo.metadata.units,
      unitsWithData: countryTopo.metadata.unitsWithData,
      href: `countries/${country}.json`
    });
  }

  const overview = {
    columns: ["code", "country", "name", "lon", "lat", "population", "density", "area", "year", "hasData"],
    units: collection.geometries.map(geometry => {
      const center = geometryCenter(geometry, topo.arcs, topo.transform);
      const props = geometry.properties || {};
      return [
        props.code,
        props.country,
        props.name,
        Math.round(center.lon * 100000) / 100000,
        Math.round(center.lat * 100000) / 100000,
        props.population || 0,
        props.density || 0,
        props.area || 0,
        props.year,
        props.hasData ? 1 : 0
      ];
    })
  };
  writeJson(path.join(outRoot, "overview.json"), overview);
  writeJson(path.join(outRoot, "index.json"), {
    ...(topo.metadata || {}),
    asset: "europe-lau",
    strategy: "overview-plus-country-topologies",
    overview: "overview.json",
    countries
  });
  console.log(`Wrote ${countries.length} country chunks and ${overview.units.length} overview points.`);
}

main();
