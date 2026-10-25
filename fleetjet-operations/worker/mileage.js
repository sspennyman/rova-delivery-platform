// Private GPS mileage is separate from delivery and payroll records.
const TZ = "America/Toronto";
const STOP_MS = 180_000;
const GAP_MS = 300_000;
const trim = (v, n = 240) => String(v ?? "").trim().slice(0, n);
const fail = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function localDay(at) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  return ["year", "month", "day"].map(k => p.find(v => v.type === k).value).join("-");
}
export function mileageWeek(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function km(a, b) {
  const rad = v => v * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function init(db) { db.mileageTrips ||= []; db.mileageReports ||= []; db.mileageTracking ||= {}; }
// Resolve ownership from the authenticated session, never from a request's driverId.
export function personalMileageDriverId(db, session) {
  const id = session?.role === "driver" ? session.driverId
    : session?.role === "dispatcher" && session.accountKey ? db.dispatcherDriverProfiles?.[session.accountKey] : null;
  return id && db.drivers.some(d => d.id === id && !d.archivedAt) ? id : null;
}
function tracking(db, id) { init(db); return db.mileageTracking[id] ||= { enabled: false, deviceId: "", lastSeq: 0, activeId: null }; }
export function mileageRate(db, driverId) {
  const value = db.drivers.find(d => d.id === driverId)?.defaultRate;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}
export function endpointLabel(value, point) {
  if (trim(value)) return trim(value);
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? `GPS: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : "";
}
export function reviewWarnings(trip) {
  // Discarded individual fixes do not make an otherwise continuous trip incomplete.
  return (trip.flags || []).filter(f => f !== "Some GPS fixes were unusable");
}
function privateTripView(t) { return { ...t, from: endpointLabel(t.from, t.start), to: endpointLabel(t.to, t.end), reviewWarnings: reviewWarnings(t) }; }
export function mileageSnapshot(db, driverId = null) {
  init(db);
  if (!driverId) return { timeZone: TZ, reports: db.mileageReports.filter(r => r.status !== "withdrawn").map(r => structuredClone(r)) };
  const { candidate, lastPoint, ...status } = tracking(db, driverId);
  const cutoff = Date.now() - 95 * 86400_000;
  return { timeZone: TZ, currency: "CAD", kmRate: mileageRate(db, driverId), preferences: { businessPurpose: trim(status.businessPurpose) }, week: mileageWeek(localDay(Date.now())), tracking: status, trips: db.mileageTrips.filter(t => t.driverId === driverId && (new Date(t.startedAt).getTime() >= cutoff || t.state === "recording")).map(privateTripView), reports: db.mileageReports.filter(r => r.driverId === driverId).map(r => structuredClone(r)) };
}
function flag(trip, text) { if (trip && !trip.flags.includes(text)) trip.flags.push(text); }
function appendPreviewPoint(record, point) {
  if (!record.previewPath && record.start) record.previewIncomplete = true;
  record.previewPath ||= [];
  const next = [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))];
  const last = record.previewPath.at(-1);
  if (last && last[0] === next[0] && last[1] === next[1]) return;
  record.previewPath.push(next);
  // This bounded visual sample never changes the full-resolution distance calculation.
  if (record.previewPath.length > 128) record.previewPath = record.previewPath.filter((_,index)=>index % 2 === 0);
}
export function finishTrip(db, s, reason) {
  const t = db.mileageTrips.find(t => t.id === s.activeId);
  if (t) { t.state = "complete"; t.endedAt = t.lastMovementAt || t.startedAt; t.distanceKm = Math.round(t.distanceKm * 1000) / 1000; if (reason) flag(t, reason); }
  s.activeId = null; s.candidate = null; s.lastPoint = null;
}
function point(raw, now) {
  const p = { lat: Number(raw.lat), lng: Number(raw.lng), accuracy: Number(raw.accuracy), speed: raw.speed == null ? null : Number(raw.speed), timestamp: new Date(Number(raw.at)).toISOString() };
  if (![p.lat, p.lng, p.accuracy].every(Number.isFinite) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180 || p.accuracy < 0 || p.accuracy > 60 || Number(raw.at) > now + 60_000 || Number(raw.at) < now - 14 * 86400_000) return null;
  return p;
}
export function ingestPoints(db, driverId, body, now = Date.now(), onLive = () => {}) {
  const s = tracking(db, driverId);
  if (!s.enabled || s.deviceId !== body.deviceId) fail("Tracking is paused or another device is selected. Enable tracking on this device first.", 409);
  if (!Array.isArray(body.points) || body.points.length > 100) fail("Send at most 100 GPS points per batch.");
  let rejected = 0;
  for (const raw of body.points.slice().sort((a, b) => a.seq - b.seq)) {
    if (!Number.isSafeInteger(raw.seq) || raw.seq < 1) fail("Invalid point sequence.");
    if (raw.seq <= s.lastSeq) continue;
    let p; try { p = point(raw, now); } catch { p = null; }
    s.lastSeq = raw.seq;
    let t = db.mileageTrips.find(t => t.id === s.activeId);
    if (!p || Number(raw.at) < new Date(s.enabledAt).getTime()) { rejected++; continue; }
    const previous = s.lastPoint;
    if (previous && p.timestamp <= previous.timestamp) { rejected++; continue; }
    const deltaMs = previous ? new Date(p.timestamp) - new Date(previous.timestamp) : 0;
    const distance = previous ? km(previous, p) : 0;
    if (previous && deltaMs <= GAP_MS && distance / (deltaMs / 3600_000) > 200) { rejected++; flag(t, "GPS jump omitted"); continue; }
    if (previous && deltaMs > GAP_MS) { finishTrip(db, s, "GPS gap: distance may be incomplete"); t = null; }
    s.lastFixAt = p.timestamp;
    // Replay restores the mileage log, but never moves a delivery map into the past.
    if (now - new Date(p.timestamp).getTime() < 90_000) onLive(p);
    if (!s.lastPoint) { s.lastPoint = p; s.candidate = { first: p, last: p, distanceKm: 0 }; appendPreviewPoint(s.candidate,p); continue; }
    const calculatedSpeed = distance / (deltaMs / 1000) * 1000;
    const speed = p.speed == null || p.speed < 0 ? calculatedSpeed : p.speed;
    const displacement = distance >= Math.max(0.01, Math.min(p.accuracy, previous.accuracy) / 1000);
    const moving = displacement && speed >= 2.2;
    if (t) {
      if (displacement && speed >= 0.5) { t.distanceKm += distance; t.end = p; t.lastMovementAt = p.timestamp; appendPreviewPoint(t,p); }
      else if (new Date(p.timestamp) - new Date(t.lastMovementAt) >= STOP_MS) finishTrip(db, s);
    } else {
      let c = s.candidate;
      if (!c || new Date(p.timestamp) - new Date(c.last.timestamp) > STOP_MS) { c = s.candidate = { first: previous, last: previous, distanceKm: 0 }; appendPreviewPoint(c,previous); }
      if (moving) { c.distanceKm += distance; c.last = p; appendPreviewPoint(c,p); }
      if (c.distanceKm >= 0.15 && km(c.first, p) >= 0.1) {
        const startedAt = c.first.timestamp;
        t = { id: crypto.randomUUID(), driverId, vehicle: trim(db.drivers.find(d => d.id === driverId)?.vehicle), source: s.source, state: "recording", category: "unclassified", purpose: "", from: "", to: "", startedAt, endedAt: null, lastMovementAt: p.timestamp, date: localDay(startedAt), week: mileageWeek(localDay(startedAt)), distanceKm: c.distanceKm, start: c.first, end: p, flags: [], audit: [] };
        t.previewPath = c.previewPath || [];
        db.mileageTrips.push(t); s.activeId = t.id; s.candidate = null;
      }
    }
    s.lastPoint = p;
  }
  s.lastUploadAt = new Date(now).toISOString(); s.rejectedFixes = (s.rejectedFixes || 0) + rejected;
  return { ack: s.lastSeq, rejected };
}
function locked(db, id) { return db.mileageReports.some(r => ["submitted", "approved"].includes(r.status) && r.items.some(t => t.id === id)); }
function csvCell(v) { let s = String(v ?? ""); if (/^[\s]*[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; }
export function mileageCsv(trips, report = null) {
  const rows = [["Date", "Vehicle", "From", "To", "Purpose", "Category", "Distance km", "Started", "Ended", "Source", "Quality notes", "Original GPS km", "Correction reason", "Rate CAD per km", "Reimbursement CAD", "Driver", "Report week"], ...trips.map(t => [t.date, t.vehicle, endpointLabel(t.from, t.start), endpointLabel(t.to, t.end), t.purpose, t.category, Number(t.distanceKm).toFixed(3), t.startedAt, t.endedAt, t.source, (t.flags || []).join("; "), t.originalGpsKm ?? "", t.correctionReason || "", t.kmRate ?? "", t.amount == null ? "" : Number(t.amount).toFixed(2), report?.driverName || "", report?.week || ""])];
  if (report) rows.push(["TOTAL", "", "", "", "", "business", Number(report.totalKm).toFixed(3), "", "", "", "", "", "", report.kmRate ?? "", report.totalAmount == null ? "" : Number(report.totalAmount).toFixed(2), report.driverName, report.week]);
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n");
}
function csvResponse(trips, suffix, report = null) { return new Response(mileageCsv(trips, report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rivo-mileage-${suffix}.csv"`, "Cache-Control": "no-store" } }); }
export async function handleMileage({ request, url, db, session, save, isDispatcher, onLive, prepareLive = async () => {} }) {
  const personal = /^\/api\/my-mileage(?:\/|$)/.test(url.pathname);
  if (!personal && !/^\/api\/mileage(?:\/|$)/.test(url.pathname)) return null;
  if (!session) return json({ error: "Sign in to access mileage." }, 401);
  init(db);
  const driverId = personal ? personalMileageDriverId(db, session) : session.role === "driver" ? session.driverId : null;
  if (personal && !driverId) return json({ error: "Open My Mileage and add your driver profile first.", code: "driver_profile_required" }, 403);
  if (personal) { url = new URL(url); url.pathname = url.pathname.replace("/api/my-mileage", "/api/mileage"); }
  if (!driverId && !isDispatcher(session)) return json({ error: "Access denied." }, 403);
  const method = request.method;
  try {
    if (method === "GET" && url.pathname === "/api/mileage") return json(mileageSnapshot(db, driverId));
    if (method === "GET" && url.pathname === "/api/mileage/export.csv") {
      if (!driverId) fail("Use the export on a submitted report.", 403);
      const year = url.searchParams.get("year"), week = url.searchParams.get("week");
      if (!(year && /^20\d\d$/.test(year)) && !(week && /^20\d\d-\d\d-\d\d$/.test(week))) fail("Choose a week or year.");
      return csvResponse(db.mileageTrips.filter(t => t.driverId === driverId && t.state === "complete" && (year ? t.date.startsWith(year) : t.week === week)), year || week);
    }
    const reportExport = url.pathname.match(/^\/api\/mileage\/reports\/([^/]+)\/export.csv$/);
    if (method === "GET" && reportExport) {
      const r = db.mileageReports.find(r => r.id === reportExport[1] && (driverId ? r.driverId === driverId : r.status !== "withdrawn"));
      if (!r) fail("Report not found.", 404);
      return csvResponse(r.items, r.week, r);
    }
    if (!["POST", "PATCH"].includes(method)) fail("Not found.", 404);
    if (!request.headers.get("content-type")?.includes("application/json")) fail("JSON required.", 415);
    const raw = await request.text(); if (raw.length > 50_000) fail("Request is too large.", 413);
    let body; try { body = JSON.parse(raw); } catch { fail("Invalid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid request.");
    if (driverId && method === "POST" && url.pathname === "/api/mileage/consent") {
      const s = tracking(db, driverId);
      if (body.enabled === true) {
        const deviceId = trim(body.deviceId, 100);
        if (!/^[a-zA-Z0-9-]{16,100}$/.test(deviceId)) fail("Invalid device identifier.");
        if (s.deviceId !== deviceId || !s.enabled) {
          finishTrip(db, s, "Tracking restarted or device changed; check endpoints");
          const sameDevice = s.deviceId === deviceId;
          s.lastSeq = sameDevice ? s.lastSeq : 0;
          if (!sameDevice || !s.enabledAt) s.enabledAt = new Date().toISOString();
          s.deviceId = deviceId;
        }
        s.enabled = true; s.source = ["android", "ios"].includes(body.source) ? body.source : "browser";
      } else {
        if (body.deviceId && body.deviceId !== s.deviceId) fail("Tracking is active on a different device.", 409);
        finishTrip(db, s, "Tracking was paused; check endpoints"); s.enabled = false; s.pausedAt = new Date().toISOString();
      }
      await save(); return json(mileageSnapshot(db, driverId));
    }
    if (driverId && method === "POST" && url.pathname === "/api/mileage/points") {
      const s = tracking(db, driverId);
      if (!s.enabled || s.deviceId !== body.deviceId) fail("Tracking is paused or another device is selected. Enable tracking on this device first.", 409);
      if (!Array.isArray(body.points) || body.points.length > 100) fail("Send at most 100 GPS points per batch.");
      if (body.points.some(p => Number(p.at) > Date.now() - 90000 && Number(p.at) <= Date.now() + 60000)) await prepareLive(driverId);
      const result = ingestPoints(db, driverId, body, Date.now(), p => onLive(driverId, p));
      await save(); return json(result);
    }
    if (driverId && method === "POST" && url.pathname === "/api/mileage/preferences") {
      if (typeof body.businessPurpose !== "string") fail("Enter a default business purpose, or leave it blank.");
      tracking(db, driverId).businessPurpose = trim(body.businessPurpose);
      await save(); return json(mileageSnapshot(db, driverId));
    }
    if (driverId && method === "POST" && url.pathname === "/api/mileage/review") {
      if (!Array.isArray(body.tripIds) || !body.tripIds.length || body.tripIds.length > 500 || new Set(body.tripIds).size !== body.tripIds.length) fail("Select between 1 and 500 trips.");
      if (!["business", "personal"].includes(body.category)) fail("Choose business or personal.");
      const selected = body.tripIds.map(id => db.mileageTrips.find(t => t.id === id && t.driverId === driverId));
      if (selected.some(t => !t)) fail("A selected trip was not found.", 404);
      if (selected.some(t => t.state !== "complete" || locked(db, t.id))) fail("Recording trips and submitted reports cannot be changed.", 409);
      // Validate the entire batch before changing anything.
      if (body.category === "business" && selected.some(t => !trim(body.purpose) && !trim(t.purpose))) fail("Add one business purpose for these trips.");
      if (body.category === "business" && selected.some(t => !endpointLabel(t.from, t.start) || !endpointLabel(t.to, t.end))) fail("A selected trip has no recorded start or destination. Add its details first.");
      const at = new Date().toISOString();
      for (const t of selected) {
        const before = { category: t.category, purpose: t.purpose, reviewedAt: t.reviewedAt || null };
        t.category = body.category;
        if (body.category === "business" && trim(body.purpose)) t.purpose = trim(body.purpose);
        if (!reviewWarnings(t).length || body.acknowledgeWarnings === true) t.reviewedAt = at;
        (t.audit ||= []).push({ at, action: "weekly-review", before, after: { category: t.category, purpose: t.purpose, reviewedAt: t.reviewedAt || null } });
      }
      await save(); return json(mileageSnapshot(db, driverId));
    }
    const tripMatch = url.pathname.match(/^\/api\/mileage\/trips\/([^/]+)$/);
    if (driverId && method === "POST" && url.pathname === "/api/mileage/trips") {
      const date = trim(body.date), distanceKm = Number(body.distanceKm);
      if (!/^20\d\d-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date || date > localDay(Date.now())) fail("Choose a valid trip date, today or earlier.");
      if (!(distanceKm > 0 && distanceKm <= 2000) || !trim(body.from) || !trim(body.to) || !trim(body.reason)) fail("Add a distance (up to 2,000 km), start, destination and reason for the manual entry.");
      const at = `${date}T12:00:00.000Z`;
      db.mileageTrips.push({ id: crypto.randomUUID(), driverId, vehicle: trim(db.drivers.find(d => d.id === driverId)?.vehicle), source: "manual", state: "complete", category: "unclassified", purpose: "", from: trim(body.from), to: trim(body.to), date, week: mileageWeek(date), startedAt: at, endedAt: at, distanceKm: Math.round(distanceKm * 1000) / 1000, start: null, end: null, flags: ["Manually entered; not GPS verified"], correctionReason: trim(body.reason), reviewedAt: new Date().toISOString(), audit: [{ at: new Date().toISOString(), action: "manual-entry", reason: trim(body.reason) }] });
      await save(); return json(mileageSnapshot(db, driverId), 201);
    }
    if (driverId && method === "PATCH" && tripMatch) {
      const t = db.mileageTrips.find(t => t.id === tripMatch[1] && t.driverId === driverId);
      if (!t) fail("Trip not found.", 404);
      if (t.state !== "complete") fail("This trip is still recording.");
      if (locked(db, t.id)) fail("Withdraw the submitted report before editing. Approved reports are locked.", 409);
      if (body.category !== undefined && !["business", "personal", "unclassified"].includes(body.category)) fail("Choose business or personal.");
      const before = { category: t.category, purpose: t.purpose, from: t.from, to: t.to, distanceKm: t.distanceKm, reviewedAt: t.reviewedAt || null };
      if (body.distanceKm !== undefined && Number(body.distanceKm) !== t.distanceKm) {
        const distanceKm = Number(body.distanceKm);
        if (!(distanceKm > 0 && distanceKm <= 2000) || !trim(body.correctionReason)) fail("A distance correction needs a positive distance (up to 2,000 km) and an explanation.");
        if (t.originalGpsKm === undefined && t.source !== "manual") t.originalGpsKm = t.distanceKm;
        t.distanceKm = Math.round(distanceKm * 1000) / 1000; t.correctionReason = trim(body.correctionReason); flag(t, "Distance corrected by driver");
      }
      for (const key of ["category", "purpose", "from", "to"]) if (body[key] !== undefined) t[key] = trim(body[key]);
      if (body.reviewed === true) t.reviewedAt = new Date().toISOString();
      t.audit.push({ at: new Date().toISOString(), before, after: { category: t.category, purpose: t.purpose, from: t.from, to: t.to, distanceKm: t.distanceKm, correctionReason: t.correctionReason || "", reviewedAt: t.reviewedAt || null } });
      await save(); return json(mileageSnapshot(db, driverId));
    }
    if (driverId && method === "POST" && url.pathname === "/api/mileage/reports") {
      if (!/^20\d\d-\d\d-\d\d$/.test(body.week || "") || !Number.isFinite(Date.parse(`${body.week}T12:00:00Z`)) || mileageWeek(body.week) !== body.week) fail("Choose a report week starting Monday.");
      const items = db.mileageTrips.filter(t => t.driverId === driverId && t.week === body.week);
      if (!items.length) fail("No trips in this week.");
      if (items.some(t => t.state !== "complete")) fail("Wait for the active trip to finish or pause tracking first.");
      if (items.some(t => t.category === "unclassified")) fail("Classify every trip in this week first.");
      const business = items.filter(t => t.category === "business");
      if (!business.length) fail("There are no business trips to submit. Personal trips remain private.");
      if (business.some(t => !endpointLabel(t.from, t.start) || !endpointLabel(t.to, t.end) || !t.purpose || reviewWarnings(t).length && !t.reviewedAt)) fail("Add any missing business purpose or endpoints, and check the trips with GPS gaps before submitting.");
      if (db.mileageReports.some(r => r.driverId === driverId && r.week === body.week && ["submitted", "approved"].includes(r.status))) fail("This week already has a submitted report.", 409);
      const driver = db.drivers.find(d => d.id === driverId);
      const kmRate = mileageRate(db, driverId);
      if (kmRate === null) fail("Ask dispatch to set your per-km rate in your driver profile before submitting.");
      if (body.expectedKmRate !== undefined && Number(body.expectedKmRate) !== kmRate) fail("Your per-km rate changed. Refresh the report and confirm the new amount before submitting.", 409);
      const reportItems = business.map(t => {
        const { audit, ...item } = privateTripView(t);
        return structuredClone({ ...item, kmRate, amount: Math.round(t.distanceKm * kmRate * 100) / 100 });
      });
      db.mileageReports.push({ id: crypto.randomUUID(), driverId, driverName: trim(driver?.name), week: body.week, timeZone: TZ, currency: "CAD", kmRate, totalAmount: Number(reportItems.reduce((a, t) => a + t.amount, 0).toFixed(2)), status: "submitted", submittedAt: new Date().toISOString(), totalKm: Number(business.reduce((a, t) => a + t.distanceKm, 0).toFixed(3)), items: reportItems, audit: [] });
      await save(); return json(mileageSnapshot(db, driverId), 201);
    }
    const reportMatch = url.pathname.match(/^\/api\/mileage\/reports\/([^/]+)$/);
    if (method === "PATCH" && reportMatch) {
      const r = db.mileageReports.find(r => r.id === reportMatch[1]);
      if (!r || driverId && r.driverId !== driverId) fail("Report not found.", 404);
      if (driverId) {
        if (body.status !== "withdrawn" || r.status !== "submitted") fail("Only a pending report can be withdrawn.", 409);
      } else {
        if (r.status !== "submitted" || !["approved", "rejected"].includes(body.status)) fail("Only pending reports can be approved or returned.", 409);
        if (body.status === "rejected" && !trim(body.note)) fail("Explain what the driver should correct.");
      }
      r.audit.push({ at: new Date().toISOString(), from: r.status, to: body.status, by: session.name, note: trim(body.note) });
      r.status = body.status; r.note = trim(body.note);
      await save(); return json(mileageSnapshot(db, driverId));
    }
    fail("Not found.", 404);
  } catch (error) { if (!error.status) throw error; return json({ error: error.message }, error.status); }
}
