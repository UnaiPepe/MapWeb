export const VISUALIZATIONS = {
  points: { id: "points", label: "Puntos", icon: "●", hint: "Puntos coloreados por la metrica activa.", legend: "Color = metrica activa." },
  choropleth: { id: "choropleth", label: "Municipios", icon: "▧", hint: "Poligonos reales coloreados por la metrica activa.", legend: "Color = metrica activa. Gris = sin datos." },
  heatmap: { id: "heatmap", label: "Densidad", icon: "≈", hint: "Superficie continua estimada desde centroides.", legend: "Mapa continuo sin circulos visibles." },
  cubes: { id: "cubes", label: "Cubos 3D", icon: "▥", hint: "Columnas 3D normalizadas por la metrica activa.", legend: "Altura y color = metrica activa; ancho variable." },
  grid: { id: "grid", label: "Grid", icon: "▦", hint: "Celdas agregadas para leer patrones amplios.", legend: "Celdas agregadas por la metrica activa." },
  bivariate: { id: "bivariate", label: "Bivariante", icon: "◉", hint: "Color = metrica activa; tamano = poblacion.", legend: "Color = metrica activa; tamano/borde = poblacion." },
  flows: { id: "flows", label: "Flujos", icon: "⇄", hint: "Lineas principales entre origen y destino.", legend: "Grosor = volumen de flujo." }
};

export function pickVisualizations(ids) {
  return ids.map(id => VISUALIZATIONS[id]).filter(Boolean);
}
