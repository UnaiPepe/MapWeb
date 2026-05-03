from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OVERVIEW = ROOT / "data" / "geographies" / "europe-lau" / "overview.json"
OUT_DIR = ROOT / "data" / "projects" / "migration-spain"


def score(unit: dict) -> float:
    props = unit["properties"]
    population = float(props.get("population") or 0)
    density = float(props.get("density") or 0)
    return math.log10(population + 1) * 0.72 + math.log10(density + 1) * 0.28


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    overview = json.loads(OVERVIEW.read_text(encoding="utf-8"))
    if "features" in overview:
        spanish = [f for f in overview["features"] if f["properties"].get("country") == "ES"]
    else:
        columns = overview["columns"]
        spanish = []
        for row in overview["units"]:
            props = dict(zip(columns, row))
            if props.get("country") != "ES":
                continue
            spanish.append({
                "type": "Feature",
                "id": props["code"],
                "geometry": {"type": "Point", "coordinates": [props["lon"], props["lat"]]},
                "properties": props,
            })
    ranked = sorted(spanish, key=score, reverse=True)
    hubs = ranked[:28]
    units = []
    flows = []

    for i, feature in enumerate(spanish):
      props = feature["properties"]
      population = int(props.get("population") or 0)
      density = float(props.get("density") or 0)
      phase = (i % 17) - 8
      incoming = int(max(0, population * (0.012 + (density % 700) / 120000) + max(0, phase) * 22))
      outgoing = int(max(0, population * (0.010 + ((900 - density) % 600) / 150000) + max(0, -phase) * 18))
      net = incoming - outgoing
      units.append({
        "id": props["code"],
        "name": props["name"],
        "country": "ES",
        "countryName": "Espana",
        "lon": props["lon"],
        "lat": props["lat"],
        "area": props.get("area", 0),
        "source": "Scaffold reproducible: sustituir por INE EMCR al ejecutar integracion oficial",
        "metrics": {
          "netMigration": net,
          "inMigration": incoming,
          "outMigration": outgoing,
          "population": population
        },
        "hasData": population > 0
      })

    for i, origin in enumerate(hubs):
      for j, dest in enumerate(hubs):
        if i == j or (i + j) % 5 != 0:
          continue
        op = origin["properties"]
        dp = dest["properties"]
        distance = max(0.8, abs(float(op["lon"]) - float(dp["lon"])) + abs(float(op["lat"]) - float(dp["lat"])))
        value = int((min(float(op.get("population") or 0), float(dp.get("population") or 0)) ** 0.55) * 38 / distance)
        if value > 650:
          flows.append({
            "originId": op["code"],
            "destinationId": dp["code"],
            "value": value,
            "year": 2024,
            "type": "demo-flow"
          })

    flows = sorted(flows, key=lambda item: item["value"], reverse=True)[:160]
    (OUT_DIR / "index.json").write_text(json.dumps({
      "title": "Migraciones municipales Espana",
      "source": "Scaffold reproducible basado en centros LAU; pendiente de sustitucion por INE EMCR",
      "years": [2024],
      "latestYear": 2024,
      "files": {"2024": "2024.json"}
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "2024.json").write_text(json.dumps({
      "year": 2024,
      "units": units,
      "flows": flows
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(units)} units and {len(flows)} flows to {OUT_DIR}")


if __name__ == "__main__":
    main()
