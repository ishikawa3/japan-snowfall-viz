#!/usr/bin/env bash
#
# build-data.sh
#
# 国土数値情報「豪雪地帯データ」(A22-2016) を都道府県コード 01〜47 について
# ダウンロードし、全国分を結合・簡略化して web/data/gosetsu.geojson を生成する。
#
# 豪雪地帯の指定は全国47都道府県のうち24道府県のみなので、指定のない
# 都道府県コードは配布元が 404 を返す。404 は「その県には豪雪地帯データが
# 存在しない」ことを意味するため、エラーにせずスキップする。
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

RAW_DIR="${ROOT_DIR}/data/raw"
WEB_DATA_DIR="${ROOT_DIR}/web/data"
OUT_FILE="${WEB_DATA_DIR}/gosetsu.geojson"

BASE_URL="https://nlftp.mlit.go.jp/ksj/gml/data/A22/A22-16"

mkdir -p "${RAW_DIR}" "${WEB_DATA_DIR}"

echo "== 国土数値情報 豪雪地帯データ(A22-2016)のダウンロード =="

downloaded_codes=()

for i in $(seq -w 1 47); do
  url="${BASE_URL}/A22-16_${i}_GML.zip"
  zip_path="${RAW_DIR}/A22-16_${i}_GML.zip"
  geojson_glob="${RAW_DIR}/A22-16_${i}.geojson"

  if [[ -f "${geojson_glob}" ]]; then
    echo "[${i}] 既に展開済みのためスキップ: ${geojson_glob}"
    downloaded_codes+=("${i}")
    continue
  fi

  echo "[${i}] ダウンロード中: ${url}"
  http_code=$(curl -s -o "${zip_path}" -w "%{http_code}" "${url}" || echo "000")

  if [[ "${http_code}" == "404" ]]; then
    echo "[${i}] 404: この都道府県には豪雪地帯データがありません。スキップします。"
    rm -f "${zip_path}"
    sleep 1
    continue
  elif [[ "${http_code}" != "200" ]]; then
    echo "[${i}] 警告: 予期しないHTTPステータス ${http_code}。スキップします。"
    rm -f "${zip_path}"
    sleep 1
    continue
  fi

  echo "[${i}] 展開中..."
  unzip -o -q "${zip_path}" -d "${RAW_DIR}"

  if [[ ! -f "${geojson_glob}" ]]; then
    echo "[${i}] 警告: 展開後にgeojsonが見つかりません(${geojson_glob})。"
  else
    downloaded_codes+=("${i}")
  fi

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
echo "== mapshaper で全県結合・市区町村単位に統合・簡略化 =="
#
# 元データは1市区町村が離島や飛び地ごとに複数フィーチャへ分割されており、
# 全国で約33,000フィーチャになる(単純結合すると簡略化してもファイルが
# 10MBを超える)。同一市区町村(A22_002=行政区域コード)のフィーチャを
# dissolveでマルチポリゴンとして統合してからsimplifyすることで、
# フィーチャ数を約550まで削減しつつファイルサイズを5MB前後に抑える。
#
# 注意: 一部の市区町村(46件)は区域内に「豪雪地帯(区分1)」と「特別豪雪
# 地帯(区分2、A22_009="2")」の両方を含む(例: 高山市 A22_002=21203)。
# dissolveキーをA22_002のみにすると区分が異なるポリゴンが1つに統合され、
# 区分情報が失われてしまう。これを避けるため、A22_002とA22_009の複合を
# dissolveキーとする(同一市区町村でも区分が異なれば別フィーチャとして
# 保持する)。

npx -y mapshaper \
  -i "${RAW_DIR}"/A22-16_*.geojson combine-files -merge-layers force \
  -filter-fields A22_002,A22_003,A22_004,A22_005,A22_006,A22_007,A22_008,A22_009 \
  -dissolve A22_002,A22_009 copy-fields=A22_003,A22_004,A22_005,A22_006,A22_007,A22_008 \
  -simplify 4% keep-shapes \
  -o "${OUT_FILE}" format=geojson precision=0.0001

echo ""
echo "== 完了 =="
ls -lh "${OUT_FILE}"
