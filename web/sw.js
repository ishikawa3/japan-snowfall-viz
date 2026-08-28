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

const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;
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
        keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 手動更新用(ページ側から postMessage できるようにしておく)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // ページ遷移: network-first(更新を拾う) → キャッシュ → オフラインは index.html
  if (req.mode === "navigate") {
    event.respondWith(handleNavigate(req));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && /\/(data|vendor)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (sameOrigin) {
    // アイコンや manifest など、その他の同一オリジン資産
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, TILE_CACHE, TILE_LIMIT));
    return;
  }
  // それ以外は素通し(失敗時のみキャッシュを見る)
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function handleNavigate(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(req, res.clone());
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
async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    // opaque(CORS なしの他オリジン。タイル等)は status 0 なので type で判定する
    if (res && (res.ok || res.type === "opaque")) {
      await cache.put(req, res.clone());
      if (limit) trimCache(cacheName, limit);
    }
    return res;
  } catch (e) {
    const fallback = await caches.match(req);
    if (fallback) return fallback;
    throw e;
  }
}

// 上限を超えた分を古い順(挿入順)に削除する
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) await cache.delete(key);
}
