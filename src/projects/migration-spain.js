import { pickVisualizations } from "../visualizations/registry.js";

const base = new URL("../../data/projects/migration-spain/", import.meta.url);
const geographyBase = new URL("../../data/geographies/europe-lau/countries/ES.json", import.meta.url);
const projectLinks = [
  { id: "density-europe", label: "Densidad municipal europea", href: new URL("../../projects/density-europe.html", import.meta.url).href },
  { id: "migration-spain", label: "Migraciones municipales Espana", href: new URL("../../projects/migration-spain.html", import.meta.url).href }
];

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
  title: "Migraciones Espana y Europa",
  subtitle: "INE EMCR y Eurostat: saldos municipales espanoles y flujos internacionales por pais y region.",
  defaultView: "choropleth",
  defaultMetric: "netMigration",
  projectLinks,
  geography: { id: "spain-municipal", level: "municipio" },
  map: { center: [-8.5, 38.5], zoom: 3.25, pitch: 34, bearing: -8, bounds: [[-82, -35], [42, 62]], selectZoom: 9.5 },
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
    },
    {
      id: "flowDirection",
      label: "Direccion de flujos",
      defaultValue: "all",
      unitFilter: false,
      options: [
        { value: "all", label: "Flujos: todos" },
        { value: "to-spain", label: "Hacia Espana", flowTest: flow => flow.direction === "to-spain" },
        { value: "from-spain", label: "Desde Espana", flowTest: flow => flow.direction === "from-spain" },
        { value: "to-europe", label: "Hacia Europa", flowTest: flow => flow.direction === "to-europe" },
        { value: "from-europe", label: "Desde Europa", flowTest: flow => flow.direction === "from-europe" }
      ]
    },
    {
      id: "flowRegion",
      label: "Region de flujos",
      defaultValue: "all",
      unitFilter: false,
      options: [
        { value: "all", label: "Region: todas" },
        { value: "latin-america", label: "Latinoamerica", flowTest: flow => flow.region === "latin-america" },
        { value: "africa", label: "Africa", flowTest: flow => flow.region === "africa" },
        { value: "europe", label: "Europa", flowTest: flow => flow.region === "europe" },
        { value: "asia", label: "Asia", flowTest: flow => flow.region === "asia" },
        { value: "north-america", label: "Norteamerica", flowTest: flow => flow.region === "north-america" },
        { value: "oceania", label: "Oceania", flowTest: flow => flow.region === "oceania" }
      ]
    }
  ],
  allowHideNoData: true,
  visualizations: pickVisualizations(["choropleth", "points", "flows"]),
  uiText: {
    allCountries: "Toda Espana",
    countryLabel: "Ambito",
    countryHint: "Municipios espanoles con flujos exteriores agregados por pais y region.",
    searchPlaceholder: "Ej. Madrid, Barcelona, Valencia...",
    emptyDetail: "Selecciona un municipio o pasa el cursor por una flecha para ver detalle.",
    metricLabels: ["municipios", "maximo", "ambitos", "total visible"]
  },
  sources: [
    "INE EMCR: inmigraciones procedentes del extranjero y emigraciones con destino al extranjero.",
    "Eurostat: migr_imm5prv y migr_emi3nxt para flujos internacionales europeos.",
    "Geografia municipal: Eurostat/GISCO LAU 2024, filtrada a Espana.",
    "Los paises menores se agrupan por macro-region para mantener legibilidad."
  ],
  async load(app) {
    app.setStatus("Cargando migraciones oficiales...");
    const index = await fetchJson(new URL("index.json", base));
    app.metadata.index = index;
    const payload = await fetchJson(new URL(index.files[String(index.latestYear)], base));
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
