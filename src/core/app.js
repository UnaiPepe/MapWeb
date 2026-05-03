import { clamp, coordBounds, escapeHtml, fmt, searchText, squareAround } from "./utils.js";
import { runWorker } from "./worker-client.js";

const MAP_STYLE = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png"
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  },
  layers: [{
    id: "carto-base",
    type: "raster",
    source: "carto",
    minzoom: 0,
    maxzoom: 19,
    paint: { "raster-saturation": -0.1, "raster-contrast": 0.05 }
  }]
};

const DEFAULT_VIEW = { center: [9.5, 48.5], zoom: 3.45, pitch: 36, bearing: -12, bounds: [[-25, 34], [35, 72]] };
const MODE_LAYERS = {
  points: ["ga-points"],
  choropleth: ["ga-fill", "ga-borders"],
  heatmap: ["ga-heat"],
  cubes: ["ga-cubes"],
  grid: ["ga-grid-fill", "ga-grid-line"],
  bivariate: ["ga-bivariate"],
  flows: ["ga-flows", "ga-flow-arrows", "ga-flow-hit", "ga-flow-points"]
};

export function createGeoAnalyticsApp(project, options = {}) {
  return new GeoAnalyticsApp(project, options);
}

class GeoAnalyticsApp {
  constructor(project, options = {}) {
    this.project = project;
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : (options.root || document.body);
    this.state = {
      activeMode: project.defaultView || project.visualizations?.[0]?.id || "points",
      activeMetric: project.defaultMetric || project.metrics?.[0]?.id || "value",
      activeCountry: "all",
      activeRankMetric: project.defaultMetric || project.metrics?.[0]?.id || "value",
      filters: Object.fromEntries((project.filters || []).map(filter => [filter.id, filter.defaultValue ?? "all"])),
      hideNoData: false,
      selected: null,
      year: project.time?.defaultYear || project.time?.years?.at?.(-1) || null,
      feel: localStorage.getItem("mapFeelMode") || "static",
      cubeHeightMode: "medium",
      gridSizeMode: "medium"
    };
    this.allUnits = [];
    this.visibleUnits = [];
    this.unitsById = new Map();
    this.loadedCountries = new Map();
    this.loadedGeometry = null;
    this.flows = [];
    this.metadata = {};
    this.cache = new Map();
    this.metricStats = new Map();
    this.sourceKeys = new Map();
    this.hoveredId = "";
    this.flowPopup = null;
    this.map = null;
  }

  async init() {
    this.renderShell();
    this.setStatus("Preparando motor geoespacial...");
    this.map = this.createMap();
    await this.project.load(this);
    this.applyFilters();
    await new Promise(resolve => this.map.on("load", resolve));
    try { this.map.setProjection({ type: "globe" }); } catch {}
    this.drawCoreLayers();
    this.setupControls();
    this.updateAll();
    this.setMode(this.state.activeMode).catch(console.error);
    this.applyFeelMode(this.state.feel);
    this.prewarmModes();
  }

  renderShell() {
    document.title = this.project.title;
    this.root.innerHTML = `
      <div class="app">
        <aside>
          <header class="brand">
            <div class="brand-row">
              <div>
                <h1>${escapeHtml(this.project.title)}</h1>
                <p class="subtitle">${escapeHtml(this.project.subtitle || "")}</p>
              </div>
              <button data-action="collapse" class="icon-btn" title="Plegar panel" aria-label="Plegar panel">&lsaquo;</button>
            </div>
          </header>
          <section class="dashboard">
            ${this.renderProjectPanel()}
            ${this.renderStatusPanel()}
            ${this.renderMetricPanel()}
            ${this.renderFeelPanel()}
            ${this.renderSearchPanel()}
            ${this.renderCountryPanel()}
            ${this.renderTimePanel()}
            ${this.renderFilterPanel()}
            ${this.renderModePanel()}
            ${this.renderRankingPanel()}
            ${this.renderDetailPanel()}
            ${this.renderMapActions()}
          </section>
          <section class="panel sources">
            <span class="label">Fuentes</span>
            ${(this.project.sources || []).map(source => `<p>${escapeHtml(source)}</p>`).join("")}
          </section>
        </aside>
        <main>
          <div class="map" id="map"></div>
          <button data-action="expand" class="sidebar-fab">Mostrar panel</button>
          <div class="map-tools" aria-hidden="true">
            <div class="tool-chip">Mapa HD</div>
            <div class="tool-chip">Globo 3D suave</div>
            <div class="tool-chip motion-chip">Animaciones B</div>
          </div>
          <div class="map-legend">
            <div class="map-legend-title" data-role="legend-title">Leyenda</div>
            <div class="legend-steps" data-role="legend-steps"></div>
            <p class="legend-note" data-role="legend-note"></p>
          </div>
          <div class="failbox" data-role="failbox">
            <h2>No se pudieron cargar los datos</h2>
            <p>Comprueba que los assets del proyecto existen y que la web se sirve desde un servidor estatico.</p>
            <p>Prueba local: usa un servidor estatico y abre la ruta del proyecto.</p>
          </div>
        </main>
      </div>
    `;
  }

  renderStatusPanel() {
    const labels = this.project.uiText?.metricLabels || ["unidades", "maximo", "territorios", "total"];
    return `
      <div class="panel">
        <span class="label">Estado</span>
        <div class="status" data-role="status" aria-live="polite">Preparando...</div>
        <div class="metric-grid">
          <div class="metric"><b data-metric-card="units">-</b><span>${escapeHtml(labels[0])}</span></div>
          <div class="metric"><b data-metric-card="max">-</b><span>${escapeHtml(labels[1])}</span></div>
          <div class="metric"><b data-metric-card="groups">-</b><span>${escapeHtml(labels[2])}</span></div>
          <div class="metric"><b data-metric-card="total">-</b><span>${escapeHtml(labels[3])}</span></div>
        </div>
      </div>
    `;
  }

  renderProjectPanel() {
    if (!this.project.projectLinks?.length) return "";
    const current = this.project.id;
    return `
      <div class="panel">
        <label class="label" for="projectSwitch">Proyecto</label>
        <select id="projectSwitch">
          ${this.project.projectLinks.map(link => `<option value="${escapeHtml(link.href)}" ${link.id === current ? "selected" : ""}>${escapeHtml(link.label)}</option>`).join("")}
        </select>
        <p class="hint">El motor reutiliza controles, capas y carga bajo demanda entre visualizaciones.</p>
      </div>
    `;
  }

  renderMetricPanel() {
    if (!this.project.metrics?.length) return "";
    return `
      <div class="panel">
        <label class="label" for="activeMetric">Metrica activa</label>
        <select id="activeMetric">
          ${this.project.metrics.map(metric => `<option value="${escapeHtml(metric.id)}">${escapeHtml(metric.label)}</option>`).join("")}
        </select>
        <p data-role="metric-hint" class="hint"></p>
      </div>
    `;
  }

  renderFeelPanel() {
    return `
      <div class="panel">
        <span class="label">Feel visual</span>
        <div class="feel-switch" role="group" aria-label="Comparar version sin y con animaciones">
          <button class="feel-btn is-active" data-feel="static" aria-pressed="true"><strong>A</strong><span>Sin animaciones</span></button>
          <button class="feel-btn" data-feel="animated" aria-pressed="false"><strong>B</strong><span>Con animaciones</span></button>
        </div>
        <p data-role="feel-hint" class="hint">A mantiene la herramienta mas analitica y directa.</p>
      </div>
    `;
  }

  renderSearchPanel() {
    return `
      <div class="panel">
        <label class="label" for="searchBox">Buscar territorio</label>
        <div class="search-row">
          <input id="searchBox" placeholder="${escapeHtml(this.project.uiText?.searchPlaceholder || "Ej. Madrid, Paris, Berlin...")}" autocomplete="off" />
          <button data-action="search" title="Centrar territorio" aria-label="Centrar territorio">⌕</button>
        </div>
        <p data-role="search-hint" class="hint"></p>
      </div>
    `;
  }

  renderCountryPanel() {
    return `
      <div class="panel">
        <label class="label" for="countryFilter">${escapeHtml(this.project.uiText?.countryLabel || "Filtrar pais")}</label>
        <select id="countryFilter"><option value="all">Toda el area</option></select>
        <p class="hint">${escapeHtml(this.project.uiText?.countryHint || "El filtro reduce capas pesadas y ayuda a comparar territorios.")}</p>
      </div>
    `;
  }

  renderTimePanel() {
    if (!this.project.time?.years?.length) return "";
    const years = this.project.time.years;
    const min = Math.min(...years);
    const max = Math.max(...years);
    return `
      <div class="panel">
        <span class="label">${escapeHtml(this.project.time.label || "Periodo")}</span>
        <div class="range-row">
          <input type="range" data-role="year-range" min="${min}" max="${max}" step="1" value="${this.state.year}">
          <strong data-role="year-label">${this.state.year}</strong>
        </div>
      </div>
    `;
  }

  renderFilterPanel() {
    const filters = (this.project.filters || []).map(filter => `
      <select data-filter="${escapeHtml(filter.id)}" aria-label="${escapeHtml(filter.label)}">
        ${(filter.options || []).map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
      </select>
    `).join("");
    if (!filters && !this.project.allowHideNoData) return "";
    return `
      <div class="panel">
        <span class="label">Filtros</span>
        <div class="control-stack">
          ${filters}
          ${this.project.allowHideNoData ? `<label class="check-row"><input data-role="hide-no-data" type="checkbox" /> Ocultar sin datos</label>` : ""}
        </div>
      </div>
    `;
  }

  renderModePanel() {
    const hasCubes = this.project.visualizations?.some(mode => mode.id === "cubes");
    const hasGrid = this.project.visualizations?.some(mode => mode.id === "grid");
    return `
      <div class="panel modes-panel">
        <span class="label">Modo visual</span>
        <div class="mode-grid" role="tablist" aria-label="Modos de visualizacion">
          ${(this.project.visualizations || []).map(mode => `
            <button class="mode-btn ${mode.id === this.state.activeMode ? "is-active" : ""}" data-mode="${escapeHtml(mode.id)}" role="tab" aria-selected="${mode.id === this.state.activeMode}">
              <span>${escapeHtml(mode.icon || "●")}</span><span>${escapeHtml(mode.label)}</span>
            </button>
          `).join("")}
        </div>
        ${hasCubes || hasGrid ? `<div class="control-stack" style="margin-top: 10px;">
          ${hasCubes ? `<select data-role="cube-height" aria-label="Altura de cubos 3D">
            <option value="soft">Cubos: altura alta</option>
            <option value="medium" selected>Cubos: altura detalle</option>
            <option value="dramatic">Cubos: altura extrema</option>
          </select>` : ""}
          ${hasGrid ? `<select data-role="grid-size" aria-label="Tamaño de grid">
            <option value="fine">Grid fino</option>
            <option value="medium" selected>Grid medio</option>
            <option value="large">Grid grande</option>
          </select>` : ""}
        </div>` : ""}
        <p data-role="mode-hint" class="hint"></p>
      </div>
    `;
  }

  renderRankingPanel() {
    return `
      <div class="panel">
        <label class="label" for="rankMetric">Ranking</label>
        <select id="rankMetric">
          ${(this.project.metrics || []).map(metric => `<option value="${escapeHtml(metric.id)}">${escapeHtml(metric.label)}</option>`).join("")}
        </select>
        <p data-role="rank-title" class="hint"></p>
        <ol class="top-list" data-role="top-list"></ol>
      </div>
    `;
  }

  renderDetailPanel() {
    return `<div class="panel"><span class="label">Detalle</span><div data-role="detail" class="note">Selecciona una unidad para ver detalle.</div></div>`;
  }

  renderMapActions() {
    return `
      <div class="panel">
        <span class="label">Mapa</span>
        <div class="action-row">
          <button data-action="reset" class="action-btn">Volver</button>
          <button data-action="clear" class="action-btn">Limpiar seleccion</button>
        </div>
      </div>
    `;
  }

  createMap() {
    const view = { ...DEFAULT_VIEW, ...(this.project.map || {}) };
    const map = new maplibregl.Map({
      container: "map",
      style: MAP_STYLE,
      center: view.center,
      zoom: view.zoom,
      minZoom: view.minZoom ?? 2,
      maxZoom: view.maxZoom ?? 12,
      pitch: view.pitch,
      bearing: view.bearing,
      attributionControl: false,
      projection: { type: "globe" }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    return map;
  }

  setStatus(html) {
    this.root.querySelector("[data-role='status']").innerHTML = html;
  }

  setFailure(err) {
    console.error(err);
    this.setStatus(`<strong>Error:</strong> ${escapeHtml(err.message)}`);
    this.root.querySelector("[data-role='failbox']").style.display = "block";
  }

  metric(id = this.state.activeMetric) {
    return (this.project.metrics || []).find(metric => metric.id === id) || this.project.metrics?.[0] || { id, label: id, unit: "" };
  }

  metricValue(unit, id = this.state.activeMetric) {
    return Number(unit.metrics?.[id] ?? unit[id] ?? unit.properties?.[id] ?? 0);
  }

  metricFormatter(id = this.state.activeMetric) {
    const metric = this.metric(id);
    if (metric.formatter) return metric.formatter;
    return value => `${fmt(value, metric.decimals ?? 0)}${metric.unit ? ` ${metric.unit}` : ""}`;
  }

  maxMetric(id = this.state.activeMetric, units = this.visibleUnits) {
    if (units === this.visibleUnits && this.metricStats.has(id)) return this.metricStats.get(id).max;
    return Math.max(1, ...units.map(unit => Math.abs(this.metricValue(unit, id))).filter(Number.isFinite));
  }

  score(value, id = this.state.activeMetric) {
    const metric = this.metric(id);
    const stats = this.metricStats.get(id);
    const max = stats?.max ?? this.maxMetric(id);
    if (metric.scale === "diverging") {
      const abs = stats?.abs ?? Math.max(1, ...this.visibleUnits.map(unit => Math.abs(this.metricValue(unit, id))).filter(Number.isFinite));
      return clamp((Number(value) + abs) / (abs * 2), 0, 1);
    }
    return clamp(Math.log10(Math.max(0, Number(value)) + 1) / Math.log10(max + 1), 0, 1);
  }

  colorExpression() {
    const metric = this.metric();
    if (metric.scale === "diverging") {
      return ["interpolate", ["linear"], ["get", "score"],
        0, "#2359d6",
        0.47, "#eef4f0",
        0.53, "#ffd857",
        1, "#c71f28"
      ];
    }
    return ["interpolate", ["linear"], ["get", "score"],
      0, "#f8fff4",
      0.32, "#c6f27a",
      0.52, "#ffd857",
      0.72, "#f17745",
      1, "#c71f28"
    ];
  }

  normalizeUnit(raw, geometry = null) {
    const props = raw.properties || raw;
    const lon = Number(props.lon ?? props.centerLon ?? props.lng);
    const lat = Number(props.lat ?? props.centerLat);
    const id = props.id || props.code || raw.id;
    const unit = {
      id,
      code: id,
      name: props.name || id,
      country: props.country || "",
      countryName: props.countryName || props.country || "",
      level: props.level || this.project.geography?.level || "unit",
      lon,
      lat,
      area: Number(props.area || 0),
      source: props.source || "",
      hasData: props.hasData !== false,
      properties: { ...props },
      metrics: { ...(props.metrics || {}) }
    };
    for (const metric of this.project.metrics || []) {
      unit.metrics[metric.id] = Number(props.metrics?.[metric.id] ?? props[metric.id] ?? props[metric.sourceProperty] ?? 0);
    }
    if (props.population !== undefined) unit.metrics.population = Number(props.population || 0);
    if (props.density !== undefined) unit.metrics.density = Number(props.density || 0);
    if (geometry) unit.geometry = geometry;
    return unit;
  }

  applyFilters() {
    const pool = this.state.activeCountry === "all"
      ? this.allUnits
      : this.allUnits.filter(unit => unit.country === this.state.activeCountry);
    this.visibleUnits = pool.filter(unit => {
      if (this.state.hideNoData && unit.hasData === false) return false;
      for (const filter of this.project.filters || []) {
        if (filter.unitFilter === false) continue;
        const value = this.state.filters[filter.id] ?? filter.defaultValue ?? "all";
        const option = (filter.options || []).find(item => item.value === value);
        if (option?.test && !option.test(unit, this)) return false;
      }
      return true;
    });
    this.unitsById = new Map(this.visibleUnits.map(unit => [unit.id, unit]));
    this.rebuildMetricStats();
    for (const unit of this.visibleUnits) {
      unit.value = this.metricValue(unit);
      unit.score = this.score(unit.value);
      unit.populationScore = this.score(unit.metrics.population || 0, "population");
    }
  }

  rebuildMetricStats() {
    this.metricStats.clear();
    const ids = new Set((this.project.metrics || []).map(metric => metric.id));
    ids.add("population");
    for (const id of ids) {
      let max = 1;
      let abs = 1;
      for (const unit of this.visibleUnits) {
        const value = Number(this.metricValue(unit, id));
        if (!Number.isFinite(value)) continue;
        max = Math.max(max, Math.abs(value));
        abs = Math.max(abs, Math.abs(value));
      }
      this.metricStats.set(id, { max, abs });
    }
  }

  toPointGeoJson(units = this.visibleUnits) {
    return {
      type: "FeatureCollection",
      features: units.filter(unit => Number.isFinite(unit.lon) && Number.isFinite(unit.lat)).map(unit => ({
        type: "Feature",
        id: unit.id,
        geometry: { type: "Point", coordinates: [unit.lon, unit.lat] },
        properties: { ...this.featureProperties(unit), value: unit.value ?? this.metricValue(unit), score: unit.score ?? this.score(this.metricValue(unit)) }
      }))
    };
  }

  geometryGeoJson() {
    return {
      type: "FeatureCollection",
      features: this.visibleUnits.filter(unit => unit.geometry).map(unit => ({
        type: "Feature",
        id: unit.id,
        geometry: unit.geometry,
        properties: { ...this.featureProperties(unit), value: unit.value ?? this.metricValue(unit), score: unit.score ?? this.score(this.metricValue(unit)) }
      }))
    };
  }

  featureProperties(unit) {
    return {
      id: unit.id,
      code: unit.code || unit.id,
      name: unit.name,
      country: unit.country,
      countryName: unit.countryName,
      level: unit.level,
      lon: unit.lon,
      lat: unit.lat,
      area: unit.area,
      source: unit.source,
      hasData: unit.hasData,
      metrics: unit.metrics,
      population: unit.metrics?.population || 0,
      populationScore: unit.populationScore || 0,
      value: unit.value || 0,
      score: unit.score || 0
    };
  }

  async ensureGeometryForMode() {
    if (!this.project.ensureGeometry) return;
    await this.project.ensureGeometry(this, this.state.activeCountry);
    this.applyFilters();
  }

  cacheKey(kind) {
    return [
      this.project.id,
      kind,
      this.state.activeCountry,
      this.state.activeMetric,
      this.state.year ?? "",
      this.state.cubeHeightMode,
      this.state.gridSizeMode,
      JSON.stringify(this.state.filters),
      this.state.hideNoData,
      this.visibleUnits.length
    ].join("|");
  }

  drawCoreLayers() {
    this.map.addSource("ga-units", { type: "geojson", data: this.toPointGeoJson(), promoteId: "id" });
    this.map.addLayer({
      id: "ga-heat",
      type: "heatmap",
      source: "ga-units",
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0.06, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.75, 9, 1.8],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 13, 8, 32, 11, 58],
        "heatmap-opacity": 0.72,
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(248,255,244,0)",
          0.2, "#d5f7a6",
          0.42, "#ffd857",
          0.68, "#f17745",
          1, "#c71f28"
        ]
      }
    });
    this.map.addLayer({
      id: "ga-points",
      type: "circle",
      source: "ga-units",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 2.2, 0.5, 5.5, 1, 11],
        "circle-color": this.colorExpression(),
        "circle-opacity": 0.82,
        "circle-stroke-color": "rgba(19, 27, 23, 0.55)",
        "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0.55]
      }
    });
    this.map.addLayer({
      id: "ga-bivariate",
      type: "circle",
      source: "ga-units",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "populationScore"], 0, 3, 0.45, 8, 1, 20],
        "circle-color": this.colorExpression(),
        "circle-opacity": ["interpolate", ["linear"], ["get", "populationScore"], 0, 0.42, 1, 0.88],
        "circle-stroke-color": "#16241e",
        "circle-stroke-width": ["interpolate", ["linear"], ["get", "populationScore"], 0, 0.4, 1, 3.4]
      }
    });
    this.map.addLayer({
      id: "ga-selected",
      type: "circle",
      source: "ga-units",
      filter: ["==", ["get", "id"], ""],
      paint: {
        "circle-radius": 16,
        "circle-color": "rgba(35, 89, 214, 0.12)",
        "circle-stroke-color": "#2359d6",
        "circle-stroke-width": 2.5
      }
    });
    this.registerLayerEvents("ga-points");
    this.registerLayerEvents("ga-bivariate");
  }

  registerLayerEvents(layerId) {
    this.map.on("mouseenter", layerId, () => { this.map.getCanvas().style.cursor = "pointer"; });
    this.map.on("mouseleave", layerId, () => {
      this.map.getCanvas().style.cursor = "";
      if (this.hoveredId && this.map.getSource("ga-units")) {
        this.map.setFeatureState({ source: "ga-units", id: this.hoveredId }, { hover: false });
      }
      this.hoveredId = "";
    });
    this.map.on("mousemove", layerId, event => {
      const feature = event.features?.[0];
      if (!feature) return;
      const id = feature.properties.id || feature.properties.code;
      if (this.hoveredId && this.hoveredId !== id && this.map.getSource("ga-units")) {
        this.map.setFeatureState({ source: "ga-units", id: this.hoveredId }, { hover: false });
      }
      this.hoveredId = id;
      if (this.map.getSource("ga-units")) this.map.setFeatureState({ source: "ga-units", id }, { hover: true });
    });
    this.map.on("click", layerId, event => {
      const props = event.features?.[0]?.properties;
      const unit = this.unitFromProperties(props);
      if (unit) this.selectUnit(unit, { openPopup: true, fly: false, lngLat: event.lngLat });
    });
  }

  unitFromProperties(props) {
    if (!props) return null;
    return this.unitsById.get(props.id || props.code) || this.allUnits.find(unit => unit.id === (props.id || props.code)) || null;
  }

  async ensurePolygonLayer() {
    await this.ensureGeometryForMode();
    const data = this.geometryGeoJson();
    if (!this.map.getSource("ga-polygons")) {
      this.map.addSource("ga-polygons", { type: "geojson", data, promoteId: "id" });
      this.map.addLayer({
        id: "ga-fill",
        type: "fill",
        source: "ga-polygons",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["case", ["boolean", ["get", "hasData"], true], this.colorExpression(), "#d8dddc"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.86, 0.62]
        }
      }, "ga-heat");
      this.map.addLayer({
        id: "ga-borders",
        type: "line",
        source: "ga-polygons",
        layout: { visibility: "none" },
        paint: {
          "line-color": "rgba(17, 23, 20, 0.42)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.18, 9, 0.85, 12, 1.6]
        }
      });
      this.map.addLayer({
        id: "ga-selected-fill",
        type: "line",
        source: "ga-polygons",
        filter: ["==", ["get", "id"], ""],
        paint: { "line-color": "#2359d6", "line-width": 3 }
      });
      this.registerPolygonEvents();
    } else {
      this.map.getSource("ga-polygons").setData(data);
    }
  }

  registerPolygonEvents() {
    this.map.on("mouseenter", "ga-fill", () => { this.map.getCanvas().style.cursor = "pointer"; });
    this.map.on("mouseleave", "ga-fill", () => { this.map.getCanvas().style.cursor = ""; });
    this.map.on("click", "ga-fill", event => {
      const unit = this.unitFromProperties(event.features?.[0]?.properties);
      if (unit) this.selectUnit(unit, { openPopup: true, fly: false, lngLat: event.lngLat });
    });
  }

  cubeHeightMax() {
    if (this.state.cubeHeightMode === "soft") return 50000;
    if (this.state.cubeHeightMode === "dramatic") return 240000;
    return 130000;
  }

  gridCellSize() {
    if (this.state.gridSizeMode === "fine") return 0.26;
    if (this.state.gridSizeMode === "large") return 0.72;
    return 0.42;
  }

  async buildCubes() {
    const key = this.cacheKey("cubes");
    if (this.cache.has(key)) return this.cache.get(key);
    const units = this.visibleUnits.filter(unit => unit.hasData !== false);
    const workerUnits = units.map(unit => this.workerUnit(unit));
    const payload = {
      units: workerUnits,
      metricId: this.state.activeMetric,
      maxMetric: this.maxMetric(),
      maxPopulation: this.maxMetric("population", units),
      heightMax: this.cubeHeightMax()
    };
    let data;
    try {
      data = await runWorker("cubes", payload);
    } catch {
      data = this.buildCubesSync(payload);
    }
    this.cache.set(key, data);
    return data;
  }

  buildCubesSync({ units, metricId, maxMetric, maxPopulation, heightMax }) {
    const score = value => clamp(Math.log10(Number(value || 0) + 1) / Math.log10(Number(maxMetric || 1) + 1), 0, 1);
    const popScore = value => clamp(Math.log10(Number(value || 0) + 1) / Math.log10(Number(maxPopulation || 1) + 1), 0, 1);
    return {
      type: "FeatureCollection",
      features: units.map(unit => {
        const value = this.metricValue(unit, metricId);
        const s = score(value);
        const p = popScore(unit.metrics.population || 0);
        const areaSide = Number(unit.area) > 0 ? Math.sqrt(Number(unit.area)) : 1;
        const footprintKm = clamp((0.65 + clamp(areaSide * 0.08, 0.35, 2.4) + Math.pow(p, 1.55) * 5.2) * (1 - s * 0.34), 0.45, 6.4);
        return {
          type: "Feature",
          id: unit.id,
          geometry: { type: "Polygon", coordinates: squareAround(unit.lon, unit.lat, footprintKm) },
          properties: { ...this.featureProperties(unit), value, score: s, populationScore: p, footprintKm, height: Math.round(1200 + Math.pow(s, 1.18) * heightMax) }
        };
      })
    };
  }

  async ensureCubeLayer() {
    const data = await this.buildCubes();
    if (!this.map.getSource("ga-cubes")) {
      this.map.addSource("ga-cubes", { type: "geojson", data, promoteId: "id" });
      this.map.addLayer({
        id: "ga-cubes",
        type: "fill-extrusion",
        source: "ga-cubes",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": this.colorExpression(),
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.78
        }
      });
      this.registerLayerEvents("ga-cubes");
    } else {
      this.map.getSource("ga-cubes").setData(data);
    }
  }

  async buildGrid() {
    const key = this.cacheKey("grid");
    if (this.cache.has(key)) return this.cache.get(key);
    const payload = {
      units: this.visibleUnits.filter(unit => unit.hasData !== false).map(unit => this.workerUnit(unit)),
      cell: this.gridCellSize(),
      metricId: this.state.activeMetric,
      maxMetric: this.maxMetric()
    };
    let data;
    try {
      data = await runWorker("grid", payload);
    } catch {
      data = this.buildGridSync(payload);
    }
    this.cache.set(key, data);
    return data;
  }

  buildGridSync({ units, cell, metricId, maxMetric }) {
    const cells = new Map();
    for (const unit of units) {
      const x = Math.floor(unit.lon / cell);
      const y = Math.floor(unit.lat / cell);
      const key = `${x}:${y}`;
      const prev = cells.get(key) || { x, y, value: 0, count: 0, area: 0, population: 0 };
      prev.value += this.metricValue(unit, metricId);
      prev.count += 1;
      prev.area += Number(unit.area || 0);
      prev.population += Number(unit.metrics.population || 0);
      cells.set(key, prev);
    }
    return {
      type: "FeatureCollection",
      features: [...cells.values()].map(cellData => {
        const west = cellData.x * cell;
        const south = cellData.y * cell;
        const value = cellData.value / Math.max(1, cellData.count);
        return {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[west, south], [west + cell, south], [west + cell, south + cell], [west, south + cell], [west, south]]] },
          properties: { id: `${cellData.x}:${cellData.y}`, name: `${cellData.count} unidades`, value, score: clamp(Math.log10(Math.abs(value) + 1) / Math.log10(maxMetric + 1), 0, 1), population: cellData.population, area: cellData.area, count: cellData.count }
        };
      })
    };
  }

  workerUnit(unit) {
    return {
      id: unit.id,
      name: unit.name,
      country: unit.country,
      countryName: unit.countryName,
      lon: unit.lon,
      lat: unit.lat,
      area: unit.area,
      hasData: unit.hasData,
      source: unit.source,
      metrics: { ...unit.metrics },
      population: unit.metrics.population || unit.population || 0
    };
  }

  async ensureGridLayer() {
    const data = await this.buildGrid();
    if (!this.map.getSource("ga-grid")) {
      this.map.addSource("ga-grid", { type: "geojson", data });
      this.map.addLayer({
        id: "ga-grid-fill",
        type: "fill",
        source: "ga-grid",
        layout: { visibility: "none" },
        paint: {
          "fill-color": this.colorExpression(),
          "fill-opacity": ["interpolate", ["linear"], ["get", "score"], 0, 0.18, 1, 0.78]
        }
      }, "ga-heat");
      this.map.addLayer({
        id: "ga-grid-line",
        type: "line",
        source: "ga-grid",
        layout: { visibility: "none" },
        paint: { "line-color": "rgba(17, 23, 20, 0.28)", "line-width": 0.55 }
      });
    } else {
      this.map.getSource("ga-grid").setData(data);
    }
  }

  flowPassesFilters(flow) {
    for (const filter of this.project.filters || []) {
      const value = this.state.filters[filter.id] ?? filter.defaultValue ?? "all";
      const option = (filter.options || []).find(item => item.value === value);
      if (option?.flowTest && !option.flowTest(flow, this)) return false;
    }
    return true;
  }

  flowEndpoint(flow, key, byId) {
    const explicit = flow[key];
    if (explicit && Number.isFinite(Number(explicit.lon)) && Number.isFinite(Number(explicit.lat))) {
      return {
        id: explicit.id || flow[`${key}Id`] || "",
        name: explicit.name || explicit.id || "",
        lon: Number(explicit.lon),
        lat: Number(explicit.lat),
        type: explicit.type || "external",
        region: explicit.region || ""
      };
    }
    const unit = byId.get(flow[`${key}Id`]);
    if (!unit) return null;
    return {
      id: unit.id,
      name: unit.name,
      lon: Number(unit.lon),
      lat: Number(unit.lat),
      type: unit.level || "unit",
      region: unit.countryName || unit.country || ""
    };
  }

  flowCurve(origin, destination, score, index) {
    const start = [origin.lon, origin.lat];
    const end = [destination.lon, destination.lat];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance <= 0) return [start, end];
    const sign = index % 2 === 0 ? 1 : -1;
    const bend = clamp(distance * (0.12 + score * 0.16), 0.35, 12) * sign;
    const nx = -dy / distance;
    const ny = dx / distance;
    const control = [
      (start[0] + end[0]) / 2 + nx * bend,
      (start[1] + end[1]) / 2 + ny * bend
    ];
    const coords = [];
    for (let i = 0; i <= 32; i += 1) {
      const t = i / 32;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      coords.push([
        a * start[0] + b * control[0] + c * end[0],
        a * start[1] + b * control[1] + c * end[1]
      ]);
    }
    return coords;
  }

  flowGeoJson() {
    const byId = new Map(this.allUnits.map(unit => [unit.id, unit]));
    const flows = (this.flows || []).filter(flow => {
      if (this.state.year && flow.year && Number(flow.year) !== Number(this.state.year)) return false;
      return this.flowPassesFilters(flow);
    });
    const max = Math.max(1, ...flows.map(flow => Math.abs(Number(flow.value || 0))));
    return {
      type: "FeatureCollection",
      features: flows.map((flow, index) => {
        const origin = this.flowEndpoint(flow, "origin", byId);
        const destination = this.flowEndpoint(flow, "destination", byId);
        if (!origin || !destination) return null;
        const score = clamp(Number(flow.value || 0) / max, 0, 1);
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: this.flowCurve(origin, destination, score, index) },
          properties: {
            id: flow.id || `${origin.id}-${destination.id}-${index}`,
            originId: origin.id,
            destinationId: destination.id,
            originName: origin.name,
            destinationName: destination.name,
            direction: flow.direction || "",
            category: flow.category || "",
            region: flow.region || "",
            source: flow.source || "",
            year: flow.year || "",
            type: flow.type || "flow",
            value: Number(flow.value || 0),
            score,
            name: flow.name || `${origin.name} -> ${destination.name}`
          }
        };
      }).filter(Boolean)
    };
  }

  async ensureFlowLayer() {
    const data = this.flowGeoJson();
    if (!this.map.getSource("ga-flow-source")) {
      this.map.addSource("ga-flow-source", { type: "geojson", data });
      this.map.addLayer({
        id: "ga-flows",
        type: "line",
        source: "ga-flow-source",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["interpolate", ["linear"], ["get", "score"], 0, "#2359d6", 1, "#c71f28"],
          "line-width": ["interpolate", ["linear"], ["get", "score"], 0, 0.8, 1, 7],
          "line-opacity": 0.72
        }
      });
      this.map.addLayer({
        id: "ga-flow-hit",
        type: "line",
        source: "ga-flow-source",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "rgba(0,0,0,0)",
          "line-width": 18,
          "line-opacity": 0
        }
      });
      this.map.addLayer({
        id: "ga-flow-arrows",
        type: "symbol",
        source: "ga-flow-source",
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "symbol-spacing": 120,
          "text-field": ">",
          "text-size": ["interpolate", ["linear"], ["get", "score"], 0, 12, 1, 20],
          "text-keep-upright": false,
          "text-allow-overlap": true,
          "text-ignore-placement": true
        },
        paint: {
          "text-color": ["interpolate", ["linear"], ["get", "score"], 0, "#2359d6", 1, "#c71f28"],
          "text-halo-color": "rgba(255,255,255,0.82)",
          "text-halo-width": 1.4,
          "text-opacity": 0.86
        }
      });
      this.map.addLayer({
        id: "ga-flow-points",
        type: "circle",
        source: "ga-units",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 3, 1, 12],
          "circle-color": this.colorExpression(),
          "circle-opacity": 0.72,
          "circle-stroke-color": "#16241e",
          "circle-stroke-width": 0.8
        }
      });
      this.registerFlowEvents();
    } else {
      this.map.getSource("ga-flow-source").setData(data);
    }
  }

  flowPopupHtml(props) {
    const value = this.metricFormatter("inMigration")(Number(props.value || 0));
    const rows = [
      ["Origen", props.originName || "-"],
      ["Destino", props.destinationName || "-"],
      ["Personas", value],
      ["Direccion", props.direction || "-"],
      ["Categoria", props.category || props.region || "-"],
      ["Ano", props.year || "-"],
      ["Fuente", props.source || "-"]
    ];
    return `
      <div class="popup-title">${escapeHtml(props.name || "Flujo migratorio")}</div>
      ${rows.map(([label, rowValue]) => `<div class="popup-row"><span>${escapeHtml(label)}:</span> ${escapeHtml(rowValue)}</div>`).join("")}
    `;
  }

  registerFlowEvents() {
    this.map.on("mouseenter", "ga-flow-hit", () => { this.map.getCanvas().style.cursor = "pointer"; });
    this.map.on("mouseleave", "ga-flow-hit", () => {
      this.map.getCanvas().style.cursor = "";
      if (this.flowPopup) {
        this.flowPopup.remove();
        this.flowPopup = null;
      }
    });
    this.map.on("mousemove", "ga-flow-hit", event => {
      const props = event.features?.[0]?.properties;
      if (!props) return;
      if (!this.flowPopup) {
        this.flowPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      }
      this.flowPopup
        .setLngLat(event.lngLat)
        .setHTML(this.flowPopupHtml(props))
        .addTo(this.map);
    });
  }

  async setMode(mode) {
    this.state.activeMode = mode;
    this.root.querySelectorAll(".mode-btn").forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    const config = this.project.visualizations.find(item => item.id === mode);
    this.root.querySelector("[data-role='mode-hint']").textContent = config?.hint || "";
    if (mode === "choropleth") await this.ensurePolygonLayer();
    if (mode === "cubes") await this.ensureCubeLayer();
    if (mode === "grid") await this.ensureGridLayer();
    if (mode === "flows") await this.ensureFlowLayer();
    Object.values(MODE_LAYERS).flat().forEach(id => {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", "none");
    });
    (MODE_LAYERS[mode] || MODE_LAYERS.points).forEach(id => {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", "visible");
    });
    if (this.map.getLayer("ga-selected-fill")) {
      this.map.setLayoutProperty("ga-selected-fill", "visibility", mode === "choropleth" ? "visible" : "none");
    }
    if (mode === "cubes") {
      this.map.easeTo({ pitch: window.innerWidth < 620 ? 44 : 62, bearing: -18, duration: this.cameraDuration(650) });
    } else if (mode === "heatmap") {
      this.map.easeTo({ pitch: 18, bearing: 0, duration: this.cameraDuration(650) });
    } else {
      this.map.easeTo({ pitch: window.innerWidth < 620 ? 22 : 36, bearing: -8, duration: this.cameraDuration(650) });
    }
    this.updateLegend();
  }

  refreshSources() {
    this.applyFilters();
    if (this.map.getSource("ga-units")) this.map.getSource("ga-units").setData(this.toPointGeoJson());
    if (this.map.getSource("ga-polygons")) this.map.getSource("ga-polygons").setData(this.geometryGeoJson());
    if (this.map.getSource("ga-flow-source")) this.map.getSource("ga-flow-source").setData(this.flowGeoJson());
    this.updateMetricPaint();
    this.cache.clear();
  }

  updateAll() {
    this.refreshSources();
    this.updateCountryOptions();
    this.updateMetricsPanel();
    this.updateRanking();
    this.updateDetail();
    this.updateLegend();
    this.updateMetricControl();
    const metricSelect = this.root.querySelector("#rankMetric");
    if (metricSelect) metricSelect.value = this.state.activeRankMetric;
    this.setStatus(`Datos cargados. <strong>${fmt(this.visibleUnits.length)}</strong> unidades visibles.`);
  }

  updateMetricControl() {
    const select = this.root.querySelector("#activeMetric");
    if (select) select.value = this.state.activeMetric;
    const hint = this.root.querySelector("[data-role='metric-hint']");
    const metric = this.metric();
    if (hint) hint.textContent = `${metric.label} controla color, tamanos, leyenda y seleccion actual.`;
  }

  updateMetricPaint() {
    if (!this.map) return;
    const color = this.colorExpression();
    if (this.map.getLayer("ga-points")) this.map.setPaintProperty("ga-points", "circle-color", color);
    if (this.map.getLayer("ga-bivariate")) this.map.setPaintProperty("ga-bivariate", "circle-color", color);
    if (this.map.getLayer("ga-flow-points")) this.map.setPaintProperty("ga-flow-points", "circle-color", color);
    if (this.map.getLayer("ga-cubes")) this.map.setPaintProperty("ga-cubes", "fill-extrusion-color", color);
    if (this.map.getLayer("ga-fill")) {
      this.map.setPaintProperty("ga-fill", "fill-color", ["case", ["boolean", ["get", "hasData"], true], color, "#d8dddc"]);
    }
    if (this.map.getLayer("ga-grid-fill")) this.map.setPaintProperty("ga-grid-fill", "fill-color", color);
  }

  updateCountryOptions() {
    const select = this.root.querySelector("#countryFilter");
    if (!select || select.dataset.ready) return;
    const countries = [...new Map(this.allUnits.map(unit => [unit.country, unit.countryName || unit.country])).entries()]
      .filter(([code]) => code)
      .sort((a, b) => a[1].localeCompare(b[1]));
    select.innerHTML = `<option value="all">${escapeHtml(this.project.uiText?.allCountries || "Toda el area")}</option>` +
      countries.map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} (${escapeHtml(code)})</option>`).join("");
    select.dataset.ready = "true";
  }

  updateMetricsPanel() {
    const metric = this.metric();
    const values = this.visibleUnits.map(unit => this.metricValue(unit)).filter(Number.isFinite);
    const total = values.reduce((sum, value) => sum + value, 0);
    this.root.querySelector("[data-metric-card='units']").textContent = fmt(this.visibleUnits.length);
    this.root.querySelector("[data-metric-card='max']").textContent = this.metricFormatter()(Math.max(0, ...values));
    this.root.querySelector("[data-metric-card='groups']").textContent = fmt(new Set(this.visibleUnits.map(unit => unit.country)).size);
    this.root.querySelector("[data-metric-card='total']").textContent = metric.total === "sum" ? this.metricFormatter()(total) : fmt(total, 0);
  }

  sortedForRanking(metricId = this.state.activeRankMetric) {
    return [...this.visibleUnits]
      .filter(unit => unit.hasData !== false && Number.isFinite(this.metricValue(unit, metricId)))
      .sort((a, b) => this.metricValue(b, metricId) - this.metricValue(a, metricId));
  }

  rankOf(unit, metricId = this.state.activeRankMetric, pool = this.allUnits) {
    const ranked = [...pool]
      .filter(item => item.hasData !== false && Number.isFinite(this.metricValue(item, metricId)))
      .sort((a, b) => this.metricValue(b, metricId) - this.metricValue(a, metricId));
    const idx = ranked.findIndex(item => item.id === unit.id);
    if (idx < 0) return { rank: null, total: ranked.length, percentile: null };
    const percentile = ranked.length > 1 ? Math.round((1 - idx / (ranked.length - 1)) * 100) : 100;
    return { rank: idx + 1, total: ranked.length, percentile };
  }

  updateRanking() {
    const metric = this.metric(this.state.activeRankMetric);
    this.root.querySelector("[data-role='rank-title']").textContent =
      `Ranking ${this.state.activeCountry === "all" ? "global" : "territorial"} por ${metric.label}.`;
    const format = this.metricFormatter(this.state.activeRankMetric);
    const items = this.sortedForRanking(this.state.activeRankMetric).slice(0, 10);
    const list = this.root.querySelector("[data-role='top-list']");
    list.innerHTML = items.map(unit =>
      `<li data-id="${escapeHtml(unit.id)}"><strong>${escapeHtml(unit.name)}</strong>: ${escapeHtml(format(this.metricValue(unit, this.state.activeRankMetric)))}</li>`
    ).join("");
    list.querySelectorAll("li").forEach(item => {
      item.addEventListener("click", () => {
        const unit = this.allUnits.find(candidate => candidate.id === item.dataset.id);
        if (unit) this.selectUnit(unit, { openPopup: true, fly: true });
      });
    });
  }

  updateLegend() {
    const metric = this.metric();
    this.root.querySelector("[data-role='legend-title']").textContent = metric.label;
    const steps = metric.scale === "diverging"
      ? [["#2359d6", "baja"], ["#a9c7ef", "-"], ["#eef4f0", "0"], ["#ffd857", "+"], ["#c71f28", "alta"]]
      : [["#f8fff4", "baja"], ["#c6f27a", "media"], ["#ffd857", "alta"], ["#f17745", "muy alta"], ["#c71f28", "extrema"]];
    this.root.querySelector("[data-role='legend-steps']").innerHTML = steps.map(([color, label]) =>
      `<div class="legend-step"><span class="legend-swatch" style="background:${color}"></span>${escapeHtml(label)}</div>`
    ).join("");
    const mode = this.project.visualizations.find(item => item.id === this.state.activeMode);
    this.root.querySelector("[data-role='legend-note']").textContent = mode?.legend || mode?.hint || "";
  }

  updateDetail(unit = this.state.selected) {
    const el = this.root.querySelector("[data-role='detail']");
    if (!unit) {
      el.innerHTML = this.project.uiText?.emptyDetail || "Selecciona una unidad para ver ranking, percentil y fuente.";
      return;
    }
    const globalRank = this.rankOf(unit, this.state.activeRankMetric, this.allUnits);
    const localRank = this.rankOf(unit, this.state.activeRankMetric, this.allUnits.filter(item => item.country === unit.country));
    const metric = this.metric(this.state.activeRankMetric);
    const rows = [
      [unit.countryName || unit.country || "-", "territorio"],
      [this.metricFormatter(this.state.activeMetric)(this.metricValue(unit)), this.metric().label],
      [this.metricFormatter(this.state.activeRankMetric)(this.metricValue(unit, this.state.activeRankMetric)), metric.label],
      [unit.area ? `${fmt(unit.area, 1)} km2` : "-", "superficie"],
      [globalRank.rank ? `${fmt(globalRank.rank)} / ${fmt(globalRank.total)}` : "-", "ranking global"],
      [localRank.rank ? `${fmt(localRank.rank)} / ${fmt(localRank.total)}` : "-", "ranking local"],
      [globalRank.percentile ?? "-", "percentil"],
      [unit.source || unit.properties?.source || "-", "fuente"]
    ];
    el.innerHTML = `
      <div class="popup-title">${escapeHtml(unit.name)}</div>
      <div class="detail-grid">
        ${rows.map(([value, label]) => `<div class="detail-item"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("")}
      </div>
    `;
  }

  popupHtml(unit) {
    const format = this.metricFormatter();
    const rows = [
      ["Territorio", unit.countryName || unit.country || "-"],
      [this.metric().label, format(this.metricValue(unit))],
      ["Superficie", unit.area ? `${fmt(unit.area, 2)} km2` : "-"],
      ["Codigo", unit.id],
      ["Fuente", unit.source || unit.properties?.source || "-"]
    ];
    return `
      <div class="popup-title">${escapeHtml(unit.name)}</div>
      ${rows.map(([label, value]) => `<div class="popup-row"><span>${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`).join("")}
    `;
  }

  selectUnit(unit, options = {}) {
    this.state.selected = unit;
    if (this.map.getLayer("ga-selected")) this.map.setFilter("ga-selected", ["==", ["get", "id"], unit.id]);
    if (this.map.getLayer("ga-selected-fill")) this.map.setFilter("ga-selected-fill", ["==", ["get", "id"], unit.id]);
    this.updateDetail(unit);
    if (options.fly !== false && Number.isFinite(unit.lon) && Number.isFinite(unit.lat)) {
      const camera = {
        center: [unit.lon, unit.lat],
        zoom: Math.max(this.map.getZoom(), this.project.map?.selectZoom || 8.7),
        pitch: this.state.activeMode === "cubes" ? 62 : 46,
        bearing: -8,
        essential: true
      };
      if (this.state.feel === "animated") this.map.flyTo({ ...camera, speed: 0.9, curve: 1.35 });
      else this.map.jumpTo(camera);
    }
    this.pulseSelection();
    if (options.openPopup) {
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14 })
        .setLngLat(options.lngLat || [unit.lon, unit.lat])
        .setHTML(this.popupHtml(unit))
        .addTo(this.map);
    }
  }

  clearSelection() {
    this.state.selected = null;
    if (this.map.getLayer("ga-selected")) this.map.setFilter("ga-selected", ["==", ["get", "id"], ""]);
    if (this.map.getLayer("ga-selected-fill")) this.map.setFilter("ga-selected-fill", ["==", ["get", "id"], ""]);
    this.updateDetail(null);
  }

  async search() {
    const input = this.root.querySelector("#searchBox");
    const hint = this.root.querySelector("[data-role='search-hint']");
    const query = searchText(input.value.trim());
    if (!query) return;
    let unit = null;
    const aliases = this.project.searchAliases || {};
    if (aliases[query]) unit = this.allUnits.find(item => item.id === aliases[query]);
    const pool = this.state.activeCountry === "all" ? this.allUnits : this.visibleUnits;
    unit ||= pool.find(item => searchText(item.name) === query);
    unit ||= pool.find(item => searchText(item.name).includes(query));
    unit ||= this.allUnits.find(item => searchText(item.name) === query || searchText(item.name).includes(query));
    if (!unit) {
      hint.textContent = "No encuentro ese territorio en el dataset cargado.";
      return;
    }
    if (this.state.activeCountry !== "all" && unit.country !== this.state.activeCountry) {
      this.state.activeCountry = unit.country;
      const select = this.root.querySelector("#countryFilter");
      if (select) select.value = unit.country;
      if (this.project.onCountryChange) await this.project.onCountryChange(this, unit.country);
      this.applyFilters();
      this.refreshSources();
    }
    hint.textContent = `${unit.name}: ${this.metricFormatter()(this.metricValue(unit))}.`;
    if (this.state.activeMode === "heatmap") await this.setMode("points");
    this.selectUnit(unit, { openPopup: true, fly: true });
  }

  setupControls() {
    this.root.querySelector("[data-action='collapse']").addEventListener("click", () => document.body.classList.add("sidebar-collapsed"));
    this.root.querySelector("[data-action='expand']").addEventListener("click", () => document.body.classList.remove("sidebar-collapsed"));
    this.root.querySelector("[data-action='search']").addEventListener("click", () => this.search());
    this.root.querySelector("#searchBox").addEventListener("keydown", event => { if (event.key === "Enter") this.search(); });
    this.root.querySelector("[data-action='reset']").addEventListener("click", () => {
      const view = { ...DEFAULT_VIEW, ...(this.project.map || {}) };
      this.map.fitBounds(view.bounds || DEFAULT_VIEW.bounds, { padding: 28, duration: this.cameraDuration(700) });
    });
    this.root.querySelector("[data-action='clear']").addEventListener("click", () => this.clearSelection());
    const projectSwitch = this.root.querySelector("#projectSwitch");
    if (projectSwitch) projectSwitch.addEventListener("change", event => {
      window.location.href = event.target.value;
    });

    this.root.querySelector("#countryFilter").addEventListener("change", async event => {
      this.state.activeCountry = event.target.value;
      this.setStatus("Cargando territorio...");
      if (this.project.onCountryChange) await this.project.onCountryChange(this, this.state.activeCountry);
      this.updateAll();
      await this.setMode(this.state.activeMode);
    });

    this.root.querySelectorAll("[data-filter]").forEach(select => {
      select.addEventListener("change", () => {
        this.state.filters[select.dataset.filter] = select.value;
        this.updateAll();
        this.setMode(this.state.activeMode).catch(console.error);
      });
    });
    const hide = this.root.querySelector("[data-role='hide-no-data']");
    if (hide) hide.addEventListener("change", () => {
      this.state.hideNoData = hide.checked;
      this.updateAll();
      this.setMode(this.state.activeMode).catch(console.error);
    });
    this.root.querySelector("#rankMetric").addEventListener("change", event => {
      this.state.activeRankMetric = event.target.value;
      this.updateRanking();
      this.updateDetail();
    });
    const activeMetric = this.root.querySelector("#activeMetric");
    if (activeMetric) activeMetric.addEventListener("change", async event => {
      this.state.activeMetric = event.target.value;
      this.state.activeRankMetric = event.target.value;
      this.cache.clear();
      this.updateAll();
      await this.setMode(this.state.activeMode);
    });
    this.root.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", () => this.setMode(btn.dataset.mode).catch(err => this.setFailure(err)));
    });
    const cubeHeight = this.root.querySelector("[data-role='cube-height']");
    if (cubeHeight) cubeHeight.addEventListener("change", async event => {
      this.state.cubeHeightMode = event.target.value;
      this.cache.clear();
      if (this.map.getSource("ga-cubes")) this.map.getSource("ga-cubes").setData(await this.buildCubes());
      this.updateLegend();
    });
    const gridSize = this.root.querySelector("[data-role='grid-size']");
    if (gridSize) gridSize.addEventListener("change", async event => {
      this.state.gridSizeMode = event.target.value;
      this.cache.clear();
      if (this.map.getSource("ga-grid")) this.map.getSource("ga-grid").setData(await this.buildGrid());
      this.updateLegend();
    });
    const range = this.root.querySelector("[data-role='year-range']");
    if (range) range.addEventListener("input", async event => {
      this.state.year = Number(event.target.value);
      this.root.querySelector("[data-role='year-label']").textContent = this.state.year;
      if (this.project.onYearChange) await this.project.onYearChange(this, this.state.year);
      this.updateAll();
      await this.setMode(this.state.activeMode);
    });
    this.setupFeelControls();
  }

  setupFeelControls() {
    this.root.querySelectorAll(".feel-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.applyFeelMode(btn.dataset.feel);
        if (this.state.feel === "animated") this.playFeelIntro();
      });
    });
    const main = this.root.querySelector("main");
    main.addEventListener("pointermove", event => {
      if (this.state.feel !== "animated") return;
      const rect = main.getBoundingClientRect();
      main.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
      main.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
      main.classList.add("is-pointer-active");
    });
    main.addEventListener("pointerleave", () => main.classList.remove("is-pointer-active"));
  }

  applyFeelMode(mode) {
    this.state.feel = mode === "animated" ? "animated" : "static";
    localStorage.setItem("mapFeelMode", this.state.feel);
    document.body.classList.toggle("feel-animated", this.state.feel === "animated");
    document.body.classList.toggle("feel-static", this.state.feel !== "animated");
    this.root.querySelectorAll(".feel-btn").forEach(btn => {
      const active = btn.dataset.feel === this.state.feel;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    const hint = this.root.querySelector("[data-role='feel-hint']");
    if (hint) hint.textContent = this.state.feel === "animated"
      ? "B activa entradas escalonadas, microinteracciones y camara suave."
      : "A mantiene la herramienta mas analitica y directa.";
  }

  playFeelIntro() {
    this.root.querySelectorAll(".panel").forEach((panel, i) => {
      panel.style.setProperty("--stagger", i);
      panel.style.animation = "none";
      panel.offsetHeight;
      panel.style.animation = "";
    });
  }

  pulseSelection() {
    if (this.state.feel !== "animated") return;
    const pulse = document.createElement("div");
    pulse.className = "selection-pulse";
    this.root.querySelector("main").appendChild(pulse);
    pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
  }

  cameraDuration(ms) {
    return this.state.feel === "animated" ? ms : 0;
  }

  prewarmModes() {
    const limit = this.project.prewarmLimit ?? 18000;
    if (this.project.prewarm === false || this.visibleUnits.length > limit) return;
    const run = async () => {
      try {
        if (this.project.visualizations.some(item => item.id === "cubes")) await this.ensureCubeLayer();
        if (this.project.visualizations.some(item => item.id === "grid")) await this.ensureGridLayer();
        Object.values(MODE_LAYERS).flat().forEach(id => {
          if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", "none");
        });
        await this.setMode(this.state.activeMode);
      } catch (err) {
        console.warn("Prewarm skipped", err);
      }
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 });
    else window.setTimeout(run, 900);
  }

  setUnits(units, geometryFeatures = null) {
    this.allUnits = units;
    if (geometryFeatures) {
      const geometryById = new Map(geometryFeatures.map(feature => [feature.id || feature.properties?.id || feature.properties?.code, feature]));
      for (const unit of this.allUnits) {
        const feature = geometryById.get(unit.id);
        if (feature) unit.geometry = feature.geometry;
      }
    }
  }
}
