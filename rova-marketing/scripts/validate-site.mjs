import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const clientRoot = resolve(projectRoot, "dist/client");
const worker = await import("../dist/server/index.js");

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      const requested = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const filePath = resolve(clientRoot, requested || "index.html");
      if (!filePath.startsWith(clientRoot + sep) && filePath !== clientRoot) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const body = await readFile(filePath);
        return new Response(body, {
          headers: { "content-type": types.get(extname(filePath)) || "application/octet-stream" },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};

async function expectStatus(pathname, status, contains = null) {
  const response = await worker.default.fetch(new Request(`https://floraljet.test${pathname}`), env);
  assert.equal(response.status, status, pathname);
  if (contains) {
    const text = await response.text();
    assert.match(text, contains, pathname);
  }
}

await expectStatus("/", 200, /Rivo/);
await expectStatus("/", 200, /All-in-one dispatch[\s\S]*Multi-stop routes, in sync/);
await expectStatus("/", 200, /Start Free/);
await expectStatus("/", 200, /7 days free/);
await expectStatus("/", 200, /Actual product/);
await expectStatus("/demo.html", 200, /See one business coordinate its delivery day/);
await expectStatus("/demo.html", 200, /Add delivery/);
await expectStatus("/demo.html", 200, /Assign \+ Optimize/);
await expectStatus("/demo.html", 200, /Check capacity/);
await expectStatus("/pricing.html", 200, /Simple plans/);
await expectStatus("/pricing.html", 200, /\$99/);
await expectStatus("/pricing.html", 200, /\$199/);
await expectStatus("/pricing.html", 200, /\$399/);
await expectStatus("/industries.html", 200, /For businesses/);
await expectStatus("/contact.html", 200, /Book a Demo \/ Operations Review/);
await expectStatus("/assets/marketing-form.js?v=41", 200, /https:\/\/app\.floraljet\.llc\/api\/leads/);
await expectStatus("/contact.html", 200, /Optional details/);
await expectStatus("/assets/rova-logo.png", 200);
await expectStatus("/assets/rova-mark.svg", 200);
await expectStatus("/assets/rivo-logo.png", 200);
await expectStatus("/assets/rova-app-preview.jpg", 200);
await expectStatus("/assets/rova-animated-ad.mp4", 200);
await expectStatus("/assets/rova-animated-ad-poster.jpg", 200);
await expectStatus("/assets/rova-secondary.css", 200, /--blue: #[0-9a-f]{6}/);
await expectStatus("/favicon.ico", 200);
await expectStatus("/missing-page", 404);

// Header destinations must be real, useful routes rather than homepage anchors.
const destinations = [["/product", "Product"], ["/mileage", "Mileage"], ["/industries", "Industries"], ["/pricing", "Pricing"], ["/contact", "Book a Demo"]];
for (const path of ["/", ...destinations.map(([path]) => path)]) {
  const response = await worker.default.fetch(new Request(`https://floraljet.test${path}`), env);
  assert.equal(response.status, 200, path);
  const page = await response.text();
  const nav = page.match(/<nav aria-label="Main navigation">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, `${path}: main navigation exists`);
  for (const [href, label] of destinations) assert.ok(nav.includes(`href="${href}"`), `${path}: ${label} destination`);
  assert.doesNotMatch(nav, /href="[^"]*#/);
  assert.equal((page.match(/<h1(?:\s|>)/g) || []).length, 1, `${path}: one page heading`);
}
for (const path of ["/product", "/mileage"]) {
  const page = await (await worker.default.fetch(new Request(`https://floraljet.test${path}`), env)).text();
  assert.ok(page.includes(`rel="canonical" href="https://floraljet.llc${path}"`));
  assert.ok(page.includes(`href="${path}" aria-current="page"`));
  for (const [, asset] of page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) await expectStatus(asset, 200);
  const schema = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema["@graph"].at(-1).url, `https://floraljet.llc${path}`);
}
const sitemap = await readFile(resolve(clientRoot, "sitemap.xml"), "utf8");
for (const path of ["/product", "/mileage"]) assert.ok(sitemap.includes(`https://floraljet.llc${path}</loc>`));


const homepage = await (await worker.default.fetch(new Request("https://floraljet.test/"), env)).text();
assert.match(homepage, /href="https:\/\/app\.floraljet\.llc\/operations">Log in<\/a>/);
assert.match(homepage, /href="https:\/\/app\.floraljet\.llc\/signup"/);
assert.doesNotMatch(homepage.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<[^>]*>/g," "), /FleetJet|FloralJet|Rova|on autopilot/i);
assert.match(homepage, /rivo-dispatch-current\.png/);
assert.match(homepage, /href="#product-tour"[^>]*>See it in motion/);
const contact = await (await worker.default.fetch(new Request("https://floraljet.test/contact"), env)).text();
assert.equal((contact.match(/ required=""/g)||[]).length,3);
const alias = await worker.default.fetch(new Request("https://floral-jet.spennyman.chatgpt.site/pricing"),env);
assert.equal(alias.status,308);
assert.equal(alias.headers.get("Location"),"https://floraljet.llc/pricing");
console.log("Marketing routes, assets, direct signup, pricing, short contact form, brand copy and canonical redirects passed.");
