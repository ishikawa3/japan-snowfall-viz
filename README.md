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
web/3d.html                  # 3Dビュー(Three.js + WebGL、同一データを立体表示、単一HTML)
web/vendor/three/            # 同梱した Three.js r160(three.module.js / OrbitControls、MITライセンス)
web/data/japan.geojson       # 3Dビューのベースマップ用 日本地形(Natural Earth 10m を簡略化、パブリックドメイン)
web/data/japan_pref.geojson  # 3Dビューの都道府県境界(Natural Earth 10m admin_1 の内部境界のみ抽出、パブリックドメイン)
web/data/gosetsu.geojson     # 指定区域の表示用データ(build-data.shが生成)
web/data/stations_maxdepth.geojson  # 観測点・最深積雪(build-stations.shが生成)
web/data/stations_snowfall.geojson  # 観測点・累計降雪量(build-stations.shが生成)
web/manifest.webmanifest     # PWA マニフェスト(アプリ名・アイコン・表示モード)
web/sw.js                    # Service Worker(オフライン対応のキャッシュ制御)
web/icons/                   # PWA/ファビコン用アイコン(雪の結晶、PNG + SVG)
```

## 3Dビュー(Three.js + WebGL)

`web/3d.html` は、2D地図と同じデータ(A22-m-14 の観測点・A22-2016 の指定区域)を
Three.js + WebGL で立体表示する別アプリです(公開URL: `.../3d.html`)。観測点を積雪量に応じた
高さのカラムで表示し、次の操作ができます。

- データセット(最深積雪 / 累計降雪量)と、**高さ・色に別々の指標**(累年平均 / 累年最大 / 最新年)を割り当て
- 高さフィルタ(指定 cm 以上のみ表示)、都道府県での絞り込み(観測点を指定区域ポリゴンに点内包判定して都道府県を割り当て)
- 指定区域の表示切替(なし / アウトライン / 豪雪区分での塗り分け)
- 日本全体の地形(海岸線)と都道府県境界をベースマップとして表示(雪データのない地域も含めて日本の形・区分が分かる)
- カメラプリセット(全体 / 北海道 / 東北 / 北陸)、カラムのクリックで詳細固定表示
- 多言語対応(日本語 / English / 简体中文 / 한국어)
- 現在の表示状態を URL ハッシュに保存する共有リンク(ディープリンク)

Three.js(r160、MITライセンス)は CDN ではなく `web/vendor/three/` に同梱しているため、
外部への追加リクエストなしで動作します(CDN障害やネットワーク遮断の影響を受けません)。
2D版(`index.html`)は従来どおり MapLibre GL JS を CDN から読み込みます。

## PWA(インストール・オフライン対応)

2D地図版・3Dビューの両方が PWA(Progressive Web App)として動作します。

- **インストール**: スマホ・PCのブラウザから「ホーム画面に追加」/「アプリをインストール」で、
  スタンドアロン表示(ブラウザUIなし)のアプリとして起動できます。
  Android のロングタップ用ショートカットから「2D地図」「3Dビュー」を直接開けます。
- **オフライン対応**: `web/sw.js`(Service Worker)がリソースをキャッシュします。
  - **3Dビューは一度オンラインで開けば完全にオフラインで動作します**
    (Three.js・GeoJSON をすべて同一オリジンに同梱しているため)。
  - 2D地図版はオフラインでもアプリ自体は起動し、閲覧済みの範囲の地理院タイルは表示されます
    (未取得のタイルは表示できません)。
  - 初回訪問では Service Worker が制御を取る前にページ側のデータ取得が終わってしまうため、
    ページ読み込み後に SW へ `WARM_CACHE` を送り、データ・ライブラリをバックグラウンドで
    キャッシュしています(取得済みならスキップ)。これにより**1回目の訪問だけでオフライン化が完了**します。

キャッシュ戦略はリソースの性質ごとに分けています(詳細は `web/sw.js` 冒頭のコメント)。

| 対象 | 戦略 |
| --- | --- |
| HTML・manifest・アイコン | install 時にプリキャッシュ。ページ遷移は network-first(更新を即反映、オフライン時はキャッシュ) |
| `data/*.geojson`・`vendor/three/*` | cache-first(合計6MB超のため再取得しない) |
| CDN(unpkg の MapLibre) | cache-first(URLにバージョンを含み内容が変わらないため) |
| 地理院タイル | cache-first + 上限300枚(超過分は古いものから削除) |

キャッシュ名には `japan-snowfall-viz-` の接頭辞を付け、古いキャッシュの削除時はこの接頭辞のものだけを
対象にしています(`user.github.io` は他のリポジトリのページとオリジンを共有するため、
他アプリのキャッシュを巻き添えで消さないようにするため)。

> **メンテナンス時の注意**: `web/data/` のデータや `web/vendor/` のライブラリを更新したときは、
> `web/sw.js` の `VERSION`(`const VERSION = "v1";`)を必ず上げてください。
> これらは cache-first のため、VERSION を上げないと古いキャッシュが使われ続けます。
> VERSION を変更すると旧キャッシュが破棄され、新しいデータを取り直します。
> HTML は network-first なので、HTMLだけの変更では VERSION 更新は不要です。

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

Service Worker は `localhost`(セキュアコンテキスト扱い)でも有効なため、ローカルでも
PWA の動作を確認できます。`file://` で直接開いた場合は登録をスキップし、通常のページとして動作します。
キャッシュを消してから確認したいときは、DevTools の Application → Storage → Clear site data を使ってください。

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
