import { km } from "./mileage.js";
import { isNonDeliveryOrder } from "../public/order-fulfillment.js";

// Detection is a workflow inference, never recipient proof or tax classification.
const NEAR_KM = 0.1;
const AWAY_KM = 0.25;
const DWELL_MS = 90_000;
const MAX_GAP_MS = 90_000;
const iso = at => new Date(at).toISOString();

export function currentAutomaticStop(db, driverId) {
  const active = db.trips.filter(t => t.driverId === driverId && t.status === "active" && !isNonDeliveryOrder(t))
    .sort((a,b) => Number(a.routeSequence || 0) - Number(b.routeSequence || 0));
  // Multiple independently dispatched routes are ambiguous; don't guess.
  return new Set(active.map(t => t.routeId || t.id)).size <= 1 ? active[0] : null;
}

export async function prepareAutomaticStops(db, driverId, env, now = Date.now()) {
  if (db.company?.operations?.autoComplete === false) return;
  const apiKey = String(env.GOOGLE_MAPS_SERVER_API_KEY || env.GOOGLE_MAPS_API_KEY || "").trim();
  if (!apiKey) return;
  // Resolve the whole active route once so an upload can advance to its next stop.
  const current = currentAutomaticStop(db, driverId);
  if (!current) return;
  const pending = db.trips.filter(t => t.driverId === driverId && t.status === "active" && !isNonDeliveryOrder(t))
    .sort((a,b) => Number(a.routeSequence || 0) - Number(b.routeSequence || 0)).slice(0,24).filter(trip => {
    if ((trip.stops?.length || 2) > 2 || trip.tripType === "personal" || trip.pickup === trip.destination) return false;
    const old = trip.autoDelivery;
    return !(old?.address === trip.destination && old?.startedAt === trip.startedAt
      && (old.target && now - Date.parse(old.resolvedAt) < 24 * 3600_000
        || now - Date.parse(old.attemptedAt) < 600_000));
  });
  if (!pending.length) return;
  for (const trip of pending) {
    trip.autoDelivery = { address: trip.destination, startedAt: trip.startedAt, attemptedAt: iso(now), status: "resolving" };
  }
  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": "routes.legs.endLocation" },
        body: JSON.stringify({ origin: { address: current.pickup }, destination: { address: pending.at(-1).destination },
          intermediates: pending.slice(0,-1).map(t => ({ address: t.destination })), travelMode: "DRIVE" })
      });
    const payload = response.ok ? await response.json() : null;
    const legs = payload?.routes?.[0]?.legs;
    if (!Array.isArray(legs) || legs.length !== pending.length) throw new Error("Unresolved route");
    const targets = legs.map(leg => leg.endLocation?.latLng);
    for (const target of targets) {
      if (typeof target?.latitude !== "number" || typeof target?.longitude !== "number"
        || Math.abs(target.latitude) > 90 || Math.abs(target.longitude) > 180) throw new Error("Unresolved stop");
    }
    pending.forEach((trip,index) => Object.assign(trip.autoDelivery, { target: { lat: targets[index].latitude, lng: targets[index].longitude }, resolvedAt: iso(now), status: "watching" }));
  } catch { for (const trip of pending) trip.autoDelivery.status = "address-unavailable"; }
}

export function detectAutomaticCompletion(db, driverId, point, now = Date.now()) {
  if (db.company?.operations?.autoComplete === false) return null;
  const trip = currentAutomaticStop(db, driverId);
  const at = Date.parse(point?.timestamp);
  const s = trip?.autoDelivery;
  if (!trip || !s?.target || s.address !== trip.destination || s.startedAt !== trip.startedAt
    || trip.tripType === "personal" || (trip.stops?.length || 2) > 2 || trip.pickup === trip.destination
    || !Number.isFinite(at) || at < Date.parse(trip.startedAt) || now - at > MAX_GAP_MS || at > now + 60_000
    || typeof point.lat !== "number" || typeof point.lng !== "number" || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180
    || typeof point.accuracy !== "number" || !Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 50
    || s.lastAt && at <= s.lastAt) return null;
  if (s.lastAt && at - s.lastAt > MAX_GAP_MS) {
    delete s.nearSince; delete s.qualifiedAt; delete s.departureAt; s.nearSamples = 0;
  }
  const gap = s.lastAt ? at - s.lastAt : 0;
  const calculatedSpeed = gap && s.lastPoint ? km(s.lastPoint,point) * 1000 / (gap / 1000) : Infinity;
  const speed = typeof point.speed === "number" && Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : calculatedSpeed;
  if (gap && calculatedSpeed > 55.6) { delete s.nearSince; delete s.qualifiedAt; delete s.departureAt; s.nearSamples = 0; s.lastAt = at; s.lastPoint = point; return null; }
  const distance = km(s.target, point);
  s.lastAt = at; s.lastPoint = point;
  if (distance >= AWAY_KM) s.approached = true;
  if (!s.approached) return null;
  if (distance <= NEAR_KM && speed <= 1.5) {
    s.nearSince ??= at; s.nearSamples = (s.nearSamples || 0) + 1;
    s.lastNearAt = at; delete s.departureAt;
    if (at - s.nearSince >= DWELL_MS && s.nearSamples >= 3) { s.qualifiedAt ??= at; s.status = "stop-detected"; }
    return null;
  }
  if (!s.qualifiedAt) { delete s.nearSince; s.nearSamples = 0; return null; }
  if (distance < AWAY_KM) { delete s.departureAt; return null; }
  s.departureAt ??= at;
  if (at - s.departureAt < 10_000) return null;
  const rules = db.company?.operations || {};
  if (rules.requirePhoto && !trip.pendingProofMedia?.photo || rules.requireSignature && !trip.pendingProofMedia?.signature) {
    s.status = "proof-required"; return null;
  }
  if (trip.proof) { trip.proofHistory ||= []; trip.proofHistory.push(trip.proof); trip.proofHistory = trip.proofHistory.slice(-20); }
  trip.status = "completed";
  trip.deliveryOutcomeStatus = "delivered";
  trip.endedAt = iso(s.lastNearAt);
  trip.completionRecordedAt = iso(now);
  trip.completionSource = "gps-detected";
  trip.completionTimeEstimated = true;
  trip.completionTimeUnknown = false;
  // Do not set private mileage categories or manufacture distance/proof.
  trip.proof = { kind: "gps-detected", outcome: "gps-detected", method: "GPS-detected stop and departure — handoff not verified",
    recipient: "", recordedAt: iso(now), recordedBy: "Rivo auto-completion", media: trip.pendingProofMedia || {},
    location: s.lastPoint, locationStatus: "departure-recorded" };
  delete trip.pendingProofMedia;
  s.status = "completed";
  return trip;
}
