from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OVERVIEW = ROOT / "data" / "geographies" / "europe-lau" / "overview.json"
OUT_DIR = ROOT / "data" / "projects" / "migration-spain"

INE = {
    "municipal_in": "https://www.ine.es/jaxiT3/files/t/csv_bdsc/69696.csv",
    "municipal_out": "https://www.ine.es/jaxiT3/files/t/csv_bdsc/69711.csv",
    "country_in": "https://www.ine.es/jaxiT3/files/t/csv_bdsc/69695.csv",
    "country_out": "https://www.ine.es/jaxiT3/files/t/csv_bdsc/69710.csv",
}

EUROSTAT_API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}"
YEARS = [2024, 2023, 2022, 2021]
SPAIN = {"id": "ES", "name": "Espana", "lon": -3.7038, "lat": 40.4168, "type": "country", "region": "europe"}
REGION_LABELS = {
    "latin-america": "Latinoamerica",
    "africa": "Africa",
    "europe": "Europa",
    "asia": "Asia",
    "north-america": "Norteamerica",
    "oceania": "Oceania",
}
REGION_COORDS = {
    "latin-america": {"lon": -63.0, "lat": -13.0},
    "africa": {"lon": 20.0, "lat": 5.0},
    "europe": {"lon": 12.0, "lat": 50.0},
    "asia": {"lon": 78.0, "lat": 34.0},
    "north-america": {"lon": -101.0, "lat": 43.0},
    "oceania": {"lon": 135.0, "lat": -25.0},
}

COUNTRIES = {
    "Alemania": ("DE", "Alemania", 10.45, 51.16, "europe"), "Francia": ("FR", "Francia", 2.21, 46.23, "europe"),
    "Italia": ("IT", "Italia", 12.57, 41.87, "europe"), "Portugal": ("PT", "Portugal", -8.22, 39.4, "europe"),
    "Reino Unido": ("GB", "Reino Unido", -3.44, 55.38, "europe"), "Rumania": ("RO", "Rumania", 24.97, 45.94, "europe"),
    "Marruecos": ("MA", "Marruecos", -7.09, 31.79, "africa"), "Argelia": ("DZ", "Argelia", 1.66, 28.03, "africa"),
    "Senegal": ("SN", "Senegal", -14.45, 14.5, "africa"), "Nigeria": ("NG", "Nigeria", 8.68, 9.08, "africa"),
    "Colombia": ("CO", "Colombia", -74.3, 4.57, "latin-america"), "Venezuela": ("VE", "Venezuela", -66.59, 6.42, "latin-america"),
    "Peru": ("PE", "Peru", -75.02, -9.19, "latin-america"), "PerÃº": ("PE", "Peru", -75.02, -9.19, "latin-america"),
    "Ecuador": ("EC", "Ecuador", -78.18, -1.83, "latin-america"), "Argentina": ("AR", "Argentina", -63.62, -38.42, "latin-america"),
    "Bolivia": ("BO", "Bolivia", -63.59, -16.29, "latin-america"), "Brasil": ("BR", "Brasil", -51.93, -14.24, "latin-america"),
    "Chile": ("CL", "Chile", -71.54, -35.68, "latin-america"), "Cuba": ("CU", "Cuba", -77.78, 21.52, "latin-america"),
    "Mexico": ("MX", "Mexico", -102.55, 23.63, "latin-america"), "MÃ©xico": ("MX", "Mexico", -102.55, 23.63, "latin-america"),
    "RepÃºblica Dominicana": ("DO", "Republica Dominicana", -70.16, 18.74, "latin-america"),
    "Estados Unidos de AmÃ©rica": ("US", "Estados Unidos", -98.58, 39.83, "north-america"),
    "Estados Unidos": ("US", "Estados Unidos", -98.58, 39.83, "north-america"), "Canada": ("CA", "Canada", -106.35, 56.13, "north-america"),
    "CanadÃ¡": ("CA", "Canada", -106.35, 56.13, "north-america"), "China": ("CN", "China", 104.2, 35.86, "asia"),
    "India": ("IN", "India", 78.96, 20.59, "asia"), "Pakistan": ("PK", "Pakistan", 69.35, 30.38, "asia"),
    "PakistÃ¡n": ("PK", "Pakistan", 69.35, 30.38, "asia"), "Filipinas": ("PH", "Filipinas", 121.77, 12.88, "asia"),
    "Ucrania": ("UA", "Ucrania", 31.17, 48.38, "europe"), "Rusia": ("RU", "Rusia", 37.62, 55.75, "europe"),
    "Suiza": ("CH", "Suiza", 8.23, 46.82, "europe"), "Paises Bajos": ("NL", "Paises Bajos", 5.29, 52.13, "europe"),
    "PaÃ­ses Bajos": ("NL", "Paises Bajos", 5.29, 52.13, "europe"), "Belgica": ("BE", "Belgica", 4.47, 50.5, "europe"),
    "BÃ©lgica": ("BE", "Belgica", 4.47, 50.5, "europe"), "Polonia": ("PL", "Polonia", 19.15, 51.92, "europe"),
}

ISO_COORDS = {
    "AT": ("Austria", 14.55, 47.52, "europe"), "BE": ("Belgica", 4.47, 50.5, "europe"), "BG": ("Bulgaria", 25.49, 42.73, "europe"),
    "CH": ("Suiza", 8.23, 46.82, "europe"), "CY": ("Chipre", 33.43, 35.13, "europe"), "CZ": ("Chequia", 15.47, 49.82, "europe"),
    "DE": ("Alemania", 10.45, 51.16, "europe"), "DK": ("Dinamarca", 9.5, 56.26, "europe"), "EE": ("Estonia", 25.01, 58.6, "europe"),
    "EL": ("Grecia", 21.82, 39.07, "europe"), "ES": ("Espana", -3.7, 40.42, "europe"), "FI": ("Finlandia", 25.75, 61.92, "europe"),
    "FR": ("Francia", 2.21, 46.23, "europe"), "HR": ("Croacia", 15.2, 45.1, "europe"), "HU": ("Hungria", 19.5, 47.16, "europe"),
    "IE": ("Irlanda", -8.24, 53.41, "europe"), "IT": ("Italia", 12.57, 41.87, "europe"), "LT": ("Lituania", 23.88, 55.17, "europe"),
    "LU": ("Luxemburgo", 6.13, 49.82, "europe"), "LV": ("Letonia", 24.6, 56.88, "europe"), "MT": ("Malta", 14.38, 35.94, "europe"),
    "NL": ("Paises Bajos", 5.29, 52.13, "europe"), "NO": ("Noruega", 8.47, 60.47, "europe"), "PL": ("Polonia", 19.15, 51.92, "europe"),
    "PT": ("Portugal", -8.22, 39.4, "europe"), "RO": ("Rumania", 24.97, 45.94, "europe"), "SE": ("Suecia", 18.64, 60.13, "europe"),
    "SI": ("Eslovenia", 14.99, 46.15, "europe"), "SK": ("Eslovaquia", 19.7, 48.67, "europe"), "UK": ("Reino Unido", -3.44, 55.38, "europe"),
    "GB": ("Reino Unido", -3.44, 55.38, "europe"), "MA": ("Marruecos", -7.09, 31.79, "africa"), "CO": ("Colombia", -74.3, 4.57, "latin-america"),
    "VE": ("Venezuela", -66.59, 6.42, "latin-america"), "EC": ("Ecuador", -78.18, -1.83, "latin-america"), "PE": ("Peru", -75.02, -9.19, "latin-america"),
    "AR": ("Argentina", -63.62, -38.42, "latin-america"), "BR": ("Brasil", -51.93, -14.24, "latin-america"), "US": ("Estados Unidos", -98.58, 39.83, "north-america"),
    "CN": ("China", 104.2, 35.86, "asia"), "IN": ("India", 78.96, 20.59, "asia"), "PK": ("Pakistan", 69.35, 30.38, "asia"),
    "UA": ("Ucrania", 31.17, 48.38, "europe"), "RU": ("Rusia", 37.62, 55.75, "europe"),
}

REGION_TOTAL_KEYS = {
    "latin-america": ["SudamÃ©rica", "Sudamérica", "Centro AmÃ©rica y Caribe", "Centro América y Caribe", "MÃ©xico", "Mexico"],
    "africa": ["Africa", "Ãfrica", "África"],
    "europe": ["UE27_2020 sin EspaÃ±a", "UE27_2020 sin España", "Europa menos UE27_2020"],
    "asia": ["Asia"],
    "north-america": ["AmÃ©rica del Norte", "América del Norte"],
    "oceania": ["Oceania", "OceanÃ­a", "Oceanía"],
}


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "MapWeb asset builder"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def parse_int(value: str | int | float | None) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text or text == "..":
        return 0
    return int(float(text.replace(".", "").replace(",", ".")))


def label_key(value: str) -> str:
    return unicodedata.normalize("NFD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower().strip()


def ine_rows(url: str) -> list[dict[str, str]]:
    text = fetch_bytes(url).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def latest_period(rows: list[dict[str, str]]) -> int:
    years = [int(row["Periodo"]) for row in rows if str(row.get("Periodo", "")).isdigit()]
    return max(years)


def load_spanish_units() -> dict[str, dict]:
    overview = json.loads(OVERVIEW.read_text(encoding="utf-8"))
    columns = overview.get("columns", [])
    units = {}
    for row in overview.get("units", []):
        props = dict(zip(columns, row))
        if props.get("country") != "ES":
            continue
        code = props["code"]
        units[code] = {
            "id": code,
            "name": props.get("name") or code,
            "country": "ES",
            "countryName": "Espana",
            "lon": props.get("lon"),
            "lat": props.get("lat"),
            "area": props.get("area", 0),
            "source": "INE EMCR y Eurostat/GISCO LAU",
            "metrics": {
                "netMigration": 0,
                "inMigration": 0,
                "outMigration": 0,
                "population": parse_int(props.get("population")),
            },
            "hasData": parse_int(props.get("population")) > 0,
        }
    return units


def municipal_values(rows: list[dict[str, str]], year: int) -> dict[str, int]:
    values = defaultdict(int)
    for row in rows:
        if row.get("Sexo") != "Ambos sexos" or int(row.get("Periodo", 0)) != year:
            continue
        match = re.match(r"(\d{5})\s+", row.get("Municipios") or "")
        if match:
            values[f"ES_{match.group(1)}"] += parse_int(row.get("Total"))
    return values


COUNTRIES_BY_KEY = {label_key(label): data for label, data in COUNTRIES.items()}


def field_by_suffix(row: dict[str, str], suffix: str) -> str:
    suffix_key = label_key(suffix)
    for key, value in row.items():
        if label_key(key).endswith(suffix_key):
            return value
    return ""


def national_country_values(rows: list[dict[str, str]], year: int, suffix: str) -> dict[str, int]:
    values = {}
    for row in rows:
        if int(row.get("Periodo", 0)) != year:
            continue
        if field_by_suffix(row, "Autonomas") or row.get("Provincias"):
            continue
        label = field_by_suffix(row, suffix)
        if label and label != "Total":
            values[label] = parse_int(row.get("Total"))
    return values


def endpoint_from_country(label: str) -> dict | None:
    item = COUNTRIES.get(label) or COUNTRIES_BY_KEY.get(label_key(label))
    if not item:
        return None
    code, name, lon, lat, region = item
    return {"id": code, "name": name, "lon": lon, "lat": lat, "type": "country", "region": region}


def endpoint_from_region(region: str, name: str | None = None) -> dict:
    coords = REGION_COORDS[region]
    return {"id": f"REGION_{region}", "name": name or REGION_LABELS[region], "lon": coords["lon"], "lat": coords["lat"], "type": "region", "region": region}


def ine_flows(values: dict[str, int], direction: str, year: int, limit: int = 25) -> list[dict]:
    values_by_key = {label_key(label): value for label, value in values.items()}
    countries = [(label, value, endpoint_from_country(label)) for label, value in values.items()]
    countries = [(label, value, endpoint) for label, value, endpoint in countries if endpoint and value > 0]
    selected = sorted(countries, key=lambda item: item[1], reverse=True)[:limit]
    flows = []
    region_selected = defaultdict(int)
    source = "INE EMCR"
    for label, value, endpoint in selected:
        region_selected[endpoint["region"]] += value
        origin, destination = (endpoint, SPAIN) if direction == "to-spain" else (SPAIN, endpoint)
        flows.append({
            "id": f"ine-{direction}-{endpoint['id']}",
            "origin": origin,
            "destination": destination,
            "value": value,
            "year": year,
            "direction": direction,
            "region": endpoint["region"],
            "category": endpoint["name"],
            "source": source,
            "type": "official-flow",
        })
    for region, keys in REGION_TOTAL_KEYS.items():
        total = sum(values_by_key.get(label_key(key), 0) for key in keys)
        remainder = max(0, total - region_selected[region])
        if remainder < 1000:
            continue
        endpoint = endpoint_from_region(region, f"Resto {REGION_LABELS[region]}")
        origin, destination = (endpoint, SPAIN) if direction == "to-spain" else (SPAIN, endpoint)
        flows.append({
            "id": f"ine-{direction}-rest-{region}",
            "origin": origin,
            "destination": destination,
            "value": remainder,
            "year": year,
            "direction": direction,
            "region": region,
            "category": f"Resto {REGION_LABELS[region]}",
            "source": source,
            "type": "official-flow",
        })
    return flows


def jsonstat_values(data: dict) -> list[tuple[dict[str, str], int]]:
    ids = data["id"]
    sizes = data["size"]
    strides = []
    acc = 1
    for size in reversed(sizes[1:]):
        acc *= size
        strides.insert(0, acc)
    strides.append(1)
    labels_by_dim = {}
    for dim in ids:
        category = data["dimension"][dim]["category"]
        index = category["index"]
        labels = category.get("label", {})
        labels_by_dim[dim] = {idx: (code, labels.get(code, code)) for code, idx in index.items()}
    values = data.get("value", {})
    if isinstance(values, list):
        values = {str(i): value for i, value in enumerate(values) if value is not None}
    out = []
    for raw_idx, value in values.items():
        idx = int(raw_idx)
        coords = {}
        remainder = idx
        for dim, size, stride in zip(ids, sizes, strides):
            pos = remainder // stride
            remainder %= stride
            code, label = labels_by_dim[dim].get(pos, ("", ""))
            coords[dim] = code
            coords[f"{dim}_label"] = label
        out.append((coords, parse_int(value)))
    return out


def eurostat_query(dataset: str, geo: str, year: int) -> dict | None:
    params = {
        "format": "JSON",
        "lang": "en",
        "freq": "A",
        "agedef": "COMPLET",
        "age": "TOTAL",
        "sex": "T",
        "unit": "NR",
        "geo": geo,
        "time": str(year),
    }
    url = EUROSTAT_API.format(dataset=dataset) + "?" + urllib.parse.urlencode(params)
    try:
        return json.loads(fetch_bytes(url).decode("utf-8"))
    except Exception as exc:
        print(f"Eurostat skipped {dataset} {geo} {year}: {exc}")
        return None


def eurostat_flows(dataset: str, direction: str, year: int, reporters: list[str], limit: int = 90) -> list[dict]:
    rows = []
    partner_dim = "partner"
    for geo in reporters:
        data = eurostat_query(dataset, geo, year)
        if not data or "value" not in data:
            continue
        reporter = ISO_COORDS.get(geo)
        if not reporter:
            continue
        reporter_ep = {"id": geo, "name": reporter[0], "lon": reporter[1], "lat": reporter[2], "type": "country", "region": "europe"}
        for coords, value in jsonstat_values(data):
            partner = coords.get(partner_dim)
            if value <= 0 or partner in {"TOTAL", geo, "UNK", "EU27_2020", "EXT_EU27_2020"}:
                continue
            partner_info = ISO_COORDS.get(partner)
            if not partner_info:
                continue
            partner_ep = {"id": partner, "name": partner_info[0], "lon": partner_info[1], "lat": partner_info[2], "type": "country", "region": partner_info[3]}
            if direction == "to-europe":
                origin, destination = partner_ep, reporter_ep
            else:
                origin, destination = reporter_ep, partner_ep
            rows.append({
                "id": f"eurostat-{direction}-{geo}-{partner}",
                "origin": origin,
                "destination": destination,
                "value": value,
                "year": year,
                "direction": direction,
                "region": partner_ep["region"],
                "category": partner_ep["name"],
                "source": f"Eurostat {dataset}",
                "type": "official-flow",
            })
    return sorted(rows, key=lambda item: item["value"], reverse=True)[:limit]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    units = load_spanish_units()
    municipal_in_rows = ine_rows(INE["municipal_in"])
    municipal_out_rows = ine_rows(INE["municipal_out"])
    country_in_rows = ine_rows(INE["country_in"])
    country_out_rows = ine_rows(INE["country_out"])
    ine_year = min(latest_period(municipal_in_rows), latest_period(municipal_out_rows), latest_period(country_in_rows), latest_period(country_out_rows))

    in_values = municipal_values(municipal_in_rows, ine_year)
    out_values = municipal_values(municipal_out_rows, ine_year)
    for unit_id, unit in units.items():
        incoming = in_values.get(unit_id, 0)
        outgoing = out_values.get(unit_id, 0)
        unit["metrics"]["inMigration"] = incoming
        unit["metrics"]["outMigration"] = outgoing
        unit["metrics"]["netMigration"] = incoming - outgoing
        unit["hasData"] = unit["hasData"] or incoming > 0 or outgoing > 0

    country_in = national_country_values(country_in_rows, ine_year, "procedencia")
    country_out = national_country_values(country_out_rows, ine_year, "destino")
    flows = ine_flows(country_in, "to-spain", ine_year) + ine_flows(country_out, "from-spain", ine_year)

    reporters = [code for code in ISO_COORDS if code in {"DE", "FR", "IT", "NL", "BE", "SE", "CH", "AT", "IE", "PT", "ES", "NO"}]
    euro_year = 2024
    flows += eurostat_flows("migr_imm5prv", "to-europe", euro_year, reporters)
    flows += eurostat_flows("migr_emi3nxt", "from-europe", euro_year, reporters)

    payload = {
        "year": ine_year,
        "eurostatYear": euro_year,
        "units": list(units.values()),
        "flows": sorted(flows, key=lambda item: item["value"], reverse=True),
    }
    asset_name = f"{ine_year}.json"
    (OUT_DIR / asset_name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "index.json").write_text(json.dumps({
        "title": "Migraciones Espana y Europa",
        "source": "INE EMCR y Eurostat",
        "latestYear": ine_year,
        "eurostatYear": euro_year,
        "years": [ine_year],
        "files": {str(ine_year): asset_name},
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(units)} units and {len(flows)} official flows to {OUT_DIR / asset_name}")


if __name__ == "__main__":
    main()
