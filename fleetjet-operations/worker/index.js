const clients = new Set();
const DEFAULT_COMPANY_NAME = "Rivo";
const DEFAULT_PICKUP_ADDRESS = "1675 Cyrville Rd";
const WIX_PICKUP_NAME = "Cyrville";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
// Cloudflare Workers rejects PBKDF2 iteration counts above 100,000.
// Keep the configured work factor at the runtime ceiling so account setup,
// invitation acceptance, and subsequent login use the same stored parameters.
const PASSWORD_HASH_ITERATIONS = 100000;
const MAX_PASSWORD_HASH_ITERATIONS = 100000;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 8;
const PERSISTED_DB_TABLE = "delivery_tracker_state_v1";
const PERSISTED_DB_KEY = "primary";
const LEAD_STAGES = new Set(["new", "qualified", "pilot", "won", "lost"]);
const LEAD_CONTACT_METHODS = new Set(["Email", "Phone"]);
const COURIER_REQUEST_METHODS = new Set(["email", "booking", "manual"]);
const COURIER_REQUEST_STATUSES = new Set(["ready-to-share", "send-failed", "requested", "accepted", "picked-up", "delivered", "declined", "cancelled"]);
const OPEN_COURIER_REQUEST_STATUSES = new Set(["ready-to-share", "send-failed", "requested", "accepted", "picked-up"]);
const CUSTOMER_VISIBLE_COURIER_REQUEST_STATUSES = new Set(["requested", "accepted", "picked-up", "delivered"]);
const LEAD_ORIGINS = new Set(["https://floraljet.llc", "https://www.floraljet.llc"]);
const APP_CANONICAL_HOST = "app.floraljet.llc";
const APP_HOSTING_ALIASES = new Set(["delivery-driver-tracker.spennyman.chatgpt.site"]);
const PROOF_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const NORMALIZED_PROJECTION_VERSION = 1;
const PLAN_CATALOG = Object.freeze({
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPrice: 99,
    currency: "CAD",
    deliveryLimit: 500,
    driverLimit: 5,
    features: ["dispatch", "driver-app", "customer-tracking", "proof", "route-optimization", "basic-analytics"]
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyPrice: 199,
    currency: "CAD",
    deliveryLimit: 2000,
    driverLimit: 15,
    features: ["dispatch", "driver-app", "customer-tracking", "proof", "basic-analytics", "advanced-optimization", "automations", "integrations"]
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPrice: 399,
    currency: "CAD",
    deliveryLimit: 10000,
    driverLimit: 50,
    features: ["dispatch", "driver-app", "customer-tracking", "proof", "basic-analytics", "advanced-optimization", "automations", "integrations", "advanced-analytics", "white-label-tracking"]
  }
});
const PROOF_MEDIA_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const DELIVERY_OUTCOMES = new Map([
  ["delivered-recipient", { label: "Delivered to recipient", exception: false }],
  ["delivered-safe", { label: "Left at approved location", exception: false }],
  ["verified", { label: "Signature collected", exception: false }],
  ["service", { label: "Service completed", exception: false }],
  ["exception-recipient", { label: "Recipient unavailable", exception: true }],
  ["exception-address", { label: "Address or access problem", exception: true }],
  ["exception-refused", { label: "Order refused", exception: true }],
  ["exception-damaged", { label: "Item missing or damaged", exception: true }],
  ["exception-unsafe", { label: "Unsafe to complete", exception: true }],
  ["exception-vehicle", { label: "Vehicle or driver issue", exception: true }],
  ["exception-other", { label: "Other delivery issue", exception: true }],
  ["returned", { label: "Returned to depot", exception: true }],
  ["dispatcher-override", { label: "Dispatcher override", exception: false, override: true }],
  ["dispatcher-failed", { label: "Closed as failed", exception: false, override: true, failed: true }]
]);
const loginAttempts = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function nowIso() {
  return new Date().toISOString();
}

function optionalIso(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeTripType(value) {
  return value === "personal" ? "personal" : "business";
}

function isBusinessTrip(trip) {
  return normalizeTripType(trip.tripType) === "business";
}

function makeId(prefix) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function makeToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function constantTimeEqual(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const length = Math.max(leftText.length, rightText.length);
  let difference = leftText.length ^ rightText.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftText.charCodeAt(index) || 0) ^ (rightText.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function legacyPasswordHash(password, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function accountPasswordHash(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  const normalizedIterations = Number(iterations);
  if (!Number.isSafeInteger(normalizedIterations) || normalizedIterations < 1 || normalizedIterations > MAX_PASSWORD_HASH_ITERATIONS) {
    throw new Error("This account needs a new secure invitation before it can sign in.");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(String(salt || "")),
      iterations: normalizedIterations
    },
    material,
    256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function setPassword(account, password) {
  const passwordSalt = makeToken(16);
  account.passwordSalt = passwordSalt;
  account.passwordIterations = PASSWORD_HASH_ITERATIONS;
  account.passwordAlgorithm = "pbkdf2-sha256";
  account.passwordHash = await accountPasswordHash(password, passwordSalt, account.passwordIterations);
  delete account.password;
}

async function passwordMatches(account, password) {
  if (!account) return false;
  if (account.passwordHash && account.passwordSalt) {
    if (account.passwordAlgorithm === "pbkdf2-sha256") {
      const iterations = Number(account.passwordIterations || PASSWORD_HASH_ITERATIONS);
      if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_HASH_ITERATIONS) return false;
      return constantTimeEqual(
        await accountPasswordHash(password, account.passwordSalt, iterations),
        account.passwordHash
      );
    }
    return constantTimeEqual(await legacyPasswordHash(password, account.passwordSalt), account.passwordHash);
  }
  return Boolean(account.password) && constantTimeEqual(account.password, password);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizedPublicHttpsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const unwrappedHostname = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    const ipv4MappedHost = unwrappedHostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] || "";
    const privateIpv4 = (host) => host === "0.0.0.0"
      || host === "127.0.0.1"
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    const blockedHostname = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || privateIpv4(hostname)
      || (ipv4MappedHost && privateIpv4(ipv4MappedHost))
      || unwrappedHostname === "::"
      || unwrappedHostname === "::1"
      || /^f[cd][0-9a-f:]*$/.test(unwrappedHostname)
      || /^fe[89ab][0-9a-f:]*$/.test(unwrappedHostname);
    if (url.protocol !== "https:" || !url.hostname || blockedHostname || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function tokenHash(token) {
  return legacyPasswordHash(token, "vms-driver-invite");
}

async function sendDriverInvite(env, driver, inviteUrl) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.INVITE_FROM_EMAIL || "").trim();
  if (!apiKey || !from) return { sent: false, reason: "Email delivery is not configured." };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [driver.email],
      subject: "You’re invited to Rivo",
      text: `Hi ${driver.name},\n\nYou’ve been invited to join Rivo as a driver. Create your password and sign in here:\n${inviteUrl}\n\nThis link expires in 7 days.`
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Invitation email could not be sent (${response.status}): ${detail.slice(0, 180)}`);
  }
  const payload = await response.json().catch(() => ({}));
  return { sent: true, providerMessageId: String(payload.id || "") };
}

function courierRequestSummary(db, courierRequest, partner) {
  const deliveries = Array.isArray(courierRequest.deliveries) ? courierRequest.deliveries : [];
  const lines = [
    `${db.company?.name || DEFAULT_COMPANY_NAME} courier request ${courierRequest.id}`,
    `Service: ${courierRequest.serviceLevel || "Same-day"}`,
    `Requested pickup: ${courierRequest.requestedPickupAt || "As soon as available"}`,
    `Pickup: ${courierRequest.pickup}`,
    "",
    ...deliveries.flatMap((delivery, index) => [
      `${index + 1}. ${delivery.customerName}`,
      `   Deliver to: ${delivery.destination}`
    ])
  ];
  if (courierRequest.notes) lines.push("", `Delivery notes: ${courierRequest.notes}`);
  lines.push("", `Please reply with acceptance, price, a provider reference, and a tracking link when available.`);
  return lines.join("\n");
}

async function sendCourierRequestEmail(env, db, courierRequest, partner) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.COURIER_REQUEST_FROM_EMAIL || "").trim();
  if (!apiKey || !from) {
    return { sent: false, configured: false, reason: "Automatic courier email is not configured. Open or copy the prepared request instead." };
  }
  if (!validEmail(partner.contactEmail)) {
    return { sent: false, configured: true, reason: "This courier partner does not have a valid request email." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [partner.contactEmail],
      subject: `${db.company?.name || DEFAULT_COMPANY_NAME}: ${courierRequest.deliveries.length} delivery request${courierRequest.deliveries.length === 1 ? "" : "s"}`,
      text: courierRequestSummary(db, courierRequest, partner)
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Courier request email could not be sent (${response.status}): ${detail.slice(0, 180)}`);
  }
  const payload = await response.json().catch(() => ({}));
  return { sent: true, configured: true, providerMessageId: String(payload.id || "") };
}

async function prepareDriverInvitation(driver, origin) {
  const inviteToken = makeToken(32);
  driver.inviteTokenHash = await tokenHash(inviteToken);
  driver.inviteCreatedAt = nowIso();
  driver.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  driver.inviteEmailStatus = "pending";
  driver.inviteEmailMessageId = "";
  driver.inviteEmailSentAt = null;
  driver.inviteEmailError = "";
  const inviteUrl = `${origin}/operations?invite=${encodeURIComponent(inviteToken)}`;
  return { inviteUrl };
}

async function deliverDriverInvitation(env, driver, inviteUrl) {
  let emailResult;
  try {
    emailResult = await sendDriverInvite(env, driver, inviteUrl);
  } catch (error) {
    emailResult = { sent: false, reason: error.message };
  }
  driver.inviteEmailStatus = emailResult.sent ? "sent" : "failed";
  driver.inviteEmailMessageId = emailResult.providerMessageId || "";
  driver.inviteEmailSentAt = emailResult.sent ? nowIso() : null;
  driver.inviteEmailError = emailResult.sent ? "" : String(emailResult.reason || "Invitation email was not sent.");
  return emailResult;
}

async function persistAndDeliverDriverInvitation(db, env, driver, origin) {
  const { inviteUrl } = await prepareDriverInvitation(driver, origin);
  // Make the token valid before an email or manual-share link can leave this request.
  // If this compare-and-swap loses a race, no unusable invitation is sent.
  await writeDb(db, env);
  const emailResult = await deliverDriverInvitation(env, driver, inviteUrl);
  let persistedDb = db;
  try {
    // Delivery metadata is useful, but a concurrent workspace edit must not turn a
    // successfully sent, already-valid link into a failed API response.
    await writeDb(db, env);
  } catch (error) {
    console.warn("Invitation delivery metadata could not be saved", error);
    try {
      persistedDb = await readDb(env);
    } catch {
      persistedDb = db;
    }
  }
  return {
    db: persistedDb,
    driver: persistedDb.drivers.find((item) => item.id === driver.id) || driver,
    inviteUrl,
    emailResult
  };
}

function stopAddresses(value) {
  if (Array.isArray(value)) {
    return value
      .map((stop) => typeof stop === "string" ? stop : stop?.address)
      .map((address) => String(address || "").trim())
      .filter(Boolean);
  }
  return String(value || "")
    .split(/\r?\n|;/)
    .map((address) => address.trim())
    .filter(Boolean);
}

function defaultStopLabel(index, total) {
  if (index === 0) return "Pickup";
  if (index === total - 1) return "Destination";
  return `Stop ${index}`;
}

function buildRouteStops(pickup, destination, stopsInput) {
  const pickupAddress = String(pickup || "").trim();
  const destinationAddress = String(destination || "").trim();
  const extras = stopAddresses(stopsInput).filter((address) => {
    return address !== pickupAddress && address !== destinationAddress;
  });
  const stops = [];
  if (pickupAddress) stops.push({ label: "Pickup", address: pickupAddress });
  extras.forEach((address, index) => stops.push({ label: `Stop ${index + 1}`, address }));
  if (destinationAddress) stops.push({ label: "Destination", address: destinationAddress });
  return stops;
}

function routeStopsForTrip(trip) {
  const stops = Array.isArray(trip?.stops)
    ? trip.stops
        .map((stop) => ({
          label: typeof stop === "object" && stop?.label ? String(stop.label).trim() : "",
          address: String((typeof stop === "string" ? stop : stop?.address) || "").trim()
        }))
        .filter((stop) => stop.address)
    : [];
  if (stops.length) {
    return stops.map((stop, index) => ({
      label: stop.label || defaultStopLabel(index, stops.length),
      address: stop.address
    }));
  }
  return buildRouteStops(trip?.pickup, trip?.destination, []);
}

function syncTrackingStops(trip) {
  const deliveryStops = routeStopsForTrip(trip).slice(1);
  const previousStops = Array.isArray(trip.trackingStops) ? trip.trackingStops : [];
  const usedPrevious = new Set();
  const nextStops = deliveryStops.map((stop, index) => {
    const previousIndex = previousStops.findIndex((entry, entryIndex) => {
      return !usedPrevious.has(entryIndex) && String(entry?.address || "").trim() === stop.address;
    });
    const previous = previousIndex >= 0 ? previousStops[previousIndex] : null;
    if (previousIndex >= 0) usedPrevious.add(previousIndex);
    return {
      stopIndex: index + 1,
      label: stop.label,
      address: stop.address,
      shareToken: String(previous?.shareToken || "").trim() || makeToken()
    };
  });

  const finalStop = nextStops.at(-1);
  if (finalStop) {
    const legacyToken = String(trip.shareToken || "").trim();
    finalStop.shareToken = legacyToken || finalStop.shareToken;
    trip.shareToken = finalStop.shareToken;
  } else if (!trip.shareToken) {
    trip.shareToken = makeToken();
  }

  trip.trackingStops = nextStops;
  return nextStops;
}

function rotateTrackingTokens(trip) {
  trip.shareToken = makeToken();
  trip.trackingStops = [];
  return syncTrackingStops(trip);
}

function trackingStopsForTrip(trip) {
  return (Array.isArray(trip?.trackingStops) ? trip.trackingStops : [])
    .map((stop, index) => ({
      stopIndex: Number(stop?.stopIndex || index + 1),
      label: String(stop?.label || `Stop ${index + 1}`).trim(),
      address: String(stop?.address || "").trim(),
      shareToken: String(stop?.shareToken || "").trim()
    }))
    .filter((stop) => stop.address && stop.shareToken);
}

function intermediateStopsText(trip) {
  return routeStopsForTrip(trip).slice(1, -1).map((stop) => stop.address).join(" | ");
}

function weekKey(dateLike = new Date()) {
  const date = new Date(dateLike);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function seededDb() {
  return {
    company: {
      name: DEFAULT_COMPANY_NAME,
      currency: "CAD",
      pickupAddress: DEFAULT_PICKUP_ADDRESS,
      timeZone: "America/Toronto",
      supportEmail: "hello@floraljet.llc",
      plan: "Starter",
      planId: "starter",
      subscriptionStatus: "setup",
      branding: {
        primaryColor: "#176b52",
        logoUrl: "",
        trackingHeadline: "Your delivery is on the way",
        showDriverFirstName: true
      },
      operations: {
        businessHours: "Mon-Fri 9:00 AM-6:00 PM",
        deliveryZones: "",
        defaultWindowMinutes: 120,
        requirePhoto: false,
        requireSignature: false
      },
      notifications: {
        customerTracking: true,
        etaUpdates: true,
        deliveredConfirmation: true
      },
      network: { status: "coming-soon", enabled: false }
    },
    wix: { lastSyncAt: null, lastError: "", importedOrderIds: [] },
    integrations: { connections: [] },
    ownerAccount: null,
    sessions: [],
    drivers: [],
    courierPartners: [],
    courierRequests: [],
    trips: [],
    leads: []
  };
}

function hasPersistentDatabase(env = {}) {
  return Boolean(env.DB && typeof env.DB.prepare === "function");
}

async function ensurePersistentDatabase(env = {}) {
  if (!hasPersistentDatabase(env)) return false;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${PERSISTED_DB_TABLE} (
      state_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();
  return true;
}

async function ensureNormalizedProjection(env = {}) {
  if (!hasPersistentDatabase(env) || typeof env.DB.batch !== "function") return false;
  const statements = [
    `CREATE TABLE IF NOT EXISTS rova_businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, pickup_address TEXT NOT NULL, time_zone TEXT NOT NULL, settings_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_users (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_drivers (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, driver_type TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, vehicle TEXT, status TEXT NOT NULL, capacity INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_customers (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, display_name TEXT NOT NULL, address TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_routes (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, driver_id TEXT, origin TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_deliveries (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, customer_id TEXT, driver_id TEXT, route_id TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, fulfillment_type TEXT NOT NULL, pickup TEXT, destination TEXT, window_start TEXT, window_end TEXT, distance_km REAL NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_delivery_stops (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, stop_order INTEGER NOT NULL, label TEXT, address TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_driver_locations (driver_id TEXT PRIMARY KEY, delivery_id TEXT, lat REAL, lng REAL, accuracy REAL, recorded_at TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_proof_of_delivery (delivery_id TEXT PRIMARY KEY, outcome TEXT, method TEXT, recipient TEXT, proof_json TEXT NOT NULL, recorded_at TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_price REAL NOT NULL, currency TEXT NOT NULL, limits_json TEXT NOT NULL, features_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_subscriptions (business_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_notifications (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, delivery_id TEXT, channel TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_network_jobs (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, delivery_id TEXT, quoted_price REAL, platform_fee REAL, external_driver_id TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rova_delivery_events (id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, event_type TEXT NOT NULL, event_json TEXT NOT NULL, recorded_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_rova_deliveries_status ON rova_deliveries (business_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_rova_deliveries_driver ON rova_deliveries (driver_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_rova_stops_delivery ON rova_delivery_stops (delivery_id, stop_order)`,
    `CREATE INDEX IF NOT EXISTS idx_rova_events_delivery ON rova_delivery_events (delivery_id, recorded_at)`
  ];
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  return true;
}

async function syncNormalizedProjection(db, env = {}) {
  if (!(await ensureNormalizedProjection(env))) return false;
  const updatedAt = nowIso();
  const businessId = "primary";
  const statements = [];
  const add = (sql, ...bindings) => statements.push(env.DB.prepare(sql).bind(...bindings));
  add(
    `INSERT INTO rova_businesses (id, name, currency, pickup_address, time_zone, settings_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, currency = excluded.currency, pickup_address = excluded.pickup_address, time_zone = excluded.time_zone, settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
    businessId,
    db.company.name,
    db.company.currency,
    db.company.pickupAddress,
    db.company.timeZone,
    JSON.stringify({ branding: db.company.branding, operations: db.company.operations, notifications: db.company.notifications, network: db.company.network }),
    updatedAt
  );
  if (db.ownerAccount) {
    add(
      `INSERT INTO rova_users (id, business_id, role, name, email, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, status = excluded.status, updated_at = excluded.updated_at`,
      "owner",
      businessId,
      "owner",
      db.ownerAccount.name || "Owner",
      normalizeEmail(db.ownerAccount.username),
      "active",
      updatedAt
    );
  }
  for (const plan of Object.values(PLAN_CATALOG)) {
    add(
      `INSERT INTO rova_plans (id, name, monthly_price, currency, limits_json, features_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, monthly_price = excluded.monthly_price, currency = excluded.currency, limits_json = excluded.limits_json, features_json = excluded.features_json, updated_at = excluded.updated_at`,
      plan.id,
      plan.name,
      plan.monthlyPrice,
      plan.currency,
      JSON.stringify({ deliveries: plan.deliveryLimit, drivers: plan.driverLimit }),
      JSON.stringify(plan.features),
      updatedAt
    );
  }
  add(
    `INSERT INTO rova_subscriptions (business_id, plan_id, status, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(business_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status, updated_at = excluded.updated_at`,
    businessId,
    db.company.planId,
    db.company.subscriptionStatus,
    updatedAt
  );
  for (const driver of db.drivers) {
    add(
      `INSERT INTO rova_drivers (id, business_id, driver_type, name, email, phone, vehicle, status, capacity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET driver_type = excluded.driver_type, name = excluded.name, email = excluded.email, phone = excluded.phone, vehicle = excluded.vehicle, status = excluded.status, capacity = excluded.capacity, updated_at = excluded.updated_at`,
      driver.id,
      businessId,
      driver.driverType || "my-driver",
      driver.name,
      driver.email || "",
      driver.phone || "",
      driver.vehicle || "",
      driver.archivedAt ? "archived" : driver.status || "offline",
      Number(driver.capacity || 20),
      updatedAt
    );
  }
  for (const trip of db.trips.slice(-500)) {
    const customerId = `customer:${trip.id}`;
    add(
      `INSERT INTO rova_customers (id, business_id, display_name, address, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, address = excluded.address, updated_at = excluded.updated_at`,
      customerId,
      businessId,
      trip.customerName || "Customer",
      trip.destination || "",
      updatedAt
    );
    add(
      `INSERT INTO rova_deliveries (id, business_id, customer_id, driver_id, route_id, status, priority, fulfillment_type, pickup, destination, window_start, window_end, distance_km, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, driver_id = excluded.driver_id, route_id = excluded.route_id, status = excluded.status, priority = excluded.priority, fulfillment_type = excluded.fulfillment_type, pickup = excluded.pickup, destination = excluded.destination, window_start = excluded.window_start, window_end = excluded.window_end, distance_km = excluded.distance_km, updated_at = excluded.updated_at`,
      trip.id,
      businessId,
      customerId,
      trip.driverId || null,
      trip.routeId || null,
      trip.status,
      trip.priority || "standard",
      trip.fulfillmentType || "my-driver",
      trip.pickup || "",
      trip.destination || "",
      trip.deliveryWindowStart || null,
      trip.deliveryWindowEnd || null,
      Number(trip.distanceKm || 0),
      updatedAt
    );
    add(`DELETE FROM rova_delivery_stops WHERE delivery_id = ?`, trip.id);
    routeStopsForTrip(trip).forEach((stop, index) => add(
      `INSERT INTO rova_delivery_stops (id, delivery_id, stop_order, label, address, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      `${trip.id}:${index}`,
      trip.id,
      index,
      stop.label || `Stop ${index + 1}`,
      typeof stop.address === "string" ? stop.address : JSON.stringify(stop.address),
      trip.status,
      updatedAt
    ));
    if (trip.location) {
      add(
        `INSERT INTO rova_driver_locations (driver_id, delivery_id, lat, lng, accuracy, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(driver_id) DO UPDATE SET delivery_id = excluded.delivery_id, lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, recorded_at = excluded.recorded_at, updated_at = excluded.updated_at`,
        trip.driverId || `unassigned:${trip.id}`,
        trip.id,
        Number(trip.location.lat),
        Number(trip.location.lng),
        trip.location.accuracy === null || trip.location.accuracy === undefined ? null : Number(trip.location.accuracy),
        trip.location.timestamp || updatedAt,
        updatedAt
      );
    }
    if (trip.proof) {
      add(
        `INSERT INTO rova_proof_of_delivery (delivery_id, outcome, method, recipient, proof_json, recorded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(delivery_id) DO UPDATE SET outcome = excluded.outcome, method = excluded.method, recipient = excluded.recipient, proof_json = excluded.proof_json, recorded_at = excluded.recorded_at, updated_at = excluded.updated_at`,
        trip.id,
        trip.proof.outcome || "",
        trip.proof.method || "",
        trip.proof.recipient || "",
        JSON.stringify(publicProof(trip.proof) || {}),
        trip.proof.recordedAt || updatedAt,
        updatedAt
      );
    }
    add(
      `INSERT INTO rova_delivery_events (id, delivery_id, event_type, event_json, recorded_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET event_type = excluded.event_type, event_json = excluded.event_json, recorded_at = excluded.recorded_at`,
      `${trip.id}:current`,
      trip.id,
      trip.status,
      JSON.stringify({ outcome: trip.deliveryOutcomeStatus || trip.status, driverId: trip.driverId || null, routeId: trip.routeId || null }),
      trip.endedAt || trip.startedAt || trip.importedAt || updatedAt
    );
    if (trip.routeId) {
      add(
        `INSERT INTO rova_routes (id, business_id, driver_id, origin, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET driver_id = excluded.driver_id, origin = excluded.origin, status = excluded.status, updated_at = excluded.updated_at`,
        trip.routeId,
        businessId,
        trip.driverId || null,
        trip.routeOrigin || trip.pickup || "",
        trip.status === "active" ? "active" : "closed",
        updatedAt
      );
    }
  }
  for (let offset = 0; offset < statements.length; offset += 100) {
    await env.DB.batch(statements.slice(offset, offset + 100));
  }
  return true;
}

async function migrateDb(db) {
  let changed = false;
  if (!db.company || typeof db.company !== "object") {
    db.company = { name: DEFAULT_COMPANY_NAME, currency: "USD" };
    changed = true;
  }
  if (!db.company.name || db.company.name === "Northline Delivery" || db.company.name === "FleetJet AI") {
    db.company.name = DEFAULT_COMPANY_NAME;
    changed = true;
  }
  const companyDefaults = {
    currency: "CAD",
    pickupAddress: DEFAULT_PICKUP_ADDRESS,
    timeZone: "America/Toronto",
    supportEmail: "hello@floraljet.llc",
    plan: "Starter",
    planId: "starter",
    subscriptionStatus: "setup"
  };
  for (const [key, value] of Object.entries(companyDefaults)) {
    if (!db.company[key]) {
      db.company[key] = value;
      changed = true;
    }
  }
  const nestedCompanyDefaults = {
    branding: {
      primaryColor: "#176b52",
      logoUrl: "",
      trackingHeadline: "Your delivery is on the way",
      showDriverFirstName: true
    },
    operations: {
      businessHours: "Mon-Fri 9:00 AM-6:00 PM",
      deliveryZones: "",
      defaultWindowMinutes: 120,
      requirePhoto: false,
      requireSignature: false
    },
    notifications: {
      customerTracking: true,
      etaUpdates: true,
      deliveredConfirmation: true
    },
    network: { status: "coming-soon", enabled: false }
  };
  for (const [section, defaults] of Object.entries(nestedCompanyDefaults)) {
    if (!db.company[section] || typeof db.company[section] !== "object") {
      db.company[section] = { ...defaults };
      changed = true;
      continue;
    }
    for (const [key, value] of Object.entries(defaults)) {
      if (db.company[section][key] === undefined) {
        db.company[section][key] = value;
        changed = true;
      }
    }
  }
  if (!PLAN_CATALOG[db.company.planId]) {
    const legacyPlanId = String(db.company.plan || "").toLowerCase();
    db.company.planId = PLAN_CATALOG[legacyPlanId] ? legacyPlanId : "starter";
    db.company.plan = PLAN_CATALOG[db.company.planId].name;
    changed = true;
  }
  if (db.normalizedProjectionVersion !== NORMALIZED_PROJECTION_VERSION) {
    db.normalizedProjectionVersion = NORMALIZED_PROJECTION_VERSION;
    changed = true;
  }
  if (db.ownerAccount === undefined) {
    db.ownerAccount = null;
    changed = true;
  }
  if (!db.wix || typeof db.wix !== "object") {
    db.wix = { lastSyncAt: null, lastError: "", importedOrderIds: [] };
    changed = true;
  }
  if (!Array.isArray(db.wix.importedOrderIds)) {
    db.wix.importedOrderIds = (db.trips || [])
      .filter((trip) => trip.source?.system === "wix" && trip.source.orderId)
      .map((trip) => trip.source.orderId);
    changed = true;
  }
  if (!db.integrations || typeof db.integrations !== "object") {
    db.integrations = { connections: [] };
    changed = true;
  }
  if (!Array.isArray(db.integrations.connections)) {
    db.integrations.connections = [];
    changed = true;
  }
  if (!Array.isArray(db.sessions)) {
    db.sessions = [];
    changed = true;
  }
  if (!Array.isArray(db.drivers)) {
    db.drivers = [];
    changed = true;
  }
  if (!Array.isArray(db.courierPartners)) {
    db.courierPartners = [];
    changed = true;
  }
  if (!Array.isArray(db.courierRequests)) {
    db.courierRequests = [];
    changed = true;
  }
  if (!Array.isArray(db.trips)) {
    db.trips = [];
    changed = true;
  }
  if (!Array.isArray(db.leads)) {
    db.leads = [];
    changed = true;
  }
  for (const lead of db.leads) {
    if (!LEAD_STAGES.has(lead.stage)) {
      lead.stage = "new";
      changed = true;
    }
    if (!lead.createdAt) {
      lead.createdAt = nowIso();
      changed = true;
    }
    if (!lead.updatedAt) {
      lead.updatedAt = lead.createdAt;
      changed = true;
    }
    if (lead.score === undefined) {
      lead.score = leadScore(lead);
      changed = true;
    }
  }
  if (db.ownerAccount?.password && !db.ownerAccount.passwordHash) {
    await setPassword(db.ownerAccount, db.ownerAccount.password);
    changed = true;
  }
  for (const [index, driver] of db.drivers.entries()) {
    if (!driver.loginId) {
      driver.loginId = index === 0 ? "ava" : index === 1 ? "miles" : String(driver.name || driver.id).trim().toLowerCase().replace(/\s+/g, ".");
      changed = true;
    }
    if (driver.password && !driver.passwordHash) {
      await setPassword(driver, driver.password);
      changed = true;
    }
    if (driver.shift === undefined) {
      driver.shift = index === 0 ? "Morning shift" : index === 1 ? "Afternoon shift" : "";
      changed = true;
    }
    if (driver.email === undefined) {
      driver.email = "";
      changed = true;
    }
    if (driver.homeAddress === undefined) {
      driver.homeAddress = "";
      changed = true;
    }
    if (driver.capacity === undefined) {
      driver.capacity = 20;
      changed = true;
    }
    if (driver.driverType === undefined) {
      driver.driverType = "my-driver";
      changed = true;
    }
  }
  for (const partner of db.courierPartners) {
    if (!COURIER_REQUEST_METHODS.has(partner.requestMethod)) {
      partner.requestMethod = validEmail(partner.contactEmail) ? "email" : partner.bookingUrl ? "booking" : "manual";
      changed = true;
    }
    if (partner.active === undefined) {
      partner.active = !partner.archivedAt;
      changed = true;
    }
    if (!partner.createdAt) {
      partner.createdAt = nowIso();
      changed = true;
    }
    if (!partner.updatedAt) {
      partner.updatedAt = partner.createdAt;
      changed = true;
    }
  }
  for (const courierRequest of db.courierRequests) {
    if (!COURIER_REQUEST_STATUSES.has(courierRequest.status)) {
      courierRequest.status = "ready-to-share";
      changed = true;
    }
    if (!Array.isArray(courierRequest.statusHistory)) {
      courierRequest.statusHistory = [{ status: courierRequest.status, at: courierRequest.createdAt || nowIso(), by: "Migration" }];
      changed = true;
    }
    if (!courierRequest.createdAt) {
      courierRequest.createdAt = nowIso();
      changed = true;
    }
    if (!courierRequest.updatedAt) {
      courierRequest.updatedAt = courierRequest.createdAt;
      changed = true;
    }
  }
  for (const trip of db.trips) {
    if (trip.source?.system === "wix" && trip.pickup === "Wix order pickup") {
      trip.pickup = WIX_PICKUP_NAME;
      if (Array.isArray(trip.stops) && trip.stops[0]) trip.stops[0].address = WIX_PICKUP_NAME;
      changed = true;
    }
    if (!trip.tripType) {
      trip.tripType = "business";
      changed = true;
    }
    if (!Array.isArray(trip.stops)) {
      trip.stops = buildRouteStops(trip.pickup, trip.destination, []);
      changed = true;
    }
    if (!Array.isArray(trip.path)) {
      trip.path = [];
      changed = true;
    }
    if (!trip.fulfillmentType) {
      trip.fulfillmentType = trip.courierRequestId ? "courier-partner" : "my-driver";
      changed = true;
    }
    if (!trip.priority) {
      trip.priority = "standard";
      changed = true;
    }
    if (trip.customerPhone === undefined) {
      trip.customerPhone = String(trip.notes || "").match(/Phone:\s*([^\n]+)/i)?.[1]?.trim() || "";
      changed = true;
    }
    if (trip.deliveryWindowStart === undefined) {
      trip.deliveryWindowStart = null;
      changed = true;
    }
    if (trip.deliveryWindowEnd === undefined) {
      trip.deliveryWindowEnd = null;
      changed = true;
    }
    const priorTrackingStops = JSON.stringify(trip.trackingStops || []);
    const priorShareToken = trip.shareToken;
    syncTrackingStops(trip);
    if (priorTrackingStops !== JSON.stringify(trip.trackingStops) || priorShareToken !== trip.shareToken) {
      changed = true;
    }
  }
  return changed;
}

async function readDb(env = {}) {
  if (!hasPersistentDatabase(env)) {
    if (!globalThis.__deliveryTrackerDb) globalThis.__deliveryTrackerDb = seededDb();
    await migrateDb(globalThis.__deliveryTrackerDb);
    return globalThis.__deliveryTrackerDb;
  }

  await ensurePersistentDatabase(env);
  const row = await env.DB
    .prepare(`SELECT payload_json, updated_at FROM ${PERSISTED_DB_TABLE} WHERE state_key = ?`)
    .bind(PERSISTED_DB_KEY)
    .first();
  let db = seededDb();
  let shouldWrite = !row?.payload_json;
  if (row?.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        db = parsed;
      } else {
        shouldWrite = true;
      }
    } catch {
      shouldWrite = true;
    }
  }
  Object.defineProperty(db, "__persistedUpdatedAt", {
    value: row?.updated_at || "",
    writable: true,
    configurable: true,
    enumerable: false
  });
  if (await migrateDb(db)) shouldWrite = true;
  if (shouldWrite) await writeDb(db, env);
  return db;
}

async function writeDb(db, env = {}) {
  if (!hasPersistentDatabase(env)) {
    globalThis.__deliveryTrackerDb = db;
    return;
  }
  await ensurePersistentDatabase(env);
  const expectedVersion = String(db.__persistedUpdatedAt || "");
  const nextVersion = `${nowIso()}:${makeToken(6)}`;
  const payloadJson = JSON.stringify(db);
  const result = expectedVersion
    ? await env.DB
        .prepare(
          `UPDATE ${PERSISTED_DB_TABLE}
           SET payload_json = ?, updated_at = ?
           WHERE state_key = ? AND updated_at = ?`
        )
        .bind(payloadJson, nextVersion, PERSISTED_DB_KEY, expectedVersion)
        .run()
    : await env.DB
        .prepare(
          `INSERT INTO ${PERSISTED_DB_TABLE} (state_key, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(state_key) DO NOTHING`
        )
        .bind(PERSISTED_DB_KEY, payloadJson, nextVersion)
        .run();
  if (Number(result?.meta?.changes || 0) !== 1) {
    const error = new Error("This workspace changed in another request. Refresh and try again.");
    error.code = "STATE_CONFLICT";
    throw error;
  }
  db.__persistedUpdatedAt = nextVersion;
  await syncNormalizedProjection(db, env).catch((error) => {
    console.error("Normalized Rivo projection could not be refreshed", error);
  });
}

function publicDriver(driver, options = {}) {
  const output = {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    email: driver.email || "",
    vehicle: driver.vehicle,
    shift: driver.shift || "",
    defaultRate: driver.defaultRate,
    capacity: Number(driver.capacity || 20),
    driverType: driver.driverType || "my-driver",
    color: driver.color,
    status: driver.status,
    lastSeenAt: driver.lastSeenAt
  };
  if (options.includeLogin) {
    const inviteExpired = Boolean(driver.inviteTokenHash) && new Date(driver.inviteExpiresAt || 0).getTime() <= Date.now();
    const inviteStatus = inviteExpired
      ? "expired"
      : driver.inviteTokenHash
        ? (driver.inviteAcceptedAt ? "reset-pending" : "pending")
        : driver.inviteAcceptedAt || driver.passwordHash
          ? "accepted"
          : "needs-invite";
    output.loginId = driver.loginId || "";
    output.homeAddress = driver.homeAddress || "";
    output.inviteStatus = inviteStatus;
    output.inviteCreatedAt = driver.inviteCreatedAt || null;
    output.inviteExpiresAt = driver.inviteExpiresAt || null;
    output.inviteEmailStatus = driver.inviteEmailStatus || "not-sent";
    output.inviteEmailSentAt = driver.inviteEmailSentAt || null;
    output.inviteEmailError = driver.inviteEmailError || "";
  }
  if (options.includePrivate) output.homeAddress = driver.homeAddress || "";
  return output;
}

function publicCourierPartner(partner) {
  return {
    id: partner.id,
    name: partner.name,
    contactEmail: partner.contactEmail || "",
    contactPhone: partner.contactPhone || "",
    serviceArea: partner.serviceArea || "",
    requestMethod: COURIER_REQUEST_METHODS.has(partner.requestMethod) ? partner.requestMethod : "manual",
    bookingUrl: partner.bookingUrl || "",
    notes: partner.notes || "",
    active: partner.active !== false && !partner.archivedAt,
    createdAt: partner.createdAt || null,
    updatedAt: partner.updatedAt || null
  };
}

function courierPartnerById(db, partnerId) {
  return db.courierPartners.find((partner) => partner.id === partnerId && !partner.archivedAt) || null;
}

function openCourierRequestForTrip(db, tripId) {
  return db.courierRequests.find((courierRequest) => {
    return OPEN_COURIER_REQUEST_STATUSES.has(courierRequest.status)
      && Array.isArray(courierRequest.tripIds)
      && courierRequest.tripIds.includes(tripId);
  }) || null;
}

function publicCourierRequest(db, courierRequest) {
  const partner = db.courierPartners.find((item) => item.id === courierRequest.courierPartnerId) || null;
  const summary = courierRequestSummary(db, courierRequest, partner);
  const subject = `${db.company?.name || DEFAULT_COMPANY_NAME}: ${courierRequest.deliveries?.length || 0} delivery request${courierRequest.deliveries?.length === 1 ? "" : "s"}`;
  const mailtoUrl = partner?.contactEmail
    ? `mailto:${encodeURIComponent(partner.contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`
    : "";
  return {
    id: courierRequest.id,
    courierPartnerId: courierRequest.courierPartnerId,
    partner: partner ? {
      id: partner.id,
      name: partner.name,
      contactPhone: partner.contactPhone || "",
      serviceArea: partner.serviceArea || "",
      requestMethod: partner.requestMethod || "manual",
      bookingUrl: partner.bookingUrl || ""
    } : null,
    tripIds: Array.isArray(courierRequest.tripIds) ? [...courierRequest.tripIds] : [],
    pickup: courierRequest.pickup || "",
    deliveries: Array.isArray(courierRequest.deliveries) ? courierRequest.deliveries.map((delivery) => ({ ...delivery })) : [],
    requestedPickupAt: courierRequest.requestedPickupAt || null,
    serviceLevel: courierRequest.serviceLevel || "Same-day",
    quotedFee: courierRequest.quotedFee === null || courierRequest.quotedFee === undefined ? null : Number(courierRequest.quotedFee),
    currency: courierRequest.currency || db.company?.currency || "CAD",
    referenceNumber: courierRequest.referenceNumber || "",
    trackingUrl: courierRequest.trackingUrl || "",
    notes: courierRequest.notes || "",
    status: courierRequest.status,
    sentAt: courierRequest.sentAt || null,
    deliveryError: courierRequest.deliveryError || "",
    createdAt: courierRequest.createdAt || null,
    updatedAt: courierRequest.updatedAt || null,
    statusHistory: Array.isArray(courierRequest.statusHistory) ? courierRequest.statusHistory.map((entry) => ({ ...entry })) : [],
    summary,
    mailtoUrl,
    bookingUrl: partner?.bookingUrl || "",
    phoneUrl: partner?.contactPhone ? `tel:${String(partner.contactPhone).replace(/[^+\d]/g, "")}` : ""
  };
}

function publicProofMedia(media = {}) {
  const output = {};
  for (const kind of ["photo", "signature"]) {
    const item = media?.[kind];
    if (!item?.token) continue;
    output[kind] = {
      url: `/api/proof-media/${encodeURIComponent(item.token)}`,
      contentType: item.contentType || "image/png",
      filename: item.filename || `${kind}.png`,
      size: Number(item.size || 0)
    };
  }
  return output;
}

function publicProof(proof) {
  if (!proof || typeof proof !== "object") return null;
  const output = {
    method: String(proof.method || "Delivery completed"),
    recipient: String(proof.recipient || ""),
    outcome: String(proof.outcome || ""),
    exceptionReason: String(proof.exceptionReason || ""),
    exceptionNote: String(proof.exceptionNote || ""),
    nextAction: String(proof.nextAction || ""),
    kind: String(proof.kind || "customer-proof"),
    overrideReason: String(proof.overrideReason || ""),
    locationStatus: String(proof.locationStatus || (proof.location ? "recorded" : "unavailable")),
    recordedAt: proof.recordedAt || null,
    recordedBy: String(proof.recordedBy || "")
  };
  if (proof.location && Number.isFinite(Number(proof.location.lat)) && Number.isFinite(Number(proof.location.lng))) {
    output.location = {
      lat: Number(proof.location.lat),
      lng: Number(proof.location.lng),
      accuracy: Number.isFinite(Number(proof.location.accuracy)) ? Number(proof.location.accuracy) : null,
      timestamp: proof.location.timestamp || proof.recordedAt || null
    };
  }
  const media = publicProofMedia(proof.media);
  if (Object.keys(media).length) output.media = media;
  return output;
}

function publicCustomerProof(proof) {
  if (!proof || typeof proof !== "object") return null;
  const output = {
    method: String(proof.method || "Delivery completed"),
    recipient: String(proof.recipient || ""),
    recordedAt: proof.recordedAt || null
  };
  const media = publicProofMedia(proof.media);
  if (Object.keys(media).length) output.media = media;
  return output;
}

function archiveTripProof(trip) {
  if (!trip.proof) return;
  trip.proofHistory = Array.isArray(trip.proofHistory) ? trip.proofHistory : [];
  trip.proofHistory.push(trip.proof);
  trip.proofHistory = trip.proofHistory.slice(-20);
  delete trip.proof;
}

function confirmDeliveredByDispatcher(trip, session, overrideReason, recordedAt = nowIso()) {
  const preserveCustomerProof = trip.status === "completed"
    && trip.proof?.kind === "customer-proof"
    && !trip.proof?.exceptionReason;
  if (preserveCustomerProof) {
    trip.dispatcherConfirmation = {
      reason: overrideReason,
      recordedAt,
      recordedBy: session.name || "Dispatcher"
    };
    return;
  }
  archiveTripProof(trip);
  trip.proof = {
    method: "Dispatcher override",
    recipient: "",
    outcome: "dispatcher-override",
    kind: "dispatcher-override",
    overrideReason,
    media: trip.pendingProofMedia || {},
    recordedAt,
    recordedBy: session.name || "Dispatcher"
  };
  delete trip.pendingProofMedia;
}

function resetTripForDispatch(trip) {
  archiveTripProof(trip);
  delete trip.pendingProofMedia;
  delete trip.courierRequestId;
  delete trip.courierPartnerId;
  delete trip.fulfillmentType;
  trip.endedAt = null;
  trip.path = [];
  trip.location = null;
  trip.distanceKm = 0;
  for (const key of ["routeId", "routeSequence", "routeStopCount", "routeOrigin", "routeDestinations"]) delete trip[key];
}

function activeRouteStateForDriver(db, driverId, excludedTripIds = new Set()) {
  const trips = db.trips
    .filter((trip) => trip.driverId === driverId && trip.status === "active" && !excludedTripIds.has(trip.id))
    .sort((left, right) => Number(left.routeSequence || 0) - Number(right.routeSequence || 0));
  const routeKeys = new Set(trips.map((trip) => trip.routeId || `single:${trip.id}`));
  return { trips, conflict: routeKeys.size > 1 };
}

function currentRouteTripId(db, trip) {
  if (!trip?.routeId || !trip.driverId) return trip?.id || "";
  const activeRouteTrips = db.trips
    .filter((item) => item.routeId === trip.routeId && item.driverId === trip.driverId && item.status === "active")
    .sort((left, right) => Number(left.routeSequence || 0) - Number(right.routeSequence || 0));
  const activeIds = new Set(activeRouteTrips.map((item) => item.id));
  const publishedId = activeRouteTrips
    .map((item) => item.routeCurrentTripId)
    .find((tripId) => activeIds.has(tripId));
  return publishedId || activeRouteTrips[0]?.id || trip.id;
}

function attachTripsToDriverRoute(db, driver, orderedTrips, fallbackOrigin) {
  const newTripIds = new Set(orderedTrips.map((trip) => trip.id));
  const activeRoute = activeRouteStateForDriver(db, driver.id, newTripIds);
  if (activeRoute.conflict) return null;
  const existingTrips = activeRoute.trips;
  const routeId = existingTrips[0]?.routeId || makeId("route");
  const routeOrigin = existingTrips[0]?.routeOrigin || fallbackOrigin;
  const combinedTrips = [...existingTrips, ...orderedTrips];
  const routeDestinations = combinedTrips.map((trip) => trip.destination);
  combinedTrips.forEach((trip, routeSequence) => {
    trip.routeId = routeId;
    trip.routeSequence = routeSequence;
    trip.routeStopCount = combinedTrips.length;
    trip.routeOrigin = routeOrigin;
    trip.routeDestinations = routeDestinations;
  });
  return { routeId, routeOrigin, combinedTrips, appendedToActiveRoute: existingTrips.length > 0 };
}

function createRedispatchAttempt(db, trip) {
  if (trip.status === "queued") return trip;
  const transferredTrackingStops = trackingStopsForTrip(trip).map((stop) => ({ ...stop }));
  const transferredShareToken = String(trip.shareToken || transferredTrackingStops.at(-1)?.shareToken || makeToken());
  const transferredSource = trip.source ? { ...trip.source } : null;
  const attempt = {
    ...trip,
    id: makeId("trip"),
    status: "queued",
    deliveryOutcomeStatus: "queued",
    driverId: "",
    startedAt: null,
    endedAt: null,
    submittedAt: null,
    reviewedAt: null,
    approvalNotes: "",
    path: [],
    location: null,
    distanceKm: 0,
    shareToken: transferredShareToken,
    trackingStops: transferredTrackingStops,
    retryOfTripId: trip.id,
    attemptNumber: Number(trip.attemptNumber || 1) + 1,
    proofHistory: [],
    exceptionHistory: []
  };
  delete attempt.proof;
  delete attempt.pendingProofMedia;
  delete attempt.retryTripId;
  if (!attempt.trackingStops.length) syncTrackingStops(attempt);
  if (transferredSource) attempt.source = transferredSource;
  else delete attempt.source;

  if (trip.status === "exception") {
    trip.status = "failed";
    trip.deliveryOutcomeStatus = "failed";
    trip.resolvedAt = nowIso();
  }
  trip.redispatchedAt = nowIso();
  trip.retryTripId = attempt.id;
  if (transferredSource) {
    trip.sourceHistory = transferredSource;
    delete trip.source;
  }
  rotateTrackingTokens(trip);
  db.trips.push(attempt);
  return attempt;
}

function proofMediaRecordByToken(db, token) {
  const tokenText = String(token || "");
  if (!tokenText) return null;
  for (const trip of db.trips) {
    const records = [trip.proof, ...(Array.isArray(trip.proofHistory) ? trip.proofHistory : [])];
    for (const proof of records) {
      for (const item of Object.values(proof?.media || {})) {
        if (item?.token && constantTimeEqual(item.token, tokenText)) return item;
      }
    }
  }
  return null;
}

function publicTrip(db, trip) {
  const driver = db.drivers.find((item) => item.id === trip.driverId);
  const courierRequest = trip.courierRequestId
    ? db.courierRequests.find((item) => item.id === trip.courierRequestId)
    : null;
  const courierPartner = courierRequest
    ? db.courierPartners.find((item) => item.id === courierRequest.courierPartnerId)
    : null;
  const tripType = normalizeTripType(trip.tripType);
  const distanceKm = Number(trip.distanceKm || 0);
  const businessDistanceKm = tripType === "business" ? distanceKm : 0;
  const personalDistanceKm = tripType === "personal" ? distanceKm : 0;
  const { pendingProofMedia: _pendingProofMedia, proof, proofHistory, ...publicFields } = trip;
  return {
    ...publicFields,
    proof: publicProof(proof),
    proofHistory: (Array.isArray(proofHistory) ? proofHistory : []).map(publicProof).filter(Boolean),
    tripType,
    stops: routeStopsForTrip(trip),
    trackingStops: trackingStopsForTrip(trip),
    driver: driver ? publicDriver(driver) : null,
    courier: courierRequest && courierPartner ? {
      requestId: courierRequest.id,
      partnerId: courierPartner.id,
      name: courierPartner.name,
      status: courierRequest.status,
      referenceNumber: courierRequest.referenceNumber || "",
      trackingUrl: courierRequest.trackingUrl || "",
      quotedFee: courierRequest.quotedFee === null || courierRequest.quotedFee === undefined ? null : Number(courierRequest.quotedFee),
      updatedAt: courierRequest.updatedAt || null,
      isOpen: OPEN_COURIER_REQUEST_STATUSES.has(courierRequest.status)
    } : null,
    businessDistanceKm,
    personalDistanceKm,
    billableAmount: Number((businessDistanceKm * (trip.kmRate || 0)).toFixed(2))
  };
}

function leadScore(lead) {
  const volume = Number(lead.weeklyDeliveries || 0);
  let score = 45;
  if (volume >= 500) score += 35;
  else if (volume >= 200) score += 25;
  else if (volume >= 50) score += 15;
  if (["shopify", "woocommerce", "wix", "square", "api"].includes(String(lead.primaryChannel || "").toLowerCase())) score += 10;
  if (String(lead.notes || "").trim().length > 40) score += 5;
  return Math.min(95, score);
}

function cleanLeadField(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function leadAttribution(value) {
  const attribution = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const landingPath = cleanLeadField(attribution.landingPath, 180);
  return {
    source: cleanLeadField(attribution.source, 80) || "direct",
    medium: cleanLeadField(attribution.medium, 80),
    campaign: cleanLeadField(attribution.campaign, 120),
    content: cleanLeadField(attribution.content, 120),
    landingPath: landingPath.startsWith("/") ? landingPath : "",
    referrerHost: cleanLeadField(attribution.referrerHost, 255).toLowerCase()
  };
}

function publicLead(lead) {
  return {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone || "",
    weeklyDeliveries: Number(lead.weeklyDeliveries || 0),
    deliveryCategory: lead.deliveryCategory || "",
    primaryChannel: lead.primaryChannel || "",
    notes: lead.notes || "",
    preferredReviewDate: lead.preferredReviewDate || "",
    preferredReviewWindow: lead.preferredReviewWindow || "",
    preferredContactMethod: lead.preferredContactMethod || "",
    attribution: leadAttribution(lead.attribution),
    stage: LEAD_STAGES.has(lead.stage) ? lead.stage : "new",
    score: Number(lead.score || 0),
    createdAt: lead.createdAt || null,
    updatedAt: lead.updatedAt || null
  };
}

function customerVisibleLocation(db, trip) {
  if (trip.status !== "active" || !trip.location) return null;
  if (trackingStopsForTrip(trip).length > 1) return null;
  if (trip.routeId && currentRouteTripId(db, trip) !== trip.id) return null;
  return {
    lat: trip.location.lat,
    lng: trip.location.lng,
    accuracy: trip.location.accuracy ?? null,
    timestamp: trip.location.timestamp || null
  };
}

function publicCustomerTrip(db, trip, trackingStop) {
  const driver = db.drivers.find((item) => item.id === trip.driverId);
  const courierRequest = trip.courierRequestId
    ? db.courierRequests.find((item) => item.id === trip.courierRequestId)
    : null;
  const courierPartner = courierRequest
    ? db.courierPartners.find((item) => item.id === courierRequest.courierPartnerId)
    : null;
  const customerCourierVisible = Boolean(courierRequest && courierPartner && CUSTOMER_VISIBLE_COURIER_REQUEST_STATUSES.has(courierRequest.status));
  const destination = trackingStop?.address || routeStopsForTrip(trip).at(-1)?.address || "";
  const courierCustomerStatus = courierRequest?.status === "picked-up"
    ? "picked-up"
    : courierRequest?.status === "accepted"
      ? "accepted"
      : courierRequest?.status === "requested"
        ? "requested"
        : courierRequest?.status === "delivered"
          ? "delivered"
          : "";
  const customerStatus = courierCustomerStatus || (trip.deliveryOutcomeStatus === "failed" || trip.status === "failed"
    ? "failed"
    : trip.deliveryOutcomeStatus === "exception" || trip.status === "exception"
      ? "exception"
      : ["completed", "submitted", "approved", "rejected", "delivered"].includes(trip.status)
        ? "delivered"
        : trip.status);
  const output = {
    id: trip.id,
    customerName: "Your delivery",
    status: customerStatus,
    startedAt: trip.startedAt || null,
    endedAt: trip.endedAt || null,
    etaMinutes: Number.isFinite(Number(trip.etaMinutes)) ? Number(trip.etaMinutes) : null,
    expectedArrivalAt: trip.expectedArrivalAt || null,
    location: customerVisibleLocation(db, trip),
    stops: destination ? [{ label: "Delivery address", address: destination }] : [],
    driver: driver
      ? {
          name: db.company?.branding?.showDriverFirstName === false ? "Your driver" : String(driver.name || "Driver").split(/\s+/)[0],
          vehicle: driver.vehicle,
          color: driver.color
        }
      : null,
    courier: customerCourierVisible ? {
      name: courierPartner.name,
      status: courierRequest.status,
      referenceNumber: courierRequest.referenceNumber || "",
      trackingUrl: courierRequest.trackingUrl || "",
      updatedAt: courierRequest.updatedAt || null
    } : null
  };
  const finalTrackingStop = trackingStopsForTrip(trip).at(-1);
  const isFinalTrackingStop = Boolean(trackingStop?.shareToken && finalTrackingStop?.shareToken)
    && constantTimeEqual(trackingStop.shareToken, finalTrackingStop.shareToken);
  if (trip.proof && trip.status !== "exception" && isFinalTrackingStop) output.proof = publicCustomerProof(trip.proof);
  return output;
}

function currentPlan(db) {
  return PLAN_CATALOG[db.company?.planId] || PLAN_CATALOG.starter;
}

function planFeatureGates(db) {
  const plan = currentPlan(db);
  const orderedPlans = Object.values(PLAN_CATALOG);
  const featureIds = [...new Set(orderedPlans.flatMap((item) => item.features))];
  return Object.fromEntries(featureIds.map((feature) => {
    const minimumPlan = orderedPlans.find((item) => item.features.includes(feature));
    return [feature, {
      enabled: plan.features.includes(feature),
      minimumPlanId: minimumPlan?.id || "pro",
      minimumPlanName: minimumPlan?.name || "Pro"
    }];
  }));
}

function operationsAnalytics(db) {
  const trips = db.trips || [];
  const completed = trips.filter((trip) => ["completed", "delivered", "submitted", "approved", "rejected"].includes(trip.status));
  const failed = trips.filter((trip) => trip.status === "failed" || trip.deliveryOutcomeStatus === "failed");
  const late = trips.filter((trip) => {
    if (!trip.deliveryWindowEnd) return false;
    const deadline = new Date(trip.deliveryWindowEnd).getTime();
    const finished = trip.endedAt ? new Date(trip.endedAt).getTime() : Date.now();
    return Number.isFinite(deadline) && finished > deadline && !["queued"].includes(trip.status);
  });
  const timedCompleted = completed.filter((trip) => trip.startedAt && trip.endedAt);
  const durationMinutes = timedCompleted.reduce((total, trip) => {
    return total + Math.max(0, new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 60000;
  }, 0);
  const totalDistance = completed.reduce((total, trip) => total + Number(trip.distanceKm || 0), 0);
  const totalCost = completed.reduce((total, trip) => total + Number(trip.distanceKm || 0) * Number(trip.kmRate || 0), 0);
  const timedWindowTrips = completed.filter((trip) => trip.deliveryWindowEnd);
  const onTime = timedWindowTrips.filter((trip) => new Date(trip.endedAt).getTime() <= new Date(trip.deliveryWindowEnd).getTime()).length;
  const activeDriverIds = new Set(trips.filter((trip) => trip.driverId && ["active", "completed", "delivered", "submitted", "approved"].includes(trip.status)).map((trip) => trip.driverId));
  const driverCount = db.drivers.filter((driver) => !driver.archivedAt).length;
  const deliveriesByDriver = db.drivers.filter((driver) => !driver.archivedAt).map((driver) => ({
    driverId: driver.id,
    name: driver.name,
    completed: completed.filter((trip) => trip.driverId === driver.id).length,
    active: trips.filter((trip) => trip.driverId === driver.id && trip.status === "active").length
  }));
  return {
    dataSource: "Rivo delivery records",
    scope: "All non-archived deliveries in this workspace",
    caveat: "Time and on-time metrics appear only when the required timestamps or delivery windows exist.",
    completed: completed.length,
    onTimeRate: timedWindowTrips.length ? Math.round((onTime / timedWindowTrips.length) * 100) : null,
    averageDeliveryMinutes: timedCompleted.length ? Math.round(durationMinutes / timedCompleted.length) : null,
    averageDistanceKm: completed.length ? Number((totalDistance / completed.length).toFixed(1)) : null,
    failed: failed.length,
    late: late.length,
    driverUtilizationRate: driverCount ? Math.round((activeDriverIds.size / driverCount) * 100) : null,
    averageCostPerDelivery: completed.length ? Number((totalCost / completed.length).toFixed(2)) : null,
    deliveriesByDriver
  };
}

function operationalAlerts(db) {
  const now = Date.now();
  const alerts = [];
  const plan = currentPlan(db);
  const activeDriverCount = db.drivers.filter((driver) => !driver.archivedAt).length;
  const monthPrefix = nowIso().slice(0, 7);
  const monthlyDeliveryCount = db.trips.filter((trip) => String(trip.importedAt || trip.startedAt || "").startsWith(monthPrefix)).length;
  if (activeDriverCount >= plan.driverLimit) alerts.push({ type: "plan-drivers", severity: "medium", count: activeDriverCount, message: `${activeDriverCount} of ${plan.driverLimit} plan driver seats are in use` });
  if (monthlyDeliveryCount >= Math.ceil(plan.deliveryLimit * 0.9)) alerts.push({ type: "plan-deliveries", severity: monthlyDeliveryCount >= plan.deliveryLimit ? "high" : "medium", count: monthlyDeliveryCount, message: `${monthlyDeliveryCount} of ${plan.deliveryLimit} monthly deliveries are recorded` });
  const unassigned = db.trips.filter((trip) => trip.status === "queued" && !trip.driverId && !trip.courierRequestId);
  if (unassigned.length) alerts.push({ type: "unassigned", severity: "high", count: unassigned.length, message: `${unassigned.length} queued deliver${unassigned.length === 1 ? "y has" : "ies have"} no driver` });
  const late = db.trips.filter((trip) => trip.status === "active" && trip.deliveryWindowEnd && new Date(trip.deliveryWindowEnd).getTime() < now);
  if (late.length) alerts.push({ type: "late", severity: "high", count: late.length, message: `${late.length} active deliver${late.length === 1 ? "y is" : "ies are"} past the delivery window` });
  const stale = db.trips.filter((trip) => trip.status === "active" && trip.location?.timestamp && now - new Date(trip.location.timestamp).getTime() > 15 * 60 * 1000);
  if (stale.length) alerts.push({ type: "stale-location", severity: "medium", count: stale.length, message: `${stale.length} active driver location${stale.length === 1 ? " has" : "s have"} not updated in 15 minutes` });
  return alerts;
}

function snapshot(db, env) {
  return {
    company: companyForEnv(db, env),
    plans: Object.values(PLAN_CATALOG),
    planAccess: currentPlan(db),
    featureGates: planFeatureGates(db),
    analytics: operationsAnalytics(db),
    alerts: operationalAlerts(db),
    dispatchAssistant: {
      mode: "explainable-rules",
      aiConnected: false,
      label: "Explainable dispatch recommendations",
      note: "Rivo uses current workload, driver availability, route order, delivery priority, and time windows. No generative AI provider is connected."
    },
    weekKey: weekKey(),
    integrations: integrationsStatus(db, env),
    invitationEmail: {
      configured: Boolean(String(env.RESEND_API_KEY || "").trim() && String(env.INVITE_FROM_EMAIL || "").trim()),
      from: String(env.INVITE_FROM_EMAIL || "").trim().replace(/^.*<([^>]+)>.*$/, "$1")
    },
    courierEmail: {
      configured: Boolean(String(env.RESEND_API_KEY || "").trim() && String(env.COURIER_REQUEST_FROM_EMAIL || "").trim()),
      from: String(env.COURIER_REQUEST_FROM_EMAIL || "").trim().replace(/^.*<([^>]+)>.*$/, "$1")
    },
    proofMedia: { configured: Boolean(env.PROOF_MEDIA && typeof env.PROOF_MEDIA.put === "function") },
    drivers: db.drivers.filter((driver) => !driver.archivedAt).map((driver) => publicDriver(driver, { includeLogin: true })),
    courierPartners: db.courierPartners.filter((partner) => !partner.archivedAt).map(publicCourierPartner),
    courierRequests: db.courierRequests.slice(-100).map((courierRequest) => publicCourierRequest(db, courierRequest)),
    trips: db.trips.map((trip) => publicTrip(db, trip)),
    leads: db.leads.map(publicLead)
  };
}

function driverById(db, driverId) {
  return db.drivers.find((driver) => driver.id === driverId && !driver.archivedAt);
}

async function driverByLogin(db, identifier, password) {
  const normalizedIdentifier = normalizePhone(identifier);
  const loginText = String(identifier || "").trim().toLowerCase();
  for (const driver of db.drivers) {
    if (driver.archivedAt) continue;
    const phoneMatches = normalizedIdentifier && normalizePhone(driver.phone) === normalizedIdentifier;
    const loginMatches = loginText && String(driver.loginId || "").toLowerCase() === loginText;
    const emailMatches = loginText && normalizeEmail(driver.email) === loginText;
    if ((phoneMatches || loginMatches || emailMatches) && await passwordMatches(driver, password)) return driver;
  }
  return null;
}

function driverSnapshot(db, env, driverId) {
  const driver = driverById(db, driverId);
  if (!driver) return null;
  return {
    company: companyForEnv(db, env),
    weekKey: weekKey(),
    integrations: { connections: [] },
    proofMedia: { configured: Boolean(env.PROOF_MEDIA && typeof env.PROOF_MEDIA.put === "function") },
    drivers: [publicDriver(driver, { includePrivate: true })],
    trips: db.trips
      .filter((trip) => trip.driverId === driver.id)
      .map((trip) => publicTrip(db, trip))
  };
}

function cleanSessions(db) {
  const cutoff = Date.now();
  db.sessions = Array.isArray(db.sessions)
    ? db.sessions.filter((session) => new Date(session.expiresAt).getTime() > cutoff)
    : [];
}

function createSession(db, user) {
  cleanSessions(db);
  const session = {
    token: makeToken(),
    role: user.role,
    name: user.name,
    driverId: user.driverId || "",
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  db.sessions.push(session);
  return session;
}

function sessionFromRequest(request, db, url) {
  cleanSessions(db);
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const token = bearer || request.headers.get("x-session-token") || url.searchParams.get("session") || "";
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token) || null;
  if (session?.role === "driver" && !driverById(db, session.driverId)) return null;
  return session;
}

function publicSession(session) {
  return {
    token: session.token,
    role: session.role,
    name: session.name,
    driverId: session.driverId || "",
    expiresAt: session.expiresAt
  };
}

function companyForEnv(db, env = {}) {
  return {
    ...db.company,
    name: String(db.company?.name || env.COMPANY_NAME || DEFAULT_COMPANY_NAME)
  };
}

function workspacePickupAddress(db) {
  return String(db.company?.pickupAddress || DEFAULT_PICKUP_ADDRESS).trim() || DEFAULT_PICKUP_ADDRESS;
}

function mapsConfig(env = {}) {
  const apiKey = String(env.GOOGLE_MAPS_BROWSER_API_KEY || env.GOOGLE_MAPS_API_KEY || "").trim();
  const mapId = String(env.GOOGLE_MAPS_MAP_ID || "").trim();
  return {
    configured: Boolean(apiKey),
    apiKey,
    mapId
  };
}

async function optimizedStopOrder(env, origin, destinations) {
  const apiKey = String(env.GOOGLE_MAPS_SERVER_API_KEY || env.GOOGLE_MAPS_API_KEY || "").trim();
  const fallbackOrder = destinations.map((_, index) => index);
  if (!apiKey || destinations.length < 2) return { order: fallbackOrder, optimized: false, distanceKm: null, durationMinutes: null };
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration"
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: origin },
      intermediates: destinations.map((address) => ({ address })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: true
    })
  });
  if (!response.ok) return { order: fallbackOrder, optimized: false, distanceKm: null, durationMinutes: null };
  const payload = await response.json();
  const route = payload.routes?.[0] || {};
  const order = route.optimizedIntermediateWaypointIndex;
  const durationSeconds = Number(String(route.duration || "").replace(/s$/, ""));
  const summary = {
    distanceKm: Number.isFinite(Number(route.distanceMeters)) ? Number((Number(route.distanceMeters) / 1000).toFixed(1)) : null,
    durationMinutes: Number.isFinite(durationSeconds) ? Math.round(durationSeconds / 60) : null
  };
  return Array.isArray(order) && order.length === destinations.length
    ? { order, optimized: true, ...summary }
    : { order: fallbackOrder, optimized: false, ...summary };
}

function optimizationCandidates(db, requestedIds = null) {
  const trips = db.trips
    .filter((trip) => trip.status === "queued" && !openCourierRequestForTrip(db, trip.id) && (!requestedIds || requestedIds.has(trip.id)))
    .sort((left, right) => {
      const priorityRank = { urgent: 0, priority: 1, standard: 2 };
      const priorityDelta = (priorityRank[left.priority] ?? 2) - (priorityRank[right.priority] ?? 2);
      if (priorityDelta) return priorityDelta;
      const leftWindow = left.deliveryWindowEnd ? new Date(left.deliveryWindowEnd).getTime() : Number.MAX_SAFE_INTEGER;
      const rightWindow = right.deliveryWindowEnd ? new Date(right.deliveryWindowEnd).getTime() : Number.MAX_SAFE_INTEGER;
      return leftWindow - rightWindow || new Date(left.importedAt || 0) - new Date(right.importedAt || 0);
    });
  const drivers = db.drivers.filter((driver) => {
    return driver.status !== "offline"
      && Boolean(driver.passwordHash || driver.inviteAcceptedAt)
      && !activeRouteStateForDriver(db, driver.id).conflict;
  });
  return { trips, drivers };
}

async function buildOptimizationPlan(db, env, requestedIds = null) {
  const { trips, drivers } = optimizationCandidates(db, requestedIds);
  if (!trips.length) throw new Error("There are no queued orders to optimize.");
  if (!drivers.length) throw new Error("Add an available driver before optimizing deliveries.");
  const load = new Map(drivers.map((driver) => [driver.id, db.trips.filter((trip) => trip.driverId === driver.id && trip.status === "active").length]));
  const groups = new Map(drivers.map((driver) => [driver.id, []]));
  for (const trip of trips) {
    const eligible = drivers.filter((driver) => load.get(driver.id) < Number(driver.capacity || 20));
    if (!eligible.length) throw new Error("Every available driver is at capacity. Increase capacity or add another driver.");
    const driver = eligible.slice().sort((left, right) => (load.get(left.id) - load.get(right.id)) || String(left.name).localeCompare(String(right.name)))[0];
    groups.get(driver.id).push(trip);
    load.set(driver.id, load.get(driver.id) + 1);
  }
  const recommendations = [];
  for (const driver of drivers) {
    const group = groups.get(driver.id);
    if (!group.length) continue;
    const existingRoute = activeRouteStateForDriver(db, driver.id);
    const origin = existingRoute.trips.at(-1)?.destination || workspacePickupAddress(db);
    const routePlan = await optimizedStopOrder(env, origin, group.map((trip) => trip.destination));
    const orderedTrips = routePlan.order.map((index) => group[index]);
    recommendations.push({
      driverId: driver.id,
      driverName: driver.name,
      currentStops: existingRoute.trips.length,
      capacity: Number(driver.capacity || 20),
      origin,
      optimized: routePlan.optimized,
      estimatedDistanceKm: routePlan.distanceKm,
      estimatedDurationMinutes: routePlan.durationMinutes,
      expectedCompletionAt: routePlan.durationMinutes ? new Date(Date.now() + routePlan.durationMinutes * 60000).toISOString() : null,
      tripIds: orderedTrips.map((trip) => trip.id),
      stops: orderedTrips.map((trip, index) => ({
        order: index + 1,
        tripId: trip.id,
        customerName: trip.customerName,
        destination: trip.destination,
        priority: trip.priority || "standard",
        deliveryWindowEnd: trip.deliveryWindowEnd || null
      })),
      reason: existingRoute.trips.length
        ? `Adds these stops to ${driver.name}'s current route while balancing total workload.`
        : `${driver.name} has the lightest available workload and capacity for these stops.`
    });
  }
  return {
    generatedAt: nowIso(),
    engine: recommendations.some((item) => item.optimized) ? "google-routes-plus-rules" : "explainable-rules",
    canEstimateRoute: recommendations.some((item) => item.estimatedDurationMinutes !== null),
    totalDeliveries: trips.length,
    recommendations,
    explanation: "Priority orders and earliest delivery windows are considered first. Rivo then balances active workload and driver capacity before ordering each route."
  };
}

function setupCode(env = {}) {
  return String(env.OWNER_SETUP_CODE || "").trim();
}

function setupEnabled(env = {}) {
  return Boolean(setupCode(env));
}

function dispatcherCredentials(env = {}) {
  const username = String(env.DISPATCHER_USERNAME || "").trim().toLowerCase();
  const password = String(env.DISPATCHER_PASSWORD || "");
  return username && password ? { username, password } : null;
}

async function loginUser(db, env, identifier, password) {
  const owner = db.ownerAccount;
  if (
    owner?.username &&
    String(identifier || "").trim().toLowerCase() === String(owner.username).toLowerCase() &&
    await passwordMatches(owner, password)
  ) {
    if (owner.passwordAlgorithm !== "pbkdf2-sha256") await setPassword(owner, password);
    return { role: "dispatcher", name: owner.name || "Owner" };
  }
  const credentials = dispatcherCredentials(env);
  if (credentials && String(identifier || "").trim().toLowerCase() === credentials.username && constantTimeEqual(password, credentials.password)) {
    return { role: "dispatcher", name: "Dispatcher" };
  }
  const driver = await driverByLogin(db, identifier, password);
  if (!driver) return null;
  if (driver.passwordAlgorithm !== "pbkdf2-sha256") await setPassword(driver, password);
  return { role: "driver", name: driver.name, driverId: driver.id };
}

function loginAttemptKey(request, identifier) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${ip}:${String(identifier || "").trim().toLowerCase()}`;
}

function loginAttemptState(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.startedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    const fresh = { count: 0, startedAt: now };
    loginAttempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function loginRetryAfterSeconds(key) {
  const current = loginAttemptState(key);
  if (current.count < LOGIN_ATTEMPT_LIMIT) return 0;
  return Math.max(1, Math.ceil((LOGIN_ATTEMPT_WINDOW_MS - (Date.now() - current.startedAt)) / 1000));
}

function recordLoginFailure(key) {
  const current = loginAttemptState(key);
  current.count += 1;
}

function isDispatcher(session) {
  return session?.role === "dispatcher";
}

function canAccessTrip(session, trip) {
  return isDispatcher(session) || (session?.role === "driver" && session.driverId === trip.driverId);
}

function trackingShareByToken(db, token) {
  const tokenText = String(token || "");
  for (const trip of db.trips) {
    const trackingStop = trackingStopsForTrip(trip).find((stop) => constantTimeEqual(stop.shareToken, tokenText));
    if (trackingStop) return { trip, trackingStop };
  }
  return null;
}

function courierPartnerInput(body, existing = {}) {
  const requestMethod = String(body.requestMethod ?? existing.requestMethod ?? "email").trim().toLowerCase();
  const contactEmail = normalizeEmail(body.contactEmail ?? existing.contactEmail ?? "");
  const contactPhone = String(body.contactPhone ?? existing.contactPhone ?? "").trim();
  const rawBookingUrl = String(body.bookingUrl ?? existing.bookingUrl ?? "").trim();
  const bookingUrl = rawBookingUrl ? normalizedPublicHttpsUrl(rawBookingUrl) : "";
  if (!COURIER_REQUEST_METHODS.has(requestMethod)) throw new Error("Choose email, booking page, or manual sharing for this courier.");
  if (contactEmail && !validEmail(contactEmail)) throw new Error("Enter a valid courier request email.");
  if (rawBookingUrl && !bookingUrl) throw new Error("Courier booking links must be public HTTPS URLs.");
  if (requestMethod === "email" && !validEmail(contactEmail)) throw new Error("Email requests need a valid courier email address.");
  if (requestMethod === "booking" && !bookingUrl) throw new Error("Booking requests need a public HTTPS booking page.");
  if (requestMethod === "manual" && !contactEmail && !contactPhone && !bookingUrl) {
    throw new Error("Add an email, phone number, or booking page for manual courier requests.");
  }
  const name = String(body.name ?? existing.name ?? "").trim();
  if (name.length < 2) throw new Error("Courier partner name is required.");
  return {
    name: name.slice(0, 120),
    contactEmail,
    contactPhone: contactPhone.slice(0, 60),
    serviceArea: String(body.serviceArea ?? existing.serviceArea ?? "").trim().slice(0, 240),
    requestMethod,
    bookingUrl,
    notes: String(body.notes ?? existing.notes ?? "").trim().slice(0, 1200),
    active: body.active === undefined ? existing.active !== false : ![false, "false", "0", 0].includes(body.active)
  };
}

function courierStatusCanChange(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  if (["delivered", "declined", "cancelled"].includes(currentStatus)) return false;
  return COURIER_REQUEST_STATUSES.has(nextStatus) && nextStatus !== "ready-to-share" && nextStatus !== "send-failed";
}

function completeCourierRequestTrips(db, courierRequest, partner, session, recordedAt) {
  for (const tripId of courierRequest.tripIds || []) {
    const trip = db.trips.find((item) => item.id === tripId);
    if (!trip || trip.courierRequestId !== courierRequest.id) continue;
    archiveTripProof(trip);
    delete trip.pendingProofMedia;
    trip.status = "delivered";
    trip.deliveryOutcomeStatus = "delivered";
    trip.endedAt = recordedAt;
    trip.tripType = "business";
    trip.proof = {
      method: `${partner?.name || "Courier partner"} delivery confirmation`,
      recipient: "",
      outcome: "external-courier",
      kind: "external-courier",
      recordedAt,
      recordedBy: session.name || "Dispatcher"
    };
  }
}

function releaseCourierRequestTrips(db, courierRequest) {
  for (const tripId of courierRequest.tripIds || []) {
    const trip = db.trips.find((item) => item.id === tripId);
    if (!trip || trip.courierRequestId !== courierRequest.id) continue;
    delete trip.courierRequestId;
    delete trip.courierPartnerId;
    delete trip.fulfillmentType;
  }
}

function sendJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}

function authJson(body, status = 200, extraHeaders = {}) {
  return sendJson(body, status, { "Cache-Control": "no-store", ...extraHeaders });
}

function leadCorsHeaders(request) {
  const origin = String(request.headers.get("origin") || "");
  if (!LEAD_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function leadJson(request, body, status = 200) {
  return sendJson(body, status, leadCorsHeaders(request));
}

async function readBody(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON.");
  }
}

function badRequest(message) {
  return sendJson({ error: message }, 400);
}

function unauthorized(message = "Login required.") {
  return sendJson({ error: message }, 401);
}

function notFound() {
  return sendJson({ error: "Not found" }, 404);
}

function sendSse(client, event, data) {
  client.controller.enqueue(client.encoder.encode(`event: ${event}\n`));
  client.controller.enqueue(client.encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function canReceiveBroadcast(client, event, data, options = {}) {
  if (client.token) return Boolean(options.token) && client.token === options.token;
  if (client.tripId) {
    if (!options.tripId || client.tripId !== options.tripId) return false;
    return !client.session || canAccessTrip(client.session, data);
  }
  return event !== "trip-update";
}

function broadcast(event, data, options = {}) {
  for (const client of clients) {
    if (!canReceiveBroadcast(client, event, data, options)) continue;
    try {
      sendSse(client, event, data);
    } catch {
      clients.delete(client);
    }
  }
}

function broadcastCustomerTripUpdates(db, trip) {
  for (const trackingStop of trackingStopsForTrip(trip)) {
    broadcast("trip-update", publicCustomerTrip(db, trip, trackingStop), { token: trackingStop.shareToken });
  }
}

function broadcastSnapshot(db, env) {
  for (const client of clients) {
    if (client.token) continue;
    try {
      if (client.session?.role === "driver") {
        const nextSnapshot = driverSnapshot(db, env, client.session.driverId);
        if (nextSnapshot) sendSse(client, "snapshot", nextSnapshot);
      } else if (client.session?.role === "dispatcher") {
        sendSse(client, "snapshot", snapshot(db, env));
      }
    } catch {
      clients.delete(client);
    }
  }
}

function calcDriverStatus(db, driverId) {
  return db.trips.some((trip) => trip.driverId === driverId && trip.status === "active")
    ? "en-route"
    : "available";
}

function filterTripsForWeek(trips, selectedWeek, driverId) {
  return trips.filter((trip) => {
    if (trip.status === "queued") return false;
    if (!isBusinessTrip(trip)) return false;
    const date = trip.endedAt || trip.startedAt;
    return weekKey(date) === selectedWeek && (!driverId || trip.driverId === driverId);
  });
}

function weeklyReport(db, selectedWeek, driverId) {
  const trips = filterTripsForWeek(db.trips, selectedWeek, driverId).map((trip) => publicTrip(db, trip));
  const totals = trips.reduce(
    (memo, trip) => {
      memo.trips += 1;
      memo.distanceKm += trip.distanceKm || 0;
      memo.billableAmount += trip.billableAmount || 0;
      return memo;
    },
    { trips: 0, distanceKm: 0, billableAmount: 0 }
  );
  totals.distanceKm = Number(totals.distanceKm.toFixed(2));
  totals.billableAmount = Number(totals.billableAmount.toFixed(2));
  return { weekKey: selectedWeek, driverId: driverId || "all", totals, trips };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportCsv(report) {
  const rows = [
    ["trip_id", "driver", "customer", "pickup", "destination", "intermediate_stops", "status", "category", "started_at", "ended_at", "business_distance_km", "rate_per_km", "billable_amount", "notes"],
    ...report.trips.map((trip) => [
      trip.id,
      trip.driver?.name || "",
      trip.customerName,
      trip.pickup,
      trip.destination,
      intermediateStopsText(trip),
      trip.status,
      trip.tripType,
      trip.startedAt,
      trip.endedAt || "",
      trip.businessDistanceKm || 0,
      trip.kmRate || 0,
      trip.billableAmount || 0,
      trip.notes || ""
    ])
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function listFromEnv(env, name, fallback) {
  const raw = env?.[name] || fallback;
  return String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function wixConfig(env = {}) {
  const apiKey = env.WIX_API_KEY || "";
  const accessToken = env.WIX_ACCESS_TOKEN || "";
  const siteId = env.WIX_SITE_ID || "";
  return {
    configured: Boolean(siteId && (apiKey || accessToken)),
    siteId,
    authorization: apiKey || (accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`),
    orderStatuses: listFromEnv(env, "WIX_ORDER_STATUSES", "APPROVED"),
    paymentStatuses: listFromEnv(env, "WIX_PAYMENT_STATUSES", "PAID"),
    fulfillmentStatuses: listFromEnv(env, "WIX_FULFILLMENT_STATUSES", "NOT_FULFILLED,PARTIALLY_FULFILLED,FULFILLED"),
    lookbackDays: Number(env.WIX_SYNC_LOOKBACK_DAYS || 14),
    limit: Math.min(100, Math.max(1, Number(env.WIX_SYNC_LIMIT || 100))),
    pickupLabel: env.WIX_PICKUP_LABEL || WIX_PICKUP_NAME
  };
}

function wixStatus(db, env) {
  const config = wixConfig(env);
  return {
    configured: config.configured,
    lastSyncAt: db.wix?.lastSyncAt || null,
    lastError: db.wix?.lastError || "",
    importedOrders: db.wix?.importedOrderIds?.length || 0,
    autoSyncMs: 0,
    filters: {
      orderStatuses: config.orderStatuses,
      paymentStatuses: config.paymentStatuses,
      fulfillmentStatuses: config.fulfillmentStatuses,
      lookbackDays: config.lookbackDays
    }
  };
}

function formatWixAddress(address = {}) {
  if (!address || typeof address !== "object") return "";
  if (address.formattedAddress) return address.formattedAddress;
  const street = address.streetAddress
    ? [address.streetAddress.number, address.streetAddress.name, address.streetAddress.apt].filter(Boolean).join(" ")
    : "";
  return [address.addressLine || street, address.city, address.subdivision, address.postalCode, address.country].filter(Boolean).join(", ");
}

function wixOrderContact(order = {}) {
  return (
    order.recipientInfo?.contactDetails ||
    order.shippingInfo?.logistics?.shippingDestination?.contactDetails ||
    order.billingInfo?.contactDetails ||
    {}
  );
}

function wixOrderAddress(order = {}) {
  return (
    order.shippingInfo?.logistics?.shippingDestination?.address ||
    order.recipientInfo?.address ||
    order.billingInfo?.address ||
    {}
  );
}

function wixOrderCustomerName(order = {}) {
  const contact = wixOrderContact(order);
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name || contact.company || order.buyerInfo?.email || `Wix order ${order.number || order.id || ""}`.trim();
}

function wixLineItemName(lineItem = {}) {
  if (typeof lineItem.productName === "string") return lineItem.productName;
  return lineItem.productName?.original || lineItem.productName?.translated || lineItem.name || lineItem.catalogReference?.catalogItemId || "Item";
}

function wixOrderNotes(order = {}) {
  const items = Array.isArray(order.lineItems)
    ? order.lineItems.slice(0, 8).map((item) => `${item.quantity || 1}x ${wixLineItemName(item)}`).join("; ")
    : "";
  const phone = wixOrderContact(order).phone || wixOrderContact(order).phoneNumber || "";
  return [`Wix order #${order.number || order.id}`, phone ? `Phone: ${phone}` : "", items ? `Items: ${items}` : ""].filter(Boolean).join("\n");
}

function wixOrderSource(order = {}) {
  return {
    system: "wix",
    orderId: order.id,
    orderNumber: order.number || "",
    createdDate: order.createdDate || "",
    paymentStatus: order.paymentStatus || "",
    fulfillmentStatus: order.fulfillmentStatus || "",
    orderStatus: order.status || ""
  };
}

function isWixFulfilledTrip(trip) {
  return trip?.source?.system === "wix" && String(trip.source.fulfillmentStatus || "").toUpperCase() === "FULFILLED";
}

function updateWixTripSource(trip, order) {
  const nextSource = wixOrderSource(order);
  const previousSource = trip.source || {};
  const changed = Object.entries(nextSource).some(([key, value]) => previousSource[key] !== value);
  trip.source = { ...previousSource, ...nextSource };
  return changed;
}

function updateQueuedWixTripPickup(trip, pickup) {
  if (trip.status !== "queued") return false;
  const pickupAddress = String(pickup || DEFAULT_PICKUP_ADDRESS).trim();
  if (!pickupAddress || trip.pickup === pickupAddress) return false;
  trip.pickup = pickupAddress;
  trip.stops = buildRouteStops(pickupAddress, trip.destination, intermediateStopsText(trip));
  syncTrackingStops(trip);
  return true;
}

function wixOrderToTrip(order, config, env) {
  const address = formatWixAddress(wixOrderAddress(order));
  const trip = {
    id: makeId("trip"),
    driverId: "",
    customerName: wixOrderCustomerName(order),
    customerPhone: String(wixOrderContact(order).phone || wixOrderContact(order).phoneNumber || "").trim(),
    pickup: config.pickupLabel,
    destination: address || "Delivery address missing",
    stops: buildRouteStops(config.pickupLabel, address || "Delivery address missing", []),
    kmRate: Number(env?.WIX_DEFAULT_KM_RATE || 0),
    tripType: "business",
    fulfillmentType: "my-driver",
    priority: "standard",
    deliveryWindowStart: null,
    deliveryWindowEnd: null,
    status: "queued",
    shareToken: makeToken(),
    startedAt: null,
    endedAt: null,
    submittedAt: null,
    reviewedAt: null,
    approvalNotes: "",
    notes: wixOrderNotes(order),
    path: [],
    location: null,
    distanceKm: 0,
    importedAt: nowIso(),
    source: wixOrderSource(order)
  };
  syncTrackingStops(trip);
  return trip;
}

async function wixSearchOrders(config) {
  if (!config.configured) {
    throw new Error("Wix sync needs WIX_API_KEY and WIX_SITE_ID configured in production environment variables.");
  }
  const since = new Date(Date.now() - config.lookbackDays * 86400000).toISOString();
  const response = await fetch("https://www.wixapis.com/ecom/v1/orders/search", {
    method: "POST",
    headers: {
      "Authorization": config.authorization,
      "Content-Type": "application/json",
      "wix-site-id": config.siteId
    },
    body: JSON.stringify({
      search: {
        filter: {
          status: { "$in": config.orderStatuses },
          paymentStatus: { "$in": config.paymentStatuses },
          fulfillmentStatus: { "$in": config.fulfillmentStatuses },
          createdDate: { "$gte": since }
        },
        sort: [{ fieldName: "createdDate", order: "DESC" }],
        cursorPaging: { limit: config.limit }
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.error?.message || response.statusText || "Wix order sync failed.";
    throw new Error(`Wix ${response.status}: ${message}`);
  }
  return Array.isArray(payload.orders) ? payload.orders : [];
}

async function syncWixOrders(db, env) {
  const config = wixConfig(env);
  const orders = await wixSearchOrders(config);
  const importedIds = new Set(db.wix.importedOrderIds || []);
  const tripsByWixOrderId = new Map();
  for (const trip of db.trips) {
    if (trip.source?.system === "wix" && trip.source.orderId) {
      importedIds.add(trip.source.orderId);
      tripsByWixOrderId.set(trip.source.orderId, trip);
    }
  }
  let imported = 0;
  let skipped = 0;
  let updated = 0;
  for (const order of orders) {
    if (!order.id) {
      skipped += 1;
      continue;
    }
    const existingTrip = tripsByWixOrderId.get(order.id);
    if (existingTrip) {
      const sourceChanged = updateWixTripSource(existingTrip, order);
      const pickupChanged = updateQueuedWixTripPickup(existingTrip, config.pickupLabel);
      if (sourceChanged || pickupChanged) updated += 1;
      else skipped += 1;
      importedIds.add(order.id);
      continue;
    }
    if (importedIds.has(order.id)) {
      skipped += 1;
      continue;
    }
    const trip = wixOrderToTrip(order, config, env);
    db.trips.push(trip);
    tripsByWixOrderId.set(order.id, trip);
    importedIds.add(order.id);
    imported += 1;
  }
  db.wix.importedOrderIds = Array.from(importedIds);
  db.wix.lastSyncAt = nowIso();
  db.wix.lastError = "";
  return { imported, updated, skipped, ordersFetched: orders.length, lastSyncAt: db.wix.lastSyncAt };
}

const CHANNEL_PROVIDERS = new Set(["shopify", "woocommerce", "wix", "webhook"]);

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64ToBytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function integrationCryptoKey(env) {
  const secret = String(env.INTEGRATION_ENCRYPTION_KEY || env.OWNER_SETUP_CODE || "").trim();
  if (secret.length < 8) throw new Error("Set INTEGRATION_ENCRYPTION_KEY before connecting a sales channel.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptIntegrationCredentials(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await integrationCryptoKey(env);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptIntegrationCredentials(env, value) {
  const [ivText, payloadText] = String(value || "").split(".");
  if (!ivText || !payloadText) throw new Error("This connection needs to be reconnected.");
  const key = await integrationCryptoKey(env);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(ivText) }, key, base64ToBytes(payloadText));
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function providerLabel(provider) {
  return ({ shopify: "Shopify", woocommerce: "WooCommerce", wix: "Wix", webhook: "Universal webhook" })[provider] || provider;
}

function safeHttpsOrigin(value, options = {}) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid HTTPS store URL.");
  }
  const hostname = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (url.protocol !== "https:" || privateIpv4 || hostname === "localhost" || hostname === "0.0.0.0" || hostname === "[::1]" || hostname.endsWith(".local")) {
    throw new Error("The store URL must be a public HTTPS address.");
  }
  if (options.shopify && !hostname.endsWith(".myshopify.com")) {
    throw new Error("Use the store’s .myshopify.com address.");
  }
  return url.origin;
}

function connectionImportedCount(db, connection) {
  return db.trips.filter((trip) => trip.source?.connectionId === connection.id).length;
}

function publicConnection(db, connection) {
  return {
    id: connection.id,
    provider: connection.provider,
    providerLabel: providerLabel(connection.provider),
    name: connection.name || providerLabel(connection.provider),
    storeUrl: connection.storeUrl || "",
    pickupLabel: connection.pickupLabel || DEFAULT_PICKUP_ADDRESS,
    configured: true,
    lastSyncAt: connection.lastSyncAt || null,
    lastError: connection.lastError || "",
    importedOrders: connectionImportedCount(db, connection),
    createdAt: connection.createdAt || null
  };
}

function integrationsStatus(db, env) {
  const connections = (db.integrations?.connections || []).map((connection) => publicConnection(db, connection));
  if (wixConfig(env).configured && !connections.some((connection) => connection.provider === "wix")) {
    connections.unshift({
      id: "legacy-wix",
      provider: "wix",
      providerLabel: "Wix",
      name: "Wix",
      storeUrl: "",
      pickupLabel: wixConfig(env).pickupLabel,
      configured: true,
      lastSyncAt: db.wix?.lastSyncAt || null,
      lastError: db.wix?.lastError || "",
      importedOrders: db.wix?.importedOrderIds?.length || 0,
      managedByEnvironment: true
    });
  }
  return { connections };
}

function normalizedAddress(address = {}) {
  if (typeof address === "string") return address.trim();
  return [address.address1 || address.address_1 || address.addressLine1, address.address2 || address.address_2 || address.addressLine2, address.city, address.province || address.state, address.zip || address.postcode || address.postalCode, address.country].filter(Boolean).join(", ");
}

function normalizedLineItems(items) {
  return Array.isArray(items)
    ? items.slice(0, 12).map((item) => `${item.quantity || 1}x ${item.name || item.title || item.productName || "Item"}`).join("; ")
    : "";
}

function normalizeShopifyOrder(order) {
  const address = order.shipping_address || order.billing_address || {};
  const customer = order.customer || {};
  return {
    id: String(order.id || order.admin_graphql_api_id || ""),
    number: order.name || order.order_number || order.id || "",
    customerName: [address.first_name || customer.first_name, address.last_name || customer.last_name].filter(Boolean).join(" ") || order.email || "Shopify customer",
    destination: normalizedAddress(address),
    phone: address.phone || order.phone || customer.phone || "",
    items: normalizedLineItems(order.line_items),
    createdAt: order.created_at || "",
    paymentStatus: order.financial_status || "",
    fulfillmentStatus: order.fulfillment_status || "unfulfilled",
    orderStatus: order.cancelled_at ? "cancelled" : "open"
  };
}

function normalizeWooOrder(order) {
  const address = Object.values(order.shipping || {}).some(Boolean) ? order.shipping : (order.billing || {});
  return {
    id: String(order.id || ""),
    number: order.number || order.id || "",
    customerName: [address.first_name, address.last_name].filter(Boolean).join(" ") || order.billing?.email || "WooCommerce customer",
    destination: normalizedAddress(address),
    phone: order.billing?.phone || "",
    items: normalizedLineItems(order.line_items),
    createdAt: order.date_created_gmt || order.date_created || "",
    paymentStatus: order.date_paid ? "paid" : order.status || "",
    fulfillmentStatus: order.status || "processing",
    orderStatus: order.status || ""
  };
}

function normalizeWebhookOrder(order) {
  const address = order.shippingAddress || order.shipping_address || order.shipping || order.deliveryAddress || order.delivery_address || order.address || {};
  const customer = order.customer || order.recipient || {};
  return {
    id: String(order.id || order.orderId || order.order_id || order.number || ""),
    number: order.number || order.orderNumber || order.order_number || order.id || "",
    customerName: order.customerName || order.customer_name || customer.name || [customer.firstName || customer.first_name, customer.lastName || customer.last_name].filter(Boolean).join(" ") || order.email || "Customer",
    destination: normalizedAddress(address),
    phone: order.phone || customer.phone || address.phone || "",
    items: typeof order.items === "string" ? order.items : normalizedLineItems(order.items || order.lineItems || order.line_items),
    createdAt: order.createdAt || order.created_at || nowIso(),
    paymentStatus: order.paymentStatus || order.payment_status || "",
    fulfillmentStatus: order.fulfillmentStatus || order.fulfillment_status || "",
    orderStatus: order.status || ""
  };
}

function channelOrderToTrip(order, connection, env) {
  const pickup = connection.pickupLabel || DEFAULT_PICKUP_ADDRESS;
  const destination = order.destination || "Delivery address missing";
  const provider = connection.provider;
  const notes = [`${providerLabel(provider)} order #${order.number || order.id}`, order.phone ? `Phone: ${order.phone}` : "", order.items ? `Items: ${order.items}` : ""].filter(Boolean).join("\n");
  const trip = {
    id: makeId("trip"), driverId: "", customerName: order.customerName || `${providerLabel(provider)} customer`, pickup, destination,
    customerPhone: String(order.phone || "").trim(),
    stops: buildRouteStops(pickup, destination, []), kmRate: Number(env?.WIX_DEFAULT_KM_RATE || 0), tripType: "business", status: "queued",
    fulfillmentType: "my-driver", priority: "standard", deliveryWindowStart: null, deliveryWindowEnd: null,
    shareToken: makeToken(), startedAt: null, endedAt: null, submittedAt: null, reviewedAt: null, approvalNotes: "", notes,
    path: [], location: null, distanceKm: 0, importedAt: nowIso(),
    source: { system: provider, connectionId: connection.id, orderId: order.id, orderNumber: String(order.number || ""), createdDate: order.createdAt || "", paymentStatus: order.paymentStatus || "", fulfillmentStatus: order.fulfillmentStatus || "", orderStatus: order.orderStatus || "" }
  };
  syncTrackingStops(trip);
  return trip;
}

function upsertChannelOrders(db, connection, orders, env) {
  const existing = new Map(db.trips.filter((trip) => trip.source?.connectionId === connection.id && trip.source?.orderId).map((trip) => [String(trip.source.orderId), trip]));
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const order of orders) {
    if (!order.id) { skipped += 1; continue; }
    const prior = existing.get(String(order.id));
    if (prior) {
      const nextSource = { ...prior.source, orderNumber: String(order.number || ""), createdDate: order.createdAt || "", paymentStatus: order.paymentStatus || "", fulfillmentStatus: order.fulfillmentStatus || "", orderStatus: order.orderStatus || "" };
      if (JSON.stringify(nextSource) !== JSON.stringify(prior.source)) { prior.source = nextSource; updated += 1; }
      else skipped += 1;
      continue;
    }
    const trip = channelOrderToTrip(order, connection, env);
    db.trips.push(trip);
    existing.set(String(order.id), trip);
    imported += 1;
  }
  return { imported, updated, skipped, ordersFetched: orders.length, lastSyncAt: nowIso() };
}

async function fetchConnectionOrders(connection, credentials) {
  if (connection.provider === "shopify") {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const params = new URLSearchParams({ status: "any", financial_status: "paid", limit: "100", created_at_min: since });
    const response = await fetch(`${connection.storeUrl}/admin/api/2026-07/orders.json?${params}`, { headers: { "X-Shopify-Access-Token": credentials.accessToken } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Shopify ${response.status}: ${payload.errors || response.statusText}`);
    return (payload.orders || []).filter((order) => !order.cancelled_at).map(normalizeShopifyOrder);
  }
  if (connection.provider === "woocommerce") {
    const params = new URLSearchParams({ status: "any", per_page: "100", after: new Date(Date.now() - 14 * 86400000).toISOString() });
    const authorization = `Basic ${btoa(`${credentials.consumerKey}:${credentials.consumerSecret}`)}`;
    const response = await fetch(`${connection.storeUrl}/wp-json/wc/v3/orders?${params}`, { headers: { Authorization: authorization } });
    const payload = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(`WooCommerce ${response.status}: ${payload.message || response.statusText}`);
    return (Array.isArray(payload) ? payload : []).filter((order) => ["processing", "on-hold", "completed"].includes(order.status)).map(normalizeWooOrder);
  }
  if (connection.provider === "wix") {
    const config = { configured: true, siteId: credentials.siteId, authorization: credentials.apiKey.startsWith("Bearer ") ? credentials.apiKey : credentials.apiKey, orderStatuses: ["APPROVED"], paymentStatuses: ["PAID"], fulfillmentStatuses: ["NOT_FULFILLED", "PARTIALLY_FULFILLED", "FULFILLED"], lookbackDays: 14, limit: 100, pickupLabel: connection.pickupLabel };
    return (await wixSearchOrders(config)).map((order) => ({ id: String(order.id || ""), number: order.number || order.id || "", customerName: wixOrderCustomerName(order), destination: formatWixAddress(wixOrderAddress(order)), phone: wixOrderContact(order).phone || wixOrderContact(order).phoneNumber || "", items: normalizedLineItems(order.lineItems), createdAt: order.createdDate || "", paymentStatus: order.paymentStatus || "", fulfillmentStatus: order.fulfillmentStatus || "", orderStatus: order.status || "" }));
  }
  throw new Error("Webhook connections receive orders automatically and do not need manual sync.");
}

async function syncConnection(db, env, connection) {
  const credentials = await decryptIntegrationCredentials(env, connection.credentials);
  const orders = await fetchConnectionOrders(connection, credentials);
  const sync = upsertChannelOrders(db, connection, orders, env);
  connection.lastSyncAt = sync.lastSyncAt;
  connection.lastError = "";
  return sync;
}

async function handleApi(request, env, url) {
  const db = await readDb(env);
  const method = request.method || "GET";
  const session = sessionFromRequest(request, db, url);

  if (method === "GET" && url.pathname === "/api/health") {
    return sendJson({ ok: true, service: "Rivo", time: nowIso() });
  }

  const proofMediaReadMatch = url.pathname.match(/^\/api\/proof-media\/([^/]+)$/);
  if (method === "GET" && proofMediaReadMatch) {
    if (!env.PROOF_MEDIA || typeof env.PROOF_MEDIA.get !== "function") return notFound();
    const item = proofMediaRecordByToken(db, decodeURIComponent(proofMediaReadMatch[1]));
    if (!item?.key) return notFound();
    const object = await env.PROOF_MEDIA.get(item.key);
    if (!object) return notFound();
    const headers = new Headers({
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${String(item.filename || "proof.png").replace(/["\\\r\n]/g, "_")}"`,
      "Content-Type": item.contentType || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });
    if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
    return new Response(object.body, { headers });
  }

  if (method === "OPTIONS" && url.pathname === "/api/leads") {
    const headers = leadCorsHeaders(request);
    if (!headers["Access-Control-Allow-Origin"]) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers });
  }

  const webhookMatch = url.pathname.match(/^\/api\/integrations\/webhook\/([^/]+)$/);
  if (method === "POST" && webhookMatch) {
    const connection = (db.integrations?.connections || []).find((item) => item.id === webhookMatch[1] && item.provider === "webhook");
    if (!connection) return notFound();
    const providedToken = String(url.searchParams.get("token") || request.headers.get("x-fleetjet-token") || "");
    if (!providedToken || !constantTimeEqual(await tokenHash(providedToken), connection.webhookTokenHash)) return unauthorized("Invalid webhook token.");
    const body = await readBody(request);
    const rawOrders = Array.isArray(body) ? body : Array.isArray(body.orders) ? body.orders : [body.order || body];
    const sync = upsertChannelOrders(db, connection, rawOrders.map(normalizeWebhookOrder), env);
    connection.lastSyncAt = sync.lastSyncAt;
    connection.lastError = "";
    await writeDb(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ ok: true, sync }, 202);
  }

  if (method === "GET" && url.pathname === "/api/setup/status") {
    return authJson({
      company: companyForEnv(db, env),
      setupEnabled: setupEnabled(env),
      ownerCreated: Boolean(db.ownerAccount?.username)
    });
  }

  if (method === "POST" && url.pathname === "/api/leads") {
    const body = await readBody(request);
    if (String(body.website || "").trim()) {
      return leadJson(request, { ok: true, message: "Request received." }, 202);
    }
    const companyName = String(body.companyName || "").trim();
    const contactName = String(body.contactName || "").trim();
    const email = normalizeEmail(body.email);
    const weeklyDeliveries = Math.max(0, Math.round(Number(body.weeklyDeliveries || 0)));
    const preferredReviewDate = cleanLeadField(body.preferredReviewDate, 10);
    const preferredReviewWindow = cleanLeadField(body.preferredReviewWindow, 80);
    const preferredContactMethod = cleanLeadField(body.preferredContactMethod, 20);
    if (companyName.length < 2) return leadJson(request, { error: "Company name is required." }, 400);
    if (companyName.length > 120) return leadJson(request, { error: "Company name is too long." }, 400);
    if (contactName.length < 2) return leadJson(request, { error: "Contact name is required." }, 400);
    if (contactName.length > 120) return leadJson(request, { error: "Contact name is too long." }, 400);
    if (!validEmail(email)) return leadJson(request, { error: "A valid work email is required." }, 400);
    if (String(body.phone || "").trim().length > 40) return leadJson(request, { error: "Phone number is too long." }, 400);
    if (String(body.notes || "").trim().length > 2000) return leadJson(request, { error: "Please shorten the operations note." }, 400);
    if (preferredReviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredReviewDate)) {
      return leadJson(request, { error: "Choose a valid preferred review date." }, 400);
    }
    if (preferredContactMethod && !LEAD_CONTACT_METHODS.has(preferredContactMethod)) {
      return leadJson(request, { error: "Choose email or phone as the preferred contact method." }, 400);
    }
    const recentDuplicate = db.leads.find((item) => item.email === email && Date.now() - new Date(item.createdAt || 0).getTime() < 15 * 60 * 1000);
    if (recentDuplicate) {
      return leadJson(request, {
        ok: true,
        lead: publicLead(recentDuplicate),
        message: "Thanks. Your Rivo operational review request is already in the queue."
      }, 202);
    }
    const lead = {
      id: makeId("lead"),
      companyName,
      contactName,
      email,
      phone: String(body.phone || "").trim(),
      weeklyDeliveries,
      deliveryCategory: String(body.deliveryCategory || "").trim(),
      primaryChannel: String(body.primaryChannel || "").trim(),
      notes: String(body.notes || "").trim(),
      preferredReviewDate,
      preferredReviewWindow,
      preferredContactMethod,
      attribution: leadAttribution(body.attribution),
      stage: "new",
      score: 0,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    lead.score = leadScore(lead);
    db.leads.unshift(lead);
    db.leads = db.leads.slice(0, 250);
    await writeDb(db, env);
    broadcastSnapshot(db, env);
    return leadJson(request, {
      ok: true,
      lead: publicLead(lead),
      message: "Thanks. Your Rivo operational review request is in the queue."
    }, 201);
  }

  if (method === "POST" && url.pathname === "/api/auth/setup") {
    const configuredCode = setupCode(env);
    if (!configuredCode) return unauthorized("Owner account setup is not enabled.");
    if (db.ownerAccount?.username) return badRequest("Owner account already exists. Please sign in.");
    const body = await readBody(request);
    if (String(body.setupCode || "").trim() !== configuredCode) {
      return unauthorized("Setup code is incorrect.");
    }
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || username || "Owner").trim();
    const companyName = String(body.companyName || DEFAULT_COMPANY_NAME).trim();
    if (username.length < 3) return badRequest("Username must be at least 3 characters.");
    if (password.length < 8) return badRequest("Password must be at least 8 characters.");
    db.company = {
      ...db.company,
      name: companyName || DEFAULT_COMPANY_NAME
    };
    const ownerAccount = {
      username,
      name,
      createdAt: db.ownerAccount?.createdAt || nowIso(),
      updatedAt: nowIso()
    };
    await setPassword(ownerAccount, password);
    db.ownerAccount = ownerAccount;
    const nextSession = createSession(db, { role: "dispatcher", name });
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return authJson({
      session: publicSession(nextSession),
      snapshot: nextSnapshot
    }, 201);
  }

  if (method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(request);
    const attemptKey = loginAttemptKey(request, body.identifier);
    const retryAfter = loginRetryAfterSeconds(attemptKey);
    if (retryAfter) {
      return authJson(
        { error: "Too many sign-in attempts. Wait a few minutes and try again." },
        429,
        { "Retry-After": String(retryAfter) }
      );
    }
    const user = await loginUser(db, env, body.identifier, body.password);
    if (!user) {
      recordLoginFailure(attemptKey);
      return authJson({ error: "Email or password is incorrect. Drivers must use their invitation link once before signing in." }, 401);
    }
    loginAttempts.delete(attemptKey);
    const nextSession = createSession(db, user);
    const driver = user.driverId ? driverById(db, user.driverId) : null;
    if (driver) {
      driver.lastSeenAt = nowIso();
      driver.status = calcDriverStatus(db, driver.id);
    }
    await writeDb(db, env);
    const nextSnapshot = user.role === "driver"
      ? driverSnapshot(db, env, user.driverId)
      : snapshot(db, env);
    broadcastSnapshot(db, env);
    return authJson({
      session: publicSession(nextSession),
      snapshot: nextSnapshot
    });
  }

  if (method === "GET" && url.pathname === "/api/auth/invite") {
    const token = String(url.searchParams.get("token") || "");
    if (!token) return authJson({ error: "Invitation token is missing." }, 400);
    const hash = await tokenHash(token);
    const driver = db.drivers.find((item) => !item.archivedAt && item.inviteTokenHash === hash);
    if (!driver || new Date(driver.inviteExpiresAt || 0).getTime() <= Date.now()) {
      return authJson({ error: "This invitation is invalid or has expired." }, 401);
    }
    return authJson({ name: driver.name, email: driver.email, expiresAt: driver.inviteExpiresAt });
  }

  if (method === "POST" && url.pathname === "/api/auth/invite/accept") {
    const body = await readBody(request);
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (password.length < 8) return authJson({ error: "Password must be at least 8 characters." }, 400);
    const hash = await tokenHash(token);
    const driver = db.drivers.find((item) => !item.archivedAt && item.inviteTokenHash === hash);
    if (!driver || new Date(driver.inviteExpiresAt || 0).getTime() <= Date.now()) {
      return authJson({ error: "This invitation is invalid or has expired." }, 401);
    }
    await setPassword(driver, password);
    driver.inviteAcceptedAt = nowIso();
    delete driver.inviteTokenHash;
    delete driver.inviteExpiresAt;
    driver.inviteEmailStatus = "accepted";
    driver.inviteEmailError = "";
    db.sessions = (db.sessions || []).filter((item) => item.driverId !== driver.id);
    const nextSession = createSession(db, { role: "driver", name: driver.name, driverId: driver.id });
    driver.lastSeenAt = nowIso();
    driver.status = calcDriverStatus(db, driver.id);
    await writeDb(db, env);
    return authJson({
      session: publicSession(nextSession),
      snapshot: driverSnapshot(db, env, driver.id)
    });
  }

  if (method === "POST" && url.pathname === "/api/auth/logout") {
    if (!session) return authJson({ ok: true });
    db.sessions = (db.sessions || []).filter((item) => item.token !== session.token);
    await writeDb(db, env);
    return authJson({ ok: true });
  }

  if (method === "GET" && url.pathname === "/api/me") {
    if (!session) return unauthorized();
    const nextSnapshot = session.role === "driver"
      ? driverSnapshot(db, env, session.driverId)
      : snapshot(db, env);
    return authJson({ session: publicSession(session), snapshot: nextSnapshot });
  }

  if (method === "GET" && url.pathname === "/api/maps/config") {
    return sendJson(mapsConfig(env));
  }

  if (method === "GET" && url.pathname === "/api/bootstrap") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    return sendJson(snapshot(db, env));
  }

  if (method === "PATCH" && url.pathname === "/api/company") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    const pickupAddress = String(body.pickupAddress || "").trim();
    const timeZone = String(body.timeZone || "").trim();
    const currency = String(body.currency || "").trim().toUpperCase();
    const supportEmail = normalizeEmail(body.supportEmail);
    const primaryColor = String(body.brandPrimaryColor || db.company.branding?.primaryColor || "#176b52").trim();
    const logoUrl = String(body.logoUrl || "").trim();
    const trackingHeadline = String(body.trackingHeadline || "Your delivery is on the way").trim();
    const defaultWindowMinutes = Number(body.defaultWindowMinutes || 120);
    if (name.length < 2) return badRequest("Company name is required.");
    if (pickupAddress.length < 5) return badRequest("Enter a valid pickup or depot address.");
    if (!timeZone.includes("/")) return badRequest("Choose a valid time zone.");
    if (!["CAD", "USD"].includes(currency)) return badRequest("Choose CAD or USD.");
    if (!validEmail(supportEmail)) return badRequest("Enter a valid support email.");
    if (!/^#[0-9a-f]{6}$/i.test(primaryColor)) return badRequest("Choose a valid six-digit brand colour.");
    if (logoUrl && !normalizedPublicHttpsUrl(logoUrl)) return badRequest("Logo URL must use a public HTTPS address.");
    if (trackingHeadline.length < 4 || trackingHeadline.length > 90) return badRequest("Tracking-page wording must be between 4 and 90 characters.");
    if (!Number.isFinite(defaultWindowMinutes) || defaultWindowMinutes < 15 || defaultWindowMinutes > 1440) return badRequest("Default delivery window must be between 15 and 1,440 minutes.");
    db.company = {
      ...db.company,
      name,
      pickupAddress,
      timeZone,
      currency,
      supportEmail,
      branding: {
        ...db.company.branding,
        primaryColor,
        logoUrl,
        trackingHeadline,
        showDriverFirstName: body.showDriverFirstName === true || body.showDriverFirstName === "on"
      },
      operations: {
        ...db.company.operations,
        businessHours: String(body.businessHours || "").trim(),
        deliveryZones: String(body.deliveryZones || "").trim(),
        defaultWindowMinutes,
        requirePhoto: body.requirePhoto === true || body.requirePhoto === "on",
        requireSignature: body.requireSignature === true || body.requireSignature === "on"
      },
      notifications: {
        customerTracking: body.customerTracking === true || body.customerTracking === "on",
        etaUpdates: body.etaUpdates === true || body.etaUpdates === "on",
        deliveredConfirmation: body.deliveredConfirmation === true || body.deliveredConfirmation === "on"
      },
      updatedAt: nowIso()
    };
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ company: nextSnapshot.company, snapshot: nextSnapshot });
  }

  const leadPatchMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
  if (method === "PATCH" && leadPatchMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const lead = db.leads.find((item) => item.id === leadPatchMatch[1]);
    if (!lead) return notFound();
    const body = await readBody(request);
    if (body.stage !== undefined) {
      const nextStage = String(body.stage || "").trim().toLowerCase();
      if (!LEAD_STAGES.has(nextStage)) return badRequest("Choose a valid lead stage.");
      lead.stage = nextStage;
    }
    if (body.notes !== undefined) lead.notes = String(body.notes || "").trim();
    lead.score = leadScore(lead);
    lead.updatedAt = nowIso();
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ lead: publicLead(lead), snapshot: nextSnapshot });
  }

  if (method === "GET" && url.pathname === "/api/integrations/wix/status") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    return sendJson(wixStatus(db, env));
  }

  if (method === "POST" && url.pathname === "/api/integrations/wix/sync") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    try {
      const sync = await syncWixOrders(db, env);
      await writeDb(db, env);
      const nextSnapshot = snapshot(db, env);
      broadcastSnapshot(db, env);
      return sendJson({ sync, snapshot: nextSnapshot });
    } catch (error) {
      db.wix.lastError = error.message || "Wix sync failed.";
      await writeDb(db, env);
      return sendJson({ error: db.wix.lastError, wix: wixStatus(db, env) }, 400);
    }
  }

  if (method === "GET" && url.pathname === "/api/integrations") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    return sendJson(integrationsStatus(db, env));
  }

  if (method === "POST" && url.pathname === "/api/integrations/connect") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const provider = String(body.provider || "").trim().toLowerCase();
    if (!CHANNEL_PROVIDERS.has(provider)) return badRequest("Choose Shopify, WooCommerce, Wix, or Universal webhook.");
    const connection = {
      id: makeId("chn"),
      provider,
      name: String(body.name || providerLabel(provider)).trim(),
      pickupLabel: String(body.pickupLabel || workspacePickupAddress(db)).trim(),
      storeUrl: "",
      credentials: "",
      createdAt: nowIso(),
      lastSyncAt: null,
      lastError: ""
    };
    let credentials = {};
    let webhookToken = "";
    if (provider === "shopify") {
      connection.storeUrl = safeHttpsOrigin(body.storeUrl, { shopify: true });
      credentials.accessToken = String(body.accessToken || "").trim();
      if (credentials.accessToken.length < 10) return badRequest("Enter the Shopify Admin API access token.");
    } else if (provider === "woocommerce") {
      connection.storeUrl = safeHttpsOrigin(body.storeUrl);
      credentials.consumerKey = String(body.consumerKey || "").trim();
      credentials.consumerSecret = String(body.consumerSecret || "").trim();
      if (!credentials.consumerKey.startsWith("ck_") || !credentials.consumerSecret.startsWith("cs_")) return badRequest("Enter the WooCommerce consumer key and secret.");
    } else if (provider === "wix") {
      credentials.siteId = String(body.siteId || "").trim();
      credentials.apiKey = String(body.apiKey || "").trim();
      if (!credentials.siteId || credentials.apiKey.length < 10) return badRequest("Enter the Wix site ID and API key.");
    } else {
      webhookToken = makeToken(32);
      connection.webhookTokenHash = await tokenHash(webhookToken);
    }
    connection.credentials = await encryptIntegrationCredentials(env, credentials);
    db.integrations.connections.push(connection);
    await writeDb(db, env);
    let sync = null;
    if (provider !== "webhook") {
      try {
        sync = await syncConnection(db, env, connection);
        await writeDb(db, env);
      } catch (error) {
        connection.lastError = error.message || "Connection test failed.";
        await writeDb(db, env);
        return sendJson({ error: connection.lastError, connection: publicConnection(db, connection), snapshot: snapshot(db, env) }, 400);
      }
    }
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({
      connection: publicConnection(db, connection),
      webhookUrl: webhookToken ? `${url.origin}/api/integrations/webhook/${connection.id}?token=${encodeURIComponent(webhookToken)}` : "",
      sync,
      snapshot: nextSnapshot
    }, 201);
  }

  if (method === "POST" && url.pathname === "/api/integrations/sync") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const results = [];
    if (wixConfig(env).configured && !(db.integrations?.connections || []).some((item) => item.provider === "wix")) {
      try { results.push({ id: "legacy-wix", provider: "wix", ...(await syncWixOrders(db, env)) }); }
      catch (error) { db.wix.lastError = error.message || "Wix sync failed."; results.push({ id: "legacy-wix", provider: "wix", error: db.wix.lastError }); }
    }
    for (const connection of db.integrations.connections) {
      if (connection.provider === "webhook") continue;
      try { results.push({ id: connection.id, provider: connection.provider, ...(await syncConnection(db, env, connection)) }); }
      catch (error) { connection.lastError = error.message || `${providerLabel(connection.provider)} sync failed.`; results.push({ id: connection.id, provider: connection.provider, error: connection.lastError }); }
    }
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ results, snapshot: nextSnapshot });
  }

  const connectionSyncMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)\/sync$/);
  if (method === "POST" && connectionSyncMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    if (connectionSyncMatch[1] === "legacy-wix") {
      const sync = await syncWixOrders(db, env);
      await writeDb(db, env);
      const nextSnapshot = snapshot(db, env);
      broadcastSnapshot(db, env);
      return sendJson({ sync, snapshot: nextSnapshot });
    }
    const connection = db.integrations.connections.find((item) => item.id === connectionSyncMatch[1]);
    if (!connection) return notFound();
    try {
      const sync = await syncConnection(db, env, connection);
      await writeDb(db, env);
      const nextSnapshot = snapshot(db, env);
      broadcastSnapshot(db, env);
      return sendJson({ sync, snapshot: nextSnapshot });
    } catch (error) {
      connection.lastError = error.message || "Sync failed.";
      await writeDb(db, env);
      return sendJson({ error: connection.lastError, connection: publicConnection(db, connection) }, 400);
    }
  }

  const connectionDeleteMatch = url.pathname.match(/^\/api\/integrations\/([^/]+)$/);
  if (method === "DELETE" && connectionDeleteMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    if (connectionDeleteMatch[1] === "legacy-wix") return badRequest("This Wix connection is managed through hosted environment settings.");
    const before = db.integrations.connections.length;
    db.integrations.connections = db.integrations.connections.filter((item) => item.id !== connectionDeleteMatch[1]);
    if (db.integrations.connections.length === before) return notFound();
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ ok: true, snapshot: nextSnapshot });
  }

  if (method === "POST" && url.pathname === "/api/couriers") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    let fields;
    try {
      fields = courierPartnerInput(body);
    } catch (error) {
      return badRequest(error.message);
    }
    const partner = {
      id: makeId("courier"),
      ...fields,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.courierPartners.push(partner);
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ courierPartner: publicCourierPartner(partner), snapshot: nextSnapshot }, 201);
  }

  const courierPartnerMatch = url.pathname.match(/^\/api\/couriers\/([^/]+)$/);
  if (method === "PATCH" && courierPartnerMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const partner = courierPartnerById(db, courierPartnerMatch[1]);
    if (!partner) return notFound();
    const body = await readBody(request);
    let fields;
    try {
      fields = courierPartnerInput(body, partner);
    } catch (error) {
      return badRequest(error.message);
    }
    Object.assign(partner, fields, { updatedAt: nowIso() });
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ courierPartner: publicCourierPartner(partner), snapshot: nextSnapshot });
  }

  if (method === "DELETE" && courierPartnerMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const partner = courierPartnerById(db, courierPartnerMatch[1]);
    if (!partner) return notFound();
    const hasOpenRequests = db.courierRequests.some((courierRequest) => {
      return courierRequest.courierPartnerId === partner.id && OPEN_COURIER_REQUEST_STATUSES.has(courierRequest.status);
    });
    if (hasOpenRequests) return badRequest("Finish or cancel this courier’s open requests before archiving the partner.");
    partner.active = false;
    partner.archivedAt = nowIso();
    partner.updatedAt = partner.archivedAt;
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ archived: true, snapshot: nextSnapshot });
  }

  if (method === "POST" && url.pathname === "/api/courier-requests") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const tripIds = Array.isArray(body.tripIds) ? [...new Set(body.tripIds.map(String))] : [];
    if (!tripIds.length) return badRequest("Select at least one order for the courier request.");
    if (tripIds.length > 100) return badRequest("Request no more than 100 deliveries at once.");
    const partner = courierPartnerById(db, String(body.courierPartnerId || ""));
    if (!partner || partner.active === false) return badRequest("Choose an active courier partner.");
    const sourceTrips = tripIds.map((tripId) => db.trips.find((trip) => trip.id === tripId));
    if (sourceTrips.some((trip) => !trip || !["queued", "completed", "exception"].includes(trip.status))) {
      return badRequest("Every selected order must be queued, needs review, or needs attention.");
    }
    if (sourceTrips.some((trip) => openCourierRequestForTrip(db, trip.id))) {
      return badRequest("One or more selected orders already has an open courier request. Cancel it before requesting another provider.");
    }
    const pickupKeys = new Set(sourceTrips.map((trip) => String(trip.pickup || "").trim().toLowerCase()));
    if (pickupKeys.size !== 1 || pickupKeys.has("")) {
      return badRequest("A courier request must use one common pickup address. Split orders with different pickups into separate requests.");
    }
    let requestedPickupAt = null;
    if (body.requestedPickupAt) {
      const parsedPickupTime = new Date(body.requestedPickupAt);
      if (Number.isNaN(parsedPickupTime.getTime())) return badRequest("Enter a valid requested pickup time.");
      requestedPickupAt = parsedPickupTime.toISOString();
    }
    let quotedFee = null;
    if (body.quotedFee !== undefined && String(body.quotedFee).trim() !== "") {
      quotedFee = Number(body.quotedFee);
      if (!Number.isFinite(quotedFee) || quotedFee < 0) return badRequest("Enter a valid courier fee.");
    }
    const trips = sourceTrips.map((trip) => createRedispatchAttempt(db, trip));
    const recordedAt = nowIso();
    const courierRequest = {
      id: makeId("courier_request"),
      courierPartnerId: partner.id,
      tripIds: trips.map((trip) => trip.id),
      pickup: trips[0].pickup,
      deliveries: trips.map((trip) => ({ tripId: trip.id, customerName: trip.customerName, destination: trip.destination })),
      requestedPickupAt,
      serviceLevel: String(body.serviceLevel || "Same-day").trim().slice(0, 120),
      quotedFee,
      currency: db.company?.currency || "CAD",
      referenceNumber: "",
      trackingUrl: "",
      notes: String(body.notes || "").trim().slice(0, 1600),
      status: "ready-to-share",
      sentAt: null,
      deliveryError: "",
      providerMessageId: "",
      statusHistory: [{ status: "ready-to-share", at: recordedAt, by: session.name || "Dispatcher" }],
      createdAt: recordedAt,
      updatedAt: recordedAt
    };
    const affectedDriverIds = new Set();
    for (const trip of trips) {
      if (trip.driverId) affectedDriverIds.add(trip.driverId);
      trip.driverId = "";
      trip.fulfillmentType = "courier";
      trip.courierPartnerId = partner.id;
      trip.courierRequestId = courierRequest.id;
    }
    for (const driverId of affectedDriverIds) {
      const driver = db.drivers.find((item) => item.id === driverId);
      if (driver) driver.status = calcDriverStatus(db, driver.id);
    }
    db.courierRequests.push(courierRequest);
    await writeDb(db, env);

    let deliveryResult = { sent: false, configured: false, reason: "Request saved for manual sharing." };
    if (partner.requestMethod === "email") {
      try {
        deliveryResult = await sendCourierRequestEmail(env, db, courierRequest, partner);
        if (deliveryResult.sent) {
          courierRequest.status = "requested";
          courierRequest.sentAt = nowIso();
          courierRequest.providerMessageId = deliveryResult.providerMessageId || "";
          courierRequest.statusHistory.push({ status: "requested", at: courierRequest.sentAt, by: "Automatic email" });
        } else if (deliveryResult.configured) {
          courierRequest.status = "send-failed";
          courierRequest.deliveryError = deliveryResult.reason || "Courier request email was not sent.";
        }
      } catch (error) {
        deliveryResult = { sent: false, configured: true, reason: error.message };
        courierRequest.status = "send-failed";
        courierRequest.deliveryError = error.message || "Courier request email was not sent.";
      }
      courierRequest.updatedAt = nowIso();
      if (deliveryResult.sent || deliveryResult.configured) {
        try {
          await writeDb(db, env);
        } catch (error) {
          console.warn("Courier delivery metadata could not be saved", error);
        }
      }
    }
    const persistedDb = await readDb(env);
    const persistedRequest = persistedDb.courierRequests.find((item) => item.id === courierRequest.id) || courierRequest;
    const nextSnapshot = snapshot(persistedDb, env);
    broadcastSnapshot(persistedDb, env);
    return sendJson({
      courierRequest: publicCourierRequest(persistedDb, persistedRequest),
      deliverySent: Boolean(deliveryResult.sent),
      deliveryMessage: deliveryResult.sent ? "Courier request emailed." : deliveryResult.reason,
      snapshot: nextSnapshot
    }, 201);
  }

  const courierRequestMatch = url.pathname.match(/^\/api\/courier-requests\/([^/]+)$/);
  if (method === "PATCH" && courierRequestMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const courierRequest = db.courierRequests.find((item) => item.id === courierRequestMatch[1]);
    if (!courierRequest) return notFound();
    const partner = db.courierPartners.find((item) => item.id === courierRequest.courierPartnerId) || null;
    const body = await readBody(request);
    const nextStatus = body.status === undefined ? courierRequest.status : String(body.status).trim();
    if (!courierStatusCanChange(courierRequest.status, nextStatus)) {
      return badRequest("That courier request status change is not allowed. Create a new request if the closed request needs to be reopened.");
    }
    let quotedFee = courierRequest.quotedFee ?? null;
    if (body.quotedFee !== undefined) {
      quotedFee = String(body.quotedFee).trim() === "" ? null : Number(body.quotedFee);
      if (quotedFee !== null && (!Number.isFinite(quotedFee) || quotedFee < 0)) return badRequest("Enter a valid courier fee.");
    }
    const rawTrackingUrl = body.trackingUrl === undefined ? courierRequest.trackingUrl || "" : String(body.trackingUrl || "").trim();
    const trackingUrl = rawTrackingUrl ? normalizedPublicHttpsUrl(rawTrackingUrl) : "";
    if (rawTrackingUrl && !trackingUrl) return badRequest("Courier tracking links must be public HTTPS URLs.");
    courierRequest.quotedFee = quotedFee;
    courierRequest.referenceNumber = String(body.referenceNumber ?? courierRequest.referenceNumber ?? "").trim().slice(0, 160);
    courierRequest.trackingUrl = trackingUrl;
    courierRequest.notes = String(body.notes ?? courierRequest.notes ?? "").trim().slice(0, 1600);
    const recordedAt = nowIso();
    if (nextStatus !== courierRequest.status) {
      courierRequest.status = nextStatus;
      courierRequest.statusHistory = Array.isArray(courierRequest.statusHistory) ? courierRequest.statusHistory : [];
      courierRequest.statusHistory.push({ status: nextStatus, at: recordedAt, by: session.name || "Dispatcher" });
      if (nextStatus === "requested" && !courierRequest.sentAt) courierRequest.sentAt = recordedAt;
      if (nextStatus === "delivered") completeCourierRequestTrips(db, courierRequest, partner, session, recordedAt);
      if (["declined", "cancelled"].includes(nextStatus)) releaseCourierRequestTrips(db, courierRequest);
    }
    courierRequest.updatedAt = recordedAt;
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    for (const tripId of courierRequest.tripIds || []) {
      const trip = db.trips.find((item) => item.id === tripId);
      if (!trip) continue;
      broadcast("trip-update", publicTrip(db, trip), { tripId });
      broadcastCustomerTripUpdates(db, trip);
    }
    broadcastSnapshot(db, env);
    return sendJson({ courierRequest: publicCourierRequest(db, courierRequest), snapshot: nextSnapshot });
  }

  if (method === "POST" && url.pathname === "/api/drivers") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    if (!body.name || !body.vehicle) return badRequest("Driver name and vehicle are required.");
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return badRequest("A valid driver email is required.");
    if (db.drivers.some((item) => normalizeEmail(item.email) === email)) {
      return badRequest("A driver with this email already exists.");
    }
    const capacity = Number(body.capacity || 20);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return badRequest("Driver capacity must be between 1 and 100 stops.");
    const driver = {
      id: makeId("drv"),
      name: String(body.name).trim(),
      phone: String(body.phone || "").trim(),
      email,
      homeAddress: String(body.homeAddress || "").trim(),
      vehicle: String(body.vehicle).trim(),
      shift: String(body.shift || "").trim(),
      loginId: email,
      defaultRate: Number(body.defaultRate || 1),
      capacity,
      driverType: "my-driver",
      color: body.color || "#2563eb",
      status: "offline",
      lastSeenAt: null
    };
    db.drivers.push(driver);
    const invitation = await persistAndDeliverDriverInvitation(db, env, driver, url.origin);
    const nextSnapshot = snapshot(invitation.db, env);
    broadcastSnapshot(invitation.db, env);
    return sendJson({
      driver: publicDriver(invitation.driver, { includeLogin: true }),
      snapshot: nextSnapshot,
      inviteUrl: invitation.inviteUrl,
      emailSent: invitation.emailResult.sent,
      emailMessage: invitation.emailResult.sent ? "Invitation email sent." : invitation.emailResult.reason
    }, 201);
  }

  const driverInvite = url.pathname.match(/^\/api\/drivers\/([^/]+)\/invite$/);
  if (method === "POST" && driverInvite) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const driver = db.drivers.find((item) => item.id === driverInvite[1] && !item.archivedAt);
    if (!driver) return notFound();
    if (!validEmail(driver.email)) return badRequest("This driver needs a valid email address before an invitation can be created.");
    const invitation = await persistAndDeliverDriverInvitation(db, env, driver, url.origin);
    const nextSnapshot = snapshot(invitation.db, env);
    broadcastSnapshot(invitation.db, env);
    return sendJson({
      driver: publicDriver(invitation.driver, { includeLogin: true }),
      snapshot: nextSnapshot,
      inviteUrl: invitation.inviteUrl,
      emailSent: invitation.emailResult.sent,
      emailMessage: invitation.emailResult.sent ? "Invitation email sent." : invitation.emailResult.reason
    });
  }

  const driverPatch = url.pathname.match(/^\/api\/drivers\/([^/]+)$/);
  if (method === "PATCH" && driverPatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const driver = db.drivers.find((item) => item.id === driverPatch[1] && !item.archivedAt);
    if (!driver) return notFound();
    for (const key of ["name", "phone", "vehicle", "shift", "color", "homeAddress"]) {
      if (body[key] !== undefined) driver[key] = String(body[key]).trim();
    }
    let identityChanged = false;
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return badRequest("Enter a valid driver email address.");
      if (db.drivers.some((item) => item.id !== driver.id && normalizeEmail(item.email) === email)) {
        return badRequest("Another driver already uses this email address.");
      }
      identityChanged = normalizeEmail(driver.email) !== email;
      driver.email = email;
      driver.loginId = email;
    }
    if (body.loginId !== undefined) {
      const loginId = String(body.loginId).trim().toLowerCase();
      if (loginId.length < 3) return badRequest("Driver username must be at least 3 characters.");
      driver.loginId = loginId;
    }
    if (body.password !== undefined && String(body.password)) {
      const password = String(body.password);
      if (password.length < 8) return badRequest("Driver password must be at least 8 characters.");
      await setPassword(driver, password);
    }
    if (body.defaultRate !== undefined) driver.defaultRate = Number(body.defaultRate);
    if (body.capacity !== undefined) {
      const capacity = Number(body.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) return badRequest("Driver capacity must be between 1 and 100 stops.");
      driver.capacity = capacity;
    }
    let invitation = null;
    if (identityChanged) {
      db.sessions = (db.sessions || []).filter((item) => item.driverId !== driver.id);
      delete driver.passwordHash;
      delete driver.passwordSalt;
      delete driver.password;
      delete driver.inviteAcceptedAt;
      driver.status = "offline";
      driver.lastSeenAt = null;
      invitation = await persistAndDeliverDriverInvitation(db, env, driver, url.origin);
    } else {
      await writeDb(db, env);
    }
    const responseDb = invitation?.db || db;
    const responseDriver = invitation?.driver || driver;
    const nextSnapshot = snapshot(responseDb, env);
    broadcastSnapshot(responseDb, env);
    return sendJson({
      driver: publicDriver(responseDriver, { includeLogin: true }),
      snapshot: nextSnapshot,
      identityChanged,
      inviteUrl: invitation?.inviteUrl || "",
      emailSent: Boolean(invitation?.emailResult.sent),
      emailMessage: invitation ? (invitation.emailResult.sent ? "Invitation email sent." : invitation.emailResult.reason) : ""
    });
  }

  if (method === "DELETE" && driverPatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const driverId = driverPatch[1];
    const driver = db.drivers.find((item) => item.id === driverId);
    if (!driver) return notFound();
    const activeTrips = db.trips.filter((trip) => trip.driverId === driverId && trip.status === "active");
    if (activeTrips.length) return badRequest("Finish or reassign this driver’s active deliveries before archiving the profile.");
    driver.archivedAt = nowIso();
    driver.status = "offline";
    delete driver.inviteTokenHash;
    delete driver.inviteExpiresAt;
    driver.inviteEmailStatus = "revoked";
    db.sessions = (db.sessions || []).filter((item) => item.driverId !== driverId);
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({
      driver: publicDriver(driver, { includeLogin: true }),
      archived: true,
      deletedTrips: 0,
      snapshot: nextSnapshot
    });
  }

  if (method === "POST" && url.pathname === "/api/deliveries") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const customerName = String(body.customerName || "").trim();
    const pickup = String(body.pickup || workspacePickupAddress(db)).trim();
    const destination = String(body.destination || "").trim();
    const priority = ["standard", "priority", "urgent"].includes(String(body.priority || "").toLowerCase())
      ? String(body.priority).toLowerCase()
      : "standard";
    if (!customerName) return badRequest("Customer name is required.");
    if (pickup.length < 3 || destination.length < 3) return badRequest("Pickup and destination are required.");
    const deliveryWindowStart = optionalIso(body.deliveryWindowStart);
    const deliveryWindowEnd = optionalIso(body.deliveryWindowEnd);
    if (deliveryWindowStart === undefined || deliveryWindowEnd === undefined) return badRequest("Enter a valid delivery window.");
    if (deliveryWindowStart && deliveryWindowEnd && new Date(deliveryWindowEnd) <= new Date(deliveryWindowStart)) {
      return badRequest("Delivery window end must be after the start.");
    }
    const trip = {
      id: makeId("trip"),
      driverId: "",
      customerName,
      customerPhone: String(body.customerPhone || "").trim(),
      pickup,
      destination,
      stops: buildRouteStops(pickup, destination, body.stops || body.stopsText),
      kmRate: 0,
      tripType: "business",
      fulfillmentType: "my-driver",
      priority,
      deliveryWindowStart,
      deliveryWindowEnd,
      status: "queued",
      deliveryOutcomeStatus: "queued",
      shareToken: makeToken(),
      importedAt: nowIso(),
      startedAt: null,
      endedAt: null,
      submittedAt: null,
      reviewedAt: null,
      approvalNotes: "",
      notes: String(body.notes || "").trim(),
      path: [],
      location: null,
      distanceKm: 0,
      source: { system: "manual", orderId: makeId("manual"), orderNumber: "Manual", createdDate: nowIso() }
    };
    syncTrackingStops(trip);
    db.trips.push(trip);
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ delivery: publicTrip(db, trip), snapshot: nextSnapshot }, 201);
  }

  if (method === "POST" && url.pathname === "/api/trips") {
    if (!session) return unauthorized();
    const body = await readBody(request);
    const driver = session.role === "driver"
      ? driverById(db, session.driverId)
      : db.drivers.find((item) => item.id === body.driverId && !item.archivedAt);
    if (!driver) return badRequest("A valid driver is required.");
    const pickup = String(body.pickup || workspacePickupAddress(db)).trim();
    const destination = String(body.destination || "Destination").trim();
    const deliveryWindowStart = optionalIso(body.deliveryWindowStart);
    const deliveryWindowEnd = optionalIso(body.deliveryWindowEnd);
    if (deliveryWindowStart === undefined || deliveryWindowEnd === undefined) return badRequest("Enter a valid delivery window.");
    if (deliveryWindowStart && deliveryWindowEnd && new Date(deliveryWindowEnd) <= new Date(deliveryWindowStart)) {
      return badRequest("Delivery window end must be after the start.");
    }
    const trip = {
      id: makeId("trip"),
      driverId: driver.id,
      customerName: String(body.customerName || "Customer").trim(),
      customerPhone: String(body.customerPhone || "").trim(),
      pickup,
      destination,
      stops: buildRouteStops(pickup, destination, body.stops || body.stopsText),
      kmRate: Number(body.kmRate || driver.defaultRate || 1),
      tripType: "business",
      fulfillmentType: "my-driver",
      priority: ["standard", "priority", "urgent"].includes(String(body.priority || "").toLowerCase()) ? String(body.priority).toLowerCase() : "standard",
      deliveryWindowStart,
      deliveryWindowEnd,
      status: "active",
      deliveryOutcomeStatus: "active",
      shareToken: makeToken(),
      startedAt: nowIso(),
      endedAt: null,
      submittedAt: null,
      reviewedAt: null,
      approvalNotes: "",
      notes: String(body.notes || "").trim(),
      path: [],
      location: null,
      distanceKm: 0
    };
    syncTrackingStops(trip);
    db.trips.push(trip);
    const attachedRoute = attachTripsToDriverRoute(db, driver, [trip], pickup);
    if (!attachedRoute) {
      return badRequest("This driver has separate active routes. Finish or consolidate them before starting more work.");
    }
    driver.status = "en-route";
    if (session.role === "driver") driver.lastSeenAt = nowIso();
    await writeDb(db, env);
    const nextSnapshot = session.role === "driver" ? driverSnapshot(db, env, session.driverId) : snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({
      trip: publicTrip(db, trip),
      routeId: attachedRoute.routeId,
      appendedToActiveRoute: attachedRoute.appendedToActiveRoute,
      snapshot: nextSnapshot
    }, 201);
  }

  const proofMediaUploadMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/proof-media$/);
  if (method === "POST" && proofMediaUploadMatch) {
    if (!session) return unauthorized();
    const trip = db.trips.find((item) => item.id === proofMediaUploadMatch[1]);
    if (!trip) return notFound();
    if (!canAccessTrip(session, trip)) return unauthorized("This trip is not assigned to this login.");
    if (trip.status !== "active") return badRequest("Proof can only be added to an active delivery.");
    if (!env.PROOF_MEDIA || typeof env.PROOF_MEDIA.put !== "function") {
      return badRequest("Proof photo storage is not connected for this workspace.");
    }
    if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) {
      return badRequest("Upload proof as multipart form data.");
    }
    const form = await request.formData();
    const candidates = [];
    for (const kind of ["photo", "signature"]) {
      const file = form.get(kind);
      if (!file || typeof file.arrayBuffer !== "function" || !Number(file.size || 0)) continue;
      const contentType = String(file.type || "").toLowerCase();
      const extensionName = PROOF_MEDIA_TYPES.get(contentType);
      if (!extensionName) return badRequest("Proof images must be JPG, PNG, or WebP files.");
      if (Number(file.size) > PROOF_MEDIA_MAX_BYTES) return badRequest("Each proof image must be 5 MB or smaller.");
      candidates.push({ kind, file, contentType, extensionName });
    }
    if (!candidates.length) return badRequest("Choose a proof photo or collect a signature first.");
    const previousPending = trip.pendingProofMedia || {};
    const pending = { ...previousPending };
    const stagedKeys = [];
    const supersededKeys = [];
    try {
      for (const candidate of candidates) {
        const previous = pending[candidate.kind];
        const key = `proof/${trip.id}/${makeToken(18)}.${candidate.extensionName}`;
        await env.PROOF_MEDIA.put(key, await candidate.file.arrayBuffer(), {
          httpMetadata: { contentType: candidate.contentType },
          customMetadata: { tripId: trip.id, kind: candidate.kind }
        });
        stagedKeys.push(key);
        if (previous?.key) supersededKeys.push(previous.key);
        pending[candidate.kind] = {
          key,
          token: makeToken(24),
          contentType: candidate.contentType,
          filename: String(candidate.file.name || `${candidate.kind}.${candidate.extensionName}`).slice(0, 160),
          size: Number(candidate.file.size || 0),
          uploadedAt: nowIso(),
          uploadedBy: session.name || session.role
        };
      }
      trip.pendingProofMedia = pending;
      await writeDb(db, env);
    } catch (error) {
      trip.pendingProofMedia = previousPending;
      if (typeof env.PROOF_MEDIA.delete === "function") {
        await Promise.all(stagedKeys.map((key) => env.PROOF_MEDIA.delete(key).catch(() => {})));
      }
      throw error;
    }
    if (typeof env.PROOF_MEDIA.delete === "function") {
      await Promise.all(supersededKeys.map((key) => env.PROOF_MEDIA.delete(key).catch(() => {})));
    }
    return sendJson({ uploaded: candidates.map((item) => item.kind), proofMedia: { configured: true } }, 201);
  }

  if (method === "POST" && url.pathname === "/api/routes/recommendations") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const requestedIds = Array.isArray(body.tripIds) ? new Set(body.tripIds.map(String)) : null;
    try {
      return sendJson({ plan: await buildOptimizationPlan(db, env, requestedIds) });
    } catch (error) {
      return badRequest(error.message || "Rivo could not prepare an optimization plan.");
    }
  }

  if (method === "POST" && url.pathname === "/api/routes/auto-assign") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const requestedIds = Array.isArray(body.tripIds) ? new Set(body.tripIds.map(String)) : null;
    let plan;
    try {
      plan = await buildOptimizationPlan(db, env, requestedIds);
    } catch (error) {
      return badRequest(error.message || "Rivo could not optimize these deliveries.");
    }
    let optimizedRoutes = 0;
    const appliedTrips = [];
    for (const recommendation of plan.recommendations) {
      const driver = db.drivers.find((item) => item.id === recommendation.driverId);
      if (!driver) continue;
      const orderedTrips = recommendation.tripIds.map((id) => db.trips.find((trip) => trip.id === id)).filter(Boolean);
      const origin = workspacePickupAddress(db);
      const startedAt = nowIso();
      orderedTrips.forEach((trip, index) => {
        resetTripForDispatch(trip);
        trip.driverId = driver.id;
        trip.kmRate = Number(driver.defaultRate || 1);
        trip.status = "active";
        trip.deliveryOutcomeStatus = "active";
        trip.startedAt = startedAt;
        trip.endedAt = null;
        trip.tripType = "business";
        trip.fulfillmentType = "my-driver";
        trip.etaMinutes = recommendation.estimatedDurationMinutes === null
          ? null
          : Math.round((recommendation.estimatedDurationMinutes / orderedTrips.length) * (index + 1));
        trip.expectedArrivalAt = trip.etaMinutes ? new Date(Date.now() + trip.etaMinutes * 60000).toISOString() : null;
      });
      attachTripsToDriverRoute(db, driver, orderedTrips, origin);
      driver.status = "en-route";
      if (recommendation.optimized) optimizedRoutes += 1;
      appliedTrips.push(...orderedTrips);
    }
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ assigned: appliedTrips.length, optimizedRoutes, plan, snapshot: nextSnapshot }, 201);
  }

  if (method === "POST" && url.pathname === "/api/routes/dispatch") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const tripIds = Array.isArray(body.tripIds) ? [...new Set(body.tripIds.map(String))] : [];
    if (!tripIds.length) return badRequest("Select at least one order to dispatch.");
    const driver = db.drivers.find((item) => item.id === body.driverId && !item.archivedAt);
    if (!driver) return badRequest("A valid driver is required.");
    const existingDriverRoute = activeRouteStateForDriver(db, driver.id);
    if (existingDriverRoute.conflict) {
      return badRequest("This driver has separate active routes. Finish or consolidate them before dispatching more work.");
    }
    const sourceTrips = tripIds.map((id) => db.trips.find((item) => item.id === id));
    if (sourceTrips.some((trip) => !trip || !["queued", "completed", "exception"].includes(trip.status))) {
      return badRequest("Every selected order must be ready to dispatch.");
    }
    if (sourceTrips.some((trip) => openCourierRequestForTrip(db, trip.id))) {
      return badRequest("Cancel the open courier request before dispatching these orders to a driver.");
    }
    const trips = sourceTrips.map((trip) => createRedispatchAttempt(db, trip));
    const defaultOrigin = workspacePickupAddress(db);
    const origin = String(body.origin || defaultOrigin).trim() || defaultOrigin;
    const destinations = trips.map((trip) => String(trip.destination || "").trim());
    if (destinations.some((address) => !address)) return badRequest("Every selected order needs a destination.");
    const planningOrigin = existingDriverRoute.trips.at(-1)?.destination || origin;
    const routePlan = await optimizedStopOrder(env, planningOrigin, destinations);
    const startedAt = nowIso();
    const orderedTrips = routePlan.order.map((index) => trips[index]);
    orderedTrips.forEach((trip) => {
      resetTripForDispatch(trip);
      trip.driverId = driver.id;
      trip.kmRate = Number(body.kmRate || driver.defaultRate || 1);
      trip.tripType = "business";
      trip.status = "active";
      trip.deliveryOutcomeStatus = "active";
      trip.startedAt = startedAt;
      trip.endedAt = null;
    });
    const attachedRoute = attachTripsToDriverRoute(db, driver, orderedTrips, origin);
    if (!attachedRoute) return badRequest("This driver has separate active routes. Finish or consolidate them before dispatching more work.");
    driver.status = "en-route";
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({
      routeId: attachedRoute.routeId,
      appendedToActiveRoute: attachedRoute.appendedToActiveRoute,
      optimized: routePlan.optimized,
      trips: orderedTrips.map((trip) => publicTrip(db, trip)),
      snapshot: nextSnapshot
    }, 201);
  }

  if (method === "POST" && url.pathname === "/api/trips/bulk") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const action = String(body.action || "");
    const tripIds = Array.isArray(body.tripIds) ? [...new Set(body.tripIds.map(String))] : [];
    if (!tripIds.length) return badRequest("Select at least one delivery.");
    if (tripIds.length > 100) return badRequest("Update no more than 100 deliveries at once.");
    if (!["assign", "complete", "delivered"].includes(action)) return badRequest("Choose a valid bulk action.");
    const trips = tripIds.map((id) => db.trips.find((item) => item.id === id));
    if (trips.some((trip) => !trip)) return badRequest("One or more selected deliveries no longer exist.");
    const affectedDriverIds = new Set(trips.map((trip) => trip.driverId).filter(Boolean));
    const recordedAt = nowIso();

    if (action === "assign") {
      if (trips.some((trip) => !["queued", "completed"].includes(trip.status))) {
        return badRequest("Only queued or review-ready deliveries can be assigned in bulk.");
      }
      const driver = db.drivers.find((item) => item.id === body.driverId && !item.archivedAt);
      if (!driver) return badRequest("Choose a valid driver.");
      if (trips.some((trip) => openCourierRequestForTrip(db, trip.id))) {
        return badRequest("Cancel the open courier request before assigning these orders to a driver.");
      }
      const requestedRate = body.kmRate === undefined ? Number(driver.defaultRate || 0) : Number(body.kmRate);
      if (!Number.isFinite(requestedRate) || requestedRate < 0) return badRequest("Enter a valid kilometre rate.");
      for (const trip of trips) {
        trip.driverId = driver.id;
        trip.kmRate = requestedRate;
      }
      affectedDriverIds.add(driver.id);
    }

    if (action === "complete") {
      if (trips.some((trip) => trip.status !== "active")) {
        return badRequest("Only active deliveries can be completed in bulk.");
      }
      const overrideReason = String(body.overrideReason || "").trim();
      if (!overrideReason) return badRequest("Add a reason for the dispatcher override.");
      for (const trip of trips) {
        archiveTripProof(trip);
        trip.status = "completed";
        trip.deliveryOutcomeStatus = "delivered";
        trip.endedAt = trip.endedAt || recordedAt;
        trip.tripType = "business";
        trip.proof = {
          method: "Dispatcher override",
          recipient: "",
          outcome: "dispatcher-override",
          kind: "dispatcher-override",
          overrideReason,
          media: trip.pendingProofMedia || {},
          recordedAt,
          recordedBy: session.name || "Dispatcher"
        };
        delete trip.pendingProofMedia;
      }
    }

    if (action === "delivered") {
      if (trips.some((trip) => !trip.source?.system || !["queued", "completed", "exception"].includes(trip.status))) {
        return badRequest("Only queued, issue, or review-ready imported orders can be marked delivered in bulk.");
      }
      const overrideReason = String(body.overrideReason || "").trim();
      if (!overrideReason) return badRequest("Add a reason for the dispatcher override.");
      if (trips.some((trip) => openCourierRequestForTrip(db, trip.id))) {
        return badRequest("Update the courier request instead of closing these orders separately.");
      }
      for (const trip of trips) {
        confirmDeliveredByDispatcher(trip, session, overrideReason, recordedAt);
        trip.status = "delivered";
        trip.deliveryOutcomeStatus = "delivered";
        trip.endedAt = trip.endedAt || recordedAt;
        trip.tripType = "business";
        trip.notes = trip.notes || "Marked delivered by dispatcher.";
      }
    }

    for (const driverId of affectedDriverIds) {
      const driver = db.drivers.find((item) => item.id === driverId);
      if (!driver) continue;
      driver.status = calcDriverStatus(db, driver.id);
    }
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    for (const trip of trips) {
      const publicUpdate = publicTrip(db, trip);
      broadcast("trip-update", publicUpdate, { tripId: trip.id });
      broadcastCustomerTripUpdates(db, trip);
    }
    broadcastSnapshot(db, env);
    return sendJson({ action, updated: trips.length, trips: trips.map((trip) => publicTrip(db, trip)), snapshot: nextSnapshot });
  }

  if (method === "POST" && url.pathname === "/api/routes/reorder") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const tripIds = Array.isArray(body.tripIds) ? [...new Set(body.tripIds.map(String))] : [];
    if (tripIds.length < 2) return badRequest("A route needs at least two active deliveries.");
    const trips = tripIds.map((id) => db.trips.find((item) => item.id === id));
    if (trips.some((trip) => !trip || trip.status !== "active")) {
      return badRequest("Every route stop must be an active delivery.");
    }
    const driverId = trips[0].driverId;
    if (!driverId || trips.some((trip) => trip.driverId !== driverId)) {
      return badRequest("All route stops must belong to the same driver.");
    }
    const existingRouteIds = new Set(trips.map((trip) => trip.routeId || trip.id));
    if (existingRouteIds.size !== 1) {
      return badRequest("Stops from separate routes cannot be merged by reordering.");
    }
    const routeId = trips.find((trip) => trip.routeId)?.routeId || makeId("route");
    const allActiveRouteTrips = db.trips.filter((trip) => trip.status === "active" && (trip.routeId || trip.id) === (trips[0].routeId || trips[0].id));
    if (allActiveRouteTrips.length !== trips.length || allActiveRouteTrips.some((trip) => !tripIds.includes(trip.id))) {
      return badRequest("Reorder the complete active route so no stop is accidentally dropped.");
    }
    const defaultOrigin = workspacePickupAddress(db);
    const origin = String(body.origin || trips[0].routeOrigin || defaultOrigin).trim() || defaultOrigin;
    const destinations = trips.map((trip) => trip.destination);
    trips.forEach((trip, routeSequence) => {
      trip.routeId = routeId;
      trip.routeSequence = routeSequence;
      trip.routeStopCount = trips.length;
      trip.routeOrigin = origin;
      trip.routeDestinations = destinations;
    });
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({
      routeId,
      trips: trips.map((trip) => publicTrip(db, trip)),
      snapshot: nextSnapshot
    });
  }

  const tripPatchMatch = url.pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (method === "PATCH" && tripPatchMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === tripPatchMatch[1]);
    if (!trip) return notFound();
    if (!["queued", "active", "completed", "exception"].includes(trip.status)) {
      return badRequest("Only queued, active, issue, or review-ready deliveries can be edited.");
    }
    const previousCustomerName = trip.customerName;
    const previousPickup = trip.pickup;
    const previousDestination = trip.destination;
    const previousStops = JSON.stringify(routeStopsForTrip(trip));
    const proposedCustomerName = body.customerName === undefined ? trip.customerName : String(body.customerName).trim();
    const proposedPickup = body.pickup === undefined ? trip.pickup : String(body.pickup).trim();
    const proposedDestination = body.destination === undefined ? trip.destination : String(body.destination).trim();
    const proposedStops = body.stops === undefined && body.stopsText === undefined
      ? previousStops
      : JSON.stringify(buildRouteStops(proposedPickup, proposedDestination, body.stops ?? body.stopsText));
    if (openCourierRequestForTrip(db, trip.id) && (
      proposedCustomerName !== trip.customerName
      || proposedPickup !== trip.pickup
      || proposedDestination !== trip.destination
      || proposedStops !== previousStops
    )) {
      return badRequest("Cancel the open courier request before changing customer or route details.");
    }
    if (trip.proof && (
      proposedCustomerName !== trip.customerName
      || proposedPickup !== trip.pickup
      || proposedDestination !== trip.destination
      || proposedStops !== previousStops
    )) {
      return badRequest("Customer and route details are locked once proof is recorded. Create a retry attempt instead.");
    }
    for (const key of ["customerName", "pickup", "destination", "notes"]) {
      if (body[key] !== undefined) trip[key] = String(body[key]).trim();
    }
    if (body.priority !== undefined) {
      const priority = String(body.priority || "").toLowerCase();
      if (!["standard", "priority", "urgent"].includes(priority)) return badRequest("Choose a valid delivery priority.");
      trip.priority = priority;
    }
    if (body.deliveryWindowStart !== undefined) {
      const value = optionalIso(body.deliveryWindowStart);
      if (value === undefined) return badRequest("Enter a valid delivery window start.");
      trip.deliveryWindowStart = value;
    }
    if (body.deliveryWindowEnd !== undefined) {
      const value = optionalIso(body.deliveryWindowEnd);
      if (value === undefined) return badRequest("Enter a valid delivery window end.");
      trip.deliveryWindowEnd = value;
    }
    if (trip.deliveryWindowStart && trip.deliveryWindowEnd && new Date(trip.deliveryWindowEnd) <= new Date(trip.deliveryWindowStart)) {
      return badRequest("Delivery window end must be after the start.");
    }
    if (!trip.customerName || !trip.pickup || !trip.destination) {
      return badRequest("Customer, pickup, and destination are required.");
    }
    if (body.kmRate !== undefined) trip.kmRate = Number(body.kmRate || 0);
    trip.stops = buildRouteStops(trip.pickup, trip.destination, body.stops || body.stopsText);
    const trackingIdentityChanged = previousCustomerName !== trip.customerName
      || previousPickup !== trip.pickup
      || previousDestination !== trip.destination
      || previousStops !== JSON.stringify(routeStopsForTrip(trip));
    if (trackingIdentityChanged) rotateTrackingTokens(trip);
    else syncTrackingStops(trip);
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), snapshot: nextSnapshot });
  }

  const dispatchMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/dispatch$/);
  if (method === "POST" && dispatchMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    let trip = db.trips.find((item) => item.id === dispatchMatch[1]);
    if (!trip) return notFound();
    if (!["queued", "completed", "exception"].includes(trip.status)) return badRequest("Only queued, issue, or delivered imported orders can be dispatched.");
    if (openCourierRequestForTrip(db, trip.id)) return badRequest("Cancel the open courier request before dispatching this order to a driver.");
    const driver = db.drivers.find((item) => item.id === body.driverId && !item.archivedAt);
    if (!driver) return badRequest("A valid driver is required.");
    if (activeRouteStateForDriver(db, driver.id).conflict) {
      return badRequest("This driver has separate active routes. Finish or consolidate them before dispatching more work.");
    }
    trip = createRedispatchAttempt(db, trip);
    const previousCustomerName = trip.customerName;
    const previousPickup = trip.pickup;
    const previousDestination = trip.destination;
    const previousStops = JSON.stringify(routeStopsForTrip(trip));
    for (const key of ["customerName", "pickup", "destination", "notes"]) {
      if (body[key] !== undefined) trip[key] = String(body[key]).trim();
    }
    if (!trip.customerName || !trip.pickup || !trip.destination) {
      return badRequest("Customer, pickup, and destination are required.");
    }
    trip.driverId = driver.id;
    trip.kmRate = Number(body.kmRate || driver.defaultRate || 1);
    trip.tripType = "business";
    trip.stops = buildRouteStops(trip.pickup, trip.destination, body.stops || body.stopsText);
    const trackingIdentityChanged = previousCustomerName !== trip.customerName
      || previousPickup !== trip.pickup
      || previousDestination !== trip.destination
      || previousStops !== JSON.stringify(routeStopsForTrip(trip));
    if (trackingIdentityChanged) rotateTrackingTokens(trip);
    else syncTrackingStops(trip);
    resetTripForDispatch(trip);
    trip.status = "active";
    trip.deliveryOutcomeStatus = "active";
    trip.startedAt = nowIso();
    trip.endedAt = null;
    const attachedRoute = attachTripsToDriverRoute(db, driver, [trip], trip.pickup);
    if (!attachedRoute) return badRequest("This driver has separate active routes. Finish or consolidate them before dispatching more work.");
    trip.notes = body.notes !== undefined ? String(body.notes).trim() : trip.notes;
    driver.status = "en-route";
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), routeId: attachedRoute.routeId, appendedToActiveRoute: attachedRoute.appendedToActiveRoute, snapshot: nextSnapshot });
  }

  const locationMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/location$/);
  if (method === "POST" && locationMatch) {
    if (!session) return unauthorized();
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === locationMatch[1]);
    if (!trip) return notFound();
    if (trip.status !== "active") return badRequest("Only active trips can receive location updates.");
    if (!canAccessTrip(session, trip)) return unauthorized("This trip is not assigned to this login.");
    if (trip.routeId && currentRouteTripId(db, trip) !== trip.id) {
      return badRequest("Publish location from the current route stop before moving to a later stop.");
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return badRequest("Latitude and longitude are required.");
    const point = {
      lat,
      lng,
      accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
      heading: Number.isFinite(Number(body.heading)) ? Number(body.heading) : null,
      speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : null,
      timestamp: nowIso()
    };
    const previous = trip.path.at(-1);
    const deltaKm = haversineKm(previous, point);
    if (!previous || deltaKm >= 0.01) {
      trip.path.push(point);
      trip.distanceKm = Number(((trip.distanceKm || 0) + deltaKm).toFixed(2));
    }
    trip.location = point;
    if (trip.routeId) {
      for (const routeTrip of db.trips) {
        if (routeTrip.routeId === trip.routeId && routeTrip.driverId === trip.driverId && routeTrip.status === "active") {
          routeTrip.location = point;
          routeTrip.routeCurrentTripId = trip.id;
        }
      }
    }
    const driver = db.drivers.find((item) => item.id === trip.driverId);
    if (driver) {
      driver.status = "en-route";
      driver.lastSeenAt = point.timestamp;
    }
    await writeDb(db, env);
    const nextTrip = publicTrip(db, trip);
    const nextSnapshot = session.role === "driver" ? driverSnapshot(db, env, session.driverId) : snapshot(db, env);
    broadcast("trip-update", nextTrip, { tripId: trip.id });
    broadcastCustomerTripUpdates(db, trip);
    broadcastSnapshot(db, env);
    return sendJson({ trip: nextTrip, snapshot: nextSnapshot });
  }

  const deliveredMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/delivered$/);
  if (method === "POST" && deliveredMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === deliveredMatch[1]);
    if (!trip) return notFound();
    if (!trip.source?.system) return badRequest("Only imported sales-channel orders can be marked delivered here.");
    if (!["queued", "completed", "exception"].includes(trip.status)) return badRequest("Only queued, issue, or review-ready imported orders can be marked delivered.");
    if (openCourierRequestForTrip(db, trip.id)) return badRequest("Update the courier request instead of closing this order separately.");
    const overrideReason = String(body.overrideReason || "").trim();
    if (!overrideReason) return badRequest("Add a reason for the dispatcher override.");
    const recordedAt = nowIso();
    confirmDeliveredByDispatcher(trip, session, overrideReason, recordedAt);
    trip.status = "delivered";
    trip.deliveryOutcomeStatus = "delivered";
    trip.endedAt = trip.endedAt || recordedAt;
    trip.tripType = "business";
    trip.notes = trip.notes || "Marked delivered by dispatcher.";
    const driver = db.drivers.find((item) => item.id === trip.driverId);
    if (driver) {
      driver.status = calcDriverStatus(db, driver.id);
    }
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcast("trip-update", publicTrip(db, trip), { tripId: trip.id });
    broadcastCustomerTripUpdates(db, trip);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), snapshot: nextSnapshot });
  }

  const completeMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/complete$/);
  if (method === "POST" && completeMatch) {
    if (!session) return unauthorized();
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === completeMatch[1]);
    if (!trip) return notFound();
    if (!canAccessTrip(session, trip)) return unauthorized("This trip is not assigned to this login.");
    const allowedStatuses = isDispatcher(session) ? ["active", "exception"] : ["active"];
    if (!allowedStatuses.includes(trip.status)) {
      return badRequest(isDispatcher(session)
        ? "Only active deliveries or open exceptions can be closed here."
        : "Only an active assigned delivery can be completed.");
    }
    const currentRouteStopId = currentRouteTripId(db, trip);
    const isCurrentRouteStop = !trip.routeId || currentRouteStopId === trip.id;
    if (session.role === "driver" && !isCurrentRouteStop) {
      return badRequest("Complete route stops in the dispatched order.");
    }
    if (isDispatcher(session)) {
      const previousCustomerName = trip.customerName;
      const previousPickup = trip.pickup;
      const previousDestination = trip.destination;
      const previousStops = JSON.stringify(routeStopsForTrip(trip));
      for (const key of ["customerName", "pickup", "destination", "notes"]) {
        if (body[key] !== undefined) trip[key] = String(body[key]).trim();
      }
      if (!trip.customerName || !trip.pickup || !trip.destination) {
        return badRequest("Customer, pickup, and destination are required.");
      }
      if (body.kmRate !== undefined) {
        const kmRate = Number(body.kmRate);
        if (!Number.isFinite(kmRate) || kmRate < 0) return badRequest("Enter a valid kilometre rate.");
        trip.kmRate = kmRate;
      }
      const routeFieldsUpdated = body.stops !== undefined || body.stopsText !== undefined || body.pickup !== undefined || body.destination !== undefined;
      if (routeFieldsUpdated) {
        const existingStops = routeStopsForTrip(trip).slice(1, -1);
        trip.stops = buildRouteStops(
          trip.pickup,
          trip.destination,
          body.stops !== undefined ? body.stops : body.stopsText !== undefined ? body.stopsText : existingStops
        );
      }
      const trackingIdentityChanged = previousCustomerName !== trip.customerName
        || previousPickup !== trip.pickup
        || previousDestination !== trip.destination
        || previousStops !== JSON.stringify(routeStopsForTrip(trip));
      if (trackingIdentityChanged) rotateTrackingTokens(trip);
      else if (routeFieldsUpdated) syncTrackingStops(trip);
    }
    const requestedOutcomeId = String(body.proofOutcome || "").trim();
    if (requestedOutcomeId && !DELIVERY_OUTCOMES.has(requestedOutcomeId)) {
      return badRequest("Choose a valid delivery outcome.");
    }
    const outcomeId = requestedOutcomeId || (isDispatcher(session) ? "dispatcher-override" : "delivered-recipient");
    const outcome = DELIVERY_OUTCOMES.get(outcomeId);
    if (outcome.override && !isDispatcher(session)) return unauthorized("Only dispatch can record an override.");
    if (session.role === "driver" && !outcome.exception && !outcome.failed && db.company?.operations?.requirePhoto && !trip.pendingProofMedia?.photo) {
      return badRequest("This workspace requires a delivery photo before completing the stop.");
    }
    if (session.role === "driver" && !outcome.exception && !outcome.failed && db.company?.operations?.requireSignature && !trip.pendingProofMedia?.signature) {
      return badRequest("This workspace requires a recipient signature before completing the stop.");
    }
    if (outcomeId === "verified" && !trip.pendingProofMedia?.signature) {
      return badRequest("Collect a recipient signature before recording Signature collected.");
    }
    const exceptionNote = String(body.exceptionNote || body.notes || trip.notes || "").trim();
    if (outcome.exception && !exceptionNote) return badRequest("Add a note explaining the delivery issue.");
    const nextAction = outcome.exception ? String(body.exceptionNextAction || "dispatcher").trim() : "";
    if (outcome.exception && !["retry", "return", "dispatcher"].includes(nextAction)) {
      return badRequest("Choose what should happen next.");
    }
    const recordedAt = nowIso();
    archiveTripProof(trip);
    trip.status = outcome.failed ? "failed" : outcome.exception ? "exception" : "completed";
    trip.deliveryOutcomeStatus = outcome.failed ? "failed" : outcome.exception ? "exception" : "delivered";
    trip.endedAt = recordedAt;
    trip.tripType = "business";
    if (body.notes !== undefined) trip.notes = String(body.notes || "").trim();
    trip.proof = {
      method: String(body.proofMethod || outcome.label || "Delivery completed").trim(),
      recipient: String(body.proofRecipient || "").trim(),
      outcome: outcomeId,
      exceptionReason: outcome.exception ? outcome.label : "",
      exceptionNote: outcome.exception ? exceptionNote : "",
      nextAction,
      kind: outcome.override ? "dispatcher-override" : "customer-proof",
      overrideReason: outcome.override ? String(body.overrideReason || exceptionNote || "Dispatcher completed this delivery without driver proof.").trim() : "",
      media: trip.pendingProofMedia || {},
      location: trip.location && isCurrentRouteStop
        ? {
            lat: trip.location.lat,
            lng: trip.location.lng,
            accuracy: trip.location.accuracy ?? null,
            timestamp: trip.location.timestamp || recordedAt
          }
        : null,
      locationStatus: trip.location && !isCurrentRouteStop ? "omitted-non-current-route-stop" : trip.location ? "recorded" : "unavailable",
      recordedAt,
      recordedBy: session.name || (session.role === "driver" ? "Driver" : "Dispatcher")
    };
    delete trip.pendingProofMedia;
    if (outcome.exception) {
      trip.exceptionHistory = Array.isArray(trip.exceptionHistory) ? trip.exceptionHistory : [];
      trip.exceptionHistory.push({
        reason: outcome.label,
        nextAction,
        note: exceptionNote,
        driverId: trip.driverId,
        kmRate: Number(trip.kmRate || 0),
        distanceKm: Number(trip.distanceKm || 0),
        lastLocation: trip.location || null,
        recordedAt,
        recordedBy: trip.proof.recordedBy
      });
      trip.exceptionHistory = trip.exceptionHistory.slice(-20);
    }
    const driver = db.drivers.find((item) => item.id === trip.driverId);
    if (driver) {
      driver.status = calcDriverStatus(db, driver.id);
      if (session.role === "driver") driver.lastSeenAt = nowIso();
    }
    await writeDb(db, env);
    const nextSnapshot = session.role === "driver" ? driverSnapshot(db, env, session.driverId) : snapshot(db, env);
    broadcast("trip-update", publicTrip(db, trip), { tripId: trip.id });
    broadcastCustomerTripUpdates(db, trip);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), snapshot: nextSnapshot });
  }

  const submitMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/submit$/);
  if (method === "POST" && submitMatch) {
    if (!session) return unauthorized();
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === submitMatch[1]);
    if (!trip) return notFound();
    if (!canAccessTrip(session, trip)) return unauthorized("This trip is not assigned to this login.");
    if (!["completed", "rejected", "failed"].includes(trip.status)) return badRequest("Only completed, failed, or rejected trips can be submitted.");
    if (!isBusinessTrip(trip)) return badRequest("Only business trips are sent for approval.");
    trip.status = "submitted";
    trip.submittedAt = nowIso();
    trip.approvalNotes = "";
    if (body.notes !== undefined) trip.notes = String(body.notes).trim();
    await writeDb(db, env);
    const nextSnapshot = session.role === "driver" ? driverSnapshot(db, env, session.driverId) : snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), snapshot: nextSnapshot });
  }

  const approvalMatch = url.pathname.match(/^\/api\/trips\/([^/]+)\/approval$/);
  if (method === "POST" && approvalMatch) {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const body = await readBody(request);
    const trip = db.trips.find((item) => item.id === approvalMatch[1]);
    if (!trip) return notFound();
    if (!["approved", "rejected"].includes(body.decision)) return badRequest("Decision must be approved or rejected.");
    trip.status = body.decision;
    trip.reviewedAt = nowIso();
    trip.approvalNotes = String(body.approvalNotes || "").trim();
    await writeDb(db, env);
    const nextSnapshot = snapshot(db, env);
    broadcastSnapshot(db, env);
    return sendJson({ trip: publicTrip(db, trip), snapshot: nextSnapshot });
  }

  const shareMatch = url.pathname.match(/^\/api\/share\/([^/]+)$/);
  if (method === "GET" && shareMatch) {
    const share = trackingShareByToken(db, shareMatch[1]);
    if (!share) return notFound();
    return sendJson(
      { trip: publicCustomerTrip(db, share.trip, share.trackingStop), company: companyForEnv(db, env) },
      200,
      { "Cache-Control": "private, no-store, max-age=0" }
    );
  }

  if (method === "GET" && url.pathname === "/api/reports/weekly") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const selectedWeek = url.searchParams.get("week") || weekKey();
    const driverId = url.searchParams.get("driverId") || "";
    return sendJson(weeklyReport(db, selectedWeek, driverId));
  }

  if (method === "GET" && url.pathname === "/api/reports/weekly.csv") {
    if (!isDispatcher(session)) return unauthorized("Dispatcher login required.");
    const selectedWeek = url.searchParams.get("week") || weekKey();
    const driverId = url.searchParams.get("driverId") || "";
    return new Response(reportCsv(weeklyReport(db, selectedWeek, driverId)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="delivery-report-${selectedWeek}.csv"`
      }
    });
  }

  return notFound();
}

async function handleEvents(request, env, url) {
  const db = await readDb(env);
  const session = sessionFromRequest(request, db, url);
  if (!url.searchParams.get("token") && !session) {
    return unauthorized();
  }
  const encoder = new TextEncoder();
  let client;
  const stream = new ReadableStream({
    start(controller) {
      client = {
        controller,
        encoder,
        tripId: url.searchParams.get("tripId") || "",
        token: url.searchParams.get("token") || "",
        session
      };
      clients.add(client);
      sendSse(client, "connected", { connectedAt: nowIso() });
      if (client.token) {
        const share = trackingShareByToken(db, client.token);
        if (share) sendSse(client, "trip-update", publicCustomerTrip(db, share.trip, share.trackingStop));
      } else if (client.session?.role === "driver") {
        const nextSnapshot = driverSnapshot(db, env, client.session.driverId);
        if (nextSnapshot) sendSse(client, "snapshot", nextSnapshot);
      } else if (client.tripId) {
        const trip = db.trips.find((item) => item.id === client.tripId);
        if (trip) sendSse(client, "trip-update", publicTrip(db, trip));
      } else {
        sendSse(client, "snapshot", snapshot(db, env));
      }
    },
    cancel() {
      if (client) clients.delete(client);
    }
  });
  request.signal.addEventListener("abort", () => {
    if (client) clients.delete(client);
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}

function extension(pathname) {
  const match = pathname.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : "";
}

function staticPath(pathname) {
  if (pathname === "/") {
    return "/index.html";
  }
  if (pathname === "/favicon.ico") return "/assets/rova-mark.svg";
  const appRoutes = new Set(["/dispatcher", "/login", "/operations", "/operations.html", "/contact.html", "/pricing.html", "/demo.html", "/industries.html", "/terms.html", "/privacy.html"]);
  if (appRoutes.has(pathname) || pathname === "/setup" || pathname.startsWith("/driver") || pathname.startsWith("/track") || pathname.startsWith("/join")) {
    return "/operations.html";
  }
  if (pathname.includes("..")) return null;
  return pathname;
}

async function serveStatic(request, env, url) {
  const pathname = staticPath(decodeURIComponent(url.pathname));
  if (!pathname) return new Response("Bad request", { status: 400 });
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("Static asset binding is unavailable.", { status: 500 });
  }
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (response.status === 404) return new Response("Not found", { status: 404 });
  const headers = new Headers(response.headers);
  headers.set("Content-Type", MIME_TYPES[extension(pathname)] || headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", pathname === "/index.html" || pathname === "/operations.html" ? "no-store" : "public, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const forwardedHost = String(request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
      .split(",")[0]
      .trim()
      .split(":")[0];
    if (APP_HOSTING_ALIASES.has(url.hostname) || APP_HOSTING_ALIASES.has(forwardedHost)) {
      url.protocol = "https:";
      url.hostname = APP_CANONICAL_HOST;
      return new Response(null, {
        status: 308,
        headers: {
          "Cache-Control": "public, max-age=3600",
          "Location": url.toString()
        }
      });
    }
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      if (url.pathname === "/events") {
        return sendJson({ error: "Live event streams have been replaced by polling." }, 410);
      }
      return await serveStatic(request, env, url);
    } catch (error) {
      return sendJson({ error: error.message || "Server error" }, error?.code === "STATE_CONFLICT" ? 409 : 500);
    }
  }
};
