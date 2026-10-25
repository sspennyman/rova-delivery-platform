import {createTripMaps, tripMapHtml, tripPlaceLabel} from "./trip-maps.js?v=99";
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const km = v => `${Number(v || 0).toFixed(1)} km`;
const money = v => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(v || 0));
const rateMoney = v => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(v || 0));
const warnings = t => t.reviewWarnings || (t.flags || []).filter(f => f !== "Some GPS fixes were unusable");
const coord = p => p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : "Unknown";
const dayLabel = v => new Date(`${v}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const weekOf = v => { const d = new Date(`${v}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
function queueDb() {
  return new Promise((resolve, reject) => { const r = indexedDB.open("rivo-private-mileage", 1); r.onupgradeneeded = () => r.result.createObjectStore("points", { keyPath: "id" }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function queue(action, value) {
  const db = await queueDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("points", action === "all" ? "readonly" : "readwrite");
    const s = tx.objectStore("points"); let r;
    if (action === "put") r = s.put(value);
    else if (action === "all") r = s.getAll();
    else for (const id of value) s.delete(id);
    tx.oncomplete = () => { db.close(); resolve(r?.result); }; tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export function createMileageUI({ api, getAuth, getData, setData, render, toast, requestText, personal = false, navigate, loadMap }) {
  const ownsTarget = target => Boolean(target.closest?.("[data-personal-mileage]")) === personal;
  let selectedWeek = "", filter = "all", watch = null, owner = "", sending = false, lastFix = 0, lastAcceptedFix = 0, status = "", seq = 0, blockedToken = null;
  const selected = new Set();
  const ios = /RivoIOS\//.test(navigator.userAgent);
  const native = ios || /RivoAndroid\//.test(navigator.userAgent);
  let deviceId;
  try { deviceId = localStorage.getItem("rivoMileageDevice") || crypto.randomUUID(); localStorage.setItem("rivoMileageDevice", deviceId); } catch { deviceId = crypto.randomUUID(); }
  const data = () => getData() || { trips: [], reports: [], tracking: {} };
  const week = () => selectedWeek || data().week || weekOf(new Date().toISOString().slice(0, 10));
  const trips = () => (data().trips || []).filter(t => t.week === week()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const tripMaps = createTripMaps({loadMap,getTrips:trips,personal});
  const locked = id => (data().reports || []).some(r => ["submitted", "approved"].includes(r.status) && r.items.some(t => t.id === id));
  const btn = (action, label, extra = "", secondary = true) => `<button class="button${secondary ? " secondary" : ""}" type="button" data-mileage="${action}" ${extra}>${label}</button>`;
  function stop() { if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; owner = ""; }
  function refreshStatus() { document.querySelectorAll("[data-mileage-status]").forEach(el => { if (ownsTarget(el)) el.textContent = trackingText(); }); }
  function trackingText() {
    const s = data().tracking || {};
    if (!s.enabled) return "Auto-track is off";
    const local = !native && s.deviceId === deviceId;
    const age = Date.now() - Math.max(Date.parse(s.lastFixAt || "") || 0, local ? lastAcceptedFix : 0);
    if (local && status && !/GPS connected|Weak GPS|Offline · saving/.test(status)) return status;
    if (age > 120_000) return "No recent GPS — check the tracking phone";
    if (local && !navigator.onLine) return "Offline · trips are saving on this device";
    return s.activeId ? "Auto-track on · recording your drive" : "Auto-track on · ready when you drive";
  }
  async function flush() {
    const auth = getAuth();
    if (!auth || auth.role !== "driver" || sending || !navigator.onLine || blockedToken && blockedToken === auth.token) return;
    const s = data().tracking || {};
    if (!s.enabled || s.deviceId !== deviceId) return;
    sending = true;
    try {
      const points = (await queue("all")).filter(p => p.driverId === auth.driverId && p.deviceId === deviceId).sort((a, b) => a.seq - b.seq).slice(0, 100);
      if (!points.length) return;
      if (getAuth()?.driverId !== auth.driverId || getAuth()?.token !== auth.token || !data().tracking?.enabled || data().tracking?.deviceId !== deviceId) return;
      const result = await api("/api/mileage/points", { method: "POST", body: { deviceId, points } });
      await queue("delete", points.filter(p => p.seq <= result.ack).map(p => p.id));
      status = result.rejected ? "Weak GPS fixes skipped · tracking continues" : "GPS connected · mileage saving automatically";
    } catch (e) { status = e.status === 401 ? "Sign in again to resume tracking" : "Saved on this device · waiting to sync"; if (e.status === 401) { blockedToken = auth.token; stop(); } }
    finally { sending = false; refreshStatus(); }
  }
  function start() {
    const auth = getAuth(), s = data().tracking || {};
    if (native || !auth || auth.role !== "driver" || !s.enabled || s.deviceId !== deviceId || blockedToken && blockedToken === auth.token || auth.expiresAt && Date.now() >= new Date(auth.expiresAt).getTime()) { stop(); return; }
    if (watch !== null && owner === auth.driverId) return;
    stop(); owner = auth.driverId; status = ""; lastAcceptedFix = 0;
    if (!navigator.geolocation) { status = "Location is unavailable in this browser"; return; }
    watch = navigator.geolocation.watchPosition(async position => {
      if (getAuth()?.driverId !== owner || Date.now() - lastFix < 8000) return;
      lastFix = Date.now();
      if (![position.coords.latitude, position.coords.longitude, position.coords.accuracy].every(Number.isFinite) || position.coords.accuracy > 60 || position.coords.accuracy < 0 || Math.abs(Date.now() - position.timestamp) > 60000) { status = "Weak GPS · waiting for an accurate location"; refreshStatus(); return; }
      lastAcceptedFix = position.timestamp;
      const driverId = owner;
      try {
        const pending = await queue("all");
        if (getAuth()?.driverId !== driverId || owner !== driverId || !data().tracking?.enabled) return;
        if (pending.length >= 20000) { stop(); status = "Storage queue full — connect to the internet before tracking again"; refreshStatus(); return; }
        seq = Math.max(Date.now(), seq + 1, (data().tracking?.lastSeq || 0) + 1);
        await queue("put", { id: `${driverId}:${deviceId}:${seq}`, driverId, deviceId, seq, at: position.timestamp, lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, speed: position.coords.speed });
        status = navigator.onLine ? "GPS connected · mileage saving automatically" : "Offline · saving on this device";
        refreshStatus(); flush();
      } catch { stop(); status = "Device storage unavailable — tracking stopped"; refreshStatus(); }
    }, error => { status = error.code === 1 ? "Location blocked — allow location in your browser settings" : "GPS signal unavailable — keep the app open"; if (error.code === 1) stop(); refreshStatus(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
  }
  function weekPicker() { return `<label class="mileage-week">Week of ${h(dayLabel(week()))}<input class="input" type="date" data-mileage-week value="${h(week())}" aria-label="Choose a date in the report week"></label>`; }
  function summaryHtml() {
    // Native headers already show status; controls live in Settings.
    if (native) return "";
    const s = data().tracking || {};
    const sourceText = s.enabled && ["android", "ios"].includes(s.source)
      ? `Tracking phone: ${s.source === "ios" ? "iPhone" : "Android"} app · check the latest GPS status above.`
      : native ? "Enable Auto-track once using the settings at the top of this app." : "Browser tracking is foreground only. Locked-screen tracking needs the native companion.";
    return `<div class="panel mileage-tracking"><div><p class="eyebrow">Automatic mileage</p><h3 data-mileage-status>${h(trackingText())}</h3><p>${sourceText}</p></div><div class="mileage-actions">${btn("open-settings", s.enabled ? "Tracking settings" : "Set up auto-track", "", !s.enabled ? false : true)}</div></div>`;
  }
  function settingsHtml() {
    const s = data().tracking || {};
    const seen = s.lastFixAt ? new Date(s.lastFixAt).toLocaleString("en-CA", { timeZone: "America/Toronto" }) : "No GPS received yet";
    const sourceLabel = { android: "Android tracking app", ios: "iPhone tracking app", browser: "Web browser (must stay open)" };
    const nativeHelp = ios
      ? "Open the gear-shaped Settings button at the top of the iPhone app. Enable Always and Precise Location once. Turn Auto-track off in Settings to pause immediately, including offline."
      : "Open Settings using the gear at the top of the Android app, then enable Auto-track. Allow precise location and notifications once. The ongoing tracking notification shows whether the service is recording.";
    return `${window.RivoAppearance?.settingsHtml() || ""}<div class="panel mileage-settings"><h3>Auto-track</h3><p data-mileage-status>${h(trackingText())}</p><dl class="mileage-health"><div><dt>Recording source</dt><dd>${s.enabled ? sourceLabel[s.source] || "Unknown tracking source" : "Not enabled"}</dd></div><div><dt>Last GPS received · Toronto time</dt><dd>${h(seen)}</dd></div></dl>${native ? `<p>${nativeHelp}</p>` : `<p><strong>For tracking with the screen locked:</strong> use the native Rivo tracking app. A browser or installed website shortcut cannot provide reliable background recording.</p><p>Android companion: pilot build available for phone testing. The iPhone companion is in local development, not released. iPhone background tracking is not available in this web app.</p><details><summary>Use browser tracking while Rivo stays open</summary><p>Screen lock, switching apps or closing Rivo can stop browser recording.</p>${btn("enable", "Enable browser tracking")}</details>`}<div class="mileage-actions">${s.enabled && !native ? btn("pause", "Pause auto-track") : ""}</div><p class="privacy-copy">After enabling, detected drives start and finish automatically. Personal trips stay private. You choose which business trips to submit. Force-stop, battery restrictions, sign-out or revoked permissions can stop capture.</p></div><form class="panel mileage-settings" data-mileage-preferences><h3>Faster classification</h3><label>Default business purpose<input class="input" name="businessPurpose" maxlength="240" value="${h(data().preferences?.businessPurpose || "")}" placeholder="e.g. Customer deliveries"></label><p>Used only when you choose Business. Nothing is automatically marked business.</p><button class="button" type="submit">Save preference</button><p class="mileage-error" role="alert"></p></form>`;
  }
  const editable = t => t.state === "complete" && !locked(t.id);
  const inFilter = t => filter === "all" || (filter === "warnings" ? warnings(t).length && !t.reviewedAt : t.category === filter);
  function tripListHtml() {
    const list = trips(), visible = list.filter(inFilter), available = visible.filter(editable);
    const chosen = list.filter(t => editable(t) && selected.has(t.id));
    const labels = { all: "All", unclassified: "To classify", business: "Business", personal: "Personal", warnings: "GPS gaps / corrections" };
    return `<div class="mileage-tabs" aria-label="Filter trips">${Object.entries(labels).map(([f, label]) => btn("filter", `${label} · ${list.filter(t => f === "all" || (f === "warnings" ? warnings(t).length && !t.reviewedAt : t.category === f)).length}`, `data-filter="${f}" aria-pressed="${filter === f}"`)).join("")}</div>
      ${available.length || chosen.length ? `<div class="mileage-bulk"><label class="mileage-select"><input type="checkbox" data-mileage-all ${available.length && available.every(t => selected.has(t.id)) ? "checked" : ""}>Select all shown</label><span>${chosen.length} selected</span><div class="mileage-actions">${btn("bulk-business", "Mark business", chosen.length ? "" : "disabled", false)}${btn("bulk-personal", "Mark personal", chosen.length ? "" : "disabled")}${chosen.length ? btn("clear", "Clear") : ""}</div></div>` : ""}
      <div class="mileage-trip-list">${visible.length ? visible.map(t => `<article class="panel mileage-trip mileage-compact-trip"><div class="mileage-trip-content">${tripMapHtml(t)}<div class="mileage-trip-info"><div class="mileage-trip-top">${editable(t) ? `<label class="mileage-select"><input type="checkbox" data-mileage-select="${h(t.id)}" aria-label="Select trip on ${h(t.date)} from ${h(tripPlaceLabel(t.from, "Start location"))}" ${selected.has(t.id) ? "checked" : ""}></label>` : ""}<div class="mileage-route"><span class="eyebrow">${h(dayLabel(t.date))} · ${h(new Date(t.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }))}</span><h3>${h(tripPlaceLabel(t.from, "Start location"))} <span aria-label="to">→</span> ${h(tripPlaceLabel(t.to, "Finish location"))}</h3><p>${h(t.purpose || (t.state === "recording" ? "Recording automatically" : t.source === "manual" ? "Manually entered trip" : "Recorded automatically"))}</p></div><strong class="mileage-distance">${km(t.distanceKm)}</strong></div>${warnings(t).length ? `<details class="mileage-quality"><summary>${t.reviewedAt ? "GPS note checked" : "Check GPS gap / correction"}</summary><p>${h(warnings(t).join(" · "))}</p></details>` : ""}<div class="mileage-actions"><span class="count-chip">${h(t.state === "recording" ? "Recording" : locked(t.id) ? `${t.category} · Submitted` : t.category === "unclassified" ? "Saved · choose category" : t.category)}</span>${editable(t) ? `${btn("business", "Business", `data-id="${h(t.id)}" aria-pressed="${t.category === "business"}"`)}${btn("personal", "Personal", `data-id="${h(t.id)}" aria-pressed="${t.category === "personal"}"`)}${btn("edit", "Details", `data-id="${h(t.id)}"`)}` : ""}</div></div></div></article>`).join("") : `<div class="panel empty">${list.length ? "No trips in this category." : "No drives recorded this week. Check that Auto-track is enabled on the tracking phone. Missing GPS cannot be recreated; use Add a missed drive only if you have reliable distance records."}</div>`}</div>`;
  }
  function tripsHtml() {
    const list = trips(), total = category => list.filter(t => t.category === category).reduce((sum, t) => sum + t.distanceKm, 0);
    const recorded = list.reduce((sum, trip) => sum + trip.distanceKm, 0);
    const unclassified = total("unclassified");
    return `<div class="mileage-header"><div><h2 class="section-title">Trips</h2><p>${list.length} trip${list.length === 1 ? "" : "s"} saved this week. Your choice what to share.</p></div>${weekPicker()}</div><div class="mileage-week-summary"><div><strong>${km(recorded)}</strong><span>Total recorded</span></div><div><strong>${km(total("business"))}</strong><span>Business</span></div><div><strong>${km(total("personal"))}</strong><span>Personal</span></div><div>${btn("open-report", "Review &amp; submit week", "", false)}</div></div>${unclassified > 0 ? `<p class="mileage-readiness" role="status">${km(unclassified)} recorded and waiting for Business or Personal classification. It is included in Total recorded.</p>` : ""}${tripListHtml()}`;
  }
  function reportState() {
    const list = trips(), business = list.filter(t => t.category === "business"), report = (data().reports || []).find(r => r.week === week() && ["submitted", "approved"].includes(r.status));
    const kmRate = report ? report.kmRate : data().kmRate;
    const rateSet = kmRate !== null && kmRate !== undefined && Number.isFinite(Number(kmRate));
    const totalKm = report ? report.totalKm : business.reduce((a, t) => a + t.distanceKm, 0);
    const totalAmount = report ? report.totalAmount : rateSet ? business.reduce((a, t) => a + Math.round(t.distanceKm * kmRate * 100) / 100, 0) : null;
    const unclassified = list.filter(t => t.category === "unclassified").length;
    const issues = business.filter(t => !t.purpose || !t.from && !t.start || !t.to && !t.end || warnings(t).length && !t.reviewedAt).length;
    const recording = list.some(t => t.state !== "complete");
    return { list, business, report, kmRate, rateSet, totalKm, totalAmount, unclassified, issues, recording, ready: business.length > 0 && !unclassified && !issues && !recording && rateSet };
  }
  function reportHtml() {
    const s = reportState(), { list, report, unclassified } = s;
    const year = week().slice(0, 4);
    const pending = [unclassified ? `${unclassified} to classify` : "", s.issues ? `${s.issues} business trip${s.issues === 1 ? "" : "s"} to check` : "", s.recording ? "A trip is still recording" : "", !s.rateSet ? "Dispatch needs to set your per-km rate" : ""].filter(Boolean);
    return `<div class="mileage-header"><div><p class="eyebrow">Monday–Sunday · Toronto time</p><h2 class="section-title">Weekly mileage report</h2><p>Select trips below, mark business or personal, then submit once.</p></div>${weekPicker()}</div><div class="panel mileage-report"><div class="mileage-totals"><div><strong>${km(s.totalKm)}</strong><span>Business distance</span></div><div><strong>${s.rateSet ? `${rateMoney(s.kmRate)}/km` : "Not set"}</strong><span>Driver’s saved rate · CAD</span></div><div><strong>${s.totalAmount == null ? "—" : money(s.totalAmount)}</strong><span>Reimbursement · CAD</span></div></div>${!report ? `<p class="mileage-readiness" role="status">${pending.length ? h(pending.join(" · ")) : s.ready ? "Ready to submit. Personal trips will stay private." : "No business mileage to submit yet."}</p>` : ""}<div class="mileage-actions">${report ? `<span class="count-chip">${h(report.status)} · ${h(dayLabel(report.week))}</span>${report.status === "submitted" ? btn("withdrawn", "Withdraw to edit", `data-report="${h(report.id)}"`) : ""}<a class="button" href="/api/mileage/reports/${h(report.id)}/export.csv">Download report with rate</a>` : btn("submit", "Submit weekly report", s.ready ? "" : "disabled", false)}<a class="button secondary" href="/api/mileage/export.csv?year=${year}">Download ${year} trip log</a></div><p class="privacy-copy">GPS mileage reimbursement is separate from delivery payments. Do not add both for the same driving. Rate and amounts are saved with the submitted report.</p></div>${tripListHtml()}<div class="mileage-actions mileage-legacy">${btn("manual", "Add a missed drive")}<a class="button secondary" href="/api/mileage/export.csv?week=${h(week())}">Download private trip log</a></div><details class="mileage-legacy"><summary>Submitted reports &amp; year-end records</summary><p>Keep vehicle opening and closing odometer readings with your records. Classifying a drive as business does not by itself establish tax eligibility.</p>${reportsHtml(false)}</details>`;
  }
  function reportsHtml(dispatcher) {
    const reports = (data().reports || []).slice().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return reports.length ? `<div class="mileage-trip-list">${reports.map(r => `<article class="panel mileage-trip"><div class="mileage-trip-top"><div><p class="eyebrow">${dispatcher ? h(r.driverName) : "Business mileage"}</p><h3>Week of ${h(dayLabel(r.week))}</h3><p>${r.items.length} business trips · ${h(r.status)}</p><p>${r.kmRate == null ? "Historical report · rate was not saved" : `${rateMoney(r.kmRate)}/km · ${money(r.totalAmount)} reimbursement (CAD)`}</p>${r.note ? `<p>${h(r.note)}</p>` : ""}</div><strong class="mileage-distance">${km(r.totalKm)}</strong></div><details><summary>Reported trips &amp; amounts</summary>${r.items.map(t => `<p><strong>${h(t.date)} · ${km(t.distanceKm)}${t.amount == null ? "" : ` · ${rateMoney(t.kmRate)}/km · ${money(t.amount)}`}</strong><br>${h(t.from)} → ${h(t.to)}<br>${h(t.purpose)}${t.flags.length ? `<br>GPS notes: ${h(t.flags.join("; "))}` : ""}</p>`).join("")}</details><div class="mileage-actions"><a class="button secondary" href="/api/mileage/reports/${h(r.id)}/export.csv">Download report</a>${dispatcher && r.status === "submitted" ? btn("approved", "Approve", `data-report="${h(r.id)}"`, false) + btn("rejected", "Return for correction", `data-report="${h(r.id)}"`) : ""}</div></div></div></article>`).join("")}</div>` : `<div class="panel empty">No mileage reports submitted yet.</div>`;
  }
  function dispatchHtml() { return `<div class="mileage-header"><div><p class="eyebrow">Driver-submitted mileage</p><h2 class="section-title">Weekly mileage reports</h2><p>Business trips only. Personal trips stay private. Mileage approval here does not create a payroll payment.</p></div></div>${reportsHtml(true)}<h3 class="mileage-legacy-title">Delivery payment records</h3>`; }
  async function update(path, body, method = "POST") { const next = await api(path, { method, body }); setData(next); render(); return next; }
  function reviewBusiness(items) {
    if (!items.length) return;
    const needsCheck = items.filter(t => warnings(t).length && !t.reviewedAt);
    const purposes = [...new Set(items.map(t => t.purpose || data().preferences?.businessPurpose).filter(Boolean))];
    const dialog = document.createElement("dialog"); dialog.className = "mileage-dialog";
    dialog.innerHTML = `<form><h2>${items.length === 1 ? "Business trip" : `${items.length} business trips`}</h2><p>${km(items.reduce((a, t) => a + t.distanceKm, 0))} · Recorded starts and destinations are already included.</p><label>Business purpose for these trips<input class="input" name="purpose" required maxlength="240" value="${h(purposes.length === 1 ? purposes[0] : "")}" placeholder="e.g. Customer deliveries"></label>${needsCheck.length ? `<div class="mileage-warning"><strong>${needsCheck.length} trip${needsCheck.length === 1 ? " has" : "s have"} GPS notes</strong>${needsCheck.map(t => `<p>${h(dayLabel(t.date))} · ${km(t.distanceKm)} · ${h(warnings(t).join("; "))}</p>`).join("")}</div><label class="mileage-check"><input type="checkbox" name="acknowledgeWarnings">I checked these distances and endpoints against my records.</label><p>You can leave this unchecked and correct those trips later. Missing GPS distance is never filled in automatically.</p>` : ""}<p class="mileage-error" role="alert"></p><div class="mileage-actions"><button class="button" type="submit">Save ${items.length === 1 ? "trip" : `${items.length} trips`}</button><button class="button secondary" type="button" data-close>Cancel</button></div></form>`;
    document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove(); dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = async event => {
      event.preventDefault(); const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
      const form = new FormData(event.currentTarget);
      try { await update("/api/mileage/review", { tripIds: items.map(t => t.id), category: "business", purpose: form.get("purpose"), acknowledgeWarnings: form.get("acknowledgeWarnings") === "on" }); selected.clear(); render(); dialog.close(); toast(`${items.length} trip${items.length === 1 ? "" : "s"} marked business`); } catch (e) { dialog.querySelector(".mileage-error").textContent = e.message; button.disabled = false; }
    };
  }
  function confirmReport() {
    const s = reportState(); if (!s.ready || s.report) return;
    const dialog = document.createElement("dialog"); dialog.className = "mileage-dialog";
    dialog.innerHTML = `<h2>Submit this week?</h2><p>${h(dayLabel(week()))} · ${s.business.length} business trips</p><p><strong>${km(s.totalKm)} · ${rateMoney(s.kmRate)}/km</strong><br>Reimbursement: <strong>${money(s.totalAmount)} CAD</strong></p><p>I have checked the business trips, purposes and distances. Only these business trips will be shared with dispatch; personal trips stay private.</p><p class="mileage-error" role="alert"></p><div class="mileage-actions"><button class="button" data-confirm>Confirm &amp; submit</button><button class="button secondary" data-close>Cancel</button></div>`;
    document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove(); dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-confirm]").onclick = async () => {
      const button = dialog.querySelector("[data-confirm]"); button.disabled = true;
      try { await update("/api/mileage/reports", { week: week(), expectedKmRate: s.kmRate }); selected.clear(); dialog.close(); toast("Weekly report submitted with rate and reimbursement. Personal trips stayed private."); } catch (e) { dialog.querySelector(".mileage-error").textContent = e.message; button.disabled = false; }
    };
  }
  function editTrip(t, category = t.category) {
    const dialog = document.createElement("dialog"); dialog.className = "mileage-dialog";
    dialog.innerHTML = `<form><h2>Review trip</h2><p>${h(t.date)} · ${km(t.distanceKm)} · ${h(coord(t.start))} → ${h(coord(t.end))}</p><label>Category<select class="select" name="category">${["unclassified", "business", "personal"].map(c => `<option ${c === category ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Start / departure<input class="input" name="from" maxlength="240" value="${h(t.from)}" placeholder="e.g. Depot, Ottawa"></label><label>Destination<input class="input" name="to" maxlength="240" value="${h(t.to)}" placeholder="e.g. Client address"></label><label>Business purpose<input class="input" name="purpose" maxlength="240" value="${h(t.purpose)}" placeholder="e.g. Deliver flowers to customer"></label>${t.flags.length ? `<p class="mileage-warning">${h(t.flags.join(" · "))}</p><label class="mileage-check"><input type="checkbox" name="reviewed" ${t.reviewedAt ? "checked" : ""}>I reviewed this distance and the GPS warnings.</label>` : ""}<p class="mileage-error" role="alert"></p><div class="mileage-actions"><button class="button" type="submit">Save trip</button><button class="button secondary" type="button" data-close>Cancel</button></div></form>`;
    dialog.querySelector(".mileage-error").insertAdjacentHTML("beforebegin", `<details><summary>Correct a missing or inaccurate distance</summary><p>Use a reliable odometer reading or other record. The original GPS distance and your explanation are retained.</p><label>Distance (km)<input class="input" name="distanceKm" type="number" min="0.001" max="2000" step="0.001" value="${Number(t.distanceKm).toFixed(3)}"></label><label>Reason for correction<input class="input" name="correctionReason" maxlength="240" value="${h(t.correctionReason || "")}"></label>${t.flags.length ? "" : '<label class="mileage-check"><input type="checkbox" name="reviewed">I checked the corrected distance against my records.</label>'}</details>`);
    document.body.append(dialog); dialog.showModal(); dialog.addEventListener("close", () => dialog.remove()); dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = async event => {
      event.preventDefault(); const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
      const body = Object.fromEntries(new FormData(event.currentTarget)); body.reviewed = body.reviewed === "on";
      try { await update(`/api/mileage/trips/${t.id}`, body, "PATCH"); dialog.close(); toast("Trip saved"); } catch (e) { dialog.querySelector(".mileage-error").textContent = e.message; button.disabled = false; }
    };
  }
  function consent() {
    const dialog = document.createElement("dialog"); dialog.className = "mileage-dialog";
    dialog.innerHTML = `<h2>Enable automatic mileage?</h2><p>Rivo will record all detected drives while this browser remains open and you are signed in. This includes personal driving. You can pause at any time.</p><p>Trips stay private until you submit business mileage. During assigned deliveries, dispatch and the delivery tracking link can see your live delivery location.</p><p><strong>Browser limit:</strong> locking the screen or switching apps can stop recording. Use the Android companion for locked-screen tracking. A normal home-screen shortcut is still a browser.</p><div class="mileage-actions"><button class="button" data-allow>Enable &amp; allow location</button><button class="button secondary" data-cancel>Cancel</button></div><p class="mileage-error" role="alert"></p>`;
    document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove(); dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-allow]").onclick = async () => {
      const button = dialog.querySelector("[data-allow]"); button.disabled = true;
      try { await update("/api/mileage/consent", { enabled: true, deviceId, source: "browser" }); status = "Waiting for location permission"; start(); dialog.close(); } catch (e) { dialog.querySelector(".mileage-error").textContent = e.message; button.disabled = false; }
    };
  }
  function manualTrip() {
    const dialog = document.createElement("dialog"); dialog.className = "mileage-dialog";
    dialog.innerHTML = `<form><h2>Add a missed drive</h2><p>This will be marked as a manual record, not GPS tracking. Use an odometer reading or another reliable record.</p><label>Trip date<input class="input" type="date" name="date" value="${h(new Date().toLocaleDateString("en-CA"))}" required></label><label>Start<input class="input" name="from" maxlength="240" required></label><label>Destination<input class="input" name="to" maxlength="240" required></label><label>Distance (km)<input class="input" type="number" min="0.001" max="2000" step="0.001" name="distanceKm" required></label><label>Why is this entry manual?<input class="input" name="reason" maxlength="240" required placeholder="e.g. GPS was off; used odometer readings"></label><p class="mileage-error" role="alert"></p><div class="mileage-actions"><button class="button" type="submit">Add trip to review</button><button class="button secondary" type="button" data-close>Cancel</button></div></form>`;
    document.body.append(dialog); dialog.showModal(); dialog.onclose = () => dialog.remove(); dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = async event => {
      event.preventDefault(); const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
      try { const body = Object.fromEntries(new FormData(event.currentTarget)); selectedWeek = weekOf(body.date); await update("/api/mileage/trips", body); dialog.close(); toast("Manual trip added. Choose business or personal."); } catch (e) { dialog.querySelector(".mileage-error").textContent = e.message; button.disabled = false; }
    };
  }
  document.addEventListener("change", e => {
    if (!ownsTarget(e.target)) return;
    if (e.target.matches("[data-mileage-week]") && e.target.value) { selectedWeek = weekOf(e.target.value); selected.clear(); render(); }
    if (e.target.matches("[data-mileage-select]")) { if (e.target.checked) selected.add(e.target.dataset.mileageSelect); else selected.delete(e.target.dataset.mileageSelect); render(); }
    if (e.target.matches("[data-mileage-all]")) { for (const t of trips().filter(t => editable(t) && inFilter(t))) { if (e.target.checked) selected.add(t.id); else selected.delete(t.id); } render(); }
  });
  document.addEventListener("click", async e => {
    if (!ownsTarget(e.target)) return;
    const button = e.target.closest("[data-mileage]"); if (!button) return;
    const action = button.dataset.mileage, id = button.dataset.id;
    if (navigate && ["open-trips", "open-report", "open-settings"].includes(action)) { navigate(action); return; }
    if (action === "filter") { filter = button.dataset.filter; render(); return; }
    if (action === "open-trips") { document.querySelector('a[href="#trips"]')?.click(); location.hash = "trips"; return; }
    if (action === "open-report") { document.querySelector('a[href="#report"]')?.click(); location.hash = "report"; return; }
    if (action === "clear") { selected.clear(); render(); return; }
    if (action === "enable") { consent(); return; }
    if (action === "manual") { manualTrip(); return; }
    if (action === "edit") { const t = data().trips.find(t => t.id === id); if (t) editTrip(t); return; }
    if (action === "open-settings") { document.querySelector('a[href="#profile"]')?.click(); location.hash = "profile"; return; }
    if (action === "business" || action === "bulk-business") {
      const items = trips().filter(t => editable(t) && (action === "business" ? t.id === id : selected.has(t.id)));
      const purpose = data().preferences?.businessPurpose;
      if (!purpose || items.some(t => warnings(t).length && !t.reviewedAt)) { reviewBusiness(items); return; }
      button.disabled = true;
      try { await update("/api/mileage/review", { tripIds: items.map(t => t.id), category: "business", purpose }); selected.clear(); render(); }
      catch (error) { toast(error.message); } finally { button.disabled = false; }
      return;
    }
    if (action === "submit") { confirmReport(); return; }
    button.disabled = true;
    try {
      if (action === "pause") { await flush(); await update("/api/mileage/consent", { enabled: false }); stop(); status = ""; }
      if (action === "personal" || action === "bulk-personal") {
        const ids = trips().filter(t => editable(t) && (action === "personal" ? t.id === id : selected.has(t.id))).map(t => t.id);
        await update("/api/mileage/review", { tripIds: ids, category: "personal" }); selected.clear(); render();
      }
      if (["approved", "rejected", "withdrawn"].includes(action)) {
        const note = action === "rejected" ? await requestText("What should the driver correct in this mileage report?") : "";
        if (action === "rejected" && !note) return;
        await update(`/api/mileage/reports/${button.dataset.report}`, { status: action, note }, "PATCH");
      }
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
  window.addEventListener("online", flush);
  document.addEventListener("submit", async e => {
    if (!ownsTarget(e.target)) return;
    if (!e.target.matches("[data-mileage-preferences]")) return;
    e.preventDefault(); const button = e.target.querySelector('[type="submit"]'); button.disabled = true;
    try { await update("/api/mileage/preferences", { businessPurpose: new FormData(e.target).get("businessPurpose") }); toast("Default business purpose saved"); }
    catch (error) { e.target.querySelector(".mileage-error").textContent = error.message; button.disabled = false; }
  });
  setInterval(() => { start(); flush(); refreshStatus(); }, 15000);
  const tripWorkspaceHtml = () => `${tripsHtml()}<div class="mileage-actions mileage-legacy">${btn("manual", "Add a missed drive")}<p class="privacy-copy">Recent 95 days shown here. Yearly downloads include all retained records. Very short drives (under about 150 m) may need a manual entry.</p></div>`;
  const html = fn => () => personal ? fn().replaceAll("/api/mileage/", "/api/my-mileage/") : fn();
  return { summaryHtml: html(summaryHtml), settingsHtml: html(settingsHtml), tripsHtml: html(tripWorkspaceHtml), reportHtml: html(reportHtml), dispatchHtml, mount: () => { start(); refreshStatus(); tripMaps.mount(); }, stop: () => {stop();tripMaps.stop();} };
}
