#!/usr/bin/env bash
#
# build-stations.sh
#
# 国土数値情報「豪雪地帯データ(気象データ等)」(A22-m-14) を都道府県コード
# 01〜47 についてダウンロードし、気象観測点の「最深積雪」「累計降雪量」
# レイヤーを抽出・変換して web/data/stations_maxdepth.geojson と
# web/data/stations_snowfall.geojson を生成する。
#
# 豪雪地帯の指定がない都道府県は配布元が404を返す。北海道(01)は67MB程度
# あるため取得に時間がかかる。配布元への配慮として1リクエストごとに1秒
# sleepする。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RAW_DIR="${ROOT_DIR}/data/raw/a22m"
WEB_DATA_DIR="${ROOT_DIR}/web/data"

BASE_URL="https://nlftp.mlit.go.jp/ksj/gml/data/A22-m/A22-m-14"

mkdir -p "${RAW_DIR}" "${WEB_DATA_DIR}"

echo "== 国土数値情報 豪雪地帯データ(気象データ等 A22-m-14)のダウンロード =="

downloaded_codes=()

for i in $(seq -w 1 47); do
  url="${BASE_URL}/A22-m-14_${i}_GML.zip"
  zip_path="${RAW_DIR}/A22-m-14_${i}_GML.zip"

  if [[ -f "${zip_path}" ]]; then
    echo "[${i}] 既にダウンロード済みのためスキップ: ${zip_path}"
    downloaded_codes+=("${i}")
    continue
  fi

  echo "[${i}] ダウンロード中: ${url}"
  http_code=$(curl -s -o "${zip_path}" -w "%{http_code}" "${url}" || echo "000")

  if [[ "${http_code}" == "404" ]]; then
    echo "[${i}] 404: この都道府県には豪雪地帯(気象データ等)がありません。スキップします。"
    rm -f "${zip_path}"
    sleep 1
    continue
  elif [[ "${http_code}" != "200" ]]; then
    echo "[${i}] 警告: 予期しないHTTPステータス ${http_code}。スキップします。"
    rm -f "${zip_path}"
    sleep 1
    continue
  fi

  downloaded_codes+=("${i}")
  sleep 1
done

echo ""
echo "== ダウンロード完了 =="
echo "取得できた都道府県コード (${#downloaded_codes[@]}件): ${downloaded_codes[*]}"

if [[ ${#downloaded_codes[@]} -eq 0 ]]; then
  echo "エラー: 1件もデータを取得できませんでした。" >&2
  exit 1
fi

echo ""
echo "== 観測点レイヤーの抽出・変換・マージ =="
python3 "${SCRIPT_DIR}/build_stations.py"

echo ""
echo "== 完了 =="
ls -lh "${WEB_DATA_DIR}"/stations_*.geojson
