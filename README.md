# japan-snowfall-viz

国土数値情報「豪雪地帯データ」(A22-2016) を地図上に可視化する静的Webアプリです。
豪雪地帯・特別豪雪地帯として指定された市区町村の区域を、MapLibre GL JS + 地理院タイルの地図上に色分け表示します。
あわせて「豪雪地帯データ(気象データ等)」(A22-m-14) の気象観測点(最深積雪・累計降雪量)をポイント表示できます。

## 公開URL(デモ)

**https://ishikawa3.github.io/japan-snowfall-viz/**

`main` ブランチへの push で GitHub Actions が `web/` を GitHub Pages に自動デプロイします
(`.github/workflows/deploy-pages.yml`)。

## データ出典・利用規約

- データ: [国土数値情報 豪雪地帯データ(A22-2016)](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A22-2016.html) 国土交通省
- データ: [国土数値情報 豪雪地帯データ(気象データ等)(A22-m-14)](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A22-m.html) 国土交通省
- 利用にあたっては上記ページに掲載されている国土数値情報の利用規約(政府標準利用規約2.0相当)に従ってください。
- ベースマップ: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)(淡色地図) 国土地理院

## ディレクトリ構成

```
scripts/build-data.sh       # 指定区域ポリゴンのダウンロード〜結合・簡略化スクリプト
scripts/build-stations.sh   # 気象観測点(A22-m-14)のダウンロード〜変換スクリプト
scripts/build_stations.py   # build-stations.sh から呼ばれる変換処理本体(python3 + GDAL)
data/raw/                    # ダウンロードした生データ(zip・geojson、.gitignore対象)
data/raw/a22m/               # A22-m-14 の生データ(zip・展開後shp、.gitignore対象)
web/index.html               # 地図アプリ本体(MapLibre GL JS、単一HTML)
web/data/gosetsu.geojson     # 指定区域の表示用データ(build-data.shが生成)
web/data/stations_maxdepth.geojson  # 観測点・最深積雪(build-stations.shが生成)
web/data/stations_snowfall.geojson  # 観測点・累計降雪量(build-stations.shが生成)
```

## セットアップ

### 1. 必要なツール

- `curl`, `unzip`
- `node` / `npx`(mapshaperの実行に使用。`npx -y mapshaper` でインストール不要で実行されます)
- `python3`(観測点データの変換・ローカルサーバーに使用)
- GDAL の Python バインディング(`osgeo`。macOS では `brew install gdal` で導入可能。観測点データの変換に使用)

### 2. 指定区域データの取得・生成

```bash
./scripts/build-data.sh
```

国土数値情報のサイトから都道府県コード 01〜47 のデータを順にダウンロードします
(豪雪地帯の指定がある24道府県のみデータが存在し、それ以外は404となるためスキップします)。
取得したgeojsonをmapshaperで結合・簡略化し、`web/data/gosetsu.geojson` を生成します。
サーバーへの配慮のため、リクエスト間に1秒のスリープを挟んでいます。実行には数分かかります。

同一市区町村の区域内に豪雪地帯(区分1)と特別豪雪地帯(区分2)の両方が存在する場合が
あるため、dissolveは「行政区域コード(A22_002)×豪雪区分(A22_009)」の複合キーで
行っています。該当する46市区町村は区分ごとに2フィーチャを持ちます。

### 3. 気象観測点データの取得・生成

```bash
./scripts/build-stations.sh
```

国土数値情報「豪雪地帯データ(気象データ等)」(A22-m-14) を都道府県コード 01〜47 に
ついてダウンロードし(指定のない県は404でスキップ、北海道は約67MBと大きめです)、
気象観測点の「最深積雪」「累計降雪量」レイヤーを抽出して
`web/data/stations_maxdepth.geojson` / `web/data/stations_snowfall.geojson` を生成します。

- zip内のファイル名はShift_JIS(CP932)のため、Pythonのzipfileでエンコーディングを
  変換しながら展開します(macOSのunzipでは文字化けします)。
- 年次カラム(A22_01YYYY / A22_02YYYY)はファイルサイズ削減のため出力に含めず、
  `avg`(累年平均)・`max`(累年最大)・`latest`/`latestYear`(最新の非欠測年の値と年)・
  `years`(非欠測の観測年数)に圧縮しています。
- 欠測値コード(99999998=欠測、99999999=統計資料なし)は除外して扱います。
- 生データは `data/raw/a22m/` に保存されます(.gitignore対象)。

### 4. ローカルで表示

```bash
cd web
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開いてください。
画面右上のコントロールで指定区域ポリゴンの表示/非表示と、観測点レイヤー
(なし / 最深積雪 / 累計降雪量)を切り替えられます。左側のパネルには都道府県別の
指定市区町村数の集計が表示され、行をクリックするとその都道府県へズームします。

## 属性スキーマ(A22-2016)

下表は**元データ(A22-2016)の全フィールド**です。生成物 `web/data/gosetsu.geojson` は
`build-data.sh` の `-filter-fields`・`-dissolve` により一部フィールド(例: A22_001)を
含みません。

| フィールド | 内容 |
|---|---|
| A22_001 | 豪雪地帯ID |
| A22_002 | 行政区域コード |
| A22_003 | 都道府県名 |
| A22_004 | 支庁名(北海道のみ) |
| A22_005 | 郡名 |
| A22_006 | 市区町村名 |
| A22_007 | 市区町村名(現在) |
| A22_008 | 旧市町村に関する備考 |
| A22_009 | 豪雪区分コード("1"=豪雪地帯, "2"=特別豪雪地帯) |

## 属性スキーマ(A22-m-14 気象観測点、変換後)

`stations_maxdepth.geojson` / `stations_snowfall.geojson` の各ポイントのプロパティ:

| フィールド | 内容(元属性) |
|---|---|
| name | 観測点名(A22_000001) |
| addr | 所在地(A22_000002) |
| org | 観測機関(A22_000003) |
| avg | 累年平均値 cm(A22_010001 / A22_020001。最古年〜2013年度の各年度値の平均) |
| max | 累年最大値 cm(A22_010002 / A22_020002。最古年〜2013年度の各年度値の最大) |
| latest | 最新の非欠測年度の値 cm |
| latestYear | 上記の年度(西暦) |
| years | 非欠測の観測年数 |
