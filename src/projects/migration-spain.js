import { pickVisualizations } from "../visualizations/registry.js";

const base = new URL("../../data/projects/migration-spain/", import.meta.url);
const geographyBase = new URL("../../data/geographies/europe-lau/countries/ES.json", import.meta.url);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al cargar ${url}`);
  return res.json();
}

function loadUnits(app, payload) {
  const units = payload.units.map(unit => app.normalizeUnit({
    ...unit,
    level: "municipio",
    metrics: {
      netMigration: Number(unit.metrics?.netMigration || 0),
      inMigration: Number(unit.metrics?.inMigration || 0),
      outMigration: Number(unit.metrics?.outMigration || 0),
      population: Number(unit.metrics?.population || 0)
    }
  }));
  app.setUnits(units);
  app.flows = payload.flows || [];
}

export const migrationSpainProject = {
  id: "migration-spain",
  title: "Migraciones municipales Espana",
  subtitle: "Piloto de motor: saldos, entradas, salidas y flujos principales a escala municipal.",
  defaultView: "choropleth",
  defaultMetric: "netMigration",
  geography: { id: "spain-municipal", level: "municipio" },
  map: { center: [-3.7, 40.2], zoom: 5.35, pitch: 32, bearing: -8, bounds: [[-10, 35.5], [4.7, 43.9]], selectZoom: 9.5 },
  time: { label: "Ano", years: [2024], defaultYear: 2024 },
  metrics: [
    { id: "netMigration", label: "Saldo migratorio", unit: "pers.", decimals: 0, scale: "diverging", total: "sum" },
    { id: "inMigration", label: "Entradas", unit: "pers.", decimals: 0, scale: "log", total: "sum" },
    { id: "outMigration", label: "Salidas", unit: "pers.", decimals: 0, scale: "log", total: "sum" },
    { id: "population", label: "Poblacion", unit: "hab.", decimals: 0, scale: "log", total: "sum" }
  ],
  filters: [
    {
      id: "migrationBand",
      label: "Saldo",
      defaultValue: "all",
      options: [
        { value: "all", label: "Saldo: todos" },
        { value: "positive", label: "Saldo positivo", test: unit => unit.metrics.netMigration > 0 },
        { value: "negative", label: "Saldo negativo", test: unit => unit.metrics.netMigration < 0 },
        { value: "strongPositive", label: "Ganancia alta (+500)", test: unit => unit.metrics.netMigration >= 500 },
        { value: "strongNegative", label: "Perdida alta (-500)", test: unit => unit.metrics.netMigration <= -500 }
      ]
    }
  ],
  allowHideNoData: true,
  visualizations: pickVisualizations(["choropleth", "points", "flows", "heatmap", "grid", "bivariate"]),
  uiText: {
    allCountries: "Toda Espana",
    countryLabel: "Ambito",
    countryHint: "Piloto municipal espanol. Los flujos muestran una seleccion top-N para mantener rendimiento.",
    searchPlaceholder: "Ej. Madrid, Barcelona, Valencia...",
    emptyDetail: "Selecciona un municipio para ver entradas, salidas, saldo y ranking.",
    metricLabels: ["municipios", "maximo", "ambitos", "total visible"]
  },
  sources: [
    "Piloto funcional preparado para INE EMCR. El asset actual es un scaffold reproducible hasta conectar la matriz oficial.",
    "Geografia municipal: Eurostat/GISCO LAU 2024, filtrada a Espana.",
    "Objetivo de la siguiente iteracion: sustituir el scaffold por INE Estadistica de Migraciones y Cambios de Residencia."
  ],
  async load(app) {
    app.setStatus("Cargando piloto de migraciones...");
    const index = await fetchJson(new URL("index.json", base));
    app.metadata.index = index;
    const payload = await fetchJson(new URL(index.files[String(index.latestYear)], base));
    loadUnits(app, payload);
  },
  async onYearChange(app, year) {
    const index = app.metadata.index || await fetchJson(new URL("index.json", base));
    const file = index.files[String(year)];
    if (!file) return;
    const payload = await fetchJson(new URL(file, base));
    loadUnits(app, payload);
  },
  async ensureGeometry(app) {
    if (app.loadedGeometry === "ES") return;
    const topo = await fetchJson(geographyBase);
    const geo = topojson.feature(topo, topo.objects.lau);
    const byId = new Map(geo.features.map(feature => [feature.id || feature.properties?.code, feature.geometry]));
    for (const unit of app.allUnits) {
      if (byId.has(unit.id)) unit.geometry = byId.get(unit.id);
    }
    app.loadedGeometry = "ES";
  }
};
