#!/usr/bin/env python3
"""
build_stations.py

国土数値情報「豪雪地帯データ(気象データ等)」(A22-m-14) の県別ZIPから
気象観測点(01_気象観測点)の「01_最深積雪」「02_累計降雪量」レイヤーを
抽出し、全国分をマージして web/data/stations_maxdepth.geojson と
web/data/stations_snowfall.geojson を生成する。

zip内のファイル名はShift_JIS(CP932)でエンコードされているが、ZIPの
汎用フラグではUTF-8フラグが立っていないため、Pythonのzipfileは既定で
CP437としてデコードしてしまい文字化けする。そのため、一度CP437で
エンコードし直してからCP932でデコードする変換を行う。

各観測点のプロパティは以下に圧縮する(年次カラムはサイズ削減のため
出力に含めない):
  name       観測点名 (A22_000001)
  addr       所在地   (A22_000002)
  org        観測機関 (A22_000003)
  avg        累年平均値 (A22_010001 / A22_020001)  [cm]
  max        累年最大値 (A22_010002 / A22_020002)  [cm]
  latest     最新の非欠測年の値 [cm]
  latestYear 上記の年(西暦)
  years      非欠測の観測年数

欠測値コードは 99999998(欠測)と 99999999(統計資料なし)の2種類があり、
どちらも欠測として扱い、値としては出力しない。
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

try:
    from osgeo import ogr
except ImportError:
    print("エラー: GDAL の Python バインディング (osgeo) が見つかりません。", file=sys.stderr)
    print("  brew install gdal などでインストールしてください。", file=sys.stderr)
    sys.exit(1)

ogr.UseExceptions()

ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT_DIR / "data" / "raw" / "a22m"
EXTRACT_DIR = RAW_DIR / "extracted"
WEB_DATA_DIR = ROOT_DIR / "web" / "data"

MISSING_VALUES = {99999998, 99999999, 99999998.0, 99999999.0}

# レイヤー定義: (zip内パスの一部, shpファイル名接頭辞, 平均フィールド, 最大フィールド, 出力ファイル名)
LAYERS = [
    {
        "dir_marker": "最深積雪",
        "shp_prefix": "A22-m-14_MaxSnowDepth_",
        "avg_field": "A22_010001",
        "max_field": "A22_010002",
        "year_prefix": "A22_01",
        "out_file": "stations_maxdepth.geojson",
        "label": "最深積雪",
    },
    {
        "dir_marker": "累計降雪量",
        "shp_prefix": "A22-m-14_TotalSnowfall_",
        "avg_field": "A22_020001",
        "max_field": "A22_020002",
        "year_prefix": "A22_02",
        "out_file": "stations_snowfall.geojson",
        "label": "累計降雪量",
    },
]

YEAR_FIELD_RE = re.compile(r"^A22_0[12](\d{4})$")


def decode_zip_name(raw_name: str) -> str:
    """zipfile が CP437 として誤デコードしたファイル名を CP932 として復元する。"""
    try:
        return raw_name.encode("cp437").decode("cp932")
    except (UnicodeEncodeError, UnicodeDecodeError):
        # すでに正しくデコードできている(UTF-8フラグ付き等)場合はそのまま返す
        return raw_name


def extract_prefecture(zip_path: Path, code: str) -> dict[str, Path]:
    """指定県のzipから最深積雪・累計降雪量のshpセットを展開する。

    戻り値: {layer_label: 展開したshpファイルのパス} (存在するレイヤーのみ)
    """
    result: dict[str, Path] = {}
    out_dir = EXTRACT_DIR / code
    out_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        for layer in LAYERS:
            marker = layer["dir_marker"]
            shp_prefix = layer["shp_prefix"]
            members = []
            for info in zf.infolist():
                if info.is_dir():
                    continue
                decoded = decode_zip_name(info.filename)
                if marker in decoded and f"{shp_prefix}{code}." in decoded:
                    members.append((info, decoded))

            if not members:
                continue  # このレイヤーはこの県には存在しない

            shp_path = None
            for info, decoded in members:
                basename = decoded.split("/")[-1]
                target = out_dir / basename
                with zf.open(info) as src, open(target, "wb") as dst:
                    dst.write(src.read())
                if basename.endswith(".shp"):
                    shp_path = target

            if shp_path is not None:
                result[layer["label"]] = shp_path

    return result


def missing(v) -> bool:
    return v is None or v in MISSING_VALUES or (isinstance(v, float) and v >= 99999998)


def read_shapefile_features(shp_path: Path, layer_def: dict) -> list[dict]:
    ds = ogr.Open(str(shp_path))
    if ds is None:
        print(f"  警告: 開けませんでした: {shp_path}", file=sys.stderr)
        return []
    lyr = ds.GetLayer()
    defn = lyr.GetLayerDefn()
    field_names = [defn.GetFieldDefn(i).GetName() for i in range(defn.GetFieldCount())]

    year_fields = []
    for fn in field_names:
        m = YEAR_FIELD_RE.match(fn)
        if m:
            year = int(m.group(1))
            if 1800 <= year <= 2100:
                year_fields.append((year, fn))
    year_fields.sort(key=lambda t: t[0], reverse=True)  # 新しい年順

    features = []
    for feat in lyr:
        geom = feat.GetGeometryRef()
        if geom is None:
            continue
        lon, lat = geom.GetX(), geom.GetY()

        name = feat.GetField("A22_000001")
        addr = feat.GetField("A22_000002")
        org = feat.GetField("A22_000003")

        avg = feat.GetField(layer_def["avg_field"])
        mx = feat.GetField(layer_def["max_field"])
        avg = None if missing(avg) else avg
        mx = None if missing(mx) else mx

        latest = None
        latest_year = None
        years_count = 0
        for year, fn in year_fields:
            v = feat.GetField(fn)
            if missing(v):
                continue
            years_count += 1
            if latest is None:
                latest = v
                latest_year = year

        props = {
            "name": name,
            "addr": addr,
            "org": org,
            "avg": round(avg, 1) if avg is not None else None,
            "max": round(mx, 1) if mx is not None else None,
            "latest": round(latest, 1) if latest is not None else None,
            "latestYear": latest_year,
            "years": years_count,
        }

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                "properties": props,
            }
        )
    return features


def main() -> int:
    zips = sorted(RAW_DIR.glob("A22-m-14_*_GML.zip"))
    if not zips:
        print(f"エラー: {RAW_DIR} に A22-m-14_*_GML.zip が見つかりません。", file=sys.stderr)
        return 1

    merged: dict[str, list[dict]] = {layer["label"]: [] for layer in LAYERS}

    for zip_path in zips:
        m = re.search(r"A22-m-14_(\d{2})_GML\.zip$", zip_path.name)
        if not m:
            continue
        code = m.group(1)
        print(f"[{code}] 展開中: {zip_path.name}")
        shp_paths = extract_prefecture(zip_path, code)
        if not shp_paths:
            print(f"[{code}]   対象レイヤーなし(スキップ)")
            continue
        for layer in LAYERS:
            label = layer["label"]
            if label not in shp_paths:
                print(f"[{code}]   {label}: レイヤーなし")
                continue
            feats = read_shapefile_features(shp_paths[label], layer)
            print(f"[{code}]   {label}: {len(feats)}件")
            merged[label].extend(feats)

    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    for layer in LAYERS:
        label = layer["label"]
        feats = merged[label]
        out_path = WEB_DATA_DIR / layer["out_file"]
        fc = {"type": "FeatureCollection", "features": feats}
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
        size_kb = out_path.stat().st_size / 1024
        print(f"== {label}: {len(feats)}件 -> {out_path} ({size_kb:.0f} KB) ==")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
