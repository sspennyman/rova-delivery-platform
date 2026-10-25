import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { wixFulfillment, isNonDeliveryOrder, fulfillmentMethodForTrip } from "../public/order-fulfillment.js";
import { currentAutomaticStop } from "../worker/auto-delivery.js";

const address = { addressLine: "Fixture street", city: "Ottawa" };
const order = (id, extra = {}) => ({ id, number: id, status: "APPROVED", paymentStatus: "PAID", fulfillmentStatus: "NOT_FULFILLED", createdDate: new Date().toISOString(), ...extra });
const pickup = order("pickup", { billingInfo: { address }, shippingInfo: { title: "Collect in store", logistics: { pickupDetails: { pickupMethod: "STORE_PICKUP", address }, shippingDestination: { address } } } });
const delivery = order("delivery", { shippingInfo: { title: "Local delivery", logistics: { shippingDestination: { address } } } });
const point = order("point", { shippingInfo: { logistics: { pickupDetails: { pickupMethod: "PICKUP_POINT" }, shippingDestination: { address } } } });
const pos = order("pos", { channelInfo: { type: "POS" }, billingInfo: { address }, fulfillmentStatus: "FULFILLED" });
const unclear = order("unclear", { billingInfo: { address } });
const shipped = order("shipped", { shippingInfo: { title: "Xpresspost", logistics: { shippingDestination: { address } } } });
const fulfilled = { ...delivery, id: "fulfilled", number: "fulfilled", fulfillmentStatus: "FULFILLED" };
assert.equal(wixFulfillment(pickup).fulfillmentMethod, "customer-pickup");
assert.equal(wixFulfillment(delivery).fulfillmentMethod, "delivery");
assert.equal(wixFulfillment(point).fulfillmentMethod, "delivery", "carrier pickup point is not customer store pickup");
assert.equal(wixFulfillment(pos).fulfillmentMethod, "needs-details", "POS does not determine pickup versus delivery");
assert.equal(wixFulfillment(unclear).fulfillmentMethod, "needs-details", "billing is not a delivery address");
assert.equal(wixFulfillment({ ...delivery, channelInfo: { type: "POS" } }).fulfillmentMethod, "delivery", "POS delivery remains dispatchable");
assert.equal(wixFulfillment(shipped).fulfillmentMethod, "carrier-shipping");
assert.equal(wixFulfillment(fulfilled).fulfillmentMethod, "fulfillment-review", "upstream fulfillment does not fabricate a delivery record");
for (const [title, expected] of [["Canada Post Expedited Parcel", "carrier-shipping"], ["UPS Ground", "carrier-shipping"], ["Same-day local delivery", "delivery"], ["Standard shipping", "delivery"]]) {
  assert.equal(wixFulfillment({ ...delivery, shippingInfo: { ...delivery.shippingInfo, title } }).fulfillmentMethod, expected);
}
const legacyCarrier = { status: "queued", destination: "Fixture address", source: { system: "wix", fulfillmentMethod: "delivery", shippingTitle: "Xpresspost" } };
assert.equal(fulfillmentMethodForTrip(legacyCarrier), "carrier-shipping", "existing queues are protected without a historical Wix resync");
assert.equal(fulfillmentMethodForTrip({ ...legacyCarrier, startedAt: new Date().toISOString(), status: "active" }), "delivery", "active work is not reclassified");
for (const method of ["carrier-shipping", "fulfillment-review"]) {
  assert.equal(fulfillmentMethodForTrip({ ...legacyCarrier, status: "completed", proof: { recordedAt: "fixture" }, source: { ...legacyCarrier.source, fulfillmentMethod: method } }), "delivery", "upstream metadata cannot reclassify recorded delivery work");
}
assert.equal(fulfillmentMethodForTrip({ ...legacyCarrier, source: { ...legacyCarrier.source, fulfillmentOverride: "delivery" } }), "delivery", "explicit dispatch choice wins");
assert.equal(currentAutomaticStop({ trips: [{ ...pickup, source: wixFulfillment(pickup), driverId: "a", status: "active" }] }, "a"), undefined);

delete globalThis.__deliveryTrackerDb;
const env = { DISPATCHER_USERNAME: "pickup-fixture", DISPATCHER_PASSWORD: "fixture-password-only", WIX_API_KEY: "fixture-only", WIX_SITE_ID: "fixture-only", INTEGRATION_ENCRYPTION_KEY: "fixture-encryption-only" };
const call = (path, token, body) => worker.fetch(new Request("https://app.floraljet.llc" + path, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { waitUntil() {} });
const login = await (await call("/api/auth/login", null, { identifier: env.DISPATCHER_USERNAME, password: env.DISPATCHER_PASSWORD })).json();
const token = login.session.token;
const profile = await (await call("/api/me/driver-profile", token, { name: "Fixture owner" })).json();
const driverId = profile.driver.id;
const originalFetch = globalThis.fetch;
let orders = [pickup, delivery, point, pos, unclear, shipped, fulfilled];
globalThis.fetch = async () => Response.json({ orders });
try {
  assert.equal((await call("/api/integrations/wix/sync", null, {})).status, 401);
  const first = await (await call("/api/integrations/wix/sync", token, {})).json();
  assert.equal(first.sync.imported, 7);
  const db = globalThis.__deliveryTrackerDb;
  const byOrder = id => db.trips.find(t => t.source?.orderId === id);
  assert.equal(byOrder("pickup").status, "pickup");
  assert.equal(byOrder("pos").status, "order-review");
  assert.equal(byOrder("unclear").status, "order-review");
  assert.equal(byOrder("delivery").status, "queued");
  assert.equal(byOrder("point").status, "queued");
  for (const id of ["pickup", "pos", "unclear", "shipped", "fulfilled"]) {
    const trip = byOrder(id);
    assert.equal(trip.driverId, ""); assert.equal(trip.kmRate, 0); assert.equal(trip.shareToken, "");
    assert.deepEqual(trip.trackingStops, []); assert.equal(isNonDeliveryOrder(trip), true);
    for (const path of ["/api/routes/preview", "/api/routes/dispatch", "/api/trips/bulk", `/api/trips/${trip.id}/dispatch`]) {
      assert.equal((await call(path, token, { action: "assign", tripIds: [trip.id], driverId })).status, 400, path);
    }
  }
  const second = await (await call("/api/integrations/wix/sync", token, {})).json();
  assert.equal(second.sync.imported, 0); assert.equal(second.sync.updated, 0, "sync is idempotent");
  db.company.pickupAddress = "Fixture depot";
  const carrierTrip = byOrder("shipped");
  assert.equal((await call(`/api/trips/${carrierTrip.id}/fulfillment`, token, { fulfillmentMethod: "delivery", destination: "Fixture customer address" })).status, 200);
  assert.equal(isNonDeliveryOrder(carrierTrip), false, "carrier shipping can be explicitly assigned to an in-house route");
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(isNonDeliveryOrder(carrierTrip), false, "resync retains that decision");
  const posTrip = byOrder("pos");
  const choosePath = `/api/trips/${posTrip.id}/fulfillment`;
  assert.equal((await call(choosePath, null, { fulfillmentMethod: "delivery", destination: "Fixture customer address" })).status, 401);
  assert.equal((await call(choosePath, token, { fulfillmentMethod: "delivery", destination: "" })).status, 400, "delivery requires an actual address");
  assert.equal(posTrip.source.fulfillmentOverride, undefined, "invalid choice cannot mutate the order");
  assert.equal((await call(choosePath, token, { fulfillmentMethod: "customer-pickup" })).status, 200);
  assert.equal(posTrip.status, "pickup");
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(posTrip.status, "pickup", "sync preserves an explicit dispatcher choice");
  assert.equal((await call(choosePath, token, { fulfillmentMethod: "delivery", destination: "Fixture customer address" })).status, 200);
  assert.equal(posTrip.status, "queued");
  assert.equal(posTrip.destination, "Fixture customer address");
  assert.equal(isNonDeliveryOrder(posTrip), false, "a POS sale selected for delivery can be routed");
  assert.equal((await call("/api/trips/bulk", token, { action: "assign", tripIds: [posTrip.id], driverId })).status, 200);
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(posTrip.status, "queued");
  assert.equal(posTrip.destination, "Fixture customer address");
  assert.equal(posTrip.driverId, driverId, "sync does not remove a valid POS delivery assignment");
  const prior = byOrder("delivery"); prior.driverId = driverId;
  orders = [{ ...pickup, id: "delivery", number: "delivery" }];
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(prior.status, "pickup", "existing untouched queue entries are corrected");
  assert.equal(prior.driverId, "");
  assert.equal(prior.fulfillmentHistory.at(-1).previousDriverId, driverId);
  orders = [{ ...delivery, id: "unclear", number: "unclear" }];
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(byOrder("unclear").status, "queued", "adding Wix shipping details returns order to delivery queue");
  prior.status = "completed"; prior.startedAt = new Date().toISOString(); prior.endedAt = prior.startedAt;
  prior.distanceKm = 9; prior.proof = { kind: "customer-proof", recipient: "Fixture" };
  const record = JSON.stringify({ status: prior.status, startedAt: prior.startedAt, endedAt: prior.endedAt, distanceKm: prior.distanceKm, proof: prior.proof });
  orders = [{ ...pickup, id: "delivery", number: "delivery", fulfillmentStatus: "FULFILLED" }];
  await call("/api/integrations/wix/sync", token, {});
  assert.equal(JSON.stringify({ status: prior.status, startedAt: prior.startedAt, endedAt: prior.endedAt, distanceKm: prior.distanceKm, proof: prior.proof }), record, "history and proof are never rewritten");
  assert.equal((await call(`/api/trips/${prior.id}/dispatch`, token, { driverId })).status, 400, "historical pickup cannot be redispatched");
  assert.equal((await call(`/api/trips/${prior.id}/fulfillment`, token, { fulfillmentMethod: "delivery", destination: "Fixture street" })).status, 400, "choice cannot rewrite started or recorded history");
  orders = [{ ...pickup, id: "connected-pickup", number: "connected-pickup" }];
  const connected = await call("/api/integrations/connect", token, { provider: "wix", name: "Fixture Wix", siteId: "fixture-site", apiKey: "fixture-credentials-only" });
  assert.equal(connected.status, 201, await connected.clone().text());
  const connectedTrip = byOrder("connected-pickup");
  assert.equal(connectedTrip.status, "pickup", "connected Wix path also classifies pickups");
  assert.ok(connectedTrip.source.connectionId);
  await call("/api/integrations/sync", token, {});
  assert.equal(db.trips.filter(t => t.source?.orderId === "connected-pickup" && t.source.connectionId).length, 1);
} finally { globalThis.fetch = originalFetch; }
console.log("Wix pickup/POS classification, dispatch guards, idempotence, queue correction and history preservation passed.");
