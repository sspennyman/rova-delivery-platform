const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const MARKETING_CANONICAL_HOST = "floraljet.llc";
const MARKETING_HOSTING_ALIASES = new Set([
  "floral-jet.spennyman.chatgpt.site",
  "www.floraljet.llc",
]);

const cacheableExtensions = new Set([
  ".css",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".js",
  ".mp4",
  ".png",
  ".svg",
  ".webp",
]);

function hasExtension(pathname) {
  return /\.[a-z0-9]+$/i.test(pathname);
}

function extension(pathname) {
  const match = pathname.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizePath(pathname) {
  if (pathname === "/" || pathname === "") return "/index.html";
  if (pathname === "/favicon.ico") return "/assets/rova-mark.svg";
  if (pathname.includes("..")) return null;
  if (!hasExtension(pathname)) return `${pathname.replace(/\/$/, "")}.html`;
  return pathname;
}

function withHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }
  if (cacheableExtensions.has(extension(pathname))) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  } else {
    headers.set("cache-control", "public, max-age=300");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(request, env, pathname) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const url = new URL(request.url);
  url.pathname = pathname;
  const assetRequest = new Request(url, request);
  const response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 404) return null;
  return withHeaders(response, pathname);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const forwardedHost = String(request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
      .split(",")[0]
      .trim()
      .split(":")[0];
    if (MARKETING_HOSTING_ALIASES.has(url.hostname) || MARKETING_HOSTING_ALIASES.has(forwardedHost)) {
      url.protocol = "https:";
      url.hostname = MARKETING_CANONICAL_HOST;
      return new Response(null, {
        status: 308,
        headers: {
          "cache-control": "public, max-age=3600",
          location: url.toString(),
        },
      });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const pathname = normalizePath(decodeURIComponent(url.pathname));
    if (!pathname) return new Response("Bad request", { status: 400 });

    const asset = await fetchAsset(request, env, pathname);
    if (asset) return asset;

    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
