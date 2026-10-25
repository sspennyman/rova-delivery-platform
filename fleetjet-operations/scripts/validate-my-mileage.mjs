import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { mileageWeek, localDay } from "../worker/mileage.js";

delete globalThis.__deliveryTrackerDb;
const envA = { DISPATCHER_USERNAME: "spencer-fixture", DISPATCHER_PASSWORD: "fixture-password-only" };
const envB = { DISPATCHER_USERNAME: "other-fixture", DISPATCHER_PASSWORD: "other-fixture-password" };
async function call(path, { token, body, method = body === undefined ? "GET" : "POST", env = envA } = {}) {
  return worker.fetch(new Request("https://app.floraljet.llc" + path, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { waitUntil() {} });
}
async function login(env) { const r = await call("/api/auth/login", { body: { identifier: env.DISPATCHER_USERNAME, password: env.DISPATCHER_PASSWORD }, env }); assert.equal(r.status, 200); return (await r.json()).session; }
const a = await login(envA), b = await login(envB);
const entry = await call("/my-mileage");
assert.equal(entry.status, 302); assert.equal(entry.headers.get("location"), "https://app.floraljet.llc/?view=my-mileage", "native entry uses canonical static shell without losing its view");
assert.equal((await call("/api/me/driver-profile", { body: { name: "No session" } })).status, 401);
assert.equal((await call("/api/my-mileage", { token: a.token })).status, 403);
let r = await call("/api/me/driver-profile", { token: a.token, body: { name: "Spencer Monahan" } });
assert.equal(r.status, 201);
const profile = await r.json(), id = profile.driver.id;
assert.equal(profile.session.role, "dispatcher");
assert.equal(profile.session.driverId, "");
assert.equal(profile.session.mileageDriverId, id);
assert.equal(profile.driver.defaultRate, null);
assert.equal(profile.mileage.tracking.enabled, false);
assert.equal(profile.driver.inviteStatus, "linked");
assert.equal(profile.driver.email, "", "do not invent an email for a username account");
assert.equal((await call("/api/bootstrap", { token: a.token })).status, 200, "dispatch access retained");
const repeat = await (await call("/api/me/driver-profile", { token: a.token, body: { name: "Duplicate", driverId: "someone-else" } })).json();
assert.equal(repeat.driver.id, id, "self-enrollment is idempotent");
const bProfile = await (await call("/api/me/driver-profile", { token: b.token, body: { name: "Other owner", driverId: id } })).json();
assert.notEqual(bProfile.driver.id, id, "a supplied driver ID cannot claim someone else's profile");
const again = await login(envA); assert.equal(again.mileageDriverId, id, "link survives a new session");
const db = globalThis.__deliveryTrackerDb;
assert.equal(db.drivers.find(d => d.id === id).loginId, "", "migration must not invent a driver username for a linked profile");
const now = new Date().toISOString(), week = mileageWeek(localDay(Date.now()));
const trip = { id: "own-private", driverId: id, date: localDay(Date.now()), week, startedAt: now, endedAt: now, state: "complete", category: "personal", purpose: "PRIVATE PURPOSE", from: "PRIVATE ORIGIN", to: "PRIVATE END", distanceKm: 5, flags: [], audit: [] };
db.mileageTrips.push(trip);
const mine = await (await call("/api/my-mileage?driverId=" + bProfile.driver.id, { token: a.token })).json();
assert.equal(mine.trips[0].id, trip.id, "URL driverId cannot change ownership");
const other = await (await call("/api/my-mileage", { token: b.token })).json();
assert.equal(other.trips.length, 0);
const me = await (await call("/api/me", { token: a.token })).json();
assert.equal(me.snapshot.myMileage.trips[0].id, trip.id);
for (const route of ["/api/bootstrap", "/api/mileage", "/api/admin/backup"]) {
  const payload = await (await call(route, { token: b.token })).text();
  assert.ok(!payload.includes("PRIVATE ORIGIN"), route + " excludes personal trips");
  assert.ok(!payload.includes("dispatcherDriverProfiles"), route + " excludes identity mapping");
}
assert.equal((await call(`/api/my-mileage/trips/${trip.id}`, { token: b.token, method: "PATCH", body: { category: "business" } })).status, 404);
assert.ok(!(await (await call("/api/my-mileage/export.csv?week=" + week, { token: b.token })).text()).includes("PRIVATE ORIGIN"));
assert.equal((await call(`/api/drivers/${id}/invite`, { token: a.token, body: {} })).status, 400);
assert.equal((await call(`/api/drivers/${id}`, { token: a.token, method: "PATCH", body: { password: "do-not-create-password" } })).status, 400);
assert.equal((await call(`/api/drivers/${id}`, { token: a.token, method: "PATCH", body: { defaultRate: -1 } })).status, 400);
assert.equal((await call(`/api/drivers/${id}`, { token: a.token, method: "PATCH", body: { vehicle: "Fixture vehicle", defaultRate: .72 } })).status, 200);
assert.equal((await call(`/api/my-mileage/trips/${trip.id}`, { token: a.token, method: "PATCH", body: { category: "business", purpose: "Fixture delivery" } })).status, 200);
db.mileageTrips.push({ ...structuredClone(trip), id: "still-private", category: "personal", from: "UNSUBMITTED PRIVATE" });
assert.equal((await call("/api/my-mileage/reports", { token: a.token, body: { week, expectedKmRate: .72 } })).status, 201);
const report = db.mileageReports[0]; assert.equal(report.kmRate, .72); assert.equal(report.totalAmount, 3.6); assert.equal(report.items.length, 1);
assert.equal((await call(`/api/my-mileage/reports/${report.id}/export.csv`, { token: b.token })).status, 404);
assert.equal((await call(`/api/my-mileage/reports/${report.id}`, { token: a.token, method: "PATCH", body: { status: "approved" } })).status, 409, "personal view cannot act as staff approval");
assert.ok(!(await (await call("/api/mileage", { token: b.token })).text()).includes("UNSUBMITTED PRIVATE"));
const deviceId = "fixture-iphone-0000001";
assert.equal((await call("/api/my-mileage/consent", { token: a.token, body: { enabled: true, source: "ios", deviceId, driverId: bProfile.driver.id } })).status, 200);
assert.equal(db.mileageTracking[id].enabled, true); assert.equal(db.mileageTracking[bProfile.driver.id].enabled, false);
assert.equal((await call("/api/my-mileage/points", { token: a.token, body: { deviceId, points: [] } })).status, 200);
db.sessions.push({ token: "legacy-session-fixture", role: "dispatcher", name: "Old session", expiresAt: new Date(Date.now() + 60000).toISOString() });
assert.equal((await call("/api/me/driver-profile", { token: "legacy-session-fixture", body: { name: "Legacy" } })).status, 409);
db.drivers.find(d => d.id === id).archivedAt = now;
assert.equal((await call("/api/my-mileage", { token: a.token })).status, 403, "archiving stops linked mileage access");
assert.equal((await call("/api/me/driver-profile", { token: a.token, body: { name: "Duplicate" } })).status, 409);
console.log("PASS: dispatcher self-profile, stable identity, private mileage, native consent, rate reports, cross-account isolation, archive and legacy-session gates");
