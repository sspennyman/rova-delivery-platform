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
await expectStatus("/", 200, /Local delivery,[\s\S]*on autopilot/);
await expectStatus("/", 200, /Every delivery has an owner, a route, a status, and a completion record/);
await expectStatus("/", 200, /Invitation-only driver accounts/);
await expectStatus("/", 200, /The paid route can start at home/);
await expectStatus("/demo.html", 200, /See one business coordinate its delivery day/);
await expectStatus("/demo.html", 200, /Add delivery/);
await expectStatus("/demo.html", 200, /AI Assign \+ Optimize/);
await expectStatus("/demo.html", 200, /Check capacity/);
await expectStatus("/pricing.html", 200, /Plans that scale with your delivery team/);
await expectStatus("/pricing.html", 200, /\$99-\$399\/mo/);
await expectStatus("/pricing.html", 200, /Flexible plans for different delivery teams/);
await expectStatus("/industries.html", 200, /Built for businesses using their own drivers, courier partners, or both/);
await expectStatus("/contact.html", 200, /Plan your Rivo operational review/);
await expectStatus("/contact.html", 200, /https:\/\/app\.floraljet\.llc\/api\/leads/);
await expectStatus("/contact.html", 200, /id="sales-form"/);
await expectStatus("/assets/rova-logo.png", 200);
await expectStatus("/assets/rova-mark.svg", 200);
await expectStatus("/assets/rivo-logo.png", 200);
await expectStatus("/assets/rova-app-preview.jpg", 200);
await expectStatus("/assets/rova-animated-ad.mp4", 200);
await expectStatus("/assets/rova-animated-ad-poster.jpg", 200);
await expectStatus("/assets/rova-secondary.css", 200, /--blue: #1468ff/);
await expectStatus("/favicon.ico", 200);
await expectStatus("/missing-page", 404);

const homepage = await (await worker.default.fetch(new Request("https://floraljet.test/"), env)).text();
assert.match(homepage, /href="https:\/\/app\.floraljet\.llc\/">Log in<\/a>/, "the public site should link to the Rivo app login");
assert.match(homepage, /floral-jet\.spennyman\.chatgpt\.site[\s\S]*https:\/\/floraljet\.llc/, "the public shell should replace the old Sites alias before rendering");
assert.match(homepage, /property="og:image" content="https:\/\/floraljet\.llc\/assets\/rova-app-preview\.jpg"/, "the public site should include the current product in its social preview");
assert.doesNotMatch(homepage, /FleetJet/i, "the public homepage should not expose the previous company name");
assert.doesNotMatch(homepage, /SaaS first/i);
assert.doesNotMatch(homepage, /Marketplace second/i);
assert.doesNotMatch(homepage, /future module/i);
assert.match(homepage, /Connect stores and webhooks/, "the homepage should describe the supported connection workflow clearly");
assert.match(homepage, /Shopify[\s\S]*WooCommerce[\s\S]*Wix/, "the homepage should name supported direct commerce connections");
assert.match(homepage, /single-use link that expires after seven days/i, "the homepage should explain driver invitation security");
assert.match(homepage, /Plans start at \$99 CAD per month/, "the homepage should make the pricing starting point visible");
assert.match(homepage, /Home → Work and Depot → Home/, "the homepage should explain paid home-route support");
assert.match(homepage, /Proof and exception records[\s\S]*photo or recipient signature/i, "the homepage should describe the released proof workflow");
assert.match(homepage, /own drivers and third-party couriers/i, "the homepage should position Rivo for hybrid local-delivery operations");
assert.match(homepage, /Rivo Guided Onboarding/, "the homepage should present a structured onboarding program");
assert.match(homepage, /structured operational review/i, "the homepage should position onboarding as an established process");
assert.match(homepage, /14-day evaluation/, "the homepage should explain the evaluation duration");
assert.doesNotMatch(homepage, /Founding 10|founding spots?|claim (?:a|my) pilot spot/i, "the public offer should not make Rivo sound newly established");
assert.match(homepage, /Set up in under 10 minutes[\s\S]*Your drivers \+ courier partners[\s\S]*Plans from \$99 CAD/, "the hero should lead with fast setup, flexible fulfilment, and transparent pricing");
assert.match(homepage, /own drivers and third-party couriers[\s\S]*request, status, reference number, fee, and tracking link/i, "the homepage should explain the released courier-partner workflow");
assert.match(homepage, /clearly marked as not sent/i, "courier request copy must distinguish prepared requests from sent messages");
assert.doesNotMatch(homepage, /Coming next|Rivo Driver pilot/, "the primary sales page should not present unreleased roadmap work as current product value");
assert.doesNotMatch(homepage, /Parkside Pharmacy|Bloom Room Florals|Greenlane Express|Northline Courier/i, "the homepage demo should represent one business and its customers");
assert.match(homepage, /The screenshot is the current Rivo product/, "the homepage should show the actual dispatcher, not only a synthetic product mockup");
assert.match(homepage, /id="video-demo"/, "the homepage should expose the product-video destination");
assert.match(homepage, /45-second product walkthrough/, "the homepage should describe the guided product walkthrough clearly");
assert.match(homepage, /<video[\s\S]*assets\/rova-animated-ad\.mp4/, "the homepage should embed the current animated product ad");

for (const pathname of ["contact.html", "demo.html", "industries.html", "pricing.html", "privacy.html", "terms.html"]) {
  const page = await (await worker.default.fetch(new Request(`https://floraljet.test/${pathname}`), env)).text();
  assert.doesNotMatch(page, /#how-it-works/, `${pathname} should not link to a missing homepage anchor`);
  assert.match(page, /index\.html#platform/, `${pathname} should link to the released platform section`);
  assert.match(page, /rel="icon" href="assets\/rova-mark\.svg"/, `${pathname} should use the current Rivo mark`);
}

const contactPage = await (await worker.default.fetch(new Request("https://floraljet.test/contact.html"), env)).text();
assert.doesNotMatch(contactPage, /action="mailto:/i, "demo requests should enter the Rivo account pipeline");
assert.doesNotMatch(contactPage, /Pay Setup Deposit/i, "public demo requests should not ask for payment before scope is agreed");

const aliasResponse = await worker.default.fetch(new Request("https://floral-jet.spennyman.chatgpt.site/pricing.html?source=old-link"), env);
assert.equal(aliasResponse.status, 308, "the Sites alias should permanently redirect");
assert.equal(aliasResponse.headers.get("location"), "https://floraljet.llc/pricing.html?source=old-link", "the redirect should preserve path and query");
const forwardedAliasResponse = await worker.default.fetch(
  new Request("https://floraljet.llc/pricing.html?source=forwarded", {
    headers: { "x-forwarded-host": "floral-jet.spennyman.chatgpt.site" },
  }),
  env,
);
assert.equal(forwardedAliasResponse.status, 308, "forwarded Sites aliases should redirect too");
assert.equal(forwardedAliasResponse.headers.get("location"), "https://floraljet.llc/pricing.html?source=forwarded");

console.log("Site package is valid");
