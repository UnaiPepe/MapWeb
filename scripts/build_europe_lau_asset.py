from __future__ import annotations

import csv
import json
import math
from io import BytesIO, StringIO, TextIOWrapper
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile


GISCO_TOPOJSON = "https://gisco-services.ec.europa.eu/distribution/v2/lau/topojson/LAU_RG_01M_2024_4326.json"
INE_CSV = "https://www.ine.es/jaxiT3/files/t/csv_bdsc/68065.csv"
INSEE_ZIP = "https://www.insee.fr/fr/statistiques/fichier/7739582/ensemble.zip"

EU_EFTA = {
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR",
    "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
    "SE", "SI", "SK", "CH", "IS", "LI", "NO",
}


def read_url(url: str, timeout: int = 180) -> bytes:
    with urlopen(url, timeout=timeout) as response:
        return response.read()


def parse_number(value: str | int | float | None) -> float:
    if value is None:
        return math.nan
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "")
    if not text:
        return math.nan
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif text.count(".") > 1:
        text = text.replace(".", "")
    else:
        text = text
    try:
        return float(text)
    except ValueError:
        return math.nan


def parse_spanish_integer(value: str | int | float | None) -> float:
    if value is None:
        return math.nan
    text = str(value).strip().replace(" ", "")
    if not text:
        return math.nan
    try:
        return float(text.replace(".", "").replace(",", "."))
    except ValueError:
        return math.nan


def load_spain_population() -> dict[str, int]:
    raw = read_url(INE_CSV, timeout=120).decode("iso-8859-15").lstrip("\ufeff")
    rows = csv.DictReader(StringIO(raw), delimiter=";")
    population: dict[str, tuple[int, int]] = {}
    for row in rows:
        if (row.get("Sexo") or "").strip().lower() != "total":
            continue
        muni = row.get("Municipios") or ""
        code = muni[:5] if len(muni) >= 5 and muni[:5].isdigit() else ""
        if not code:
            continue
        period = int(row.get("Periodo") or 0)
        parsed_pop = parse_spanish_integer(row.get("Total"))
        if not math.isfinite(parsed_pop):
            continue
        pop = int(parsed_pop)
        if code not in population or period > population[code][1]:
            population[code] = (pop, period)
    return {f"ES_{code}": pop for code, (pop, _period) in population.items()}


def load_france_population() -> dict[str, int]:
    archive = ZipFile(BytesIO(read_url(INSEE_ZIP, timeout=120)))
    population: dict[str, int] = {}
    paris = lyon = marseille = 0
    with archive.open("donnees_communes.csv") as file:
        rows = csv.DictReader(TextIOWrapper(file, encoding="utf-8-sig"), delimiter=";")
        for row in rows:
            code = (row.get("COM") or "").strip()
            pop = int(parse_number(row.get("PMUN")) or 0)
            if code:
                population[f"FR_{code}"] = pop
            if code.startswith("751"):
                paris += pop
            elif code.startswith("6938"):
                lyon += pop
            elif code.startswith("132"):
                marseille += pop
    if paris:
        population["FR_75056"] = paris
    if lyon:
        population["FR_69123"] = lyon
    if marseille:
        population["FR_13055"] = marseille
    return population


def compact_geometry(geometry: dict, supplements: dict[str, dict[str, int]]) -> dict | None:
    props = geometry.get("properties") or {}
    code = props.get("GISCO_ID") or geometry.get("id")
    country = props.get("CNTR_CODE")
    if not code or country not in EU_EFTA:
        return None

    area = parse_number(props.get("AREA_KM2"))
    population = parse_number(props.get("POP_2024"))
    source = "Eurostat/GISCO LAU 2024"
    if code in supplements["ES"]:
        population = float(supplements["ES"][code])
        source = "INE 2025 + GISCO area"
    elif code in supplements["FR"]:
        population = float(supplements["FR"][code])
        source = "INSEE 2021 + GISCO area"

    has_data = bool(area and area > 0 and population and population > 0)
    density = population / area if has_data else 0
    out = {
        "type": geometry["type"],
        "arcs": geometry["arcs"],
        "id": code,
        "properties": {
            "code": code,
            "country": country,
            "name": props.get("LAU_NAME") or code,
            "population": round(population) if population and population > 0 else 0,
            "density": round(density, 4) if density > 0 else 0,
            "area": round(area, 4) if area and area > 0 else 0,
            "year": 2024,
            "source": source if has_data else "Sin dato de población disponible",
            "hasData": has_data,
        },
    }
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "data"
    out_dir.mkdir(exist_ok=True)

    print("Downloading supplements...")
    supplements = {
        "ES": load_spain_population(),
        "FR": load_france_population(),
    }

    print("Downloading GISCO LAU TopoJSON...")
    topo = json.loads(read_url(GISCO_TOPOJSON, timeout=240).decode("utf-8"))
    object_name = "LAU_RG_01M_2024_4326"
    geometries = topo["objects"][object_name]["geometries"]
    original_count = len(geometries)
    compacted = [compact_geometry(g, supplements) for g in geometries]
    compacted = [g for g in compacted if g is not None]

    countries = sorted({g["properties"]["country"] for g in compacted})
    with_data = sum(1 for g in compacted if g["properties"]["hasData"])
    total_population = sum(g["properties"]["population"] for g in compacted)

    asset = {
        "type": "Topology",
        "transform": topo["transform"],
        "arcs": topo["arcs"],
        "objects": {
            "lau": {
                "type": "GeometryCollection",
                "geometries": compacted,
            }
        },
        "metadata": {
            "title": "Europe LAU 2024 density asset",
            "source": "Eurostat/GISCO LAU 2024, INE 2025 supplement for Spain, INSEE 2021 supplement for France",
            "originalUnits": original_count,
            "units": len(compacted),
            "unitsWithData": with_data,
            "countries": countries,
            "totalPopulation": total_population,
        },
    }

    out_path = out_dir / "europe_lau_2024.min.json"
    out_path.write_text(json.dumps(asset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(asset["metadata"], ensure_ascii=False, indent=2))
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    main()
