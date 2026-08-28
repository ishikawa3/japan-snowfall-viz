/*
 * Service Worker(PWA オフライン対応)
 *
 * キャッシュ戦略はリソースの性質ごとに分けている:
 *
 *  1. アプリシェル(HTML / manifest / アイコン)
 *     install 時にプリキャッシュ。ナビゲーションは network-first にして
 *     デプロイ後の更新をすぐ拾い、オフライン時はキャッシュにフォールバックする。
 *
 *  2. データ(data/*.geojson)とライブラリ(vendor/three/*)
 *     合計 6MB 超と大きいため cache-first(取得後は再検証しない)。
 *     毎回の再取得を避け、モバイル回線の通信量を抑える。
 *     ★データやライブラリを更新したときは下の VERSION を必ず上げること。
 *       (VERSION が変わると旧キャッシュを破棄して取り直す)
 *
 *  3. CDN(unpkg の MapLibre。2D地図版のみ使用)
 *     URL にバージョンが含まれ内容が変わらないため cache-first。
 *
 *  4. 地理院タイル(2D地図版の背景地図)
 *     cache-first + 上限つき(TILE_LIMIT)。上限を超えたら古いものから削除する。
 *     枚数が無制限に増えるとストレージを圧迫するため。
 *
 * 3Dビュー(3d.html)は Three.js もデータもすべて同一オリジンに同梱しているため、
 * 一度オンラインで開けば完全にオフラインで動作する。2D地図版は上記 3〜4 の
 * キャッシュが溜まった範囲(閲覧済みのタイル)でオフライン表示できる。
 */

const VERSION = "v1";

// このSWが管理するキャッシュの接頭辞。
// GitHub Pages(user.github.io)は同一オリジンを他のリポジトリのページと共有するため、
// 古いキャッシュを消すときはこの接頭辞のものだけを対象にする(他アプリの巻き添えを防ぐ)。
const CACHE_PREFIX = "japan-snowfall-viz-";

const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${VERSION}`;
const TILE_CACHE = `${CACHE_PREFIX}tiles-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, TILE_CACHE];

// 地理院タイルの保持上限(枚)
const TILE_LIMIT = 300;

// install 時に確実に持っておくもの(オフライン起動に必要な最小限)
const SHELL_URLS = [
  "./",
  "./index.html",
  "./3d.html",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// ページ読み込み後にバックグラウンドで温めておくリソース。
// 初回訪問では「SWが制御を取る前にページ側のデータ取得が終わっている」ため、
// これを行わないと2回目の訪問までオフラインで動作しない。
// ページから { type: "WARM_CACHE", profile } を受け取ったタイミングで取得する
// (取得済みならスキップ)。
//
// 温める対象はページごとに分ける。2D地図版しか使わない利用者が
// 3D専用の資産(Three.js・地形データ)まで取得してしまうのを避けるため。
const WARM_2D = [
  "./data/gosetsu.geojson",
  "./data/stations_maxdepth.geojson",
  "./data/stations_snowfall.geojson",
];
const WARM_SETS = {
  "2d": WARM_2D,
  // 3Dビューは 2D と同じデータに加えて、地形と Three.js が必要
  "3d": [
    ...WARM_2D,
    "./data/japan.geojson",
    "./data/japan_pref.geojson",
    "./vendor/three/build/three.module.js",
    "./vendor/three/examples/jsm/controls/OrbitControls.js",
  ],
};

const CDN_HOSTS = ["unpkg.com"];
const TILE_HOSTS = ["cyberjapandata.gsi.go.jp"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 1つでも失敗すると install 全体が失敗する addAll は避け、個別に投入する
      // (HTTPキャッシュを迂回するため cache: "reload" を指定)
      await Promise.allSettled(
        SHELL_URLS.map(async (url) => {
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (res && res.ok) await cache.put(url, res);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // 自分が作ったキャッシュ(接頭辞つき)のうち、現行バージョン以外だけを削除する
          .filter((k) => k.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(k))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  // 手動更新用
  if (msg === "SKIP_WAITING") self.skipWaiting();
  // ページ読み込み後のキャッシュ温め。
  // activate の waitUntil で行うと activating の間 fetch イベントが滞留して
  // ページ表示を待たせてしまうため、ページ側から明示的に依頼を受けて実行する。
  // どのページからの依頼かは profile で受け取り、必要な資産だけを温める。
  if (msg && msg.type === "WARM_CACHE") {
    const urls = WARM_SETS[msg.profile];
    if (urls) event.waitUntil(warmAssets(urls));
  }
});

// データ・ライブラリを順番に取得してキャッシュへ入れる(取得済みはスキップ)。
// 途中で失敗しても次回の訪問で再試行されるため、エラーは無視してよい。
async function warmAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  for (const url of urls) {
    try {
      if (await cache.match(url)) continue;
      const res = await fetch(url);
      if (res && res.ok) await cache.put(url, res);
    } catch (e) {
      /* オフライン等。次の訪問で再試行する */
    }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // ページ遷移: network-first(更新を拾う) → キャッシュ → オフラインは index.html
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(event));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && /\/(data|vendor)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(event, ASSET_CACHE));
    return;
  }
  if (sameOrigin) {
    // アイコンや manifest など、その他の同一オリジン資産
    event.respondWith(cacheFirst(event, SHELL_CACHE));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event, ASSET_CACHE));
    return;
  }
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event, TILE_CACHE, TILE_LIMIT));
    return;
  }
  // それ以外は素通し(失敗時のみキャッシュを見る)。
  // キャッシュにも無い場合は undefined を返さないよう、明示的にネットワークエラーを返す
  // (respondWith(undefined) は TypeError になるため)。
  event.respondWith(
    fetch(req).catch(async () => (await caches.match(req)) || Response.error())
  );
});

async function handleNavigate(event) {
  const req = event.request;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      // キャッシュへの書き込みは waitUntil で保護する。
      // レスポンスを返した直後にSWが停止して書き込みが中断されるのを防ぐ。
      const copy = res.clone();
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)));
    }
    return res;
  } catch (e) {
    const cached = (await caches.match(req)) || (await caches.match("./index.html"));
    if (cached) return cached;
    return new Response("オフラインです / You are offline", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

// 取得済みならキャッシュを返し、無ければ取得して保存する
async function cacheFirst(event, cacheName, limit) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // opaque(CORS なしの他オリジン。タイル等)は status 0 なので type で判定する
    if (res && (res.ok || res.type === "opaque")) {
      // 保存と上限調整は waitUntil で保護し、SW停止で中断されないようにする
      const copy = res.clone();
      event.waitUntil(
        (async () => {
          await cache.put(req, copy);
          // 開き直さず、ここで開いた cache をそのまま渡す(タイルは頻度が高い)
          if (limit) await trimCache(cache, limit);
        })()
      );
    }
    return res;
  } catch (e) {
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw e;
  }
}

// 上限を超えた分を古い順(挿入順)に削除する(呼び出し側で開いた cache を受け取る)
async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}
