# Motor estatico geoespacial

Este repositorio ya no contiene una unica web acoplada al dataset de densidad. La app se organiza como un motor estatico que puede levantar distintas webs analiticas en GitHub Pages.

## Crear un proyecto nuevo

1. Crea un archivo en `src/projects/<id>.js`.
2. Exporta un `ProjectConfig` con:
   - `id`, `title`, `subtitle`
   - `defaultView`, `defaultMetric`
   - `metrics`, `filters`, `visualizations`
   - `load(app)` para cargar unidades normalizadas
   - opcionalmente `ensureGeometry(app, country)` y `onYearChange(app, year)`
3. Crea una ruta HTML minima en `projects/<id>.html`.
4. Coloca los assets bajo `data/geographies/` o `data/projects/`.

## Formato de unidad normalizada

Cada unidad debe poder convertirse a:

```js
{
  id,
  name,
  country,
  countryName,
  level,
  lon,
  lat,
  area,
  source,
  hasData,
  metrics: { metricId: number }
}
```

Si el proyecto necesita coropletas, cada unidad puede incorporar `geometry` GeoJSON. Para optimizar la primera carga, es mejor arrancar con puntos/overview y cargar geometria completa bajo demanda.

## Formato de flujos

```js
{
  originId,
  destinationId,
  value,
  year,
  type
}
```

El motor dibuja los flujos como lineas entre centroides de las unidades cargadas.

## Optimizacion

- Usa assets particionados por territorio.
- Carga primero overview ligero.
- Carga geometria completa solo cuando el modo o filtro lo requiera.
- Deja los calculos pesados de grid/cubos/rankings al worker.
- Evita parsear CSV/XLSX remoto en runtime; preprocesa con scripts.
