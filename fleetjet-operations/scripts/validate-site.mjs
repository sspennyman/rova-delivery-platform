import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const requiredFiles = [
  "dist/server/index.js",
  "dist/client/index.html",
  "dist/client/operations.html",
  "dist/client/app.js",
  "dist/client/styles.css",
  "dist/client/manifest.webmanifest",
  "dist/client/assets/rova-logo.png",
  "dist/client/assets/rova-mark.svg",
  "dist/client/assets/rivo-logo.png",
  "dist/.openai/hosting.json",
  "dist/.openai/drizzle/0001_rova_normalized_projection.sql"
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing ${relativePath}. Run npm run build first.`);
  }
}

const appHtml = fs.readFileSync(path.join(root, "dist/client/index.html"), "utf8");
const operationsHtml = fs.readFileSync(path.join(root, "dist/client/operations.html"), "utf8");
assert.match(appHtml, /id="app"/, "the public root should load the Rivo application shell");
assert.match(appHtml, /app\.js\?v=45/, "the public root should load the latest Rivo app bundle");
assert.match(operationsHtml, /id="app"/, "the dispatcher route should retain the operations application shell");
assert.match(operationsHtml, /app\.js\?v=45/, "the dispatcher route should load the latest Rivo app bundle");

const hosting = JSON.parse(fs.readFileSync(path.join(root, "dist/.openai/hosting.json"), "utf8"));
if (!hosting.project_id) {
  throw new Error("dist/.openai/hosting.json must include project_id.");
}

const appSource = fs.readFileSync(path.join(root, "dist/client/app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "dist/client/styles.css"), "utf8");
assert.match(appSource, /Run the delivery day without the chaos/, "the app subdomain should render the Rivo login portal");
assert.match(appSource, /Rivo app/, "the app portal should use the Rivo company name");
assert.match(appSource, /Business profile/, "dispatcher workspaces should include operational settings");
assert.match(appSource, /Nothing on this page creates a charge/, "plan settings must not create accidental charges");
assert.match(appSource, /Balance orders/, "dispatcher workspaces should expose workload balancing without overstating AI");
assert.match(appSource, /Smart Dispatch/, "the dispatcher should expose explainable route recommendations");
assert.match(appSource, /Optimize deliveries/, "dispatchers should be able to preview a route plan before applying it");
assert.match(appSource, /Live operations data/, "analytics should identify the source of its operational metrics");
assert.match(appSource, /Route capacity/, "driver profiles should include capacity for workload planning");
assert.match(appSource, /Add or connect orders/, "onboarding should support manual entry without forcing an integration");
assert.match(appSource, /Next delivery/, "the mobile driver workflow should make the next stop obvious");
assert.match(appSource, /First time here\?/, "the app login should explain driver invite passwords");
assert.doesNotMatch(appSource, /lead-capture-form|Request demo|Request pilot/, "the app subdomain should not expose a public sales form");
assert.match(appSource, /Private dispatcher workspace for inbound requests/, "the dispatcher app should include the private accounts workspace");
assert.match(appSource, /Invite link copied/, "the add-driver flow should expose the invite fallback clearly");
assert.match(appSource, /Open email draft/, "manual driver invitations should open a complete email draft");
assert.match(appSource, /Download operational backup/, "dispatchers should be able to export a redacted continuity backup");
assert.match(appSource, /rivoAuthStateV2/, "browser auth state should use the hardened session marker");
assert.match(appSource, /credentials: "same-origin"/, "browser requests should include the secure session cookie");
const drawMapSource = appSource.slice(appSource.indexOf("function drawMap"), appSource.indexOf("function drawCanvasMap"));
assert.match(drawMapSource, /renderGoogleRoutes/, "configured maps should render address-based route previews");
assert.match(drawMapSource, /renderOpenMap/, "the live map should retain a reliable keyless GPS fallback");
assert.match(
  drawMapSource,
  /renderGoogleRoutes[\s\S]*if \(!rendered\) return useLiveMap\(\)/,
  "route preview should fall back to the live GPS map only when route rendering is unavailable"
);
assert.match(appSource, /Waiting for driver GPS/, "the live map should explain its pre-location state");
assert.match(appSource, /https:\/\/tiles\.openfreemap\.org\/styles\/positron/, "the live GPS fallback should use a real keyless basemap");
assert.match(appSource, /rova-live-routes/, "the keyless basemap should render live route paths");
assert.match(stylesSource, /\.google-map\.maplibregl-map/, "the keyless basemap should fill the live map panel");
assert.match(appSource, /your drivers, and the work that needs attention/, "the dispatcher shell should use daily staff language");
assert.match(appSource, /Each driver creates their own password/, "driver onboarding should explain the login flow");
assert.match(appSource, /Invitation-only accounts/, "driver onboarding should expose account status as a first-class workflow");
assert.match(appSource, /Reset link ready to share/, "manual password-reset links must not be mislabeled as sent email");
assert.match(stylesSource, /\.invite-shell/, "driver invitations should have a purpose-built responsive signup screen");
assert.match(appSource, /data-select-all-orders/, "the dispatch queue should expose select-all batch actions");
assert.match(appSource, /assign-selected-orders/, "selected orders should support bulk assignment");
assert.match(appSource, /request-selected-courier/, "selected orders should support courier requests without fake driver records");
assert.match(appSource, /Courier partners/, "the delivery team should manage saved courier partners beside in-house drivers");
assert.match(appSource, /not sent yet/i, "manual courier requests must never be mislabeled as sent");
assert.match(appSource, /Provider updates only/, "customer tracking should distinguish courier updates from driver GPS");
assert.match(appSource, /complete-selected-active/, "active deliveries should support bulk completion");
assert.match(appSource, /driver-roster-list/, "driver editing should use the visible roster layout");
assert.match(stylesSource, /\.bulk-action-bar/, "batch controls should stay together in a persistent action bar");
assert.match(appSource, /Take or choose photo/, "drivers should be able to capture a real proof photo");
assert.match(appSource, /data-signature-pad/, "drivers should be able to collect a real signature");
assert.match(appSource, /Resolve delivery issues/, "dispatchers should have a first-class exception recovery workflow");
assert.match(appSource, /Search customer, order, address, or driver/, "the daily queue should be searchable without leaving dispatch");
assert.match(stylesSource, /\.today-glance/, "the dispatch view should include a compact daily closeout summary");
assert.match(appSource, /Arrange dashboard sections/, "dispatchers should be able to open dashboard customization");
assert.match(appSource, /rivoDispatcherDashboardLayoutV3/, "dashboard layout preferences should persist on the device");
assert.match(appSource, /Dispatch workflow/, "the daily dashboard should expose a clear orders-to-route-to-active flow");
assert.match(appSource, /hidden: \["assistant", "create"\]/, "secondary tools should stay out of the default dispatch flow");
assert.match(appSource, /: \[\.\.\.defaults\.hidden\]/, "a fresh dashboard must retain the simplified default visibility");
assert.match(appSource, /No orders yet/, "an empty queue should use one concise action state");
assert.match(appSource, /Route details & customer links/, "active delivery detail should stay collapsed until needed");
assert.match(appSource, /data-dashboard-drag-handle/, "dashboard sections should support drag-and-drop ordering");
assert.match(appSource, /resize-dashboard-widget/, "dashboard sections should support compact or full-width sizing");
assert.match(stylesSource, /\.dashboard-board[\s\S]*grid-template-columns: repeat\(12/, "the operations dashboard should use a rearrangeable grid");
assert.match(stylesSource, /\.dispatch-side-stack,\s*\n\.route-preview-panel \{\s*\n\s*position: static/, "the route map should stay in normal page flow while scrolling");
assert.match(appSource, /Repair owner sign-in/, "legacy owner accounts should have a visible recovery flow");
assert.match(appSource, /\/api\/auth\/owner-recovery/, "the owner recovery form should use the protected recovery endpoint");
assert.match(appSource, /Connect stores and order webhooks/, "connections should be a first-class product workflow");
assert.doesNotMatch(appSource, /Revenue ladder|SaaS target model|data-view="growth"|id="growth"|Growth plan/, "public app bundle should not ship old growth strategy copy");

const workerPath = path.join(root, "dist/server/index.js");
const worker = await import(pathToFileURL(workerPath).href);
if (typeof worker.default?.fetch !== "function") {
  throw new Error("dist/server/index.js must export default.fetch(request, env).");
}

class FakeD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new FakeD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    if (!this.sql.startsWith("SELECT payload_json")) {
      throw new Error(`Unsupported D1 query: ${this.sql}`);
    }
    return this.database.row ? { ...this.database.row } : null;
  }

  async run() {
    if (this.sql.startsWith("CREATE TABLE")) return { meta: { changes: 0 } };
    if (this.sql.trim().startsWith("UPDATE delivery_tracker_state_v1")) {
      const [payloadJson, updatedAt, stateKey, expectedUpdatedAt] = this.bindings;
      if (!this.database.row || this.database.row.state_key !== stateKey || this.database.row.updated_at !== expectedUpdatedAt) {
        return { meta: { changes: 0 } };
      }
      this.database.row = { state_key: stateKey, payload_json: payloadJson, updated_at: updatedAt };
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO delivery_tracker_state_v1")) {
      const [stateKey, payloadJson, updatedAt] = this.bindings;
      if (this.database.row && this.sql.includes("DO NOTHING")) return { meta: { changes: 0 } };
      this.database.row = { state_key: stateKey, payload_json: payloadJson, updated_at: updatedAt };
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unsupported D1 statement: ${this.sql}`);
  }
}

class FakeD1 {
  row = null;

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }
}

class FakeR2 {
  objects = new Map();

  async put(key, value, options = {}) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, options });
    return { key };
  }

  async get(key) {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      body: item.bytes,
      writeHttpMetadata(headers) {
        if (item.options.httpMetadata?.contentType) headers.set("content-type", item.options.httpMetadata.contentType);
      }
    };
  }

  async delete(key) {
    this.objects.delete(key);
  }
}

async function loadFreshWorker(version) {
  return import(`${pathToFileURL(workerPath).href}?validation=${version}`);
}

const database = new FakeD1();
const proofMedia = new FakeR2();
const assetRequests = [];
const env = {
  DB: database,
  PROOF_MEDIA: proofMedia,
  COMPANY_NAME: "Rivo",
  OWNER_SETUP_CODE: "validation-setup-code",
  ASSETS: {
    fetch: async (request) => {
      assetRequests.push(new URL(request.url).pathname);
      return new Response("<!doctype html><div id=\"app\"></div>", {
        headers: { "content-type": "text/html" }
      });
    }
  }
};
const setupRequest = new Request("https://vms.test/api/auth/setup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    setupCode: "validation-setup-code",
    companyName: "Rivo",
    name: "Rivo Owner",
    username: "fleetjetowner",
    password: "validation-password"
  })
});
const initialWorker = await loadFreshWorker("initial");
const setupResponse = await initialWorker.default.fetch(setupRequest, env);
assert.equal(setupResponse.status, 201, "owner setup should save to the attached database");
assert.equal(setupResponse.headers.get("cache-control"), "no-store", "authentication responses must not be cached");
assert.match(setupResponse.headers.get("set-cookie") || "", /rivo_session=.*HttpOnly.*Secure.*SameSite=Lax/, "owner setup should issue a secure HttpOnly session cookie");
assert.match(setupResponse.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, "responses should include the production content-security policy");
const setupPayload = await setupResponse.json();
assert.ok(database.row?.payload_json, "attached database should contain the saved Rivo state");
assert.equal(setupPayload.snapshot.drivers.length, 0, "a fresh production workspace should not seed demo drivers");
assert.equal(setupPayload.snapshot.courierPartners.length, 0, "a fresh production workspace should not seed courier partners");
assert.equal(setupPayload.snapshot.courierRequests.length, 0, "a fresh production workspace should not seed courier requests");
const setupState = JSON.parse(database.row.payload_json);
assert.ok(setupState.ownerAccount?.passwordHash, "owner passwords should be stored as hashes");
assert.equal(setupState.ownerAccount?.passwordAlgorithm, "pbkdf2-sha256", "owner passwords should use PBKDF2");
assert.equal(setupState.ownerAccount?.passwordIterations, 100000, "owner password hashing should stay within the production runtime limit");
assert.equal(setupState.ownerAccount?.password, undefined, "owner passwords must not be stored in plaintext");
assert.doesNotMatch(database.row.payload_json, /validation-password/, "the saved state must not contain the owner password");
assert.equal(setupPayload.snapshot.invitationEmail.configured, false, "the UI should expose manual sharing when email delivery is not configured");
assert.equal(setupPayload.snapshot.courierEmail.configured, false, "courier email must stay in prepared-request mode until a dedicated sender is configured");
assert.equal(setupPayload.snapshot.proofMedia.configured, true, "the UI should expose attached proof storage");
assert.equal(setupPayload.snapshot.planAccess.monthlyPrice, 99, "new workspaces should expose Starter pricing without charging the account");
assert.equal(setupPayload.snapshot.dispatchAssistant.aiConnected, false, "the rules engine must not be presented as connected generative AI");
assert.equal(setupPayload.snapshot.analytics.dataSource, "Rivo delivery records", "analytics should describe its source");
assert.equal(setupPayload.snapshot.company.currency, "CAD", "new customer workspaces should default to Canadian billing");
assert.equal(setupPayload.snapshot.company.subscriptionStatus, "evaluation", "new customer workspaces should begin a guided evaluation");
assert.equal(setupPayload.snapshot.runtimeReadiness.billingMode, "manual-invoice", "first-customer billing should stay reviewed and manual");

const setupStatusResponse = await initialWorker.default.fetch(new Request("https://vms.test/api/setup/status"), env);
const setupStatusPayload = await setupStatusResponse.json();
assert.deepEqual(Object.keys(setupStatusPayload.company), ["name"], "public setup status must not expose private workspace configuration");
assert.equal(setupStatusPayload.company.name, "Rivo", "the public sign-in gateway should use the Rivo product brand");

const cookieValue = (setupResponse.headers.get("set-cookie") || "").split(";")[0];
const cookieSessionResponse = await initialWorker.default.fetch(new Request("https://vms.test/api/me", { headers: { cookie: cookieValue } }), env);
assert.equal(cookieSessionResponse.status, 200, "secure cookie sessions should authenticate without a persisted bearer token");

const backupResponse = await initialWorker.default.fetch(new Request("https://vms.test/api/admin/backup", { headers: { cookie: cookieValue } }), env);
assert.equal(backupResponse.status, 200, "dispatchers should be able to download an operational continuity export");
assert.match(backupResponse.headers.get("content-disposition") || "", /rivo-operational-backup/, "continuity exports should download with a recognizable filename");
const backupText = await backupResponse.text();
assert.doesNotMatch(backupText, /passwordHash|passwordSalt|inviteTokenHash|shareToken|webhookTokenHash|"credentials"/, "continuity exports must redact authentication and integration secrets");

const reloadedWorker = await loadFreshWorker("reload");
const persistedResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/me", {
    headers: { authorization: `Bearer ${setupPayload.session.token}` }
  }),
  env
);
assert.equal(persistedResponse.status, 200, "saved owner session should work after a worker reload");
const persistedPayload = await persistedResponse.json();
assert.equal(persistedPayload.session.name, "Rivo Owner");
assert.equal(persistedPayload.snapshot.company.name, "Rivo");

const rootPageResponse = await reloadedWorker.default.fetch(new Request("https://vms.test/"), env);
assert.equal(rootPageResponse.status, 200, "the public root should load");
assert.equal(assetRequests.at(-1), "/index.html", "the public root should serve the public app shell");
const faviconResponse = await reloadedWorker.default.fetch(new Request("https://vms.test/favicon.ico"), env);
assert.equal(faviconResponse.status, 200, "the browser favicon request should resolve");
assert.equal(assetRequests.at(-1), "/assets/rova-mark.svg");
const stalePageResponse = await reloadedWorker.default.fetch(new Request("https://vms.test/pricing.html"), env);
assert.equal(stalePageResponse.status, 200, "stale marketing routes should keep loading");
assert.equal(assetRequests.at(-1), "/operations.html", "stale marketing routes should no longer expose old static pages");
const aliasRedirectResponse = await reloadedWorker.default.fetch(
  new Request("https://delivery-driver-tracker.spennyman.chatgpt.site/operations?invite=abc123"),
  env
);
assert.equal(aliasRedirectResponse.status, 308, "the old Sites alias should permanently redirect");
assert.equal(
  aliasRedirectResponse.headers.get("location"),
  "https://app.floraljet.llc/operations?invite=abc123",
  "the app redirect should preserve invitation paths and query strings"
);
const forwardedAliasRedirectResponse = await reloadedWorker.default.fetch(
  new Request("https://app.floraljet.llc/invite/token-123?source=email", {
    headers: { "x-forwarded-host": "delivery-driver-tracker.spennyman.chatgpt.site" }
  }),
  env
);
assert.equal(forwardedAliasRedirectResponse.status, 308, "forwarded alias hostnames should also redirect");
assert.equal(
  forwardedAliasRedirectResponse.headers.get("location"),
  "https://app.floraljet.llc/invite/token-123?source=email",
  "forwarded invitation links should preserve their full destination"
);

const healthResponse = await reloadedWorker.default.fetch(new Request("https://vms.test/api/health"), env);
assert.equal(healthResponse.status, 200, "the production health endpoint should respond");
assert.equal((await healthResponse.json()).service, "Rivo");

const leadPreflightResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/leads", {
    method: "OPTIONS",
    headers: {
      origin: "https://floraljet.llc",
      "access-control-request-method": "POST"
    }
  }),
  env
);
assert.equal(leadPreflightResponse.status, 204, "the public Rivo site should be allowed to submit leads");
assert.equal(leadPreflightResponse.headers.get("access-control-allow-origin"), "https://floraljet.llc");

const invalidLeadResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://floraljet.llc" },
    body: JSON.stringify({
      companyName: "Example Courier",
      contactName: "Operations Lead",
      email: "not-an-email",
      weeklyDeliveries: 250
    })
  }),
  env
);
assert.equal(invalidLeadResponse.status, 400, "pilot requests should require a valid email");

const leadCreateResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://floraljet.llc" },
    body: JSON.stringify({
      companyName: "Example Courier",
      contactName: "Operations Lead",
      email: "ops@example.com",
      phone: "555-0130",
      weeklyDeliveries: 250,
      deliveryCategory: "Courier",
      primaryChannel: "Shopify",
      notes: "Manual route planning and status calls are slowing the team down.",
      preferredReviewDate: "2026-09-02",
      preferredReviewWindow: "11 AM–1 PM Eastern",
      preferredContactMethod: "Email",
      attribution: {
        source: "outbound_pharmacy",
        medium: "email",
        campaign: "august_operational_review",
        content: "route_visibility",
        landingPath: "/contact.html",
        referrerHost: "mail.google.com"
      }
    })
  }),
  env
);
assert.equal(leadCreateResponse.status, 201, "public visitors should be able to request a Rivo pilot");
assert.equal(leadCreateResponse.headers.get("access-control-allow-origin"), "https://floraljet.llc");
const leadCreatePayload = await leadCreateResponse.json();
assert.match(leadCreatePayload.lead.id, /^lead_/, "pilot requests should receive a lead id");
assert.equal(leadCreatePayload.lead.stage, "new");
assert.equal(leadCreatePayload.lead.email, "ops@example.com");
assert.equal(leadCreatePayload.lead.preferredReviewDate, "2026-09-02");
assert.equal(leadCreatePayload.lead.preferredReviewWindow, "11 AM–1 PM Eastern");
assert.equal(leadCreatePayload.lead.preferredContactMethod, "Email");
assert.deepEqual(leadCreatePayload.lead.attribution, {
  source: "outbound_pharmacy",
  medium: "email",
  campaign: "august_operational_review",
  content: "route_visibility",
  landingPath: "/contact.html",
  referrerHost: "mail.google.com"
});
assert.ok(leadCreatePayload.lead.score >= 70, "high-volume channel leads should be scored as good-fit prospects");

const duplicateLeadResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://floraljet.llc" },
    body: JSON.stringify({
      companyName: "Example Courier",
      contactName: "Operations Lead",
      email: "ops@example.com",
      weeklyDeliveries: 250
    })
  }),
  env
);
assert.equal(duplicateLeadResponse.status, 202, "rapid duplicate pilot requests should not flood the sales pipeline");
assert.equal((await duplicateLeadResponse.json()).lead.id, leadCreatePayload.lead.id);

const unauthenticatedLeadStageResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/leads/${leadCreatePayload.lead.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage: "won" })
  }),
  env
);
assert.equal(unauthenticatedLeadStageResponse.status, 401, "the account pipeline must require dispatcher login");

const leadStageResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/leads/${leadCreatePayload.lead.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ stage: "pilot" })
  }),
  env
);
assert.equal(leadStageResponse.status, 200, "dispatchers should be able to move a lead through the sales pipeline");
const leadStagePayload = await leadStageResponse.json();
assert.equal(leadStagePayload.lead.stage, "pilot");
assert.equal(leadStagePayload.snapshot.leads[0].stage, "pilot");

const defaultDispatcherResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "dispatcher", password: "dispatch1234" })
  }),
  env
);
assert.equal(defaultDispatcherResponse.status, 401, "a hard-coded dispatcher fallback must not be accepted");

const invalidDriverResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/drivers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "Test Driver", vehicle: "Van", email: "not-an-email" })
  }),
  env
);
assert.equal(invalidDriverResponse.status, 400, "driver creation should require a valid email");

const driverCreateResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/drivers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Test Driver",
      vehicle: "Van",
      email: "driver@example.com",
      homeAddress: "123 Driver Home Street",
      defaultRate: 1.25
    })
  }),
  env
);
assert.equal(driverCreateResponse.status, 201, "driver creation should create an email invitation");
const driverCreatePayload = await driverCreateResponse.json();
assert.equal(driverCreatePayload.driver.homeAddress, "123 Driver Home Street", "dispatch should retain the driver's home address");
assert.equal(driverCreatePayload.driver.status, "offline", "an invited driver must not look available before account setup");
assert.equal(driverCreatePayload.driver.lastSeenAt, null, "dispatch actions must not fake driver presence");
assert.equal(driverCreatePayload.emailSent, false, "validation should retain a copy-link fallback without email credentials");
const createdInviteUrl = new URL(driverCreatePayload.inviteUrl);
const inviteToken = createdInviteUrl.searchParams.get("invite");
assert.ok(inviteToken, "driver creation should return a secure invitation link");
assert.equal(createdInviteUrl.pathname, "/operations", "driver invitations should use the production-safe application route");
assert.equal(createdInviteUrl.searchParams.get("invite"), inviteToken, "the application route must preserve the invitation token");
assert.doesNotMatch(database.row.payload_json, new RegExp(inviteToken), "the raw invitation token must not be stored");

const inviteProfileResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/auth/invite?token=${encodeURIComponent(inviteToken)}`),
  env
);
assert.equal(inviteProfileResponse.status, 200, "a fresh driver invitation should load the signup profile");
assert.equal(inviteProfileResponse.headers.get("cache-control"), "no-store", "driver invitation profiles must not be cached");
const inviteProfilePayload = await inviteProfileResponse.json();
assert.equal(inviteProfilePayload.email, "driver@example.com");

const inviteAcceptResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/invite/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: inviteToken, password: "driver-password" })
  }),
  env
);
assert.equal(inviteAcceptResponse.status, 200, "a driver should be able to accept a valid invitation");
assert.doesNotMatch(database.row.payload_json, /driver-password/, "the saved state must not contain driver passwords");
const acceptedState = JSON.parse(database.row.payload_json);
const acceptedDriver = acceptedState.drivers.find((driver) => driver.id === driverCreatePayload.driver.id);
assert.equal(acceptedDriver.passwordAlgorithm, "pbkdf2-sha256", "driver passwords should use PBKDF2");
assert.equal(acceptedDriver.passwordIterations, 100000, "driver password hashing should stay within the production runtime limit");
assert.equal(acceptedDriver.inviteTokenHash, undefined, "accepted invitation tokens should be invalidated immediately");
assert.equal(acceptedDriver.status, "available", "accepted driver accounts should become available when no route is active");

const driverLoginResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "driver@example.com", password: "driver-password" })
  }),
  env
);
assert.equal(driverLoginResponse.status, 200, "a driver should be able to log in with email after accepting an invitation");
assert.equal(driverLoginResponse.headers.get("cache-control"), "no-store", "driver login responses must not be cached");
const driverLoginPayload = await driverLoginResponse.json();
assert.equal(driverLoginPayload.session.role, "driver");
assert.equal(driverLoginPayload.snapshot.drivers.length, 1, "driver snapshots must remain private to that driver");
assert.equal(driverLoginPayload.snapshot.drivers[0].homeAddress, "123 Driver Home Street", "drivers should receive their own home address for commute trips");
assert.equal(Object.hasOwn(driverLoginPayload.snapshot, "leads"), false, "driver snapshots must not expose the sales pipeline");

const driverEmailUpdateResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/drivers/${driverCreatePayload.driver.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Test Driver",
      email: "driver.updated@example.com",
      phone: "555-0144",
      homeAddress: "456 Updated Home Avenue",
      vehicle: "Updated Van",
      shift: "Morning",
      defaultRate: 1.4,
      color: "#059669"
    })
  }),
  env
);
assert.equal(driverEmailUpdateResponse.status, 200, "dispatchers should be able to edit a driver's login email and profile");
const driverEmailUpdatePayload = await driverEmailUpdateResponse.json();
assert.equal(driverEmailUpdatePayload.driver.email, "driver.updated@example.com");
assert.equal(driverEmailUpdatePayload.driver.loginId, "driver.updated@example.com");
assert.equal(driverEmailUpdatePayload.driver.homeAddress, "456 Updated Home Avenue");
assert.equal(driverEmailUpdatePayload.identityChanged, true, "changing the login email should reset account identity");
assert.ok(driverEmailUpdatePayload.inviteUrl, "changing the login email should issue a fresh invitation");

const revokedDriverSessionResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/me", {
    headers: { authorization: `Bearer ${driverLoginPayload.session.token}` }
  }),
  env
);
assert.equal(revokedDriverSessionResponse.status, 401, "changing a login email must revoke existing driver sessions");

const updatedEmailLoginResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "driver.updated@example.com", password: "driver-password" })
  }),
  env
);
assert.equal(updatedEmailLoginResponse.status, 401, "the old password must not carry over to a corrected login email");

const emailChangeInviteToken = new URL(driverEmailUpdatePayload.inviteUrl).searchParams.get("invite");
const emailChangeAcceptResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/invite/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: emailChangeInviteToken, password: "updated-driver-password" })
  }),
  env
);
assert.equal(emailChangeAcceptResponse.status, 200, "the corrected email owner should be able to accept the fresh invitation");

const correctedEmailLoginResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "driver.updated@example.com", password: "updated-driver-password" })
  }),
  env
);
assert.equal(correctedEmailLoginResponse.status, 200, "the corrected email should become the sign-in after invitation acceptance");

const duplicateEmailDriverResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/drivers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "Second Driver", vehicle: "Car", email: "second.driver@example.com" })
  }),
  env
);
assert.equal(duplicateEmailDriverResponse.status, 201, "validation should create a second driver for duplicate-email checks");
const duplicateEmailDriverPayload = await duplicateEmailDriverResponse.json();
const duplicateEmailPatchResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/drivers/${duplicateEmailDriverPayload.driver.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: "driver.updated@example.com" })
  }),
  env
);
assert.equal(duplicateEmailPatchResponse.status, 400, "two drivers must not share the same login email");
const duplicateEmailDriverDeleteResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/drivers/${duplicateEmailDriverPayload.driver.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${setupPayload.session.token}` }
  }),
  env
);
assert.equal(duplicateEmailDriverDeleteResponse.status, 200, "the duplicate-email fixture should be removable after validation");

for (let attempt = 0; attempt < 8; attempt += 1) {
  const failedLoginResponse = await reloadedWorker.default.fetch(
    new Request("https://vms.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.44"
      },
      body: JSON.stringify({ identifier: "rate-limit@example.com", password: "incorrect-password" })
    }),
    env
  );
  assert.equal(failedLoginResponse.status, 401, "failed sign-in attempts should remain generic before the limit");
}
const rateLimitedLoginResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.44"
    },
    body: JSON.stringify({ identifier: "rate-limit@example.com", password: "incorrect-password" })
  }),
  env
);
assert.equal(rateLimitedLoginResponse.status, 429, "repeated sign-in failures should be rate limited");
assert.ok(Number(rateLimitedLoginResponse.headers.get("retry-after")) > 0, "rate limiting should tell the client when to retry");

const renewedInviteResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/drivers/${driverCreatePayload.driver.id}/invite`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  }),
  env
);
assert.equal(renewedInviteResponse.status, 200, "dispatchers should be able to create a fresh invitation for an existing driver");
const renewedInvitePayload = await renewedInviteResponse.json();
const renewedInviteUrl = new URL(renewedInvitePayload.inviteUrl);
assert.equal(renewedInviteUrl.pathname, "/operations", "renewed invitations should use the production-safe application route");
assert.ok(renewedInviteUrl.searchParams.get("invite"), "renewed invitations should preserve their token in the query string");

const joinPageResponse = await reloadedWorker.default.fetch(
  new Request(renewedInvitePayload.inviteUrl),
  env
);
assert.equal(joinPageResponse.status, 200, "the driver invitation route should load the app");
assert.equal(assetRequests.at(-1), "/operations.html", "the driver invitation route should resolve to the operations app shell");

const originalEmailFetch = globalThis.fetch;
let emailedInvitePayload;
env.RESEND_API_KEY = "validation-resend-key";
env.INVITE_FROM_EMAIL = "Rivo Drivers <drivers@floraljet.llc>";
try {
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(String(input), "https://api.resend.com/emails", "configured driver invitations should use the email provider");
    assert.equal(init.headers.authorization, "Bearer validation-resend-key");
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.to, ["driver.updated@example.com"]);
    assert.match(payload.text, /https:\/\/vms\.test\/operations\?invite=/, "email copy should contain the production-safe invitation route");
    return new Response(JSON.stringify({ id: "email_validation_1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const emailedInviteResponse = await reloadedWorker.default.fetch(
    new Request(`https://vms.test/api/drivers/${driverCreatePayload.driver.id}/invite`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${setupPayload.session.token}`,
        "content-type": "application/json"
      },
      body: "{}"
    }),
    env
  );
  assert.equal(emailedInviteResponse.status, 200, "configured email delivery should create a driver invitation");
  emailedInvitePayload = await emailedInviteResponse.json();
  assert.equal(emailedInvitePayload.emailSent, true, "configured email delivery should report success");
  assert.equal(emailedInvitePayload.driver.inviteEmailStatus, "sent");
  assert.equal(emailedInvitePayload.snapshot.invitationEmail.configured, true);
} finally {
  globalThis.fetch = originalEmailFetch;
  delete env.RESEND_API_KEY;
  delete env.INVITE_FROM_EMAIL;
}

const preResetState = JSON.parse(database.row.payload_json);
const preResetDriverSessions = preResetState.sessions.filter((item) => item.driverId === driverCreatePayload.driver.id);
assert.ok(preResetDriverSessions.length > 1, "the reset fixture should have multiple existing driver sessions");
const emailedInviteToken = new URL(emailedInvitePayload.inviteUrl).searchParams.get("invite");
const resetAcceptResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/invite/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: emailedInviteToken, password: "replacement-driver-password" })
  }),
  env
);
assert.equal(resetAcceptResponse.status, 200, "a driver should be able to accept a password-reset invitation");
const resetAcceptPayload = await resetAcceptResponse.json();
const postResetState = JSON.parse(database.row.payload_json);
const postResetDriverSessions = postResetState.sessions.filter((item) => item.driverId === driverCreatePayload.driver.id);
assert.equal(postResetDriverSessions.length, 1, "accepting a password reset should revoke every older driver session");
assert.equal(postResetDriverSessions[0].token, resetAcceptPayload.session.token, "only the new post-reset session should remain active");

const multiStopTripResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/trips", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      driverId: driverCreatePayload.driver.id,
      customerName: "Final customer",
      pickup: "Private warehouse",
      stopsText: "First private delivery\nSecond private delivery",
      destination: "Final private delivery",
      tripType: "personal"
    })
  }),
  env
);
assert.equal(multiStopTripResponse.status, 201, "a dispatcher should be able to create a multi-stop trip");
const multiStopTripPayload = await multiStopTripResponse.json();
const multiStopTrip = multiStopTripPayload.trip;
assert.equal(multiStopTrip.tripType, "business", "new trips must always be business trips");
assert.equal(multiStopTrip.trackingStops.length, 3, "every delivery stop should receive its own tracking link");
assert.equal(
  multiStopTrip.shareToken,
  multiStopTrip.trackingStops.at(-1).shareToken,
  "the legacy trip link should continue to track the final delivery"
);

const defaultPickupResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/trips", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      driverId: driverCreatePayload.driver.id,
      customerName: "Default pickup customer",
      destination: "Default pickup destination"
    })
  }),
  env
);
assert.equal(defaultPickupResponse.status, 201, "a trip without a pickup should still be created");
const defaultPickupPayload = await defaultPickupResponse.json();
assert.equal(defaultPickupPayload.trip.pickup, "1675 Cyrville Rd", "manual trips should use the configured pickup default");

const companySettingsResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/company", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Example Courier Ops",
      pickupAddress: "500 New Depot Road",
      timeZone: "America/Toronto",
      currency: "CAD",
      supportEmail: "support@example.com"
    })
  }),
  env
);
assert.equal(companySettingsResponse.status, 200, "dispatchers should be able to configure the workspace");
const companySettingsPayload = await companySettingsResponse.json();
assert.equal(companySettingsPayload.company.name, "Example Courier Ops");
assert.equal(companySettingsPayload.company.pickupAddress, "500 New Depot Road");

const configuredPickupResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/trips", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      driverId: driverCreatePayload.driver.id,
      customerName: "Configured pickup customer",
      destination: "Configured pickup destination"
    })
  }),
  env
);
assert.equal(configuredPickupResponse.status, 201);
const configuredPickupPayload = await configuredPickupResponse.json();
assert.equal(configuredPickupPayload.trip.pickup, "500 New Depot Road");

const activeEditResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${defaultPickupPayload.trip.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      customerName: "Edited active delivery",
      pickup: defaultPickupPayload.trip.pickup,
      destination: "Updated destination",
      notes: "Dispatcher corrected this active trip",
      kmRate: 1.5
    })
  }),
  env
);
assert.equal(activeEditResponse.status, 200, "dispatchers should be able to edit active deliveries");
const activeEditPayload = await activeEditResponse.json();
assert.equal(activeEditPayload.trip.customerName, "Edited active delivery");
assert.equal(activeEditPayload.trip.status, "active", "editing must not restart or close an active delivery");

for (const [index, trackingStop] of multiStopTrip.trackingStops.entries()) {
  const customerShareResponse = await reloadedWorker.default.fetch(
    new Request(`https://vms.test/api/share/${trackingStop.shareToken}`),
    env
  );
  assert.equal(customerShareResponse.status, 200, "each delivery stop link should resolve");
  assert.match(customerShareResponse.headers.get("cache-control") || "", /no-store/, "customer tracking responses must never be cached");
  const customerSharePayload = await customerShareResponse.json();
  const customerTrip = customerSharePayload.trip;
  assert.deepEqual(customerTrip.stops, [{ label: "Delivery address", address: trackingStop.address }]);
  assert.equal(customerTrip.customerName, "Your delivery");
  assert.deepEqual(Object.keys(customerTrip).sort(), [
    "courier",
    "customerName",
    "driver",
    "endedAt",
    "etaMinutes",
    "expectedArrivalAt",
    "id",
    "location",
    "startedAt",
    "status",
    "stops"
  ]);
  assert.equal(customerTrip.courier, null, "in-house customer tracking should not invent a courier provider");
  assert.deepEqual(Object.keys(customerTrip.driver).sort(), ["color", "name", "vehicle"]);
  for (const forbiddenKey of ["driverId", "pickup", "destination", "shareToken", "trackingStops", "path", "notes", "kmRate", "distanceKm"]) {
    assert.equal(Object.hasOwn(customerTrip, forbiddenKey), false, `customer tracking must not expose ${forbiddenKey}`);
  }
  const serializedCustomerTrip = JSON.stringify(customerTrip);
  assert.equal(serializedCustomerTrip.includes("Private warehouse"), false, "customer tracking must not reveal the pickup location");
  for (const otherStop of multiStopTrip.trackingStops.filter((_, otherIndex) => otherIndex !== index)) {
    assert.equal(
      serializedCustomerTrip.includes(otherStop.address),
      false,
      "customer tracking must not reveal another delivery address"
    );
  }
}

const retiredEventsResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/events?token=${encodeURIComponent(multiStopTrip.trackingStops[0].shareToken)}`),
  env
);
assert.equal(retiredEventsResponse.status, 410, "the worker must close legacy event-stream requests immediately");

const locationUpdateResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${multiStopTrip.id}/location`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resetAcceptPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ lat: 43.6532, lng: -79.3832, accuracy: 8 })
  }),
  env
);
assert.equal(locationUpdateResponse.status, 200, "an assigned driver should be able to publish a location update");
const refreshedCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(multiStopTrip.trackingStops[0].shareToken)}`),
  env
);
assert.equal(refreshedCustomerResponse.status, 200, "customer tracking should refresh through the polling endpoint");
const refreshedCustomerPayload = await refreshedCustomerResponse.json();
assert.equal(refreshedCustomerPayload.trip.location, null, "a multi-stop tracking link must never expose a shared route position");
const refreshedCustomerJson = JSON.stringify(refreshedCustomerPayload.trip);
assert.equal(refreshedCustomerJson.includes("Private warehouse"), false, "polled customer updates must hide pickup data");
assert.equal(refreshedCustomerJson.includes("Second private delivery"), false, "polled customer updates must hide other stops");

const proofForm = new FormData();
proofForm.append("photo", new File([new Uint8Array([137, 80, 78, 71, 13, 10])], "front-door.png", { type: "image/png" }));
proofForm.append("signature", new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "recipient-signature.png", { type: "image/png" }));
const proofUploadResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${multiStopTrip.id}/proof-media`, {
    method: "POST",
    headers: { authorization: `Bearer ${resetAcceptPayload.session.token}` },
    body: proofForm
  }),
  env
);
assert.equal(proofUploadResponse.status, 201, "drivers should be able to upload proof images to attached object storage");
assert.deepEqual((await proofUploadResponse.json()).uploaded.sort(), ["photo", "signature"]);

const proofCompleteResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${multiStopTrip.id}/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resetAcceptPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      proofOutcome: "delivered-recipient",
      proofMethod: "Delivered to recipient",
      proofRecipient: "Front desk",
      notes: "Handed over in good condition."
    })
  }),
  env
);
assert.equal(proofCompleteResponse.status, 200, "drivers should be able to complete a stop with uploaded proof");
const proofCompletePayload = await proofCompleteResponse.json();
assert.equal(proofCompletePayload.trip.status, "completed");
assert.match(proofCompletePayload.trip.proof.media.photo.url, /^\/api\/proof-media\//);
assert.match(proofCompletePayload.trip.proof.media.signature.url, /^\/api\/proof-media\//);
assert.equal(JSON.stringify(proofCompletePayload.trip).includes("proof/"), false, "object storage keys must stay private");
assert.equal(JSON.stringify(proofCompletePayload.trip).includes("pendingProofMedia"), false, "pending upload metadata must stay private");

const outOfOrderCompletionResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${configuredPickupPayload.trip.id}/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resetAcceptPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ proofOutcome: "delivered-recipient" })
  }),
  env
);
assert.equal(outOfOrderCompletionResponse.status, 400, "a driver must not complete a later route stop out of sequence");

const currentStopLocationResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${defaultPickupPayload.trip.id}/location`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resetAcceptPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ lat: 43.6501, lng: -79.3811, accuracy: 6 })
  }),
  env
);
assert.equal(currentStopLocationResponse.status, 200, "the driver should progress to the next route stop after completion");
const currentStopCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(activeEditPayload.trip.shareToken)}`),
  env
);
assert.equal(currentStopCustomerResponse.status, 200, "the current stop tracking link should remain live");
const currentStopCustomerPayload = await currentStopCustomerResponse.json();
assert.equal(currentStopCustomerPayload.trip.location.lat, 43.6501, "a current single-stop customer should receive the live position");
assert.equal(currentStopCustomerPayload.trip.location.lng, -79.3811);

const proofImageResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test${proofCompletePayload.trip.proof.media.photo.url}`),
  env
);
assert.equal(proofImageResponse.status, 200, "unguessable proof URLs should retrieve the stored image");
assert.equal(proofImageResponse.headers.get("content-type"), "image/png");
assert.deepEqual(Array.from(new Uint8Array(await proofImageResponse.arrayBuffer())), [137, 80, 78, 71, 13, 10]);

const completedCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(multiStopTrip.trackingStops.at(-1).shareToken)}`),
  env
);
const completedCustomerPayload = await completedCustomerResponse.json();
assert.equal(completedCustomerPayload.trip.status, "delivered", "customers should never see internal mileage review states");
assert.equal(completedCustomerPayload.trip.proof.recipient, "Front desk");
assert.equal(JSON.stringify(completedCustomerPayload.trip).includes("proof/"), false, "customer proof must not reveal storage keys");
const intermediateCompletedCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(multiStopTrip.trackingStops[0].shareToken)}`),
  env
);
const intermediateCompletedCustomerPayload = await intermediateCompletedCustomerResponse.json();
assert.equal(Object.hasOwn(intermediateCompletedCustomerPayload.trip, "proof"), false, "one stop must never receive another stop's photo, signature, or recipient name");

const exceptionResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${defaultPickupPayload.trip.id}/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resetAcceptPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      proofOutcome: "exception-recipient",
      proofMethod: "Recipient unavailable",
      exceptionNote: "No answer after two calls.",
      exceptionNextAction: "retry"
    })
  }),
  env
);
assert.equal(exceptionResponse.status, 200, "drivers should be able to report a structured delivery issue");
const exceptionPayload = await exceptionResponse.json();
assert.equal(exceptionPayload.trip.status, "exception");
assert.equal(exceptionPayload.trip.proof.exceptionReason, "Recipient unavailable");
assert.equal(exceptionPayload.trip.proof.nextAction, "retry");

const retryResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/trips/${defaultPickupPayload.trip.id}/dispatch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ driverId: driverCreatePayload.driver.id, kmRate: 1.5 })
  }),
  env
);
assert.equal(retryResponse.status, 200, "dispatchers should be able to retry an exception from the recovery panel");
const retryPayload = await retryResponse.json();
assert.equal(retryPayload.trip.status, "active");
assert.notEqual(retryPayload.trip.id, defaultPickupPayload.trip.id, "a retry should be a separate paid attempt");
assert.equal(retryPayload.trip.proof, null, "stale failed-attempt proof should not appear as current delivery proof");
const preservedFailedAttempt = retryPayload.snapshot.trips.find((trip) => trip.id === defaultPickupPayload.trip.id);
assert.equal(preservedFailedAttempt.status, "failed", "the original attempt should remain reportable as failed");
assert.equal(preservedFailedAttempt.proof.exceptionReason, "Recipient unavailable", "the failed attempt proof should remain attached to its own mileage record");
assert.equal(preservedFailedAttempt.exceptionHistory.at(-1).reason, "Recipient unavailable", "the failed attempt should remain in the audit history");
assert.equal(retryPayload.trip.distanceKm, 0, "a retry should start a fresh attempt mileage record");
assert.equal(retryPayload.trip.location, null, "a retry must not inherit another attempt's GPS position");
assert.match(retryPayload.trip.routeId, /^route_/, "a retry should receive a fresh route identity");

const mixedRouteReorderResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/routes/reorder", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      tripIds: [defaultPickupPayload.trip.id, configuredPickupPayload.trip.id]
    })
  }),
  env
);
assert.equal(mixedRouteReorderResponse.status, 400, "separate routes for the same driver must never merge during drag reordering");

const duplicateSetupResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupCode: "validation-setup-code",
      companyName: "VMS inc.",
      name: "Replacement Owner",
      username: "replacement",
      password: "replacement-password"
    })
  }),
  env
);
assert.equal(duplicateSetupResponse.status, 400, "owner setup should not overwrite an existing account");

const wixDatabase = new FakeD1();
const wixEnv = {
  DB: wixDatabase,
  COMPANY_NAME: "VMS inc.",
  OWNER_SETUP_CODE: "wix-validation-setup-code",
  WIX_API_KEY: "test-api-key",
  WIX_SITE_ID: "test-site-id"
};
const wixOrders = [
  {
    id: "wix-open-1",
    number: "1001",
    status: "APPROVED",
    paymentStatus: "PAID",
    fulfillmentStatus: "NOT_FULFILLED",
    createdDate: "2026-07-22T10:00:00.000Z",
    buyerInfo: { email: "open@example.test" },
    fulfillmentInfo: {
      shippingDestination: {
        address: { addressLine1: "100 Front Street", city: "Toronto", subdivision: "ON", postalCode: "M5J 1E6" }
      }
    }
  },
  {
    id: "wix-fulfilled-1",
    number: "1002",
    status: "APPROVED",
    paymentStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    createdDate: "2026-07-23T10:00:00.000Z",
    buyerInfo: { email: "fulfilled@example.test" },
    fulfillmentInfo: {
      shippingDestination: {
        address: { addressLine1: "200 Front Street", city: "Toronto", subdivision: "ON", postalCode: "M5J 1E6" }
      }
    }
  }
];
const wixWorker = await loadFreshWorker("wix-orders");
const originalFetch = globalThis.fetch;
const wixSearches = [];

try {
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(String(input), "https://www.wixapis.com/ecom/v1/orders/search");
    wixSearches.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ orders: wixOrders }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const wixSetupResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupCode: "wix-validation-setup-code",
        companyName: "VMS inc.",
        name: "VMS Owner",
        username: "wixowner",
        password: "validation-password"
      })
    }),
    wixEnv
  );
  assert.equal(wixSetupResponse.status, 201, "Wix validation requires a dispatcher session");
  const wixSetupPayload = await wixSetupResponse.json();
  const authHeaders = {
    authorization: `Bearer ${wixSetupPayload.session.token}`,
    "content-type": "application/json"
  };
  const wixDriverResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/drivers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Fulfilled Order Driver",
        email: "fulfilled.driver@example.com",
        vehicle: "Validation Van"
      })
    }),
    wixEnv
  );
  assert.equal(wixDriverResponse.status, 201, "Wix validation requires a driver");
  const wixDriverPayload = await wixDriverResponse.json();

  const firstSyncResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/integrations/wix/sync", {
      method: "POST",
      headers: authHeaders,
      body: "{}"
    }),
    wixEnv
  );
  assert.equal(firstSyncResponse.status, 200, "Wix sync should accept fulfilled orders");
  const firstSyncPayload = await firstSyncResponse.json();
  assert.deepEqual(
    wixSearches[0].search.filter.fulfillmentStatus.$in,
    ["NOT_FULFILLED", "PARTIALLY_FULFILLED", "FULFILLED"],
    "Wix search should include fulfilled orders by default"
  );
  assert.equal(firstSyncPayload.sync.imported, 2, "both open and fulfilled orders should be imported");
  const fulfilledTrip = firstSyncPayload.snapshot.trips.find((trip) => trip.source?.orderId === "wix-fulfilled-1");
  const openTrip = firstSyncPayload.snapshot.trips.find((trip) => trip.source?.orderId === "wix-open-1");
  assert.equal(fulfilledTrip?.source?.fulfillmentStatus, "FULFILLED");

  const bulkAssignResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/trips/bulk", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        action: "assign",
        tripIds: [openTrip.id, fulfilledTrip.id],
        driverId: wixDriverPayload.driver.id,
        kmRate: 1.45
      })
    }),
    wixEnv
  );
  assert.equal(bulkAssignResponse.status, 200, "selected orders should support one-step bulk assignment");
  const bulkAssignPayload = await bulkAssignResponse.json();
  assert.equal(bulkAssignPayload.updated, 2);
  assert.ok(bulkAssignPayload.trips.every((trip) => trip.driverId === wixDriverPayload.driver.id));
  assert.ok(bulkAssignPayload.trips.every((trip) => trip.status === "queued"), "assignment should not start the route");

  const singleDispatchResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/routes/dispatch", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        driverId: wixDriverPayload.driver.id,
        tripIds: [openTrip.id],
        origin: "1675 Cyrville Rd"
      })
    }),
    wixEnv
  );
  assert.equal(singleDispatchResponse.status, 201, "the route toolbar should also dispatch one selected order");
  const singleDispatchPayload = await singleDispatchResponse.json();
  assert.equal(singleDispatchPayload.trips.length, 1);
  const singleCompleteResponse = await wixWorker.default.fetch(
    new Request(`https://vms.test/api/trips/${openTrip.id}/complete`, {
      method: "POST",
      headers: authHeaders,
      body: "{}"
    }),
    wixEnv
  );
  assert.equal(singleCompleteResponse.status, 200);

  const fulfilledDispatchResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/routes/dispatch", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        driverId: wixDriverPayload.driver.id,
        tripIds: [openTrip.id, fulfilledTrip.id],
        origin: "1675 Cyrville Rd"
      })
    }),
    wixEnv
  );
  assert.equal(fulfilledDispatchResponse.status, 201, "multiple Wix orders should dispatch as one route");
  const fulfilledDispatchPayload = await fulfilledDispatchResponse.json();
  assert.equal(fulfilledDispatchPayload.trips.length, 2);
  assert.equal(fulfilledDispatchPayload.trips[0].routeId, fulfilledDispatchPayload.trips[1].routeId);
  assert.equal(fulfilledDispatchPayload.trips[0].status, "active");
  assert.equal(fulfilledDispatchPayload.trips[0].driverId, wixDriverPayload.driver.id);

  const reversedIds = fulfilledDispatchPayload.trips.map((trip) => trip.id).reverse();
  const reorderResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/routes/reorder", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ tripIds: reversedIds, origin: "1675 Cyrville Rd" })
    }),
    wixEnv
  );
  assert.equal(reorderResponse.status, 200, "dispatchers should be able to reorder active stops");
  const reorderPayload = await reorderResponse.json();
  assert.deepEqual(reorderPayload.trips.map((trip) => trip.id), reversedIds);
  assert.deepEqual(reorderPayload.trips.map((trip) => trip.routeSequence), [0, 1]);

  const bulkCompleteResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/trips/bulk", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "complete", tripIds: reversedIds, overrideReason: "Confirmed delivered during dispatch closeout" })
    }),
    wixEnv
  );
  assert.equal(bulkCompleteResponse.status, 200, "dispatchers should be able to complete selected active deliveries together");
  const bulkCompletePayload = await bulkCompleteResponse.json();
  assert.equal(bulkCompletePayload.updated, 2);
  assert.ok(bulkCompletePayload.trips.every((trip) => trip.status === "completed"));

  wixOrders[0].fulfillmentStatus = "FULFILLED";
  const refreshResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/integrations/wix/sync", {
      method: "POST",
      headers: authHeaders,
      body: "{}"
    }),
    wixEnv
  );
  assert.equal(refreshResponse.status, 200, "a subsequent Wix sync should succeed");
  const refreshPayload = await refreshResponse.json();
  assert.equal(refreshPayload.sync.updated, 1, "Wix fulfillment changes should update existing records");
  const refreshedOpenTrip = refreshPayload.snapshot.trips.find((trip) => trip.source?.orderId === "wix-open-1");
  assert.equal(refreshedOpenTrip?.source?.fulfillmentStatus, "FULFILLED");

  assert.equal(refreshedOpenTrip.status, "completed", "completed Wix orders should remain in mileage review after channel refresh");
  assert.equal(refreshedOpenTrip.proof.kind, "dispatcher-override", "bulk completion should retain an auditable override record");

  const editDeliveredIdentityResponse = await wixWorker.default.fetch(
    new Request(`https://vms.test/api/trips/${refreshedOpenTrip.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        customerName: "Edited Wix Customer",
        pickup: "1675 Cyrville Rd",
        destination: "300 Front Street, Toronto",
        stopsText: "250 Front Street, Toronto",
        notes: "Edited after delivery review",
        kmRate: 1.5
      })
    }),
    wixEnv
  );
  assert.equal(editDeliveredIdentityResponse.status, 400, "customer and route identity must lock after proof is recorded");

  const editDeliveredNotesResponse = await wixWorker.default.fetch(
    new Request(`https://vms.test/api/trips/${refreshedOpenTrip.id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ notes: "Edited after delivery review", kmRate: 1.5 })
    }),
    wixEnv
  );
  assert.equal(editDeliveredNotesResponse.status, 200, "review notes and mileage rate should remain editable without rewriting proof identity");
  const editDeliveredPayload = await editDeliveredNotesResponse.json();
  assert.equal(editDeliveredPayload.trip.customerName, refreshedOpenTrip.customerName);
  assert.equal(editDeliveredPayload.trip.destination, refreshedOpenTrip.destination);
  assert.equal(editDeliveredPayload.trip.notes, "Edited after delivery review");

  const redispatchDeliveredResponse = await wixWorker.default.fetch(
    new Request(`https://vms.test/api/trips/${refreshedOpenTrip.id}/dispatch`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ driverId: wixDriverPayload.driver.id, kmRate: 1.5 })
    }),
    wixEnv
  );
  assert.equal(redispatchDeliveredResponse.status, 200, "review-ready Wix orders should be dispatchable again");
  const redispatchDeliveredPayload = await redispatchDeliveredResponse.json();
  assert.equal(redispatchDeliveredPayload.trip.status, "active");
  assert.equal(redispatchDeliveredPayload.trip.driverId, wixDriverPayload.driver.id);

  const completeRedispatchedResponse = await wixWorker.default.fetch(
    new Request(`https://vms.test/api/trips/${redispatchDeliveredPayload.trip.id}/complete`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        customerName: "Completed Edited Customer",
        pickup: "1675 Cyrville Rd",
        destination: "325 Front Street, Toronto",
        stopsText: "275 Front Street, Toronto",
        notes: "Active editor notes retained on completion",
        kmRate: 1.65,
        proofMethod: "Dispatcher confirmed"
      })
    }),
    wixEnv
  );
  assert.equal(completeRedispatchedResponse.status, 200);
  const completeRedispatchedPayload = await completeRedispatchedResponse.json();
  assert.equal(completeRedispatchedPayload.trip.customerName, "Completed Edited Customer");
  assert.equal(completeRedispatchedPayload.trip.destination, "325 Front Street, Toronto");
  assert.equal(completeRedispatchedPayload.trip.notes, "Active editor notes retained on completion");
  assert.equal(completeRedispatchedPayload.trip.stops.length, 3);
  assert.equal(completeRedispatchedPayload.trip.kmRate, 1.65);

  const markDeliveredResponse = await wixWorker.default.fetch(
    new Request("https://vms.test/api/trips/bulk", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        action: "delivered",
        tripIds: [completeRedispatchedPayload.trip.id, fulfilledTrip.id],
        overrideReason: "Sales-channel orders confirmed fulfilled"
      })
    }),
    wixEnv
  );
  assert.equal(markDeliveredResponse.status, 200, "selected review-ready orders should close together");
  const markDeliveredPayload = await markDeliveredResponse.json();
  assert.equal(markDeliveredPayload.updated, 2);
  assert.ok(markDeliveredPayload.trips.every((trip) => trip.status === "delivered"));
} finally {
  globalThis.fetch = originalFetch;
}

const webhookConnectResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/integrations/connect", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      provider: "webhook",
      name: "Squarespace via Make",
      pickupLabel: "1675 Cyrville Rd"
    })
  }),
  env
);
assert.equal(webhookConnectResponse.status, 201, "dispatchers should be able to create a universal storefront webhook");
const webhookConnectPayload = await webhookConnectResponse.json();
assert.match(webhookConnectPayload.webhookUrl, /\/api\/integrations\/webhook\/chn_/);
const webhookToken = new URL(webhookConnectPayload.webhookUrl).searchParams.get("token");
assert.ok(webhookToken, "the universal webhook should return a one-time secret URL");
assert.doesNotMatch(database.row.payload_json, new RegExp(webhookToken), "raw webhook tokens must not be stored");

const webhookOrderResponse = await reloadedWorker.default.fetch(
  new Request(webhookConnectPayload.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order: {
        id: "external-order-101",
        number: "101",
        customerName: "Connected Customer",
        deliveryAddress: "100 Queen Street West, Toronto, ON",
        phone: "555-0101",
        items: [{ quantity: 2, name: "Bouquet" }],
        paymentStatus: "paid"
      }
    })
  }),
  env
);
assert.equal(webhookOrderResponse.status, 202, "connected websites should be able to send paid orders to Rivo");
const webhookOrderPayload = await webhookOrderResponse.json();
assert.equal(webhookOrderPayload.sync.imported, 1);

const integrationsResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/bootstrap", {
    headers: { authorization: `Bearer ${setupPayload.session.token}` }
  }),
  env
);
const integrationsPayload = await integrationsResponse.json();
const webhookTrip = integrationsPayload.trips.find((trip) => trip.source?.orderId === "external-order-101");
assert.equal(webhookTrip?.source?.system, "webhook", "universal orders should enter the shared dispatch queue");
assert.equal(webhookTrip?.destination, "100 Queen Street West, Toronto, ON");
assert.equal(integrationsPayload.integrations.connections[0].name, "Squarespace via Make");
assert.equal(integrationsPayload.integrations.connections[0].importedOrders, 1);

const courierPartnerResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/couriers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      name: "Capital Courier Co.",
      contactEmail: "dispatch@capitalcourier.example",
      contactPhone: "613-555-0199",
      serviceArea: "Ottawa and Gatineau",
      requestMethod: "email",
      notes: "Use the same-day desk"
    })
  }),
  env
);
assert.equal(courierPartnerResponse.status, 201, "dispatchers should be able to save a third-party courier partner");
const courierPartnerPayload = await courierPartnerResponse.json();
assert.equal(courierPartnerPayload.courierPartner.requestMethod, "email");

const courierOrderResponse = await reloadedWorker.default.fetch(
  new Request(webhookConnectPayload.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      order: {
        id: "external-order-102",
        number: "102",
        customerName: "Courier Customer",
        deliveryAddress: "200 Elgin Street, Ottawa, ON",
        phone: "555-0102",
        items: [{ quantity: 1, name: "Arrangement" }],
        paymentStatus: "paid"
      }
    })
  }),
  env
);
assert.equal(courierOrderResponse.status, 202, "courier validation should import a second connected order");
const courierBootstrapResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/bootstrap", {
    headers: { authorization: `Bearer ${setupPayload.session.token}` }
  }),
  env
);
const courierBootstrapPayload = await courierBootstrapResponse.json();
const courierTrip = courierBootstrapPayload.trips.find((trip) => trip.source?.orderId === "external-order-102");
assert.ok(courierTrip, "the imported courier fixture should enter the dispatch queue");

const courierRequestResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/courier-requests", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      courierPartnerId: courierPartnerPayload.courierPartner.id,
      tripIds: [courierTrip.id],
      requestedPickupAt: new Date(Date.now() + 3600000).toISOString(),
      serviceLevel: "Same-day",
      notes: "Fragile arrangement. Keep upright."
    })
  }),
  env
);
assert.equal(courierRequestResponse.status, 201, "selected orders should create one courier request");
const courierRequestPayload = await courierRequestResponse.json();
assert.equal(courierRequestPayload.deliverySent, false, "missing courier sender credentials must not pretend an email was sent");
assert.equal(courierRequestPayload.courierRequest.status, "ready-to-share");
assert.match(courierRequestPayload.courierRequest.mailtoUrl, /^mailto:/, "manual fallback should provide a prepared email draft");
assert.match(courierRequestPayload.courierRequest.summary, /Courier Customer[\s\S]*200 Elgin Street/, "the prepared request should include the selected delivery");
const requestedCourierTrip = courierRequestPayload.snapshot.trips.find((trip) => trip.id === courierTrip.id);
assert.equal(requestedCourierTrip.courier.name, "Capital Courier Co.");
assert.equal(requestedCourierTrip.courier.isOpen, true);
assert.equal(requestedCourierTrip.driverId, "", "courier handoff should not masquerade as an in-house driver assignment");

const unsharedCourierCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(courierTrip.trackingStops[0].shareToken)}`),
  env
);
assert.equal(unsharedCourierCustomerResponse.status, 200);
const unsharedCourierCustomerPayload = await unsharedCourierCustomerResponse.json();
assert.equal(unsharedCourierCustomerPayload.trip.courier, null, "customers must not see a courier before the provider is actually contacted");

const duplicateCourierRequestResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/courier-requests", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ courierPartnerId: courierPartnerPayload.courierPartner.id, tripIds: [courierTrip.id] })
  }),
  env
);
assert.equal(duplicateCourierRequestResponse.status, 400, "one order must not have two open courier requests");

const courierDriverDispatchResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/routes/dispatch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ driverId: driverCreatePayload.driver.id, tripIds: [courierTrip.id] })
  }),
  env
);
assert.equal(courierDriverDispatchResponse.status, 400, "an open courier handoff must block accidental driver dispatch");

const invalidCourierTrackingResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/courier-requests/${courierRequestPayload.courierRequest.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ status: "requested", trackingUrl: "http://127.0.0.1/internal" })
  }),
  env
);
assert.equal(invalidCourierTrackingResponse.status, 400, "courier tracking must reject non-public HTTPS links");

for (const trackingUrl of ["https://[::1]/internal", "https://[fd00::1]/internal", "https://[fe80::1]/internal"]) {
  const privateIpv6TrackingResponse = await reloadedWorker.default.fetch(
    new Request(`https://vms.test/api/courier-requests/${courierRequestPayload.courierRequest.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${setupPayload.session.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ status: "requested", trackingUrl })
    }),
    env
  );
  assert.equal(privateIpv6TrackingResponse.status, 400, `courier tracking must reject private IPv6 URL ${trackingUrl}`);
}

let courierLifecyclePayload;
for (const update of [
  { status: "requested", referenceNumber: "CAP-102", trackingUrl: "https://tracking.example/cap-102", quotedFee: 24.5 },
  { status: "accepted" },
  { status: "picked-up" }
]) {
  const response = await reloadedWorker.default.fetch(
    new Request(`https://vms.test/api/courier-requests/${courierRequestPayload.courierRequest.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${setupPayload.session.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(update)
    }),
    env
  );
  assert.equal(response.status, 200, `courier requests should advance to ${update.status}`);
  courierLifecyclePayload = await response.json();
}
assert.equal(courierLifecyclePayload.courierRequest.referenceNumber, "CAP-102");
assert.equal(courierLifecyclePayload.courierRequest.quotedFee, 24.5);

const courierCustomerResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/share/${encodeURIComponent(courierTrip.trackingStops[0].shareToken)}`),
  env
);
assert.equal(courierCustomerResponse.status, 200, "customer tracking should support courier-fulfilled orders");
const courierCustomerPayload = await courierCustomerResponse.json();
assert.equal(courierCustomerPayload.trip.courier.name, "Capital Courier Co.");
assert.equal(courierCustomerPayload.trip.courier.status, "picked-up");
assert.equal(courierCustomerPayload.trip.courier.referenceNumber, "CAP-102");
assert.equal(courierCustomerPayload.trip.courier.trackingUrl, "https://tracking.example/cap-102");
assert.equal(JSON.stringify(courierCustomerPayload).includes("dispatch@capitalcourier.example"), false, "customer tracking must not reveal courier contact details");
assert.equal(JSON.stringify(courierCustomerPayload).includes("Fragile arrangement"), false, "customer tracking must not expose courier request notes");

const privateDriverCourierResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/me", {
    headers: { authorization: `Bearer ${resetAcceptPayload.session.token}` }
  }),
  env
);
assert.equal(privateDriverCourierResponse.status, 200);
const privateDriverCourierPayload = await privateDriverCourierResponse.json();
assert.equal(Object.hasOwn(privateDriverCourierPayload.snapshot, "courierPartners"), false, "driver snapshots must not expose courier partner contacts");
assert.equal(Object.hasOwn(privateDriverCourierPayload.snapshot, "courierRequests"), false, "driver snapshots must not expose courier request records");

const courierDeliveredResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/courier-requests/${courierRequestPayload.courierRequest.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ status: "delivered" })
  }),
  env
);
assert.equal(courierDeliveredResponse.status, 200, "a courier delivery should close all linked orders");
const courierDeliveredPayload = await courierDeliveredResponse.json();
const deliveredCourierTrip = courierDeliveredPayload.snapshot.trips.find((trip) => trip.id === courierTrip.id);
assert.equal(deliveredCourierTrip.status, "delivered");
assert.equal(deliveredCourierTrip.proof.kind, "external-courier", "courier completion should create an auditable external record");
assert.equal(deliveredCourierTrip.distanceKm, 0, "courier fees must not invent driver mileage");

const courierPartnerEditResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/couriers/${courierPartnerPayload.courierPartner.id}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ serviceArea: "Ottawa, Gatineau, and Orleans" })
  }),
  env
);
assert.equal(courierPartnerEditResponse.status, 200, "courier partner details should remain editable");
const courierPartnerArchiveResponse = await reloadedWorker.default.fetch(
  new Request(`https://vms.test/api/couriers/${courierPartnerPayload.courierPartner.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${setupPayload.session.token}` }
  }),
  env
);
assert.equal(courierPartnerArchiveResponse.status, 200, "completed courier partners should be archivable without deleting request history");

const recommendationResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/routes/recommendations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ tripIds: [webhookTrip.id] })
  }),
  env
);
assert.equal(recommendationResponse.status, 200, "queued orders should support a non-mutating dispatch preview");
const recommendationPayload = await recommendationResponse.json();
assert.equal(recommendationPayload.plan.totalDeliveries, 1);
assert.equal(recommendationPayload.plan.recommendations[0].tripIds[0], webhookTrip.id);
assert.match(recommendationPayload.plan.explanation, /Priority orders and earliest delivery windows/);

const autoAssignResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/routes/auto-assign", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ tripIds: [webhookTrip.id] })
  }),
  env
);
assert.equal(autoAssignResponse.status, 201, "queued orders should support one-click automatic assignment");
const autoAssignPayload = await autoAssignResponse.json();
assert.equal(autoAssignPayload.assigned, 1);
const assignedWebhookTrip = autoAssignPayload.snapshot.trips.find((trip) => trip.id === webhookTrip.id);
assert.equal(assignedWebhookTrip.status, "active");
assert.equal(assignedWebhookTrip.driverId, driverCreatePayload.driver.id);
assert.equal(assignedWebhookTrip.routeOrigin, "Private warehouse", "new work should append to the driver’s continuous active route instead of sending them back through the depot");

const manualDeliveryResponse = await reloadedWorker.default.fetch(
  new Request("https://vms.test/api/deliveries", {
    method: "POST",
    headers: {
      authorization: `Bearer ${setupPayload.session.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      customerName: "Manual customer",
      customerPhone: "+16135550199",
      pickup: "Private warehouse",
      destination: "123 Manual St, Ottawa",
      priority: "urgent",
      deliveryWindowStart: "2026-08-29T14:00:00-04:00",
      deliveryWindowEnd: "2026-08-29T16:00:00-04:00"
    })
  }),
  env
);
assert.equal(manualDeliveryResponse.status, 201, "dispatchers should be able to queue an order without connecting a store");
const manualDeliveryPayload = await manualDeliveryResponse.json();
assert.equal(manualDeliveryPayload.delivery.status, "queued");
assert.equal(manualDeliveryPayload.delivery.priority, "urgent");
assert.equal(manualDeliveryPayload.delivery.customerPhone, "+16135550199");

const legacyDatabase = new FakeD1();
const legacyEnv = {
  ...env,
  DB: legacyDatabase,
  OWNER_SETUP_CODE: "legacy-recovery-code"
};
const legacyWorker = await loadFreshWorker("legacy-owner-recovery");
const legacySetupResponse = await legacyWorker.default.fetch(
  new Request("https://vms.test/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      setupCode: "legacy-recovery-code",
      companyName: "Legacy Rivo",
      name: "Legacy Owner",
      username: "legacy.owner",
      password: "old-owner-password"
    })
  }),
  legacyEnv
);
assert.equal(legacySetupResponse.status, 201);
const legacyState = JSON.parse(legacyDatabase.row.payload_json);
legacyState.ownerAccount.passwordIterations = 210000;
legacyDatabase.row.payload_json = JSON.stringify(legacyState);

const legacyLoginResponse = await legacyWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "legacy.owner", password: "old-owner-password" })
  }),
  legacyEnv
);
assert.equal(legacyLoginResponse.status, 409, "an unsupported legacy owner hash should request recovery instead of throwing a PBKDF2 runtime error");
assert.equal((await legacyLoginResponse.json()).code, "password_upgrade_required");

const ownerRecoveryResponse = await legacyWorker.default.fetch(
  new Request("https://vms.test/api/auth/owner-recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "legacy.owner", setupCode: "legacy-recovery-code", password: "new-owner-password" })
  }),
  legacyEnv
);
assert.equal(ownerRecoveryResponse.status, 200, "the owner setup code should repair an unsupported password hash");
assert.equal((await ownerRecoveryResponse.json()).session.role, "dispatcher");
const recoveredOwner = JSON.parse(legacyDatabase.row.payload_json).ownerAccount;
assert.equal(recoveredOwner.passwordIterations, 100000, "owner recovery should migrate the password to the runtime-supported work factor");

const recoveredLoginResponse = await legacyWorker.default.fetch(
  new Request("https://vms.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: "legacy.owner", password: "new-owner-password" })
  }),
  legacyEnv
);
assert.equal(recoveredLoginResponse.status, 200, "the recovered owner should be able to sign in normally");

console.log("Sites bundle validated.");
