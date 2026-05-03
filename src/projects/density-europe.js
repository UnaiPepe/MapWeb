import { pickVisualizations } from "../visualizations/registry.js";
import { centerFromGeometry } from "../core/utils.js";

const base = new URL("../../data/geographies/europe-lau/", import.meta.url);

export const COUNTRY_NAMES = {
  AT: "Austria", BE: "Belgica", BG: "Bulgaria", CH: "Suiza", CY: "Chipre",
  CZ: "Chequia", DE: "Alemania", DK: "Dinamarca", EE: "Estonia", EL: "Grecia",
  ES: "Espana", FI: "Finlandia", FR: "Francia", HR: "Croacia", HU: "Hungria",
  IE: "Irlanda", IS: "Islandia", IT: "Italia", LI: "Liechtenstein", LT: "Lituania",
  LU: "Luxemburgo", LV: "Letonia", MT: "Malta", NL: "Paises Bajos", NO: "Noruega",
  PL: "Polonia", PT: "Portugal", RO: "Rumania", SE: "Suecia", SI: "Eslovenia", SK: "Eslovaquia"
};

function unitFromFeature(app, feature) {
  const p = feature.properties || {};
  const center = feature.geometry?.type === "Point"
    ? { lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] }
    : centerFromGeometry(feature.geometry);
  return app.normalizeUnit({
    id: p.code || feature.id,
    name: p.name || feature.id,
    country: p.country || "",
    countryName: COUNTRY_NAMES[p.country] || p.country || "",
    level: "LAU",
    lon: Number(p.lon ?? center.lon),
    lat: Number(p.lat ?? center.lat),
    area: Number(p.area || 0),
    source: p.source || "Eurostat/GISCO LAU 2024",
    hasData: Boolean(p.hasData && Number(p.population) > 0 && Number(p.density) > 0),
    population: Number(p.population || 0),
    density: Number(p.density || 0),
    metrics: {
      density: Number(p.density || 0),
      population: Number(p.population || 0),
      area: Number(p.area || 0)
    }
  }, feature.geometry?.type === "Point" ? null : feature.geometry);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
  return res.json();
}

async function loadCountry(app, country) {
  if (country === "all" || app.loadedCountries.has(country)) return;
  const index = app.metadata.index;
  const item = index.countries.find(candidate => candidate.code === country);
  if (!item) return;
  const topo = await fetchJson(new URL(item.href, base));
  const geo = topojson.feature(topo, topo.objects.lau);
  const countryUnits = geo.features.map(feature => unitFromFeature(app, feature));
  app.loadedCountries.set(country, countryUnits);
  const existing = new Map(app.allUnits.map(unit => [unit.id, unit]));
  for (const unit of countryUnits) existing.set(unit.id, unit);
  app.setUnits([...existing.values()]);
}

function unitsFromOverview(app, overview) {
  if (overview.type === "FeatureCollection") return overview.features.map(feature => unitFromFeature(app, feature));
  const columns = overview.columns || [];
  return (overview.units || []).map(row => {
    const props = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
    props.hasData = Boolean(props.hasData);
    return unitFromFeature(app, {
      id: props.code,
      geometry: { type: "Point", coordinates: [Number(props.lon), Number(props.lat)] },
      properties: props
    });
  });
}

export const densityEuropeProject = {
  id: "density-europe",
  title: "Densidad municipal europea",
  subtitle: "Europa UE/EFTA · unidades LAU · densidad, poblacion y superficie desde assets particionados.",
  defaultView: "points",
  defaultMetric: "density",
  geography: { id: "europe-lau", level: "LAU" },
  map: { center: [9.5, 48.5], zoom: 3.45, pitch: 36, bearing: -12, bounds: [[-25, 34], [35, 72]], selectZoom: 9.2 },
  metrics: [
    { id: "density", label: "Densidad", unit: "hab/km2", decimals: 1, scale: "log" },
    { id: "population", label: "Poblacion", unit: "hab.", decimals: 0, scale: "log", total: "sum" },
    { id: "area", label: "Superficie", unit: "km2", decimals: 1, scale: "log", total: "sum" }
  ],
  filters: [
    {
      id: "densityBand",
      label: "Densidad",
      defaultValue: "all",
      options: [
        { value: "all", label: "Densidad: todas" },
        { value: "low", label: "Baja: menos de 50 hab/km2", test: unit => unit.metrics.density < 50 },
        { value: "medium", label: "Media: 50-500 hab/km2", test: unit => unit.metrics.density >= 50 && unit.metrics.density < 500 },
        { value: "high", label: "Alta: 500-5.000 hab/km2", test: unit => unit.metrics.density >= 500 && unit.metrics.density < 5000 },
        { value: "extreme", label: "Extrema: mas de 5.000 hab/km2", test: unit => unit.metrics.density >= 5000 }
      ]
    },
    {
      id: "populationBand",
      label: "Poblacion",
      defaultValue: "all",
      options: [
        { value: "all", label: "Poblacion: todas" },
        { value: "lt1k", label: "Menos de 1.000", test: unit => unit.metrics.population < 1000 },
        { value: "1k10k", label: "1.000-10.000", test: unit => unit.metrics.population >= 1000 && unit.metrics.population < 10000 },
        { value: "10k100k", label: "10.000-100.000", test: unit => unit.metrics.population >= 10000 && unit.metrics.population < 100000 },
        { value: "gt100k", label: "Mas de 100.000", test: unit => unit.metrics.population >= 100000 }
      ]
    }
  ],
  allowHideNoData: true,
  visualizations: pickVisualizations(["points", "choropleth", "heatmap", "cubes", "grid", "bivariate"]),
  searchAliases: {
    berlin: "DE_11000000",
    lisboa: "PT_110665",
    lisbon: "PT_110665"
  },
  uiText: {
    allCountries: "Toda Europa UE/EFTA",
    countryLabel: "Filtrar pais",
    countryHint: "El pais seleccionado carga su geometria completa bajo demanda.",
    searchPlaceholder: "Ej. Madrid, Paris, Berlin...",
    emptyDetail: "Selecciona una unidad LAU para ver ranking, percentil y fuente.",
    metricLabels: ["unidades LAU", "maximo", "paises", "total visible"]
  },
  sources: [
    "Eurostat/GISCO: LAU 2024, limites municipales europeos, poblacion, area y densidad cuando estan disponibles.",
    "Suplementos: INE 2025 para Espana e INSEE 2021 para Francia.",
    "Mapa base: OpenStreetMap y CARTO raster tiles de alta densidad."
  ],
  async load(app) {
    app.setStatus("Cargando overview europeo LAU...");
    const index = await fetchJson(new URL("index.json", base));
    const overview = await fetchJson(new URL(index.overview, base));
    app.metadata.index = index;
    app.metadata.asset = index;
    app.setUnits(unitsFromOverview(app, overview));
  },
  async onCountryChange(app, country) {
    await loadCountry(app, country);
  },
  async ensureGeometry(app, country) {
    if (country === "all") {
      app.setStatus("Cargando geometria completa europea bajo demanda...");
      for (const item of app.metadata.index.countries) await loadCountry(app, item.code);
    } else {
      await loadCountry(app, country);
    }
  }
};
