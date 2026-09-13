const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
const AUTH_STORAGE_KEY = "rivoAuthStateV2";
const LEGACY_AUTH_STORAGE_KEY = "deliveryAuthSession";
const DASHBOARD_LAYOUT_STORAGE_KEY = "rivoDispatcherDashboardLayoutV3";
const DISPATCHER_VIEWS = new Set(["operations", "drivers", "analytics", "channels", "accounts", "reports", "settings"]);
const DASHBOARD_WIDGETS = [
  { id: "overview", label: "Daily overview", defaultWidth: "wide" },
  { id: "issues", label: "Delivery issues", defaultWidth: "wide" },
  { id: "orders", label: "Order queue", defaultWidth: "wide" },
  { id: "map", label: "Route preview", defaultWidth: "half" },
  { id: "active", label: "Active deliveries", defaultWidth: "half" },
  { id: "assistant", label: "Route optimizer", defaultWidth: "wide" },
  { id: "create", label: "Create delivery", defaultWidth: "half" }
];

function defaultDashboardLayout() {
  return {
    order: DASHBOARD_WIDGETS.map((widget) => widget.id),
    hidden: ["assistant", "create"],
    widths: Object.fromEntries(DASHBOARD_WIDGETS.map((widget) => [widget.id, widget.defaultWidth]))
  };
}

function normalizeDashboardLayout(value) {
  const defaults = defaultDashboardLayout();
  const known = new Set(defaults.order);
  const suppliedOrder = Array.isArray(value?.order) ? value.order.filter((id) => known.has(id)) : [];
  const order = [...new Set([...suppliedOrder, ...defaults.order])];
  const hidden = Array.isArray(value?.hidden) ? [...new Set(value.hidden.filter((id) => known.has(id)))] : [...defaults.hidden];
  const widths = { ...defaults.widths };
  for (const id of order) {
    if (["half", "wide"].includes(value?.widths?.[id])) widths[id] = value.widths[id];
  }
  return { order, hidden, widths };
}

function readDashboardLayout() {
  try {
    return normalizeDashboardLayout(JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) || "null"));
  } catch {
    return defaultDashboardLayout();
  }
}

function saveDashboardLayout() {
  state.dashboardLayout = normalizeDashboardLayout(state.dashboardLayout);
  try {
    window.localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(state.dashboardLayout));
  } catch {
    // Local preferences still work for this session when storage is unavailable.
  }
}

function readStoredAuth() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY) || window.localStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredAuth(auth) {
  try {
    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    if (auth?.role) {
      const safeState = { role: auth.role, name: auth.name || "", driverId: auth.driverId || "", expiresAt: auth.expiresAt || "" };
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safeState));
    } else window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Storage can be blocked in private browsing; the in-memory value still works.
  }
}

const state = {
  snapshot: null,
  company: null,
  customerTrip: null,
  route: parseRoute(),
  auth: readStoredAuth(),
  loginError: "",
  ownerRecoveryMode: false,
  ownerRecoveryIdentifier: "",
  ownerRecoveryError: "",
  setupError: "",
  inviteError: "",
  inviteActionError: "",
  inviteProfile: null,
  lastInvite: null,
  editingDriverId: "",
  editingCourierId: "",
  courierRequestTripIds: [],
  selectedOrderIds: new Set(),
  selectedActiveTripIds: new Set(),
  orderQuery: "",
  orderFilter: "all",
  bulkDriverId: "",
  bulkRate: null,
  optimizerPlan: null,
  optimizerLoading: false,
  lastSnapshotSerialized: "",
  lastWebhook: null,
  dispatcherView: "operations",
  dashboardCustomizing: false,
  dashboardLayout: readDashboardLayout(),
  setupMode: false,
  setupEnabled: false,
  ownerCreated: false,
  mapsConfig: { configured: false, apiKey: "", mapId: "" },
  googleMapsDenied: false,
  googleMapsPromise: null,
  googleMapsDrawSeq: 0,
  googleMapsViews: {},
  googleRouteCache: new Map(),
  openMapPromise: null,
  openMapViews: {},
  refreshTimer: null,
  refreshGeneration: 0,
  gpsWatchId: null,
  simTimer: null,
  simOrigin: null,
  simStep: 0,
  publishTripId: "",
  locationPublishPromise: Promise.resolve(),
  installPrompt: null,
  deferRender: false
};

const GOOGLE_ROUTE_CACHE_MS = 30000;
const OPEN_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAPLIBRE_VERSION = "5.24.0";
let draggedActiveTrip = null;
let draggedDashboardWidget = null;
let activeSignatureCanvas = null;

const statusLabels = {
  queued: "Queued",
  active: "Tracking",
  completed: "Needs review",
  delivered: "Delivered",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Needs correction",
  exception: "Needs attention",
  failed: "Delivery unsuccessful",
  "ready-to-share": "Ready to share",
  "send-failed": "Send failed",
  requested: "Requested",
  accepted: "Accepted",
  "picked-up": "Picked up",
  declined: "Declined",
  cancelled: "Cancelled",
  "en-route": "En Route",
  available: "Available",
  offline: "Offline"
};

const leadStageLabels = {
  new: "New",
  qualified: "Qualified",
  pilot: "Evaluation",
  won: "Won",
  lost: "Lost"
};

const colorChoices = [
  { value: "#2563eb", label: "Blue" },
  { value: "#059669", label: "Green" },
  { value: "#d97706", label: "Amber" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#dc2626", label: "Red" },
  { value: "#0f766e", label: "Teal" }
];
const DEFAULT_PICKUP_ADDRESS = "1675 Cyrville Rd";

function companyPickupAddress() {
  return state.snapshot?.company?.pickupAddress || DEFAULT_PICKUP_ADDRESS;
}

function parseRoute() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("invite")) return { name: "invite", token: params.get("invite") || "" };
  if (params.has("track")) return { name: "customer", token: params.get("track") || "" };
  if (params.has("setup")) return { name: "setup" };
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "join") return { name: "invite", token: parts[1] || "" };
  if (parts[0] === "track") return { name: "customer", token: parts[1] || "" };
  if (parts[0] === "setup") return { name: "setup" };
  return { name: "dispatcher" };
}

function dispatcherPath() {
  return "/operations";
}

function customerPath(token = "") {
  return `/?track=${encodeURIComponent(token)}`;
}

function h(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}

function driverInviteMailto(invite) {
  if (!invite?.email || !invite?.url) return "";
  const subject = encodeURIComponent("You’re invited to Rivo");
  const body = encodeURIComponent(`Hi ${invite.name || "there"},\n\nYou’ve been invited to join Rivo as a driver. Create your password and open the driver app here:\n${invite.url}\n\nThis secure link expires in 7 days.`);
  return `mailto:${encodeURIComponent(invite.email)}?subject=${subject}&body=${body}`;
}

function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { ...(options.headers || {}) },
    credentials: "same-origin",
    ...(options.cache ? { cache: options.cache } : {})
  };
  if (options.auth !== false && state.auth?.token) {
    init.headers.Authorization = `Bearer ${state.auth.token}`;
  }
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  return fetch(path, init).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload?.error || response.statusText || "Request failed";
      const error = new Error(message);
      if (payload && typeof payload === "object" && payload.code) error.code = payload.code;
      throw error;
    }
    return payload;
  });
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl.hideTimer);
  toastEl.hideTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function hasUnsavedForm() {
  return Boolean(document.querySelector("form[data-dirty='true'], [data-proof-draft][data-dirty='true']"));
}

function markDraftDirty(target) {
  const form = target?.closest?.("form");
  if (form) form.dataset.dirty = "true";
  const proofDraft = target?.closest?.("[data-proof-draft]");
  if (proofDraft) proofDraft.dataset.dirty = "true";
}

function maybeRender() {
  const active = document.activeElement;
  if (hasUnsavedForm() || (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) {
    state.deferRender = true;
    return;
  }
  render();
}

document.addEventListener("input", (event) => {
  markDraftDirty(event.target);
});

document.addEventListener("change", (event) => {
  markDraftDirty(event.target);
});

document.addEventListener("focusout", () => {
  setTimeout(() => {
    const active = document.activeElement;
    const stillEditing = hasUnsavedForm() || (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName));
    if (!state.deferRender || stillEditing) return;
    state.deferRender = false;
    render();
  }, 0);
});

function formatMoney(value) {
  const currency = state.snapshot?.company?.currency || state.company?.currency || "USD";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatKm(value) {
  return `${Number(value || 0).toFixed(2)} km`;
}

function formatRate(value) {
  return `${formatMoney(value)} / km`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "No update yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function weekKeyOf(value = new Date()) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getDrivers() {
  return state.snapshot?.drivers || [];
}

function getTrips() {
  return state.snapshot?.trips || [];
}

function getCourierPartners() {
  return state.snapshot?.courierPartners || [];
}

function getCourierRequests() {
  return state.snapshot?.courierRequests || [];
}

function pruneSelections() {
  const trips = getTrips();
  const selectableOrders = new Set(trips.filter((trip) => isChannelOrder(trip) && ["queued", "completed"].includes(trip.status) && !trip.courier?.isOpen).map((trip) => trip.id));
  const selectableActive = new Set(trips.filter((trip) => trip.status === "active").map((trip) => trip.id));
  state.selectedOrderIds = new Set([...state.selectedOrderIds].filter((id) => selectableOrders.has(id)));
  state.selectedActiveTripIds = new Set([...state.selectedActiveTripIds].filter((id) => selectableActive.has(id)));
}

function selectionCheckboxHtml(kind, trip, label) {
  const selected = kind === "active" ? state.selectedActiveTripIds.has(trip.id) : state.selectedOrderIds.has(trip.id);
  const attribute = kind === "active" ? "data-active-order-select" : "data-order-select";
  return `<label class="route-order-check" title="Select ${h(label)}"><input type="checkbox" ${attribute} value="${h(trip.id)}" ${selected ? "checked" : ""}><span aria-hidden="true"></span><span class="sr-only">Select ${h(label)}</span></label>`;
}

function syncSelectionControls(kind) {
  const isActive = kind === "active";
  const selected = isActive ? state.selectedActiveTripIds : state.selectedOrderIds;
  const selector = isActive ? "[data-active-order-select]" : "[data-order-select]";
  const countSelector = isActive ? "[data-active-selection-count]" : "[data-order-selection-count]";
  const requiredSelector = isActive ? "[data-requires-active-selection]" : "[data-requires-order-selection]";
  const selectAllSelector = isActive ? "[data-select-all-active]" : "[data-select-all-orders]";
  const checkboxes = Array.from(document.querySelectorAll(selector)).filter((checkbox) => !checkbox.closest("[data-order-card]")?.hidden);
  for (const checkbox of checkboxes) {
    checkbox.checked = selected.has(checkbox.value);
    checkbox.closest(".item")?.classList.toggle("is-selected", checkbox.checked);
  }
  for (const counter of document.querySelectorAll(countSelector)) counter.textContent = String(selected.size);
  const toolbarSelector = isActive ? "[data-active-bulk-toolbar]" : "[data-order-bulk-toolbar]";
  for (const toolbar of document.querySelectorAll(toolbarSelector)) {
    toolbar.classList.toggle("has-selection", selected.size > 0);
  }
  for (const control of document.querySelectorAll(requiredSelector)) {
    control.disabled = selected.size === 0 || (control.hasAttribute("data-requires-driver") && getDrivers().length === 0);
  }
  for (const selectAll of document.querySelectorAll(selectAllSelector)) {
    const selectedVisible = checkboxes.filter((checkbox) => selected.has(checkbox.value)).length;
    selectAll.checked = Boolean(checkboxes.length) && selectedVisible === checkboxes.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < checkboxes.length;
  }
  if (!isActive) {
    for (const label of document.querySelectorAll("[data-order-select-all-label]")) {
      label.textContent = `Select all ${checkboxes.length} shown`;
    }
  }
}

function getLeads() {
  return state.snapshot?.leads || [];
}

function getDriver(driverId) {
  return getDrivers().find((driver) => driver.id === driverId);
}

function getCourierPartner(partnerId) {
  return getCourierPartners().find((partner) => partner.id === partnerId);
}

function tripsForDriver(driverId) {
  return getTrips().filter((trip) => trip.driverId === driverId);
}

function activeTrips() {
  return getTrips().filter((trip) => trip.status === "active");
}

function queuedTrips() {
  return getTrips().filter((trip) => trip.status === "queued" && !trip.courier?.isOpen);
}

function isWixOrder(trip) {
  return trip.source?.system === "wix";
}

function isChannelOrder(trip) {
  return Boolean(trip.source?.system);
}

function channelLabel(system) {
  return ({ wix: "Wix", shopify: "Shopify", woocommerce: "WooCommerce", webhook: "Connected site" })[system] || "Online order";
}

function isWixOrderFulfilled(trip) {
  return isWixOrder(trip) && String(trip.source?.fulfillmentStatus || "").toUpperCase() === "FULFILLED";
}

function isBusinessTrip(trip) {
  return (trip.tripType || "business") === "business";
}

function currentWeekTrips(driverId = "", options = {}) {
  const selectedWeek = state.snapshot?.weekKey || weekKeyOf();
  return getTrips().filter((trip) => {
    if (trip.status === "queued") return false;
    if (options.businessOnly && !isBusinessTrip(trip)) return false;
    const date = trip.endedAt || trip.startedAt;
    return weekKeyOf(date) === selectedWeek && (!driverId || trip.driverId === driverId);
  });
}

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function statusPill(status) {
  return `<span class="status ${h(status)}">${h(statusLabels[status] || status)}</span>`;
}

function courierPill(courier) {
  if (!courier) return "";
  return `<span class="status courier">Courier · ${h(courier.name)} · ${h(statusLabels[courier.status] || courier.status)}</span>`;
}

function proofRecordHtml(trip, options = {}) {
  const proof = trip?.proof;
  if (!proof) return "";
  const media = proof.media || {};
  const mediaHtml = [
    media.photo ? `<a class="proof-media-link" href="${h(media.photo.url)}" target="_blank" rel="noreferrer"><img src="${h(media.photo.url)}" alt="Delivery proof photo"><span>Delivery photo</span></a>` : "",
    media.signature ? `<a class="proof-media-link signature" href="${h(media.signature.url)}" target="_blank" rel="noreferrer"><img src="${h(media.signature.url)}" alt="Recipient signature"><span>Recipient signature</span></a>` : ""
  ].filter(Boolean).join("");
  const history = Array.isArray(trip.proofHistory) ? trip.proofHistory.filter(Boolean) : [];
  const historyHtml = history.length
    ? `<details class="proof-history"><summary>${history.length} earlier proof record${history.length === 1 ? "" : "s"}</summary><div class="proof-history-list">${history.map((entry) => {
        const earlierMedia = Object.values(entry.media || {}).map((item) => `<a href="${h(item.url)}" target="_blank" rel="noreferrer">Open ${h(item.filename || "proof image")}</a>`).join(" · ");
        return `<div><strong>${h(entry.exceptionReason || entry.method || "Completion record")}</strong><span>${entry.recordedAt ? h(formatDate(entry.recordedAt)) : ""}${entry.recordedBy ? ` · ${h(entry.recordedBy)}` : ""}</span>${earlierMedia ? `<span>${earlierMedia}</span>` : ""}</div>`;
      }).join("")}</div></details>`
    : "";
  const override = proof.kind === "dispatcher-override";
  return `
    <div class="proof-record${override ? " is-override" : ""}${trip.status === "exception" ? " is-exception" : ""}">
      <div class="proof-record-head">
        <strong>${h(proof.exceptionReason || proof.method || "Completion record")}</strong>
        <span class="status ${override ? "queued" : trip.status === "exception" ? "exception" : "available"}">${override ? "Dispatcher override" : trip.status === "exception" ? "Issue recorded" : "Proof saved"}</span>
      </div>
      <p>${proof.recipient ? `Received by ${h(proof.recipient)} · ` : ""}${proof.recordedAt ? h(formatDate(proof.recordedAt)) : ""}${proof.recordedBy ? ` · ${h(proof.recordedBy)}` : ""}</p>
      ${proof.exceptionNote ? `<p>${h(proof.exceptionNote)}</p>` : ""}
      ${proof.nextAction ? `<p>Next action: ${h(proof.nextAction === "retry" ? "Retry later" : proof.nextAction === "return" ? "Return to depot" : "Needs dispatcher")}</p>` : ""}
      ${override && proof.overrideReason ? `<p>${h(proof.overrideReason)}</p>` : ""}
      ${trip.dispatcherConfirmation ? `<p><strong>Dispatch confirmed:</strong> ${h(trip.dispatcherConfirmation.reason || "Confirmed delivered")}${trip.dispatcherConfirmation.recordedAt ? ` · ${h(formatDate(trip.dispatcherConfirmation.recordedAt))}` : ""}</p>` : ""}
      ${mediaHtml ? `<div class="proof-media-grid">${mediaHtml}</div>` : options.compact ? "" : `<p class="proof-empty">No photo or signature attached.</p>`}
      ${historyHtml}
    </div>`;
}

function wixFulfillmentPill(trip) {
  const status = String(trip.source?.fulfillmentStatus || "").toUpperCase();
  if (!status) return "";
  const label = status.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const className = status === "FULFILLED" ? "wix-fulfilled" : "wix-pending";
  return `<span class="status ${className}">${h(label)}</span>`;
}

function shareUrl(tokenOrTrip) {
  const token = typeof tokenOrTrip === "string" ? tokenOrTrip : tokenOrTrip?.shareToken;
  return `${window.location.origin}${customerPath(token || "")}`;
}

function customerTrackingStops(trip) {
  const configuredStops = Array.isArray(trip?.trackingStops)
    ? trip.trackingStops
        .map((stop, index) => ({
          label: String(stop?.label || `Stop ${index + 1}`).trim(),
          address: String(stop?.address || "").trim(),
          shareToken: String(stop?.shareToken || "").trim()
        }))
        .filter((stop) => stop.address && stop.shareToken)
    : [];
  if (configuredStops.length) return configuredStops;
  const destination = routeStops(trip).at(-1);
  if (!destination?.address || !trip?.shareToken) return [];
  return [{ label: destination.label || "Delivery", address: destination.address, shareToken: trip.shareToken }];
}

function routeStops(trip, options = {}) {
  const storedStops = Array.isArray(trip?.stops)
    ? trip.stops
        .map((stop, index) => {
          const address = typeof stop === "string" ? stop : stop?.address;
          const label = typeof stop === "object" && stop?.label ? stop.label : "";
          return {
            label,
            address: String(address || "").trim(),
            index
          };
        })
        .filter((stop) => stop.address)
    : [];
  const stops = storedStops.length
    ? storedStops.map((stop, index) => ({
        label: stop.label || defaultStopLabel(index, storedStops.length),
        address: stop.address
      }))
    : [
        { label: "Pickup", address: String(trip?.pickup || "").trim() },
        { label: "Destination", address: String(trip?.destination || "").trim() }
      ].filter((stop) => stop.address);
  if (options.customer && stops.length > 2) {
    return [stops[0], stops.at(-1)].filter(Boolean);
  }
  return stops;
}

function defaultStopLabel(index, total) {
  if (index === 0) return "Pickup";
  if (index === total - 1) return "Destination";
  return `Stop ${index}`;
}

function routeSummary(trip, options = {}) {
  const stops = routeStops(trip, options);
  if (stops.length === 1) return `Delivery to ${stops[0].address}`;
  const first = stops[0]?.address || trip?.pickup || "";
  const last = stops.at(-1)?.address || trip?.destination || "";
  const extraCount = Math.max(0, stops.length - 2);
  const via = extraCount ? ` via ${extraCount} stop${extraCount === 1 ? "" : "s"}` : "";
  return `${first} to ${last}${via}`.trim();
}

function routeStopLinesHtml(trip, options = {}) {
  const stops = routeStops(trip, options);
  return stops
    .map((stop, index) => `
      <div class="route-line">
        <span class="route-pin ${index === stops.length - 1 ? "end" : ""}"></span>
        <div>
          <p class="route-label">${h(stop.label || defaultStopLabel(index, stops.length))}</p>
          <p class="route-value">${h(stop.address)}</p>
        </div>
      </div>
    `)
    .join("");
}

function intermediateStopsText(trip) {
  return routeStops(trip).slice(1, -1).map((stop) => stop.address).join("\n");
}

function googleMapsDirectionsUrl(trip, options = {}) {
  const stops = routeStops(trip, options).map((stop) => stop.address).filter(Boolean);
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (options.navigate) params.set("dir_action", "navigate");
  if (!stops.length) return `https://www.google.com/maps/dir/?${params.toString()}`;
  const useCurrentLocation = options.currentLocation && stops.length > 1;
  if (!useCurrentLocation && stops[0]) params.set("origin", stops[0]);
  params.set("destination", stops.at(-1));
  // When the phone supplies the origin, omit the planned depot/start. This keeps
  // a driver moving through only the remaining stops instead of sending them
  // back through the depot after every completion.
  const waypoints = stops.slice(1, -1);
  if (waypoints.length) params.set("waypoints", waypoints.slice(0, 9).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function mapsEnabled() {
  return Boolean(!state.googleMapsDenied && state.mapsConfig?.configured && state.mapsConfig?.apiKey);
}

function isGoogleMapsAccessError(error) {
  return /PERMISSION_DENIED|API_KEY_HTTP_REFERRER_BLOCKED|RefererNotAllowedMapError/i.test(String(error?.message || error || ""));
}

function liveDriverStop(trip) {
  if (!trip?.location || !Number.isFinite(Number(trip.location.lat)) || !Number.isFinite(Number(trip.location.lng))) {
    return null;
  }
  return {
    label: "Driver",
    address: {
      lat: Number(trip.location.lat),
      lng: Number(trip.location.lng)
    },
    live: true
  };
}

function googleRouteStops(trip, options = {}) {
  const stops = routeStops(trip, options);
  const liveStop = trip?.status === "active" ? liveDriverStop(trip) : null;
  if (!liveStop) return stops;
  if (options.customer) return [liveStop, stops.at(-1)].filter(Boolean);
  return [liveStop, ...stops.slice(1)];
}

function googleStopLocation(stop) {
  return typeof stop?.address === "object" ? stop.address : stop?.address || "";
}

function googleStopKey(stop) {
  const location = googleStopLocation(stop);
  if (typeof location === "object") {
    return `${stop.label}:${Number(location.lat).toFixed(5)},${Number(location.lng).toFixed(5)}`;
  }
  return `${stop.label}:${location}`;
}

function googleRouteCacheKey(trip, options = {}) {
  const plannedStops = routeStops(trip, options).map(googleStopKey).join("|");
  const routeOrigin = liveDriverStop(trip) ? "live" : "planned";
  return `${options.customer ? "customer" : "fleet"}:${trip.preserveStopOrder ? "fixed" : "optimize"}:${trip.id}:${trip.status}:${routeOrigin}:${plannedStops}`;
}

function formatEtaTime(durationMillis) {
  if (!Number.isFinite(Number(durationMillis)) || Number(durationMillis) <= 0) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(Date.now() + Number(durationMillis)));
}

function formatDurationFromMillis(durationMillis) {
  const minutes = Math.max(1, Math.round(Number(durationMillis || 0) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function routeSummaryFromGoogle(route) {
  const duration = route?.localizedValues?.duration || formatDurationFromMillis(route?.durationMillis);
  const distance = route?.localizedValues?.distance || (route?.distanceMeters ? `${(route.distanceMeters / 1000).toFixed(1)} km` : "");
  const eta = formatEtaTime(route?.durationMillis);
  return {
    duration,
    distance,
    eta
  };
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => toast("Copied"));
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  toast("Copied");
  return Promise.resolve();
}

async function shareLink(url, title = "Delivery tracking link") {
  if (navigator.share) {
    await navigator.share({
      title,
      text: title,
      url
    });
    return;
  }
  await copyText(url);
}

async function installApp() {
  if (isStandalone()) {
    toast("Already installed");
    return;
  }
  if (state.installPrompt) {
    const promptEvent = state.installPrompt;
    state.installPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    toast(choice.outcome === "accepted" ? "Install started" : "Install dismissed");
    maybeRender();
    return;
  }
  toast("Use your phone browser menu, then Add to Home Screen.");
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function reportTotals(trips) {
  return trips.reduce(
    (memo, trip) => {
      memo.distanceKm += Number(trip.distanceKm || 0);
      memo.amount += Number(trip.billableAmount || 0);
      memo.trips += 1;
      return memo;
    },
    { distanceKm: 0, amount: 0, trips: 0 }
  );
}

function sectionNavLinks(items, options = {}) {
  const compact = Boolean(options.compact);
  const linkClass = compact ? "mobile-tab" : "nav-link";
  const markerClass = compact ? "mobile-tab-mark" : "nav-dot";
  return items
    .map((item) => `
      <a class="${linkClass}" data-section-link="${h(item.id)}" href="#${h(item.id)}">
        <span class="${markerClass}"></span><span>${h(item.label)}</span>
      </a>
    `)
    .join("");
}

function dispatcherViewLinks(options = {}) {
  const compact = Boolean(options.compact);
  const advanced = Boolean(options.advanced);
  const linkClass = compact ? "mobile-tab" : "nav-link";
  const markerClass = compact ? "mobile-tab-mark" : "nav-dot";
  const items = advanced
    ? [
        { id: "channels", label: "Connections" },
        { id: "accounts", label: "Accounts" },
        { id: "settings", label: "Settings" }
      ]
    : [
        { id: "operations", label: "Today" },
        { id: "drivers", label: "Team" },
        { id: "analytics", label: "Analytics" },
        { id: "reports", label: "Reports" }
      ];
  return items.map((item) => `
    <button class="${linkClass}${state.dispatcherView === item.id ? " active" : ""}" data-action="dispatcher-view" data-view="${item.id}" type="button"${state.dispatcherView === item.id ? ' aria-current="page"' : ""}>
      <span class="${markerClass}"></span><span>${item.label}</span>
    </button>
  `).join("");
}

function dispatcherMoreLink() {
  const active = ["channels", "accounts", "settings"].includes(state.dispatcherView);
  return `
    <button class="mobile-tab${active ? " active" : ""}" data-action="dispatcher-view" data-view="settings" type="button"${active ? ' aria-current="page"' : ""}>
      <span class="mobile-tab-mark"></span><span>More</span>
    </button>`;
}

function workspaceToolsNav() {
  return `
    <nav class="workspace-switcher" aria-label="Workspace tools">
      <span>Workspace tools</span>
      ${[
        { id: "channels", label: "Connections" },
        { id: "accounts", label: "Accounts" },
        { id: "settings", label: "Settings" }
      ].map((item) => `
        <button class="${state.dispatcherView === item.id ? "active" : ""}" data-action="dispatcher-view" data-view="${item.id}" type="button"${state.dispatcherView === item.id ? ' aria-current="page"' : ""}>${item.label}</button>
      `).join("")}
    </nav>`;
}

function syncSectionNavigation() {
  const links = Array.from(document.querySelectorAll("[data-section-link]"));
  if (!links.length) return;
  const requested = window.location.hash.replace(/^#/, "");
  const activeId = links.some((link) => link.dataset.sectionLink === requested)
    ? requested
    : links[0].dataset.sectionLink;
  for (const link of links) {
    const isActive = link.dataset.sectionLink === activeId;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function navHtml() {
  if (state.auth?.role === "driver") {
    return `
      <nav class="nav" aria-label="Driver">
        ${sectionNavLinks([
          { id: "today", label: "Today" },
          { id: "trips", label: "Trips" },
          { id: "report", label: "Report" },
          { id: "profile", label: "Profile" }
        ])}
        <button class="nav-action" data-action="logout" type="button"><span class="nav-dot"></span><span>Log Out</span></button>
        ${isStandalone() ? "" : `<button class="nav-action" data-action="install-app" type="button"><span class="nav-dot"></span><span>Install App</span></button>`}
      </nav>
    `;
  }
  return `
    <nav class="nav" aria-label="Dispatcher sections">
      ${dispatcherViewLinks()}
      <details class="nav-more"${["channels", "accounts", "settings"].includes(state.dispatcherView) ? " open" : ""}>
        <summary><span class="nav-dot"></span><span>More</span></summary>
        <div class="nav-more-links">${dispatcherViewLinks({ advanced: true })}</div>
      </details>
      <button class="nav-action" data-action="logout" type="button"><span class="nav-dot"></span><span>Log Out</span></button>
      ${isStandalone() ? "" : `<button class="nav-action" data-action="install-app" type="button"><span class="nav-dot"></span><span>Install App</span></button>`}
    </nav>
  `;
}

function mobileTabsHtml() {
  if (state.auth?.role === "driver") {
    return `
      <nav class="mobile-tabs" aria-label="Driver mobile">
        ${sectionNavLinks([
          { id: "today", label: "Today" },
          { id: "trips", label: "Trips" },
          { id: "report", label: "Report" },
          { id: "profile", label: "Profile" }
        ], { compact: true })}
      </nav>
    `;
  }
  return `
    <nav class="mobile-tabs" aria-label="Mobile">
      ${dispatcherViewLinks({ compact: true })}
      ${dispatcherMoreLink()}
    </nav>
  `;
}

function shellHtml(content) {
  const companyName = state.snapshot?.company?.name || "Delivery Ops";
  const workspaceLabel = state.auth?.role === "driver" ? "Driver workspace" : "Live dispatch";
  const brandSubtitle = companyName.toLowerCase() === "rova" ? workspaceLabel : `${companyName} · ${workspaceLabel}`;
  return `
    ${mobileTabsHtml()}
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="rova-symbol brand-mark" aria-hidden="true"><img src="/assets/rova-mark.svg" alt=""></div>
          <div class="brand-text">
            <div class="brand-name">Rivo</div>
            <div class="brand-subtitle">${h(brandSubtitle)}</div>
          </div>
        </div>
        ${navHtml()}
        <div class="sidebar-footer">
          ${state.auth?.role === "driver" ? "Your assigned routes, delivery updates, and paid mileage stay together here." : "Today's deliveries, your drivers, and the work that needs attention."}
        </div>
      </aside>
      <main class="main">
        ${content}
      </main>
    </div>
  `;
}

function metricHtml(label, value, detail = "") {
  return `
    <div class="metric">
      <div class="metric-label">${h(label)}</div>
      <div class="metric-value">${h(value)}</div>
      <div class="metric-detail">${h(detail)}</div>
    </div>
  `;
}

function colorSwatchesHtml(selected = "#2563eb") {
  return colorChoices
    .map(({ value, label }) => `
      <label class="color-swatch" title="${h(label)}">
        <input type="radio" name="color" value="${h(value)}" ${value === selected ? "checked" : ""}>
        <span class="color-swatch-dot" style="--swatch-color:${h(value)}"></span>
        <span class="sr-only">${h(label)}</span>
      </label>
    `)
    .join("");
}

function driverOptions(selectedId = "") {
  return getDrivers()
    .map((driver) => `<option value="${h(driver.id)}" ${driver.id === selectedId ? "selected" : ""}>${h(driver.name)} - ${h(driver.vehicle)}</option>`)
    .join("");
}

function defaultDriverRate() {
  return getDrivers()[0]?.defaultRate || 1;
}

function renderMapBlock(id, trips, options = {}) {
  const legendTrips = trips.filter((trip) => trip.driver);
  const small = options.small ? " small" : "";
  const label = options.label || "Live map";
  return `
    <div class="map-wrap${small}">
      <div class="map-badge" data-map-badge-for="${h(id)}">${h(label)}</div>
      <div class="google-map" id="${h(id)}-google"></div>
      <canvas class="map-canvas" id="${h(id)}"></canvas>
      <div class="map-eta" id="${h(id)}-eta" hidden></div>
      <div class="map-legend">
        ${
          legendTrips.length
            ? legendTrips
                .map((trip) => `
                  <span class="legend-item">
                    <span class="legend-swatch" style="background:${h(trip.driver.color || "#2563eb")}"></span>
                    ${h(trip.driver.name)}
                  </span>
                `)
                .join("")
            : `<span class="legend-item">Waiting for first location</span>`
        }
      </div>
    </div>
  `;
}

function activeTripItem(trip) {
  const mapsUrl = googleMapsDirectionsUrl(trip, {
    navigate: state.auth?.role === "driver",
    currentLocation: state.auth?.role === "driver"
  });
  const mapsButton = `<a class="button secondary" href="${h(mapsUrl)}" target="_blank" rel="noreferrer">Google Maps</a>`;
  const trackingStops = customerTrackingStops(trip);
  const customerActions = isBusinessTrip(trip)
    ? `
        <div class="tracking-links">
          ${trackingStops.map((stop, index) => {
            const url = shareUrl(stop.shareToken);
            const label = trackingStops.length === 1 ? "Customer tracking link" : `${stop.label || `Stop ${index + 1}`} tracking link`;
            const title = trackingStops.length === 1 ? `Track ${trip.customerName}` : `Track ${stop.label || `Stop ${index + 1}`}`;
            return `
              <div class="tracking-link">
                <p class="item-detail"><strong>${h(label)}</strong><br>${h(stop.address)}</p>
                <div class="item-actions">
                  <button class="button secondary" data-action="share-link" data-share-url="${h(url)}" data-share-title="${h(title)}">Share</button>
                  <button class="button ghost" data-action="copy" data-copy="${h(url)}">Copy</button>
                  <a class="button secondary" href="${h(customerPath(stop.shareToken))}" target="_blank" rel="noreferrer">Open</a>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `
    : `<span class="item-detail">Personal mileage is tracked here but excluded from reports.</span>`;
  const selectedClass = state.selectedActiveTripIds.has(trip.id) ? " is-selected" : "";
  return `
    <div class="item active-route-stop${selectedClass}" data-active-trip-id="${h(trip.id)}" data-driver-id="${h(trip.driverId)}" data-route-key="${h(trip.routeId || trip.id)}">
      <div class="item-main">
        <div class="active-stop-heading">
          ${state.auth?.role === "dispatcher" ? selectionCheckboxHtml("active", trip, trip.customerName) : ""}
          <div>
            ${state.auth?.role === "dispatcher" ? `<div class="route-order-controls"><button class="button ghost compact-action" data-action="move-route-stop" data-direction="up" data-trip-id="${h(trip.id)}" type="button" aria-label="Move ${h(trip.customerName)} earlier">↑</button><button class="button ghost compact-action" data-action="move-route-stop" data-direction="down" data-trip-id="${h(trip.id)}" type="button" aria-label="Move ${h(trip.customerName)} later">↓</button><span class="route-drag-handle" data-route-drag-handle draggable="true" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span><span class="item-detail">Stop ${Number(trip.routeSequence || 0) + 1}</span></div>` : ""}
            <p class="item-title">${h(trip.customerName)}</p>
            <p class="item-detail">${h(trip.driver?.name || trip.courier?.name || "Unassigned")} · ${h(routeSummary(trip))}</p>
          </div>
        </div>
        <div class="item-actions">
          ${statusPill(trip.status)}
          ${mapsButton}
          ${state.auth?.role === "dispatcher" ? `<button class="button success compact-action" data-action="complete-active-delivery" data-trip-id="${h(trip.id)}" data-trip-name="${h(trip.customerName)}" type="button">Complete</button>` : ""}
        </div>
      </div>
      <div class="item-detail">
        ${formatKm(trip.distanceKm)} logged at ${formatRate(trip.kmRate)}. Last update ${relativeTime(trip.location?.timestamp || trip.startedAt)}.
      </div>
      <details class="active-trip-details">
        <summary>Route details & customer links</summary>
        <div class="active-trip-details-body">
          ${routeStopLinesHtml(trip)}
          <div class="trip-actions">${customerActions}</div>
        </div>
      </details>
      ${state.auth?.role === "dispatcher" ? `
        <details class="manage-panel">
          <summary class="manage-summary">
            <span><span class="panel-title">Edit active delivery</span><span class="panel-subtitle">Update the route, rate, or notes without restarting tracking.</span></span>
            <span class="summary-control" aria-hidden="true">+</span>
          </summary>
          <div class="panel-body">
            <div class="form-grid compact">
              <div class="field">
                <label for="active-customer-${h(trip.id)}">Customer or purpose</label>
                <input class="input" id="active-customer-${h(trip.id)}" data-order-customer="${h(trip.id)}" value="${h(trip.customerName)}">
              </div>
              <div class="field">
                <label for="active-rate-${h(trip.id)}">Per km rate</label>
                <input class="input" id="active-rate-${h(trip.id)}" data-dispatch-rate="${h(trip.id)}" type="number" min="0" step="0.01" value="${h(trip.kmRate)}">
              </div>
              <div class="field full">
                <label for="active-pickup-${h(trip.id)}">Pickup</label>
                <input class="input" id="active-pickup-${h(trip.id)}" data-order-pickup="${h(trip.id)}" value="${h(trip.pickup)}">
              </div>
              <div class="field full">
                <label for="active-stops-${h(trip.id)}">Stops</label>
                <textarea class="textarea" id="active-stops-${h(trip.id)}" data-dispatch-stops="${h(trip.id)}">${h(intermediateStopsText(trip))}</textarea>
              </div>
              <div class="field full">
                <label for="active-destination-${h(trip.id)}">Destination</label>
                <input class="input" id="active-destination-${h(trip.id)}" data-order-destination="${h(trip.id)}" value="${h(trip.destination)}">
              </div>
              <div class="field full">
                <label for="active-notes-${h(trip.id)}">Notes</label>
                <textarea class="textarea" id="active-notes-${h(trip.id)}" data-order-notes="${h(trip.id)}">${h(trip.notes || "")}</textarea>
              </div>
              <div class="field full item-actions">
                <button class="button secondary" data-action="save-active-delivery" data-trip-id="${h(trip.id)}" type="button">Save changes</button>
                <button class="button success" data-action="complete-active-delivery" data-trip-id="${h(trip.id)}" data-trip-name="${h(trip.customerName)}" type="button">Mark complete</button>
              </div>
            </div>
          </div>
        </details>` : ""}
    </div>
  `;
}

function activeRouteGroups(trips) {
  const groups = new Map();
  for (const trip of trips) {
    const key = trip.routeId || trip.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trip);
  }
  return Array.from(groups.values()).map((group) =>
    group.sort((a, b) => Number(a.routeSequence ?? 999) - Number(b.routeSequence ?? 999) || new Date(a.startedAt) - new Date(b.startedAt))
  );
}

function activeRoutePreviewTrips(trips) {
  return activeRouteGroups(trips).map((group) => {
    const first = group[0];
    const origin = first.routeOrigin || first.pickup || companyPickupAddress();
    return {
      ...first,
      preserveStopOrder: true,
      customerName: `${first.driver?.name || "Driver"} route`,
      stops: [
        { label: "Start", address: origin },
        ...group.map((trip, index) => ({ label: `Stop ${index + 1}: ${trip.customerName}`, address: trip.destination })),
        { label: "Return", address: origin }
      ]
    };
  });
}

function selectedOrderPreviewTrips() {
  const selected = getTrips().filter((trip) => state.selectedOrderIds.has(trip.id));
  if (!selected.length) return [];
  const first = selected[0];
  const origin = companyPickupAddress();
  const selectedDriverId = document.getElementById("bulk-order-driver")?.value || first.driverId || "";
  const driver = getDriver(selectedDriverId) || first.driver;
  return [{
    ...first,
    driver,
    customerName: `${selected.length} selected order${selected.length === 1 ? "" : "s"}`,
    pickup: origin,
    stops: [
      { label: "Start", address: origin },
      ...selected.map((trip, index) => ({ label: `Stop ${index + 1}: ${trip.customerName}`, address: trip.destination })),
      { label: "Return", address: origin }
    ]
  }];
}

function dispatcherMapTrips() {
  const selectedPreview = selectedOrderPreviewTrips();
  if (selectedPreview.length) return selectedPreview;
  const active = activeTrips();
  if (active.length) return activeRoutePreviewTrips(active);
  return getTrips().filter((trip) => trip.status !== "queued").slice(0, 4);
}

function activeRouteGroupsHtml(trips) {
  return activeRouteGroups(trips).map((group) => `
    <div class="active-route-group" data-active-route-driver="${h(group[0]?.driverId || "")}" data-active-route-key="${h(group[0]?.routeId || group[0]?.id || "")}">
      <div class="item-detail" style="margin-bottom:8px"><strong>${h(group[0]?.driver?.name || "Unassigned")}</strong> · Drag stops into the preferred order</div>
      ${group.map(activeTripItem).join("")}
    </div>
  `).join("");
}

function activeBulkToolbarHtml(trips) {
  if (!trips.length) return "";
  const selectedCount = trips.filter((trip) => state.selectedActiveTripIds.has(trip.id)).length;
  const allSelected = selectedCount === trips.length;
  return `
    <div class="bulk-action-bar active-bulk-bar${selectedCount ? " has-selection" : ""}" data-active-bulk-toolbar>
      <label class="bulk-select-all"><input type="checkbox" data-select-all-active ${allSelected ? "checked" : ""}><span>Select all ${trips.length}</span></label>
      <div class="bulk-selection-summary"><strong data-active-selection-count>${selectedCount}</strong><span>selected</span></div>
      <div class="bulk-actions active-bulk-actions">
        <button class="button success" data-action="complete-selected-active" data-requires-active-selection type="button" ${selectedCount ? "" : "disabled"}>Complete selected</button>
        <button class="button ghost" data-action="clear-active-selection" data-requires-active-selection type="button" ${selectedCount ? "" : "disabled"}>Clear</button>
      </div>
    </div>`;
}

function queuedOrderItem(trip) {
  const sourceLabel = `${channelLabel(trip.source?.system)} order #${trip.source?.orderNumber || trip.source?.orderId || ""}`;
  const hasOpenCourierRequest = Boolean(trip.courier?.isOpen);
  const canManage = ["queued", "completed", "exception"].includes(trip.status) && !hasOpenCourierRequest;
  const mapsUrl = googleMapsDirectionsUrl(trip);
  const selectedClass = state.selectedOrderIds.has(trip.id) ? " is-selected" : "";
  const proofLocked = Boolean(trip.proof);
  const identityLocked = proofLocked || hasOpenCourierRequest;
  const identityLock = identityLocked ? " disabled aria-disabled=\"true\"" : "";
  const searchText = [trip.customerName, sourceLabel, trip.pickup, trip.destination, trip.notes, trip.driver?.name, trip.courier?.name, trip.courier?.referenceNumber].filter(Boolean).join(" ").toLowerCase();
  return `
    <article class="item order-card${selectedClass}" data-order-card data-order-status="${h(trip.status)}" data-order-search="${h(searchText)}">
      <div class="order-card-head">
        <div class="order-select-wrap">
          ${canManage ? selectionCheckboxHtml("order", trip, trip.customerName) : ""}
          <div>
            <p class="item-title">${h(trip.customerName)}</p>
            <p class="item-detail">${h(sourceLabel)} · ${relativeTime(trip.source?.createdDate || trip.importedAt)}</p>
          </div>
        </div>
        <div class="item-actions">${trip.driver?.name ? `<span class="status assigned">${h(trip.driver.name)}</span>` : ""}${courierPill(trip.courier)}${statusPill(trip.status)}${wixFulfillmentPill(trip)}</div>
      </div>
      <div class="order-route-summary">
        <span><small>Pickup</small>${h(trip.pickup)}</span>
        <span class="order-route-arrow" aria-hidden="true">→</span>
        <span><small>Deliver</small>${h(trip.destination)}</span>
      </div>
      ${hasOpenCourierRequest ? `<div class="courier-order-note"><strong>Courier handoff in progress</strong><span>Manage status, provider reference, fee, and tracking in Open courier requests.</span></div>` : ""}
      ${trip.proof ? proofRecordHtml(trip, { compact: true }) : ""}
      <details class="order-editor">
        <summary>Edit order details</summary>
        <div class="form-grid compact order-editor-grid">
          <div class="field full">
            <label for="order-customer-${h(trip.id)}">Customer or purpose</label>
            <input class="input" id="order-customer-${h(trip.id)}" data-order-customer="${h(trip.id)}" value="${h(trip.customerName)}"${identityLock}>
          </div>
          <div class="field full">
            <label for="order-pickup-${h(trip.id)}">Pickup</label>
            <input class="input" id="order-pickup-${h(trip.id)}" data-order-pickup="${h(trip.id)}" value="${h(trip.pickup)}"${identityLock}>
          </div>
          <div class="field full">
            <label for="dispatch-stops-${h(trip.id)}">Stops between pickup and destination</label>
            <textarea class="textarea" id="dispatch-stops-${h(trip.id)}" data-dispatch-stops="${h(trip.id)}" placeholder="Second customer address&#10;Return depot"${identityLock}>${h(intermediateStopsText(trip))}</textarea>
          </div>
          <div class="field full">
            <label for="order-destination-${h(trip.id)}">Destination</label>
            <input class="input" id="order-destination-${h(trip.id)}" data-order-destination="${h(trip.id)}" value="${h(trip.destination)}"${identityLock}>
          </div>
          <div class="field full">
            <label for="order-notes-${h(trip.id)}">Order notes</label>
            <textarea class="textarea" id="order-notes-${h(trip.id)}" data-order-notes="${h(trip.id)}" placeholder="Delivery instructions or internal notes">${h(trip.notes || "")}</textarea>
          </div>
          <div class="field full order-editor-actions">
            ${proofLocked ? `<span class="item-detail">Customer and route fields are locked to protect the saved proof. Notes can still be corrected.</span>` : hasOpenCourierRequest ? `<span class="item-detail">Cancel the courier request before changing customer or route details.</span>` : ""}
            <button class="button secondary" data-action="save-order" data-trip-id="${h(trip.id)}" type="button">Save changes</button>
            ${canManage ? `<button class="button success" data-action="mark-delivered" data-trip-id="${h(trip.id)}" data-order-label="${h(sourceLabel)}" type="button">Mark delivered</button>` : ""}
            <a class="button ghost" href="${h(mapsUrl)}" target="_blank" rel="noreferrer">Preview in Google Maps</a>
          </div>
        </div>
      </details>
    </article>
  `;
}

function bulkOrderToolbarHtml(orders) {
  if (!orders.length) return "";
  const selectedCount = orders.filter((trip) => state.selectedOrderIds.has(trip.id)).length;
  const allSelected = selectedCount === orders.length;
  const hasDrivers = getDrivers().length > 0;
  const selectedDriver = getDriver(state.bulkDriverId) || getDrivers()[0];
  const selectedRate = state.bulkRate === null ? Number(selectedDriver?.defaultRate || defaultDriverRate()) : state.bulkRate;
  return `
    <div class="bulk-action-bar${selectedCount ? " has-selection" : ""}" data-order-bulk-toolbar>
      <label class="bulk-select-all"><input type="checkbox" data-select-all-orders ${allSelected ? "checked" : ""}><span data-order-select-all-label>Select all shown</span></label>
      <div class="bulk-selection-summary"><strong data-order-selection-count>${selectedCount}</strong><span>selected</span></div>
      <div class="bulk-driver-control">
        <label for="bulk-order-driver">Driver</label>
        <select class="select" id="bulk-order-driver" data-rate-source="bulk-order-rate" ${hasDrivers ? "" : "disabled"}>
          ${hasDrivers ? driverOptions(selectedDriver?.id || "") : `<option value="">Add a driver first</option>`}
        </select>
      </div>
      <div class="bulk-rate-control">
        <label for="bulk-order-rate">$/km</label>
        <input class="input" id="bulk-order-rate" type="number" min="0" step="0.01" value="${h(selectedRate)}" ${hasDrivers ? "" : "disabled"}>
      </div>
      <div class="bulk-actions">
        <button class="button secondary" data-action="assign-selected-orders" data-requires-order-selection data-requires-driver type="button" ${selectedCount && hasDrivers ? "" : "disabled"}>Assign</button>
        <button class="button" data-action="dispatch-selected-route" data-requires-order-selection data-requires-driver type="button" ${selectedCount && hasDrivers ? "" : "disabled"}>Dispatch driver</button>
        <button class="button courier-action" data-action="request-selected-courier" data-requires-order-selection type="button" ${selectedCount ? "" : "disabled"}>Request courier</button>
        <details class="bulk-more">
          <summary class="button ghost">More</summary>
          <div class="bulk-more-menu">
            <button class="button secondary" data-action="show-route-preview" data-requires-order-selection type="button" ${selectedCount ? "" : "disabled"}>Preview map</button>
            <button class="button success" data-action="mark-selected-delivered" data-requires-order-selection type="button" ${selectedCount ? "" : "disabled"}>Mark delivered</button>
            <button class="button ghost" data-action="clear-order-selection" data-requires-order-selection type="button" ${selectedCount ? "" : "disabled"}>Clear selection</button>
          </div>
        </details>
      </div>
    </div>`;
}

function orderFilterToolbarHtml(total) {
  return `
    <div class="order-filter-toolbar">
      <label class="order-search-field">
        <span class="sr-only">Search orders</span>
        <input class="input" type="search" data-order-search-input value="${h(state.orderQuery)}" placeholder="Search customer, order, address, or driver" autocomplete="off">
      </label>
      <label class="order-filter-field">
        <span class="sr-only">Filter orders</span>
        <select class="select" data-order-filter>
          <option value="all"${state.orderFilter === "all" ? " selected" : ""}>All work</option>
          <option value="ready"${state.orderFilter === "ready" ? " selected" : ""}>Ready</option>
          <option value="review"${state.orderFilter === "review" ? " selected" : ""}>Needs review</option>
        </select>
      </label>
      <span class="count-chip"><span data-order-visible-count>${total}</span> shown</span>
    </div>
    <div class="empty order-filter-empty" data-order-filter-empty hidden>No orders match this search and filter.</div>`;
}

function applyOrderFilters() {
  const query = String(state.orderQuery || "").trim().toLowerCase();
  const filter = state.orderFilter || "all";
  let visible = 0;
  for (const card of document.querySelectorAll("[data-order-card]")) {
    const status = card.dataset.orderStatus || "";
    const filterMatch = filter === "all"
      || (filter === "ready" && status === "queued")
      || (filter === "review" && status === "completed");
    const queryMatch = !query || String(card.dataset.orderSearch || "").includes(query);
    card.hidden = !(filterMatch && queryMatch);
    if (!card.hidden) visible += 1;
  }
  for (const count of document.querySelectorAll("[data-order-visible-count]")) count.textContent = String(visible);
  for (const empty of document.querySelectorAll("[data-order-filter-empty]")) empty.hidden = visible !== 0;
  syncSelectionControls("order");
}

function channelOrdersPanel(trips) {
  const connections = state.snapshot?.integrations?.connections || [];
  const lastSyncedConnection = connections.filter((item) => item.lastSyncAt).sort((a, b) => new Date(b.lastSyncAt) - new Date(a.lastSyncAt))[0];
  const connectedText = connections.length ? `${connections.length} channel${connections.length === 1 ? "" : "s"} connected` : "No sales channel connected";
  const lastSync = lastSyncedConnection ? `Last sync ${relativeTime(lastSyncedConnection.lastSyncAt)}` : "Not synced yet";
  const channelOrders = trips
    .filter((trip) => isChannelOrder(trip) && ["queued", "completed"].includes(trip.status))
    .sort((left, right) => new Date(right.source?.createdDate || right.importedAt || 0) - new Date(left.source?.createdDate || left.importedAt || 0));
  const dispatchQueue = channelOrders.filter((trip) => trip.status === "queued" && !trip.courier?.isOpen);
  const needsReview = channelOrders.filter((trip) => trip.status === "completed");
  return `
    <div class="panel orders-panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">Online orders</h2>
          <p class="panel-subtitle">${h(connectedText)} · ${h(lastSync)}</p>
        </div>
        <div class="item-actions">
          ${dispatchQueue.length && getDrivers().some((driver) => driver.status !== "offline") ? `<button class="button" data-action="auto-assign-orders" type="button">Balance orders ${dispatchQueue.length}</button>` : ""}
          <button class="button secondary" data-action="sync-channels">Sync all</button>
          <button class="button ghost" data-action="dispatcher-view" data-view="channels">Connect a site</button>
        </div>
      </div>
      <div class="panel-body">
        ${connections.filter((item) => item.lastError).map((item) => `<div class="empty">${h(item.name)}: ${h(item.lastError)}</div>`).join("")}
        ${channelOrders.length ? `
          ${orderFilterToolbarHtml(channelOrders.length)}
          ${bulkOrderToolbarHtml(channelOrders)}
          <div class="section-heading compact-heading">
            <div><h3 class="panel-title">Dispatch queue</h3><p class="panel-subtitle">Orders waiting for assignment or delivery confirmation.</p></div>
            <span class="count-chip">${dispatchQueue.length}</span>
          </div>
          <div class="list">
            ${dispatchQueue.length ? dispatchQueue.map(queuedOrderItem).join("") : `<div class="empty compact-empty">No orders waiting in the dispatch queue.</div>`}
          </div>
          ${needsReview.length ? `
            <div class="section-heading compact-heading review-heading">
              <div><h3 class="panel-title">Needs review</h3><p class="panel-subtitle">Edit, dispatch again, or mark these orders delivered.</p></div>
              <span class="count-chip">${needsReview.length}</span>
            </div>
            <div class="list">${needsReview.map(queuedOrderItem).join("")}</div>
          ` : ""}
        ` : `<div class="orders-empty-state"><div><strong>No orders yet</strong><span>Connect a site, sync a channel, or add a delivery manually.</span></div><button class="button" data-action="open-create-delivery" type="button">Add delivery</button></div>`}
      </div>
    </div>
  `;
}

function channelConnectionCard(connection) {
  return `
    <div class="channel-connection">
      <div>
        <div class="item-main"><strong>${h(connection.name)}</strong><span class="status available">Connected</span></div>
        <p class="item-detail">${h(connection.providerLabel)}${connection.storeUrl ? ` · ${h(connection.storeUrl)}` : ""}</p>
        <p class="item-detail">${connection.lastSyncAt ? `Last sync ${relativeTime(connection.lastSyncAt)}` : "Waiting for first order"} · ${h(connection.importedOrders || 0)} imported</p>
        ${connection.lastError ? `<p class="item-detail error-copy">${h(connection.lastError)}</p>` : ""}
      </div>
      <div class="item-actions">
        ${connection.provider !== "webhook" ? `<button class="button secondary" data-action="sync-channel" data-connection-id="${h(connection.id)}" type="button">Sync now</button>` : ""}
        ${connection.managedByEnvironment ? "" : `<button class="button danger" data-action="disconnect-channel" data-connection-id="${h(connection.id)}" data-connection-name="${h(connection.name)}" type="button">Disconnect</button>`}
      </div>
    </div>`;
}

function connectionForm(provider, title, description, fields) {
  return `
    <details class="channel-provider panel">
      <summary class="manage-summary">
        <span><span class="panel-title">${title}</span><span class="panel-subtitle">${description}</span></span>
        <span class="summary-control" aria-hidden="true">+</span>
      </summary>
      <div class="panel-body">
        <form class="form-grid" data-channel-connect="${provider}">
          <input type="hidden" name="provider" value="${provider}">
          <div class="field full"><label>Connection name</label><input class="input" name="name" value="${title}" required></div>
          ${fields}
          <div class="field full"><label>Pickup address</label><input class="input" name="pickupLabel" value="${h(companyPickupAddress())}" required></div>
          <div class="field full"><button class="button" type="submit">Connect ${title}</button></div>
        </form>
      </div>
    </details>`;
}

function channelsManagementHtml() {
  const connections = state.snapshot?.integrations?.connections || [];
  return `
    <section class="${state.dispatcherView === "channels" ? "dispatch-view active" : "dispatch-view"} dashboard-section view-section" id="channels">
      <div class="section-heading">
        <div><p class="eyebrow">Connections</p><h2 class="section-title">Connect stores and order webhooks</h2><p class="section-subtitle">Bring supported order data into one dispatch queue without changing where customers buy.</p></div>
        ${connections.length ? `<button class="button secondary" data-action="sync-channels" type="button">Sync all channels</button>` : ""}
      </div>
      ${connections.length ? `<div class="panel"><div class="panel-header"><div><h3 class="panel-title">Connected channels</h3><p class="panel-subtitle">Credentials are encrypted before they are saved.</p></div></div><div class="panel-body channel-list">${connections.map(channelConnectionCard).join("")}</div></div>` : ""}
      ${state.lastWebhook ? `<div class="panel webhook-result"><div class="panel-header"><div><h3 class="panel-title">Webhook ready</h3><p class="panel-subtitle">Copy this URL now. The secret token is shown only once.</p></div></div><div class="panel-body"><div class="copy-field"><code>${h(state.lastWebhook)}</code><button class="button secondary" data-action="copy" data-copy="${h(state.lastWebhook)}" type="button">Copy URL</button></div></div></div>` : ""}
      <div class="channel-grid">
        ${connectionForm("shopify", "Shopify", "Paste the Admin API token from your Shopify store.", `<div class="field full"><label>Store address</label><input class="input" name="storeUrl" placeholder="https://your-store.myshopify.com" required></div><div class="field full"><label>Admin API access token</label><input class="input" name="accessToken" type="password" autocomplete="off" required></div>`)}
        ${connectionForm("woocommerce", "WooCommerce", "Use read-only REST API keys from WooCommerce settings.", `<div class="field full"><label>Store address</label><input class="input" name="storeUrl" type="url" placeholder="https://store.example.com" required></div><div class="field"><label>Consumer key</label><input class="input" name="consumerKey" type="password" autocomplete="off" placeholder="ck_…" required></div><div class="field"><label>Consumer secret</label><input class="input" name="consumerSecret" type="password" autocomplete="off" placeholder="cs_…" required></div>`)}
        ${connectionForm("wix", "Wix", "Connect Wix eCommerce with a site ID and API key.", `<div class="field"><label>Wix site ID</label><input class="input" name="siteId" required></div><div class="field"><label>Wix API key</label><input class="input" name="apiKey" type="password" autocomplete="off" required></div>`)}
        ${connectionForm("webhook", "Universal webhook", "For Square, Squarespace, BigCommerce, Ecwid, Zapier, Make, or a custom website.", `<div class="field full"><div class="empty">After connecting, Rivo gives you a private order URL. Send one order or an <code>orders</code> array as JSON.</div></div>`)}
      </div>
    </section>`;
}

function startTripFormHtml(prefix, driverId = "") {
  const selectedDriver = getDriver(driverId) || getDrivers()[0];
  const driverMode = prefix === "driver";
  const homeAddress = selectedDriver?.homeAddress || "";
  return `
    <form id="${h(prefix)}-start-trip" class="form-grid">
      ${driverMode
        ? `<input type="hidden" name="driverId" value="${h(selectedDriver?.id || "")}">
           <input type="hidden" name="kmRate" value="${h(selectedDriver?.defaultRate || 1)}">`
        : `<div class="field">
            <label for="${h(prefix)}-driver">Driver</label>
            <select class="select" id="${h(prefix)}-driver" name="driverId" data-rate-source="${h(prefix)}-rate" required>
              ${driverOptions(selectedDriver?.id || "")}
            </select>
          </div>
          <div class="field">
            <label for="${h(prefix)}-rate">Per km rate</label>
            <input class="input" id="${h(prefix)}-rate" name="kmRate" type="number" min="0" step="0.01" value="${h(selectedDriver?.defaultRate || 1)}" required>
          </div>`}
      ${driverMode && homeAddress ? `
        <div class="field full">
          <label>Paid commute route</label>
          <div class="item-actions">
            <button class="button secondary" type="button" data-action="route-preset" data-purpose="Home to work" data-pickup="${h(homeAddress)}" data-destination="${h(companyPickupAddress())}">Home → Work</button>
            <button class="button secondary" type="button" data-action="route-preset" data-purpose="Depot to home" data-pickup="${h(companyPickupAddress())}" data-destination="${h(homeAddress)}">Depot → Home</button>
          </div>
        </div>` : ""}
      <div class="field">
        <label for="${h(prefix)}-customer">${driverMode ? "Trip purpose" : "Customer"}</label>
        <input class="input" id="${h(prefix)}-customer" name="customerName" placeholder="${driverMode ? "Pickup, delivery, return home" : "Customer name"}" required>
      </div>
      <div class="field full">
        <label for="${h(prefix)}-pickup">Pickup</label>
        <input class="input" id="${h(prefix)}-pickup" name="pickup" value="${h(companyPickupAddress())}" required>
      </div>
      <div class="field full">
        <label for="${h(prefix)}-stops">Stops between pickup and destination</label>
        <textarea class="textarea" id="${h(prefix)}-stops" name="stopsText" placeholder="Second customer address&#10;Return depot"></textarea>
      </div>
      <div class="field full">
        <label for="${h(prefix)}-destination">Destination</label>
        <input class="input" id="${h(prefix)}-destination" name="destination" placeholder="Delivery address" required>
      </div>
      <div class="field full">
        <label for="${h(prefix)}-notes">Trip notes</label>
        <textarea class="textarea" id="${h(prefix)}-notes" name="notes" placeholder="Order details, waiting time, route notes"></textarea>
      </div>
      <div class="field full">
        <button class="button driver-primary-action" type="submit">${driverMode ? "Start trip" : "Start delivery"}</button>
      </div>
    </form>
  `;
}

function queuedDeliveryFormHtml() {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  const defaultMinutes = Number(state.snapshot?.company?.operations?.defaultWindowMinutes || 120);
  const end = new Date(start.getTime() + defaultMinutes * 60 * 1000);
  return `
    <form id="create-delivery-form" class="form-grid">
      <div class="field"><label for="delivery-customer">Customer name</label><input class="input" id="delivery-customer" name="customerName" autocomplete="name" required></div>
      <div class="field"><label for="delivery-phone">Customer phone</label><input class="input" id="delivery-phone" name="customerPhone" type="tel" autocomplete="tel"></div>
      <div class="field full"><label for="delivery-pickup">Pickup</label><input class="input" id="delivery-pickup" name="pickup" value="${h(companyPickupAddress())}" required></div>
      <div class="field full"><label for="delivery-destination">Delivery address</label><input class="input" id="delivery-destination" name="destination" autocomplete="street-address" required></div>
      <div class="field"><label for="delivery-window-start">Window starts</label><input class="input" id="delivery-window-start" name="deliveryWindowStart" type="datetime-local" value="${h(localDateTimeInputValue(start))}"></div>
      <div class="field"><label for="delivery-window-end">Deliver by</label><input class="input" id="delivery-window-end" name="deliveryWindowEnd" type="datetime-local" value="${h(localDateTimeInputValue(end))}"></div>
      <div class="field"><label for="delivery-priority">Priority</label><select class="select" id="delivery-priority" name="priority"><option value="standard">Standard</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select></div>
      <div class="field full"><label for="delivery-notes">Delivery notes</label><textarea class="textarea" id="delivery-notes" name="notes" placeholder="Access details, products, customer instructions"></textarea></div>
      <div class="field full"><button class="button" type="submit">Add to dispatch queue</button><p class="field-help">Add several deliveries, select them together, then preview or optimize the route.</p></div>
    </form>`;
}

function driverInviteText(driver) {
  if (driver.inviteStatus === "accepted") {
    return { label: "Account active", className: "available" };
  }
  if (driver.inviteStatus === "reset-pending") {
    return {
      label: driver.inviteEmailStatus === "sent" ? "Reset email sent" : "Reset link ready to share",
      className: "queued"
    };
  }
  if (driver.inviteStatus === "pending") {
    return {
      label: driver.inviteEmailStatus === "sent" ? "Invite email sent" : "Invite link ready to share",
      className: "queued"
    };
  }
  if (driver.inviteStatus === "expired") {
    return { label: "Invite expired", className: "offline" };
  }
  return { label: "Needs invitation", className: "offline" };
}

function driverInviteActionLabel(driver) {
  if (driver.inviteStatus === "accepted") return "Send password reset";
  if (["pending", "reset-pending"].includes(driver.inviteStatus)) return "Resend invitation";
  return "Send invitation";
}

function driverRow(driver) {
  const active = activeTrips().find((trip) => trip.driverId === driver.id);
  const inviteText = driverInviteText(driver);
  return `
    <tr>
      <td>
        <strong>${h(driver.name)}</strong>
        <div class="item-detail">${h(driver.email || driver.loginId || "No email")} · ${h(driver.phone || "No phone")} · ${h(driver.shift || "Shift not set")}</div>
        <div class="item-detail">Home: ${h(driver.homeAddress || "Not set")}</div>
      </td>
      <td>${h(driver.vehicle)}</td>
      <td>${statusPill(driver.status)}</td>
      <td>${active ? h(active.customerName) : "None"}</td>
      <td>${formatRate(driver.defaultRate)}</td>
      <td>${relativeTime(driver.lastSeenAt)}</td>
      <td>
        <div class="item-actions">
          <span class="status ${h(inviteText.className)}">${h(inviteText.label)}</span>
          <button class="button secondary" data-action="copy-driver-invite" data-driver-id="${h(driver.id)}" type="button">${h(driverInviteActionLabel(driver))}</button>
          <button class="button ghost" data-action="edit-driver" data-driver-id="${h(driver.id)}" type="button">Edit profile</button>
        </div>
      </td>
    </tr>
  `;
}

function driverCards() {
  if (!getDrivers().length) {
    return `<div class="empty">No drivers yet. Use Add driver to create the first profile and invitation.</div>`;
  }
  return `
    <div class="driver-roster-list">
      ${getDrivers()
        .map((driver) => {
          const active = activeTrips().find((trip) => trip.driverId === driver.id);
          const inviteText = driverInviteText(driver);
          return `
            <article class="driver-roster-card">
              <div class="driver-roster-head">
                <div class="driver-strip driver-identity">
                  <div class="avatar" style="background:${h(driver.color)}22;color:${h(driver.color)}">${h(initials(driver.name))}</div>
                  <div>
                    <p class="item-title">${h(driver.name)}</p>
                    <p class="item-detail">${h(driver.email || driver.loginId || "No login email")} · ${h(driver.phone || "No phone")}</p>
                  </div>
                </div>
                <button class="button" data-action="edit-driver" data-driver-id="${h(driver.id)}" type="button">Edit driver</button>
              </div>
              <div class="driver-facts">
                <div><span>Vehicle and shift</span><strong>${h(driver.vehicle)} · ${h(driver.shift || "Not set")}</strong></div>
                <div><span>Paid home address</span><strong>${h(driver.homeAddress || "Not set")}</strong></div>
                <div><span>Rate</span><strong>${formatRate(driver.defaultRate)}</strong></div>
                <div><span>Current work</span><strong>${active ? h(active.customerName) : "No active delivery"}</strong></div>
              </div>
              <div class="driver-roster-footer">
                <div class="item-actions">${statusPill(driver.status)}<span class="status ${h(inviteText.className)}">${h(inviteText.label)}</span><span class="item-detail">Last seen ${relativeTime(driver.lastSeenAt)}</span></div>
                <button class="button secondary" data-action="copy-driver-invite" data-driver-id="${h(driver.id)}" type="button">${h(driverInviteActionLabel(driver))}</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function courierRequestMethodLabel(partner) {
  if (partner.requestMethod === "email") return "Email request";
  if (partner.requestMethod === "booking") return "Booking page";
  return "Manual share";
}

function courierPartnerCards() {
  const partners = getCourierPartners();
  if (!partners.length) {
    return `<div class="empty compact-empty">No courier partners yet. Save the local courier companies you already use, then request them from selected orders.</div>`;
  }
  return `
    <div class="courier-partner-list">
      ${partners.map((partner) => `
        <article class="courier-partner-card">
          <div class="driver-roster-head">
            <div class="driver-strip driver-identity">
              <div class="avatar courier-avatar">${h(initials(partner.name))}</div>
              <div><p class="item-title">${h(partner.name)}</p><p class="item-detail">${h(partner.serviceArea || "Service area not set")}</p></div>
            </div>
            <button class="button secondary" data-action="edit-courier" data-courier-id="${h(partner.id)}" type="button">Edit partner</button>
          </div>
          <div class="driver-facts courier-facts">
            <div><span>Request method</span><strong>${h(courierRequestMethodLabel(partner))}</strong></div>
            <div><span>Email</span><strong>${h(partner.contactEmail || "Not set")}</strong></div>
            <div><span>Phone</span><strong>${h(partner.contactPhone || "Not set")}</strong></div>
            <div><span>Status</span><strong>${partner.active ? "Available for requests" : "Paused"}</strong></div>
          </div>
          ${partner.bookingUrl ? `<a class="button ghost courier-booking-link" href="${h(partner.bookingUrl)}" target="_blank" rel="noreferrer">Open booking page</a>` : ""}
        </article>`).join("")}
    </div>`;
}

function courierPartnerFields(partner = {}, prefix = "courier") {
  const requestMethod = partner.requestMethod || "email";
  return `
    <div class="field"><label for="${h(prefix)}-name">Company name</label><input class="input" id="${h(prefix)}-name" name="name" value="${h(partner.name || "")}" required></div>
    <div class="field"><label for="${h(prefix)}-method">Request method</label><select class="select" id="${h(prefix)}-method" name="requestMethod"><option value="email"${requestMethod === "email" ? " selected" : ""}>Email request</option><option value="booking"${requestMethod === "booking" ? " selected" : ""}>Booking page</option><option value="manual"${requestMethod === "manual" ? " selected" : ""}>Manual share</option></select></div>
    <div class="field"><label for="${h(prefix)}-email">Request email</label><input class="input" id="${h(prefix)}-email" name="contactEmail" type="email" autocomplete="email" value="${h(partner.contactEmail || "")}" placeholder="dispatch@courier.ca"></div>
    <div class="field"><label for="${h(prefix)}-phone">Phone</label><input class="input" id="${h(prefix)}-phone" name="contactPhone" value="${h(partner.contactPhone || "")}"></div>
    <div class="field full"><label for="${h(prefix)}-area">Service area</label><input class="input" id="${h(prefix)}-area" name="serviceArea" value="${h(partner.serviceArea || "")}" placeholder="Ottawa and Gatineau"></div>
    <div class="field full"><label for="${h(prefix)}-booking">Booking page</label><input class="input" id="${h(prefix)}-booking" name="bookingUrl" type="url" value="${h(partner.bookingUrl || "")}" placeholder="https://courier.example/request"></div>
    <div class="field full"><label for="${h(prefix)}-notes">Internal partner notes</label><textarea class="textarea" id="${h(prefix)}-notes" name="notes" placeholder="Hours, service limits, account number location">${h(partner.notes || "")}</textarea></div>`;
}

function courierPartnersWorkspaceHtml() {
  return `
    <div class="panel courier-partners-panel">
      <div class="panel-header">
        <div><p class="eyebrow">Outside coverage</p><h3 class="panel-title">Courier partners</h3><p class="panel-subtitle">Save preferred delivery providers without creating fake driver accounts.</p></div>
        <span class="delivery-health ${state.snapshot?.courierEmail?.configured ? "ready" : "manual"}">${state.snapshot?.courierEmail?.configured ? "Automatic request email connected" : "Email draft fallback"}</span>
      </div>
      <div class="panel-body">${courierPartnerCards()}</div>
    </div>
    <details class="panel manage-panel" id="add-courier">
      <summary class="manage-summary"><span><span class="panel-title">Add a courier partner</span><span class="panel-subtitle">Choose email, booking page, or a manual share workflow.</span></span><span class="summary-control" aria-hidden="true">+</span></summary>
      <div class="panel-body">
        <form id="add-courier-form" class="form-grid">
          ${courierPartnerFields()}
          <div class="field full"><div class="empty compact-empty courier-honesty-note">Rivo sends automatically only when a dedicated courier email sender is configured. Otherwise it prepares a request you can open or copy, clearly marked as not sent.</div></div>
          <div class="field full"><button class="button courier-action" type="submit">Save courier partner</button></div>
        </form>
      </div>
    </details>`;
}

function courierPartnerEditModalHtml() {
  const partner = getCourierPartner(state.editingCourierId);
  if (!partner) return "";
  return `
    <div class="modal-backdrop" role="presentation" data-modal-backdrop>
      <section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="courier-editor-title" data-modal-panel>
        <div class="modal-header"><div><p class="eyebrow">Courier partner</p><h2 id="courier-editor-title">${h(partner.name)}</h2><p>Edit how requests are prepared and where provider updates are recorded.</p></div><button class="icon-button" data-action="close-courier-editor" type="button" aria-label="Close courier editor">×</button></div>
        <form id="edit-courier-form" class="form-grid modal-form">
          <input type="hidden" name="courierPartnerId" value="${h(partner.id)}">
          ${courierPartnerFields(partner, "edit-courier")}
          <div class="field"><label for="edit-courier-active">Availability</label><select class="select" id="edit-courier-active" name="active"><option value="true"${partner.active ? " selected" : ""}>Available for requests</option><option value="false"${partner.active ? "" : " selected"}>Paused</option></select></div>
          <div class="modal-actions"><button class="button danger" data-action="archive-courier" data-courier-id="${h(partner.id)}" data-courier-name="${h(partner.name)}" type="button">Archive partner</button><span></span><button class="button secondary" data-action="close-courier-editor" type="button">Cancel</button><button class="button" type="submit">Save partner</button></div>
        </form>
      </section>
    </div>`;
}

function localDateTimeInputValue(date = new Date(Date.now() + 60 * 60 * 1000)) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function courierRequestModalHtml() {
  const selectedIds = new Set(state.courierRequestTripIds || []);
  const trips = getTrips().filter((trip) => selectedIds.has(trip.id));
  if (!trips.length) return "";
  const partners = getCourierPartners().filter((partner) => partner.active);
  const pickupCount = new Set(trips.map((trip) => String(trip.pickup || "").trim().toLowerCase())).size;
  return `
    <div class="modal-backdrop" role="presentation" data-modal-backdrop>
      <section class="modal-sheet courier-request-modal" role="dialog" aria-modal="true" aria-labelledby="courier-request-title" data-modal-panel>
        <div class="modal-header"><div><p class="eyebrow">External delivery</p><h2 id="courier-request-title">Request a courier for ${trips.length} order${trips.length === 1 ? "" : "s"}</h2><p>Rivo records the handoff without pretending the courier has Rivo driver GPS.</p></div><button class="icon-button" data-action="close-courier-request" type="button" aria-label="Close courier request">×</button></div>
        <div class="courier-request-summary">
          <div><span>Pickup</span><strong>${h(pickupCount === 1 ? trips[0].pickup : `${pickupCount} different pickup addresses`)}</strong></div>
          <div><span>Deliveries</span><strong>${trips.length}</strong></div>
        </div>
        <div class="courier-request-stops">${trips.map((trip, index) => `<div><span>${index + 1}</span><p><strong>${h(trip.customerName)}</strong><small>${h(trip.destination)}</small></p></div>`).join("")}</div>
        ${partners.length ? `
          <form id="courier-request-form" class="form-grid modal-form">
            <div class="field full"><label for="request-courier-partner">Courier partner</label><select class="select" id="request-courier-partner" name="courierPartnerId" required>${partners.map((partner) => `<option value="${h(partner.id)}">${h(partner.name)} · ${h(courierRequestMethodLabel(partner))}</option>`).join("")}</select></div>
            <div class="field"><label for="request-pickup-time">Requested pickup</label><input class="input" id="request-pickup-time" name="requestedPickupAt" type="datetime-local" value="${h(localDateTimeInputValue())}"></div>
            <div class="field"><label for="request-service">Service level</label><select class="select" id="request-service" name="serviceLevel"><option>Same-day</option><option>On-demand</option><option>Scheduled</option><option>Priority</option></select></div>
            <div class="field"><label for="request-fee">Expected or quoted fee</label><input class="input" id="request-fee" name="quotedFee" type="number" min="0" step="0.01" placeholder="Optional"></div>
            <div class="field full"><label for="request-notes">Notes safe to send to the courier</label><textarea class="textarea" id="request-notes" name="notes" placeholder="Pickup contact, delivery window, handling instructions"></textarea></div>
            <div class="field full courier-send-disclosure">The saved partner method determines whether Rivo emails automatically, opens a booking page, or creates a request to share manually. The result will say clearly whether anything was sent.</div>
            <div class="modal-actions simple"><span></span><button class="button secondary" data-action="close-courier-request" type="button">Cancel</button><button class="button courier-action" type="submit" ${pickupCount === 1 ? "" : "disabled"}>Create courier request</button></div>
          </form>` : `
          <div class="modal-form"><div class="empty">Add a courier partner before requesting outside coverage.</div><div class="modal-actions simple"><span></span><button class="button secondary" data-action="close-courier-request" type="button">Cancel</button><button class="button courier-action" data-action="go-to-couriers" type="button">Add courier partner</button></div></div>`}
      </section>
    </div>`;
}

function courierRequestStatusOptions(currentStatus) {
  const options = ["ready-to-share", "send-failed", "requested", "accepted", "picked-up", "delivered", "declined", "cancelled"];
  return options.map((status) => `<option value="${h(status)}"${status === currentStatus ? " selected" : ""}>${h(statusLabels[status] || status)}</option>`).join("");
}

function courierRequestCard(request) {
  const isOpen = ["ready-to-share", "send-failed", "requested", "accepted", "picked-up"].includes(request.status);
  const actionLabel = request.status === "send-failed" ? "Email failed — use prepared request" : request.status === "ready-to-share" ? "Not sent yet — share this request" : "Provider response recorded";
  return `
    <article class="courier-request-card${isOpen ? " is-open" : ""}">
      <div class="courier-request-head"><div><strong>${h(request.partner?.name || "Courier partner")}</strong><span>${request.deliveries.length} deliver${request.deliveries.length === 1 ? "y" : "ies"} · ${h(request.serviceLevel)}</span></div>${statusPill(request.status)}</div>
      <p class="courier-request-state">${h(actionLabel)}${request.deliveryError ? ` · ${h(request.deliveryError)}` : ""}</p>
      <div class="courier-request-meta"><span><small>Pickup</small>${h(request.pickup)}</span><span><small>Requested</small>${h(request.requestedPickupAt ? formatDate(request.requestedPickupAt) : "As available")}</span><span><small>Reference</small>${h(request.referenceNumber || "Not added")}</span><span><small>Fee</small>${request.quotedFee === null ? "Not added" : h(formatMoney(request.quotedFee))}</span></div>
      ${request.trackingUrl ? `<a class="button secondary" href="${h(request.trackingUrl)}" target="_blank" rel="noreferrer">Open courier tracking</a>` : ""}
      ${["ready-to-share", "send-failed"].includes(request.status) ? `<div class="item-actions courier-share-actions">${request.mailtoUrl ? `<a class="button courier-action" href="${h(request.mailtoUrl)}">Open email draft</a>` : ""}${request.bookingUrl ? `<a class="button courier-action" href="${h(request.bookingUrl)}" target="_blank" rel="noreferrer">Open booking page</a>` : ""}${request.phoneUrl ? `<a class="button secondary" href="${h(request.phoneUrl)}">Call courier</a>` : ""}<button class="button ghost" data-action="copy" data-copy="${h(request.summary)}" type="button">Copy request</button></div>` : ""}
      <details class="courier-request-editor"><summary>Update courier request</summary><form class="form-grid compact" data-courier-request-update="${h(request.id)}"><div class="field"><label>Status</label><select class="select" name="status">${courierRequestStatusOptions(request.status)}</select></div><div class="field"><label>Provider reference</label><input class="input" name="referenceNumber" value="${h(request.referenceNumber || "")}"></div><div class="field"><label>Courier fee</label><input class="input" name="quotedFee" type="number" min="0" step="0.01" value="${request.quotedFee === null ? "" : h(request.quotedFee)}"></div><div class="field full"><label>Tracking link</label><input class="input" name="trackingUrl" type="url" value="${h(request.trackingUrl || "")}" placeholder="https://courier.example/track/..."></div><div class="field full"><label>Request notes</label><textarea class="textarea" name="notes">${h(request.notes || "")}</textarea></div><div class="field full"><button class="button" type="submit">Save request update</button></div></form></details>
    </article>`;
}

function courierRequestsPanelHtml() {
  const requests = getCourierRequests().slice().sort((left, right) => {
    const leftOpen = ["ready-to-share", "send-failed", "requested", "accepted", "picked-up"].includes(left.status) ? 1 : 0;
    const rightOpen = ["ready-to-share", "send-failed", "requested", "accepted", "picked-up"].includes(right.status) ? 1 : 0;
    return rightOpen - leftOpen || new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  }).slice(0, 8);
  if (!requests.length) return "";
  const openCount = requests.filter((request) => ["ready-to-share", "send-failed", "requested", "accepted", "picked-up"].includes(request.status)).length;
  return `
    <details class="panel manage-panel courier-requests-panel"${openCount ? " open" : ""}>
      <summary class="manage-summary"><span><span class="panel-title">Courier requests</span><span class="panel-subtitle">Track outside coverage, references, fees, and provider links beside the order.</span></span><span class="count-chip">${openCount}</span></summary>
      <div class="panel-body courier-request-list">${requests.map(courierRequestCard).join("")}</div>
    </details>`;
}

function driverEditModalHtml() {
  const driver = getDriver(state.editingDriverId);
  if (!driver) return "";
  return `
    <div class="modal-backdrop" role="presentation" data-modal-backdrop>
      <section class="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="driver-editor-title" data-modal-panel>
        <div class="modal-header">
          <div><p class="eyebrow">Driver profile</p><h2 id="driver-editor-title">${h(driver.name)}</h2><p>Edit login email, paid home routes, vehicle, shift, capacity, and rate.</p></div>
          <button class="icon-button" data-action="close-driver-editor" type="button" aria-label="Close driver editor">×</button>
        </div>
        <form id="edit-driver-form" class="form-grid modal-form">
          <input type="hidden" name="driverId" value="${h(driver.id)}">
          <div class="field"><label for="edit-driver-name">Name</label><input class="input" id="edit-driver-name" name="name" value="${h(driver.name)}" required></div>
          <div class="field"><label for="edit-driver-email">Login email</label><input class="input" id="edit-driver-email" name="email" type="email" value="${h(driver.email || "")}" required></div>
          <div class="field"><label for="edit-driver-phone">Phone</label><input class="input" id="edit-driver-phone" name="phone" value="${h(driver.phone || "")}"></div>
          <div class="field"><label for="edit-driver-vehicle">Vehicle</label><input class="input" id="edit-driver-vehicle" name="vehicle" value="${h(driver.vehicle || "")}" required></div>
          <div class="field"><label for="edit-driver-shift">Shift</label><input class="input" id="edit-driver-shift" name="shift" value="${h(driver.shift || "")}"></div>
          <div class="field"><label for="edit-driver-rate">Rate per km</label><input class="input" id="edit-driver-rate" name="defaultRate" type="number" min="0" step="0.01" value="${h(driver.defaultRate || 0)}" required></div>
          <div class="field"><label for="edit-driver-capacity">Route capacity</label><input class="input" id="edit-driver-capacity" name="capacity" type="number" min="1" max="100" step="1" value="${h(driver.capacity || 20)}" required><small>Maximum active stops used by Smart Dispatch.</small></div>
          <div class="field full"><label for="edit-driver-home">Paid home address</label><input class="input" id="edit-driver-home" name="homeAddress" autocomplete="street-address" value="${h(driver.homeAddress || "")}" required><small>Used for Home → Work and Depot → Home paid trips.</small></div>
          <fieldset class="color-field field full"><legend>Map colour</legend><div class="color-swatches" role="radiogroup" aria-label="Driver map colour">${colorSwatchesHtml(driver.color)}</div></fieldset>
          <div class="modal-actions"><button class="button danger" data-action="delete-driver" data-driver-id="${h(driver.id)}" data-driver-name="${h(driver.name)}" type="button">Archive driver</button><span></span><button class="button secondary" data-action="close-driver-editor" type="button">Cancel</button><button class="button" type="submit">Save driver</button></div>
        </form>
      </section>
    </div>`;
}

function tripLogRows(trips, options = {}) {
  if (!trips.length) {
    return `
      <tr>
        <td colspan="9">No trips for this selection.</td>
      </tr>
    `;
  }
  return trips
    .map((trip) => {
      const canSubmit = options.driverActions && ["completed", "rejected", "failed"].includes(trip.status);
      const canApprove = options.approvalActions && trip.status === "submitted";
      return `
        <tr>
          <td>
            <strong>${h(trip.customerName)}</strong>
            <div class="item-detail">${h(routeSummary(trip))}</div>
            ${trip.proof ? proofRecordHtml(trip, { compact: true }) : ""}
          </td>
          <td>${h(trip.driver?.name || trip.courier?.name || "")}</td>
          <td>${statusPill(trip.status)}</td>
          <td>${formatDate(trip.startedAt)}</td>
          <td>${trip.endedAt ? formatDate(trip.endedAt) : "In progress"}</td>
          <td>${formatKm(isBusinessTrip(trip) ? trip.businessDistanceKm : trip.personalDistanceKm || trip.distanceKm)}</td>
          <td>${formatRate(trip.kmRate)}</td>
          <td class="money">${formatMoney(trip.billableAmount)}</td>
          <td>
            ${
              canSubmit
                ? `<button class="button secondary" data-action="submit-trip" data-trip-id="${h(trip.id)}">Submit</button>`
                : canApprove
                  ? `<div class="item-actions">
                      <button class="button success" data-action="approve-trip" data-trip-id="${h(trip.id)}">Approve</button>
                      <button class="button danger" data-action="reject-trip" data-trip-id="${h(trip.id)}">Reject</button>
                    </div>`
                  : h(trip.approvalNotes || trip.notes || "")
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

function tripLogCards(trips, options = {}) {
  if (!trips.length) {
    return `<div class="mobile-log-list"><div class="empty">No trips for this selection.</div></div>`;
  }
  return `
    <div class="mobile-log-list">
      ${trips
        .map((trip) => {
          const canSubmit = options.driverActions && ["completed", "rejected", "failed"].includes(trip.status);
          const canApprove = options.approvalActions && trip.status === "submitted";
          return `
            <div class="item trip-card">
              <div class="item-main">
                <div>
                  <p class="item-title">${h(trip.customerName)}</p>
                  <p class="item-detail">${h(trip.driver?.name || trip.courier?.name || "")} · ${formatDate(trip.startedAt)}</p>
                </div>
                <div class="item-actions">${statusPill(trip.status)}</div>
              </div>
              <div class="item-detail">${h(routeSummary(trip))}</div>
              ${trip.proof ? proofRecordHtml(trip, { compact: true }) : ""}
              <div class="trip-card-metrics">
                <span>${formatKm(isBusinessTrip(trip) ? trip.businessDistanceKm : trip.personalDistanceKm || trip.distanceKm)}</span>
                <span>${formatRate(trip.kmRate)}</span>
                <strong>${formatMoney(trip.billableAmount)}</strong>
              </div>
              ${
                canSubmit
                  ? `<button class="button secondary" data-action="submit-trip" data-trip-id="${h(trip.id)}">Submit</button>`
                  : canApprove
                    ? `<div class="item-actions">
                        <button class="button success" data-action="approve-trip" data-trip-id="${h(trip.id)}">Approve</button>
                        <button class="button danger" data-action="reject-trip" data-trip-id="${h(trip.id)}">Reject</button>
                      </div>`
                    : `<div class="item-detail">${h(trip.approvalNotes || trip.notes || "")}</div>`
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLogin() {
  const companyName = state.company?.name || state.snapshot?.company?.name || "Rivo";
  app.innerHTML = `
    <div class="public-shell">
      <header class="public-nav">
        <div class="brand">
          <div class="rova-symbol public-brand-mark" aria-hidden="true"><img src="/assets/rova-mark.svg" alt=""></div>
          <div class="brand-text">
            <div class="brand-name">Rivo</div>
            <div class="brand-subtitle">Operations platform</div>
          </div>
        </div>
        <a class="button secondary public-login-link" href="https://floraljet.llc/">Visit website</a>
      </header>

      <main class="public-main app-login-main">
        <section class="app-gateway" aria-label="Rivo app login">
          <div class="app-gateway-copy">
            <p class="public-badge">Rivo app</p>
            <h1 class="app-gateway-title">Run the delivery day without the chaos.</h1>
            <p class="app-gateway-subtitle">Bring orders into one queue, plan the routes, dispatch your own drivers, and keep every customer update and proof record attached to the work.</p>
            <div class="app-gateway-status" aria-label="Application status">
              <span class="app-status-dot"></span>
              <strong>App online</strong>
              <small>Secure access for dispatchers and invited drivers</small>
            </div>
            <div class="app-gateway-grid" aria-label="Workspace areas">
              <div><strong>Today</strong><span>Orders, routes, assignments, and live progress.</span></div>
              <div><strong>Driver app</strong><span>Assigned stops, directions, status, and proof.</span></div>
              <div><strong>Connect anything</strong><span>Any website, store, POS, webhook, or API.</span></div>
            </div>
          </div>

          <div class="app-gateway-login" id="login">
            <div class="panel login-panel">
              <div class="panel-header">
                <div>
                  <h2 class="panel-title">Sign in</h2>
                  <p class="panel-subtitle">Sign in to the ${h(companyName)} workspace.</p>
                </div>
              </div>
              <div class="panel-body">
                ${state.loginError ? `<div class="lead-message error">${h(state.loginError)}</div>` : ""}
                <form id="login-form" class="form-grid">
                  <div class="field full">
                    <label for="login-identifier">Email or dispatcher username</label>
                    <input class="input" id="login-identifier" name="identifier" type="text" autocomplete="username" placeholder="driver@company.com" value="${h(state.ownerRecoveryIdentifier)}" required>
                  </div>
                  <div class="field full">
                    <label for="login-password">Password</label>
                    <div class="password-field"><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required><button class="password-toggle" data-action="toggle-password" data-target="login-password" type="button">Show</button></div>
                  </div>
                  <div class="field full">
                    <button class="button" type="submit">Log in</button>
                  </div>
                </form>
                ${state.ownerCreated && state.setupEnabled ? state.ownerRecoveryMode ? `
                  <section class="owner-recovery" aria-label="Owner account recovery">
                    <div class="owner-recovery-heading"><div><strong>Repair owner sign-in</strong><span>Use the setup code for this workspace and choose a new password. Delivery records will not be changed.</span></div><button class="button ghost compact-action" data-action="toggle-owner-recovery" type="button">Cancel</button></div>
                    ${state.ownerRecoveryError ? `<div class="lead-message error">${h(state.ownerRecoveryError)}</div>` : ""}
                    <form id="owner-recovery-form" class="form-grid">
                      <div class="field full"><label for="recovery-identifier">Dispatcher username</label><input class="input" id="recovery-identifier" name="identifier" autocomplete="username" value="${h(state.ownerRecoveryIdentifier)}" required></div>
                      <div class="field full"><label for="recovery-code">Owner setup code</label><div class="password-field"><input class="input" id="recovery-code" name="setupCode" type="password" autocomplete="one-time-code" required><button class="password-toggle" data-action="toggle-password" data-target="recovery-code" type="button">Show</button></div></div>
                      <div class="field full"><label for="recovery-password">New password</label><div class="password-field"><input class="input" id="recovery-password" name="password" type="password" autocomplete="new-password" minlength="8" required><button class="password-toggle" data-action="toggle-password" data-target="recovery-password" type="button">Show</button></div></div>
                      <div class="field full"><label for="recovery-confirm">Confirm new password</label><input class="input" id="recovery-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div>
                      <div class="field full"><button class="button" type="submit">Upgrade password and sign in</button></div>
                    </form>
                  </section>` : `<button class="owner-recovery-link" data-action="toggle-owner-recovery" type="button">Owner locked out?</button>` : ""}
                <details class="login-support"><summary>Driver sign-in help</summary><div><strong>First time here?</strong> Open the latest invitation from your dispatcher and create your password. Returning drivers sign in with their email. If your link expired or you forgot your password, ask dispatch to send a new secure link.</div></details>
                <div class="login-help"><strong>New to Rivo?</strong> <a href="https://floraljet.llc/contact.html">Book a guided walkthrough</a>.</div>
                ${!state.ownerCreated && state.setupEnabled ? `
                  <div class="item-actions" style="margin-top:14px">
                    <button class="button secondary" data-action="show-setup" type="button">Create owner account</button>
                  </div>
                ` : ""}
              </div>
            </div>

            <div class="app-gateway-meta" aria-label="Workspace access notes">
              <div>
                <strong>Dispatcher access</strong>
                <span>Owners and dispatchers use their workspace credentials.</span>
              </div>
              <div>
                <strong>Driver access</strong>
                <span>Drivers must accept an invitation before their password exists.</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

function renderDriverInvite() {
  const profile = state.inviteProfile;
  app.innerHTML = `
    <div class="invite-shell">
      <aside class="invite-story">
        <a class="invite-brand" href="https://floraljet.llc/" aria-label="Rivo website">
          <span class="rova-symbol" aria-hidden="true"><img src="/assets/rova-mark.svg" alt=""></span><strong>Rivo</strong>
        </a>
        <div>
          <p class="public-badge">Driver access</p>
          <h1>Your route, stops, proof, and paid mileage in one place.</h1>
          <p>Accept this invitation once. After that, sign in with your email and the password you choose here.</p>
        </div>
        <div class="invite-benefits" aria-label="Driver app features">
          <div><span>01</span><strong>See today’s route</strong><small>Stops, customer notes, and navigation stay together.</small></div>
          <div><span>02</span><strong>Share live progress</strong><small>Location is shared only while you run an active trip.</small></div>
          <div><span>03</span><strong>Keep paid work clear</strong><small>Delivery mileage, standby trips, and approvals remain visible.</small></div>
        </div>
      </aside>
      <main class="invite-main">
        <section class="invite-card" aria-live="polite">
          <div class="invite-step">Account setup · 1 minute</div>
          <h2>${profile ? `Welcome, ${h(profile.name)}` : state.inviteError ? "Invitation unavailable" : "Checking invitation…"}</h2>
          <p class="invite-card-copy">${profile ? `Create the password for <strong>${h(profile.email)}</strong>. This email becomes your Rivo sign-in.` : state.inviteError ? "This link cannot be used. It may have expired or already been replaced." : "Please wait while Rivo verifies your secure link."}</p>
          ${state.inviteError ? `
            <div class="inline-alert error"><strong>We couldn’t open this invitation.</strong><span>${h(state.inviteError)}</span></div>
            <div class="invite-actions"><button class="button" data-action="show-login" type="button">Go to sign in</button><a class="button secondary" href="mailto:hello@floraljet.llc?subject=Driver%20invitation%20help">Get help</a></div>` : ""}
          ${profile ? `
            ${state.inviteActionError ? `<div class="inline-alert error"><strong>Account not created.</strong><span>${h(state.inviteActionError)}</span></div>` : ""}
            <form id="accept-invite-form" class="form-grid invite-form">
              <div class="field full">
                <label for="invite-password">Create password</label>
                <div class="password-field"><input class="input" id="invite-password" name="password" type="password" autocomplete="new-password" minlength="8" required><button class="password-toggle" data-action="toggle-password" data-target="invite-password" type="button">Show</button></div>
                <small>Use at least 8 characters.</small>
              </div>
              <div class="field full">
                <label for="invite-confirm">Confirm password</label>
                <div class="password-field"><input class="input" id="invite-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required><button class="password-toggle" data-action="toggle-password" data-target="invite-confirm" type="button">Show</button></div>
              </div>
              <div class="field full"><button class="button invite-submit" type="submit">Create account and open driver app</button></div>
            </form>
            <div class="invite-security"><span aria-hidden="true">✓</span><p><strong>Single-use secure link</strong><br>This invitation expires ${profile.expiresAt ? formatDate(profile.expiresAt) : "after 7 days"} and cannot be reused after account creation.</p></div>` : ""}
        </section>
      </main>
    </div>`;
}

function renderOwnerSetup() {
  const companyName = state.company?.name || "Rivo";
  app.innerHTML = `
    <div class="main">
      <section class="panel" style="max-width:520px;margin:7vh auto 0">
        <div class="panel-header">
          <div>
            <h1 class="panel-title">Create Owner Account</h1>
            <p class="panel-subtitle">Set up the dispatcher login for ${h(companyName)}.</p>
          </div>
        </div>
        <div class="panel-body">
          ${state.setupError ? `<div class="empty">${h(state.setupError)}</div>` : ""}
          <form id="owner-setup-form" class="form-grid">
            <div class="field full">
              <label for="setup-code">Setup code</label>
              <input class="input" id="setup-code" name="setupCode" autocomplete="one-time-code" required>
            </div>
            <div class="field full">
              <label for="setup-company">Company name</label>
              <input class="input" id="setup-company" name="companyName" value="${h(companyName)}" required>
            </div>
            <div class="field full">
              <label for="setup-pickup">Primary pickup or depot</label>
              <input class="input" id="setup-pickup" name="pickupAddress" autocomplete="street-address" placeholder="Street address, city, province" required>
            </div>
            <div class="field">
              <label for="setup-name">Your name</label>
              <input class="input" id="setup-name" name="name" autocomplete="name">
            </div>
            <div class="field">
              <label for="setup-username">Username</label>
              <input class="input" id="setup-username" name="username" autocomplete="username" required>
            </div>
            <div class="field">
              <label for="setup-currency">Currency</label>
              <select class="select" id="setup-currency" name="currency"><option value="CAD" selected>CAD</option><option value="USD">USD</option></select>
            </div>
            <div class="field">
              <label for="setup-timezone">Time zone</label>
              <select class="select" id="setup-timezone" name="timeZone"><option value="America/Toronto" selected>Toronto</option><option value="America/Vancouver">Vancouver</option><option value="America/Edmonton">Edmonton</option><option value="America/Winnipeg">Winnipeg</option><option value="America/New_York">New York</option><option value="America/Chicago">Chicago</option><option value="America/Denver">Denver</option><option value="America/Los_Angeles">Los Angeles</option></select>
            </div>
            <div class="field full">
              <label for="setup-support">Support email</label>
              <input class="input" id="setup-support" name="supportEmail" type="email" autocomplete="email" placeholder="dispatch@yourbusiness.com" required>
            </div>
            <div class="field">
              <label for="setup-password">Password</label>
              <input class="input" id="setup-password" name="password" type="password" autocomplete="current-password" minlength="8" required>
            </div>
            <div class="field full split-actions">
              <button class="button" type="submit">Create Account</button>
              <button class="button secondary" data-action="show-login" type="button">Back to login</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  `;
}

function leadStagePill(stage) {
  const safeStage = leadStageLabels[stage] ? stage : "new";
  return `<span class="lead-stage ${h(safeStage)}">${h(leadStageLabels[safeStage])}</span>`;
}

function leadCardHtml(lead) {
  const actions = [
    ["qualified", "Qualify"],
    ["pilot", "Evaluation"],
    ["won", "Won"],
    ["lost", "Lost"]
  ].filter(([stage]) => stage !== lead.stage);
  const weekly = Number(lead.weeklyDeliveries || 0);
  const attribution = lead.attribution || {};
  const source = attribution.source || "direct";
  const reviewPreference = lead.preferredReviewDate
    ? `${lead.preferredReviewDate}${lead.preferredReviewWindow ? ` · ${lead.preferredReviewWindow}` : ""}`
    : "";
  return `
    <article class="lead-card">
      <div class="lead-card-main">
        <div>
          <div class="lead-card-title">${h(lead.companyName)}</div>
          <div class="lead-card-detail">${h(lead.contactName)} · ${h(lead.email)}${lead.phone ? ` · ${h(lead.phone)}` : ""}</div>
        </div>
        ${leadStagePill(lead.stage)}
      </div>
      <div class="lead-facts">
        <span>${weekly ? `${weekly.toLocaleString()} weekly deliveries` : "Volume not entered"}</span>
        <span>${h(lead.deliveryCategory || "Delivery business")}</span>
        <span>${h(lead.primaryChannel || "Channel unknown")}</span>
        <span>Source ${h(source)}</span>
        ${attribution.campaign ? `<span>Campaign ${h(attribution.campaign)}</span>` : ""}
        ${reviewPreference ? `<span>Review ${h(reviewPreference)}</span>` : ""}
        ${lead.preferredContactMethod ? `<span>Contact by ${h(lead.preferredContactMethod)}</span>` : ""}
        <span>Fit ${Number(lead.score || 0)}/100</span>
        <span>Received ${h(formatDate(lead.createdAt))}</span>
      </div>
      ${lead.notes ? `<p class="lead-notes">${h(lead.notes)}</p>` : ""}
      <div class="item-actions">
        ${actions.map(([stage, label]) => `<button class="button secondary" data-action="lead-stage" data-lead-id="${h(lead.id)}" data-stage="${h(stage)}" type="button">${h(label)}</button>`).join("")}
      </div>
    </article>
  `;
}

function renderAccountsHtml() {
  const leads = getLeads().slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const activeLeads = leads.filter((lead) => !["won", "lost"].includes(lead.stage));
  const qualified = leads.filter((lead) => ["qualified", "pilot"].includes(lead.stage)).length;
  const pilots = leads.filter((lead) => lead.stage === "pilot").length;
  const customers = leads.filter((lead) => lead.stage === "won").length;
  const sourceBreakdown = Object.entries(leads.reduce((counts, lead) => {
    const source = lead.attribution?.source || "direct";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {})).sort((left, right) => right[1] - left[1]);
  const averageWeeklyVolume = leads.length
    ? Math.round(leads.reduce((total, lead) => total + Number(lead.weeklyDeliveries || 0), 0) / leads.length)
    : 0;
  return `
    <section class="dispatch-view${state.dispatcherView === "accounts" ? " active" : ""} dashboard-section view-section" id="accounts">
      <div class="accounts-grid growth-grid">
        <div class="panel accounts-command-panel growth-command-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Accounts</p>
              <h2 class="panel-title">Operational reviews</h2>
              <p class="panel-subtitle">Private dispatcher workspace for inbound requests, qualification, and onboarding.</p>
            </div>
            <span class="count-chip">${activeLeads.length}</span>
          </div>
          <div class="panel-body">
            <div class="lead-list">
              ${leads.length ? leads.map(leadCardHtml).join("") : `<div class="empty">New operational-review requests appear here after the public form is submitted.</div>`}
            </div>
          </div>
        </div>

        <div class="accounts-side growth-side">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">Pipeline status</h3>
                <p class="panel-subtitle">A quick read on accounts moving from review into evaluation and onboarding.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="accounts-stats growth-stats">
                <div><span>Active</span><strong>${activeLeads.length}</strong></div>
                <div><span>Qualified</span><strong>${qualified}</strong></div>
                <div><span>Evaluations</span><strong>${pilots}</strong></div>
                <div><span>Customers</span><strong>${customers}</strong></div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">Acquisition sources</h3>
                <p class="panel-subtitle">Verified inbound requests grouped by their first recorded campaign source.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="accounts-checklist growth-checklist">
                ${sourceBreakdown.length
                  ? sourceBreakdown.slice(0, 6).map(([source, count]) => `<div><strong>${h(source)}</strong><span>${count} request${count === 1 ? "" : "s"}</span></div>`).join("")
                  : `<div><strong>No requests yet</strong><span>Campaign attribution appears after the first operational-review form is submitted.</span></div>`}
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">Qualification signals</h3>
                <p class="panel-subtitle">Prioritize teams with enough volume and urgency to justify implementation.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="accounts-checklist growth-checklist">
                <div><strong>50-500 deliveries/week</strong><span>Enough volume to feel routing, status, and payroll pain.</span></div>
                <div><strong>Multi-channel orders</strong><span>Shopify, Square, WooCommerce, Wix, phone, or API orders in one queue.</span></div>
                <div><strong>Owned drivers</strong><span>Internal or contractor fleet with accountability and payroll needs.</span></div>
                <div><strong>High-value deliveries</strong><span>Pharmacy, cannabis, floral, courier, restaurant groups, retail.</span></div>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">Onboarding checklist</h3>
                <p class="panel-subtitle">Move a qualified account into daily use with the core operational setup.</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="accounts-checklist growth-checklist">
                <div><strong>Connect orders</strong><span>Link Wix, Shopify, WooCommerce, Square, or webhook intake.</span></div>
                <div><strong>Add drivers</strong><span>Send invitation links so every driver can create their own account.</span></div>
                <div><strong>Run the evaluation</strong><span>Dispatch live work, confirm tracking, then review mileage and payroll.</span></div>
              </div>
              <div class="accounts-stats growth-stats">
                <div><span>Evaluations</span><strong>${pilots}</strong></div>
                <div><span>Avg. weekly</span><strong>${averageWeeklyVolume}</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function onboardingSteps() {
  const company = state.snapshot?.company || {};
  const trips = getTrips();
  return [
    { label: "Configure workspace", detail: "Company, depot, currency, and time zone", done: Boolean(company.name && company.pickupAddress && company.timeZone) },
    { label: "Add a driver", detail: "Invite at least one driver to create an account", done: getDrivers().length > 0 },
    { label: "Add or connect orders", detail: "Enter deliveries manually or connect Shopify, WooCommerce, Wix, or a webhook", done: Boolean(state.snapshot?.integrations?.connections?.length || trips.length) },
    { label: "Create a delivery", detail: "Import or enter the first customer delivery", done: trips.length > 0 },
    { label: "Complete a live run", detail: "Dispatch, track, and close one delivery", done: trips.some((trip) => ["delivered", "completed", "submitted", "approved"].includes(trip.status)) }
  ];
}

function onboardingHtml(options = {}) {
  const steps = onboardingSteps();
  const complete = steps.filter((step) => step.done).length;
  if (options.compact && complete === steps.length) return "";
  const percent = Math.round((complete / steps.length) * 100);
  if (options.compact) {
    const nextStep = steps.find((step) => !step.done);
    return `
      <section class="setup-strip" aria-label="Workspace setup progress">
        <div class="setup-strip-copy"><span class="onboarding-check">${complete}</span><div><strong>${complete} of ${steps.length} setup steps complete</strong><span>Next: ${h(nextStep?.label || "Workspace ready")}</span></div></div>
        <div class="onboarding-progress" aria-label="${percent}% complete"><span style="width:${percent}%"></span></div>
        <button class="button secondary compact-action" data-action="dispatcher-view" data-view="settings" type="button">Finish setup</button>
      </section>`;
  }
  return `
    <section class="panel onboarding-panel${options.compact ? " onboarding-compact" : ""}" aria-label="Workspace onboarding">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Go live checklist</p>
          <h2 class="panel-title">${complete === steps.length ? "Workspace ready" : `${complete} of ${steps.length} setup steps complete`}</h2>
          <p class="panel-subtitle">Finish these steps before running the first customer delivery.</p>
        </div>
        <span class="count-chip">${percent}%</span>
      </div>
      <div class="panel-body">
        <div class="onboarding-progress" aria-label="${percent}% complete"><span style="width:${percent}%"></span></div>
        <div class="onboarding-list">
          ${steps.map((step) => `<div class="onboarding-step${step.done ? " done" : ""}"><span class="onboarding-check">${step.done ? "✓" : ""}</span><div><strong>${h(step.label)}</strong><span>${h(step.detail)}</span></div></div>`).join("")}
        </div>
      </div>
    </section>`;
}

function renderSettingsHtml() {
  const company = state.snapshot?.company || {};
  const branding = company.branding || {};
  const operations = company.operations || {};
  const notifications = company.notifications || {};
  const plans = state.snapshot?.plans || [];
  const planAccess = state.snapshot?.planAccess || plans[0] || {};
  const status = company.subscriptionStatus === "active" ? "Active" : company.subscriptionStatus === "past_due" ? "Past due" : company.subscriptionStatus === "evaluation" ? "14-day evaluation" : "Setup";
  const readiness = state.snapshot?.runtimeReadiness || { checks: [], readyCount: 0, totalCount: 0, requiredReady: false };
  const timeZones = ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"];
  return `
    <section class="dispatch-view${state.dispatcherView === "settings" ? " active" : ""} dashboard-section view-section" id="settings">
      <div class="settings-grid">
        <div class="panel">
          <div class="panel-header"><div><h3 class="panel-title">Business profile</h3><p class="panel-subtitle">These details become the defaults for daily delivery work.</p></div></div>
          <div class="panel-body">
            <form id="company-settings-form" class="form-grid">
              <div class="field full"><label for="company-name">Company name</label><input class="input" id="company-name" name="name" value="${h(company.name || "")}" required></div>
              <div class="field full"><label for="company-pickup">Primary pickup or depot</label><input class="input" id="company-pickup" name="pickupAddress" value="${h(company.pickupAddress || DEFAULT_PICKUP_ADDRESS)}" autocomplete="street-address" required></div>
              <div class="field"><label for="company-timezone">Time zone</label><select class="select" id="company-timezone" name="timeZone">${timeZones.map((zone) => `<option value="${h(zone)}"${zone === company.timeZone ? " selected" : ""}>${h(zone.replace("America/", "").replaceAll("_", " "))}</option>`).join("")}</select></div>
              <div class="field"><label for="company-currency">Currency</label><select class="select" id="company-currency" name="currency"><option value="CAD"${company.currency === "CAD" ? " selected" : ""}>CAD</option><option value="USD"${company.currency === "USD" ? " selected" : ""}>USD</option></select></div>
              <div class="field full"><label for="company-support">Customer support email</label><input class="input" id="company-support" name="supportEmail" type="email" value="${h(company.supportEmail || "hello@floraljet.llc")}" required></div>
              <fieldset class="settings-section full"><legend>Customer tracking brand</legend><div class="form-grid compact">
                <div class="field"><label for="brand-colour">Primary colour</label><input class="input color-input" id="brand-colour" name="brandPrimaryColor" type="color" value="${h(branding.primaryColor || "#176b52")}"></div>
                <div class="field"><label for="brand-logo">Logo URL</label><input class="input" id="brand-logo" name="logoUrl" type="url" placeholder="https://…" value="${h(branding.logoUrl || "")}"></div>
                <div class="field full"><label for="tracking-headline">Tracking-page headline</label><input class="input" id="tracking-headline" name="trackingHeadline" maxlength="90" value="${h(branding.trackingHeadline || "Your delivery is on the way")}"></div>
                <label class="setting-toggle full"><input type="checkbox" name="showDriverFirstName" ${branding.showDriverFirstName === false ? "" : "checked"}><span><strong>Show driver first name</strong><small>Never exposes the driver’s private profile or home address.</small></span></label>
              </div></fieldset>
              <fieldset class="settings-section full"><legend>Delivery rules</legend><div class="form-grid compact">
                <div class="field"><label for="business-hours">Business hours</label><input class="input" id="business-hours" name="businessHours" value="${h(operations.businessHours || "")}"></div>
                <div class="field"><label for="default-window">Default delivery window</label><select class="select" id="default-window" name="defaultWindowMinutes">${[60, 90, 120, 180, 240].map((minutes) => `<option value="${minutes}"${Number(operations.defaultWindowMinutes || 120) === minutes ? " selected" : ""}>${minutes < 120 ? `${minutes} minutes` : `${minutes / 60} hours`}</option>`).join("")}</select></div>
                <div class="field full"><label for="delivery-zones">Delivery zones</label><textarea class="textarea" id="delivery-zones" name="deliveryZones" placeholder="Downtown: M5V, M5H&#10;West: Etobicoke, Mississauga">${h(operations.deliveryZones || "")}</textarea></div>
                <label class="setting-toggle"><input type="checkbox" name="requirePhoto" ${operations.requirePhoto ? "checked" : ""}><span><strong>Require delivery photo</strong><small>Drivers cannot complete a successful stop without one.</small></span></label>
                <label class="setting-toggle"><input type="checkbox" name="requireSignature" ${operations.requireSignature ? "checked" : ""}><span><strong>Require signature</strong><small>Useful for regulated or high-value deliveries.</small></span></label>
              </div></fieldset>
              <fieldset class="settings-section full"><legend>Customer notifications</legend><div class="settings-toggle-grid">
                <label class="setting-toggle"><input type="checkbox" name="customerTracking" ${notifications.customerTracking === false ? "" : "checked"}><span><strong>Tracking links</strong><small>Create branded customer tracking links.</small></span></label>
                <label class="setting-toggle"><input type="checkbox" name="etaUpdates" ${notifications.etaUpdates === false ? "" : "checked"}><span><strong>ETA updates</strong><small>Prepare arrival notifications as routes progress.</small></span></label>
                <label class="setting-toggle"><input type="checkbox" name="deliveredConfirmation" ${notifications.deliveredConfirmation === false ? "" : "checked"}><span><strong>Delivered confirmation</strong><small>Show completion and proof when available.</small></span></label>
              </div></fieldset>
              <div class="field full"><button class="button" type="submit">Save workspace settings</button></div>
            </form>
          </div>
        </div>

        <div class="settings-stack">
          <div class="panel">
            <div class="panel-header"><div><p class="eyebrow">Launch readiness</p><h3 class="panel-title">${readiness.requiredReady ? "Core systems ready" : "Setup needs attention"}</h3><p class="panel-subtitle">${h(readiness.readyCount)} of ${h(readiness.totalCount)} production checks are ready.</p></div><span class="status-pill ${readiness.requiredReady ? "green" : "amber"}">${readiness.requiredReady ? "Ready" : "Review"}</span></div>
            <div class="panel-body"><div class="accounts-checklist">${readiness.checks.map((check) => `<div><strong>${check.ready ? "✓" : "○"} ${h(check.label)}</strong><span>${check.ready ? "Ready" : check.required ? "Required before unattended use" : "Recommended before scaling"}</span></div>`).join("")}</div><p class="settings-copy">Automatic email and separate Google map keys are recommended. Dispatch remains usable with the secure copy/share invitation fallback and the current map configuration.</p><div class="item-actions"><a class="button secondary" href="/api/admin/backup" download>Download operational backup</a><a class="button ghost" href="mailto:hello@floraljet.llc?subject=Rivo%20production%20setup">Get setup help</a></div></div>
          </div>
          <div class="panel">
            <div class="panel-header"><div><p class="eyebrow">Plan</p><h3 class="panel-title">${h(planAccess.name || company.plan || "Starter")}</h3><p class="panel-subtitle">${planAccess.monthlyPrice ? `$${h(planAccess.monthlyPrice)}/month · ` : ""}Dedicated Rivo workspace · ${h(status)}</p></div><span class="status-pill ${company.subscriptionStatus === "active" ? "green" : "amber"}">${h(status)}</span></div>
            <div class="panel-body"><div class="plan-limit-grid"><div><strong>${h(planAccess.driverLimit || "—")}</strong><span>drivers</span></div><div><strong>${h(planAccess.deliveryLimit || "—")}</strong><span>deliveries / month</span></div></div><div class="plan-feature-list">${(planAccess.features || []).map((feature) => `<span>✓ ${h(feature.replaceAll("-", " "))}</span>`).join("")}</div><p class="settings-copy">New workspaces begin with a guided 14-day evaluation. Billing is activated by a reviewed Rivo invoice. Nothing on this page creates a charge.</p><div class="item-actions"><a class="button" href="mailto:hello@floraljet.llc?subject=Rivo%20plan%20change">Request plan change</a><a class="button secondary" href="mailto:hello@floraljet.llc?subject=Rivo%20billing">Billing support</a></div></div>
          </div>
          <div class="panel network-readiness-card"><div class="panel-header"><div><p class="eyebrow">Future network</p><h3 class="panel-title">My Drivers + Rivo Driver</h3><p class="panel-subtitle">The fulfillment model is ready for external network drivers without pretending a marketplace exists today.</p></div><span class="status assigned">Coming later</span></div><div class="panel-body"><div class="fulfillment-choice-preview"><div class="active"><strong>My Drivers</strong><span>Your employed or contracted fleet.</span></div><div><strong>Rivo Driver</strong><span>Quote, accept, track, and platform-fee workflow prepared for a future network.</span></div></div><p class="settings-copy">Until the Rivo network launches, use saved courier partners for third-party coverage.</p><button class="button secondary" data-action="dispatcher-view" data-view="drivers" type="button">Manage courier partners</button></div></div>
          <div class="panel">
            <div class="panel-header"><div><h3 class="panel-title">Support</h3><p class="panel-subtitle">Get help with onboarding, integrations, or live operations.</p></div></div>
            <div class="panel-body"><div class="accounts-checklist"><div><strong>Email support</strong><span>${h(company.supportEmail || "hello@floraljet.llc")}</span></div><div><strong>Workspace model</strong><span>Dedicated account with separated operational data.</span></div><div><strong>Security</strong><span>Drivers create their own passwords from expiring invitation links.</span></div></div><div class="item-actions"><a class="button secondary" href="mailto:${h(company.supportEmail || "hello@floraljet.llc")}?subject=Rivo%20support">Contact support</a><button class="button secondary" data-action="logout" type="button">Log out</button></div></div>
          </div>
        </div>
      </div>
      ${onboardingHtml()}
    </section>`;
}

function analyticsMetricCard(label, value, detail, tone = "") {
  return `<article class="analytics-metric ${h(tone)}"><span>${h(label)}</span><strong>${h(value)}</strong><small>${h(detail)}</small></article>`;
}

function renderAnalyticsHtml() {
  const analytics = state.snapshot?.analytics || {};
  const drivers = analytics.deliveriesByDriver || [];
  const maxCompleted = Math.max(1, ...drivers.map((driver) => Number(driver.completed || 0)));
  const onTimeValue = analytics.onTimeRate === null || analytics.onTimeRate === undefined ? "—" : `${analytics.onTimeRate}%`;
  const durationValue = analytics.averageDeliveryMinutes === null || analytics.averageDeliveryMinutes === undefined ? "—" : `${analytics.averageDeliveryMinutes} min`;
  const distanceValue = analytics.averageDistanceKm === null || analytics.averageDistanceKm === undefined ? "—" : `${analytics.averageDistanceKm} km`;
  const utilizationValue = analytics.driverUtilizationRate === null || analytics.driverUtilizationRate === undefined ? "—" : `${analytics.driverUtilizationRate}%`;
  const costValue = analytics.averageCostPerDelivery === null || analytics.averageCostPerDelivery === undefined ? "—" : formatMoney(analytics.averageCostPerDelivery);
  return `
    <section class="dispatch-view${state.dispatcherView === "analytics" ? " active" : ""} dashboard-section view-section analytics-view" id="analytics">
      <div class="analytics-source-note"><span class="pulse"></span><div><strong>Live operations data</strong><small>All completed Rivo delivery records in this workspace. Metrics refresh with the dispatch board.</small></div></div>
      <div class="analytics-metric-grid">
        ${analyticsMetricCard("Completed deliveries", analytics.completed || 0, "Completed, delivered, submitted, or approved")}
        ${analyticsMetricCard("On-time delivery", onTimeValue, "Only deliveries with a configured delivery window", Number(analytics.onTimeRate || 100) < 90 ? "warn" : "good")}
        ${analyticsMetricCard("Average delivery time", durationValue, "Start to completion for timed deliveries")}
        ${analyticsMetricCard("Average distance", distanceValue, "Recorded driver distance per completed delivery")}
        ${analyticsMetricCard("Failed deliveries", analytics.failed || 0, "Recorded unsuccessful delivery outcomes", analytics.failed ? "warn" : "good")}
        ${analyticsMetricCard("Late deliveries", analytics.late || 0, "Past their configured delivery-window end", analytics.late ? "warn" : "good")}
        ${analyticsMetricCard("Driver utilization", utilizationValue, "Drivers with active or completed work ÷ active roster")}
        ${analyticsMetricCard("Cost per delivery", costValue, "Recorded distance × kilometre rate; excludes unknown costs")}
      </div>
      <div class="analytics-grid">
        <div class="panel analytics-chart-panel">
          <div class="panel-header"><div><p class="eyebrow">Workload</p><h2 class="panel-title">Deliveries per driver</h2><p class="panel-subtitle">Completed delivery volume with current active stops alongside it.</p></div></div>
          <div class="panel-body">
            <div class="driver-bars">
              ${drivers.length ? drivers.map((driver) => `<div class="driver-bar-row"><div><strong>${h(driver.name)}</strong><span>${driver.completed} completed · ${driver.active} active</span></div><div class="driver-bar-track"><span style="width:${Math.round((Number(driver.completed || 0) / maxCompleted) * 100)}%"></span></div><b>${driver.completed}</b></div>`).join("") : `<div class="empty compact-empty">Completed delivery data will appear after the first route is closed.</div>`}
            </div>
          </div>
        </div>
        <div class="panel analytics-definition-panel">
          <div class="panel-header"><div><p class="eyebrow">Metric quality</p><h2 class="panel-title">What Rivo can measure</h2><p class="panel-subtitle">Unknown data stays unknown instead of being estimated.</p></div></div>
          <div class="panel-body"><div class="accounts-checklist">
            <div><strong>On-time rate</strong><span>Requires a delivery-window end and a completion timestamp.</span></div>
            <div><strong>Cost per delivery</strong><span>Uses recorded distance and the assigned kilometre rate. Fuel, wages, and courier fees are excluded unless captured.</span></div>
            <div><strong>Utilization</strong><span>Shows the share of active roster drivers who have active or completed delivery work in the available history.</span></div>
            <div><strong>Freshness</strong><span>Live from the same workspace state used by dispatch; no separate analytics export is required.</span></div>
          </div></div>
        </div>
      </div>
    </section>`;
}

function dispatchAssistantPanelHtml() {
  const queued = queuedTrips();
  const alerts = state.snapshot?.alerts || [];
  const plan = state.optimizerPlan;
  const engineLabel = plan?.engine === "google-routes-plus-rules" ? "Google Routes + explainable rules" : "Explainable dispatch rules";
  return `
    <section class="dispatch-assistant" aria-label="Dispatch recommendations">
      <div class="dispatch-assistant-head">
        <div>
          <p class="eyebrow">Smart dispatch</p>
          <h2>${alerts.length ? `${alerts.length} issue${alerts.length === 1 ? "" : "s"} need attention` : queued.length ? `${queued.length} deliver${queued.length === 1 ? "y is" : "ies are"} ready to plan` : "Routes are under control"}</h2>
          <p>Rivo considers priority, delivery windows, driver availability, current workload, and vehicle capacity—and explains every recommendation.</p>
        </div>
        <button class="button assistant-button" data-action="optimize-deliveries" type="button" ${!queued.length || state.optimizerLoading ? "disabled" : ""}>${state.optimizerLoading ? "Planning…" : "Optimize deliveries"}</button>
      </div>
      ${alerts.length ? `<div class="dispatch-alerts">${alerts.map((alert) => `<div class="dispatch-alert ${h(alert.severity)}"><span>${h(alert.message)}</span><button class="button ghost compact-action" data-action="focus-alert" data-alert-type="${h(alert.type)}" type="button">Review</button></div>`).join("")}</div>` : ""}
      ${plan ? `
        <div class="optimization-plan">
          <div class="optimization-summary">
            <div><strong>${plan.totalDeliveries}</strong><span>deliveries</span></div>
            <div><strong>${plan.recommendations.length}</strong><span>driver routes</span></div>
            <div><strong>${h(engineLabel)}</strong><span>planning engine</span></div>
          </div>
          <p class="optimization-explanation">${h(plan.explanation)}</p>
          <div class="optimization-routes">
            ${plan.recommendations.map((recommendation) => `
              <article class="optimization-route">
                <div class="optimization-route-head"><div><strong>${h(recommendation.driverName)}</strong><span>${recommendation.currentStops} current · ${recommendation.stops.length} new · capacity ${recommendation.capacity}</span></div><span class="status ${recommendation.optimized ? "available" : "assigned"}">${recommendation.optimized ? "Route optimized" : "Balanced plan"}</span></div>
                <p>${h(recommendation.reason)}</p>
                <div class="optimization-route-metrics"><span>${recommendation.estimatedDurationMinutes === null ? "Time estimate requires Google Routes" : `${h(recommendation.estimatedDurationMinutes)} min`}</span><span>${recommendation.estimatedDistanceKm === null ? "Mileage estimate pending" : `${h(recommendation.estimatedDistanceKm)} km`}</span>${recommendation.expectedCompletionAt ? `<span>Finish about ${h(new Date(recommendation.expectedCompletionAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span>` : ""}</div>
                <ol>${recommendation.stops.map((stop) => `<li><span>${h(stop.customerName)}</span><small>${h(stop.priority)} · ${h(stop.destination)}</small></li>`).join("")}</ol>
              </article>`).join("")}
          </div>
          <div class="optimization-actions"><button class="button" data-action="apply-optimization" type="button">Apply this plan</button><button class="button ghost" data-action="clear-optimization" type="button">Dismiss</button></div>
        </div>` : ""}
    </section>`;
}

function todayAtGlanceHtml(trips) {
  const todayKey = new Date().toDateString();
  const happenedToday = (trip) => {
    const value = trip.endedAt || trip.startedAt || trip.importedAt;
    return value && new Date(value).toDateString() === todayKey;
  };
  const todayTrips = trips.filter(happenedToday);
  const delivered = todayTrips.filter((trip) => trip.deliveryOutcomeStatus === "delivered" || (!trip.deliveryOutcomeStatus && ["completed", "delivered", "submitted", "approved", "rejected"].includes(trip.status)));
  const issues = todayTrips.filter((trip) => trip.deliveryOutcomeStatus === "exception" || trip.status === "exception");
  const failed = todayTrips.filter((trip) => trip.deliveryOutcomeStatus === "failed" || trip.status === "failed");
  const open = trips.filter((trip) => ["queued", "active"].includes(trip.status));
  const km = delivered.reduce((total, trip) => total + Number(trip.distanceKm || 0), 0);
  const decided = delivered.length + issues.length + failed.length;
  const success = decided ? Math.round((delivered.length / decided) * 100) : null;
  const attention = issues.length + failed.length;
  return `
    <section class="today-glance" aria-label="Today at a glance">
      <div class="today-glance-copy">
        <p class="eyebrow">Live operations</p>
        <h2>${attention ? `${attention} delivery issue${attention === 1 ? "" : "s"} need attention` : open.length ? `${open.length} deliver${open.length === 1 ? "y is" : "ies are"} in motion` : trips.length ? "Every delivery is accounted for" : "Ready for the first delivery"}</h2>
        <p>${attention ? "Resolve the exceptions below." : success === null ? "Add or sync orders, select the stops, then preview and dispatch." : `${success}% completed successfully today.`}</p>
      </div>
      <div class="today-kpis">
        <div><strong>${open.length}</strong><span>Open</span></div>
        <div><strong>${delivered.length}</strong><span>Delivered</span></div>
        <div class="${attention ? "attention" : ""}"><strong>${attention}</strong><span>Issues</span></div>
        <div><strong>${formatKm(km)}</strong><span>Recorded</span></div>
      </div>
    </section>`;
}

function exceptionPanelHtml(trips) {
  const exceptions = trips.filter((trip) => trip.status === "exception");
  if (!exceptions.length) return "";
  return `
    <section class="panel exception-panel" aria-label="Delivery issues">
      <div class="panel-header">
        <div><p class="eyebrow">Needs attention</p><h2 class="panel-title">Resolve delivery issues</h2><p class="panel-subtitle">Retry, move, or close each failed attempt without hunting through the queue.</p></div>
        <span class="count-chip danger-chip">${exceptions.length}</span>
      </div>
      <div class="panel-body exception-list">
        ${exceptions.map((trip) => `
          <article class="exception-card">
            <div class="exception-card-main">
              <div><strong>${h(trip.customerName)}</strong><span>${h(trip.destination)}</span></div>
              <span class="status exception">${h(trip.proof?.exceptionReason || "Delivery issue")}</span>
            </div>
            <p>${h(trip.proof?.exceptionNote || "No driver note")}${trip.proof?.recordedAt ? ` · ${relativeTime(trip.proof.recordedAt)}` : ""}</p>
            <div class="exception-actions">
              <select class="select" data-exception-driver="${h(trip.id)}" aria-label="Driver for retry">${driverOptions(trip.driverId)}</select>
              <button class="button" data-action="retry-exception" data-trip-id="${h(trip.id)}" type="button">Retry now</button>
              <input class="input" data-exception-resolution="${h(trip.id)}" placeholder="Resolution note required to close">
              <button class="button secondary" data-action="close-exception" data-trip-id="${h(trip.id)}" type="button">Close as failed</button>
            </div>
          </article>`).join("")}
      </div>
    </section>`;
}

function activeDeliveriesPanelHtml(active) {
  return `
    <div class="panel active-deliveries-panel" id="active-deliveries">
      <div class="panel-header">
        <div>
          <p class="eyebrow">On the road</p>
          <h2 class="panel-title">Active deliveries</h2>
          <p class="panel-subtitle">Select several stops to close them together, or change a driver’s route order.</p>
        </div>
        <span class="count-chip">${active.length}</span>
      </div>
      <div class="panel-body">
        ${activeBulkToolbarHtml(active)}
        <div class="list">
          ${active.length ? activeRouteGroupsHtml(active) : `<div class="empty compact-empty">No active deliveries right now.</div>`}
        </div>
      </div>
    </div>`;
}

function dashboardWidgetDefinition(id) {
  return DASHBOARD_WIDGETS.find((widget) => widget.id === id);
}

function dashboardWidgetHtml(id, content) {
  const definition = dashboardWidgetDefinition(id);
  if (!definition || !content || state.dashboardLayout.hidden.includes(id)) return "";
  const width = state.dashboardLayout.widths[id] === "wide" ? "wide" : "half";
  return `
    <div class="dashboard-widget dashboard-widget-${width}${state.dashboardCustomizing ? " is-customizing" : ""}" data-dashboard-widget="${h(id)}">
      <div class="dashboard-widget-controls" aria-label="Move or resize ${h(definition.label)}">
        <button class="dashboard-drag-handle" data-dashboard-drag-handle draggable="true" type="button" title="Drag ${h(definition.label)}" aria-label="Drag ${h(definition.label)}">⋮⋮</button>
        <strong>${h(definition.label)}</strong>
        <span></span>
        <button class="widget-control" data-action="move-dashboard-widget" data-widget-id="${h(id)}" data-direction="up" type="button" aria-label="Move ${h(definition.label)} earlier">↑</button>
        <button class="widget-control" data-action="move-dashboard-widget" data-widget-id="${h(id)}" data-direction="down" type="button" aria-label="Move ${h(definition.label)} later">↓</button>
        <button class="widget-control widget-width-control" data-action="resize-dashboard-widget" data-widget-id="${h(id)}" type="button">${width === "wide" ? "Half width" : "Full width"}</button>
        <button class="widget-control" data-action="toggle-dashboard-widget" data-widget-id="${h(id)}" type="button">Hide</button>
      </div>
      ${content}
    </div>`;
}

function dashboardCustomizerHtml() {
  return `
    <section class="dashboard-customizer"${state.dashboardCustomizing ? "" : " hidden"} aria-label="Dashboard layout settings">
      <div>
        <p class="eyebrow">Layout</p>
        <h2>Keep only what you use</h2>
        <p>Move, resize, or hide sections. Your layout stays on this device.</p>
      </div>
      <div class="dashboard-visibility-list" aria-label="Visible dashboard sections">
        ${DASHBOARD_WIDGETS.map((widget) => {
          const visible = !state.dashboardLayout.hidden.includes(widget.id);
          return `<button class="visibility-chip${visible ? " active" : ""}" data-action="toggle-dashboard-widget" data-widget-id="${h(widget.id)}" type="button" aria-pressed="${visible}"><span>${visible ? "✓" : "+"}</span>${h(widget.label)}</button>`;
        }).join("")}
      </div>
      <div class="dashboard-customizer-actions">
        <button class="button secondary" data-action="reset-dashboard-layout" type="button">Reset layout</button>
        <button class="button" data-action="toggle-dashboard-customizer" type="button">Done</button>
      </div>
    </section>`;
}

function dashboardBoardHtml(widgetContent) {
  const ordered = state.dashboardLayout.order
    .map((id) => dashboardWidgetHtml(id, widgetContent[id]))
    .filter(Boolean)
    .join("");
  return `<section class="dashboard-board${state.dashboardCustomizing ? " is-customizing" : ""}" aria-label="Customizable operations dashboard">${ordered}</section>`;
}

function operationsFlowNavHtml(trips, active, selectedPreview) {
  const queued = queuedTrips();
  return `
    <nav class="operations-flowbar" aria-label="Dispatch workflow">
      <a href="#orders"><span>1</span><strong>Orders</strong><small>${queued.length} waiting</small></a>
      <a href="#route-preview"><span>2</span><strong>Route</strong><small>${selectedPreview.length ? `${selectedPreview.length} selected` : "Select stops"}</small></a>
      <a href="#active-deliveries"><span>3</span><strong>On the road</strong><small>${active.length} active</small></a>
    </nav>`;
}

function moveDashboardWidget(widgetId, direction) {
  const order = [...state.dashboardLayout.order];
  const index = order.indexOf(widgetId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return false;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  state.dashboardLayout.order = order;
  saveDashboardLayout();
  return true;
}

function renderDispatcher() {
  if (state.auth?.role !== "dispatcher") {
    renderLogin();
    return;
  }
  pruneSelections();
  const trips = getTrips();
  const active = activeTrips();
  const selectedPreview = selectedOrderPreviewTrips();
  const mapTrips = dispatcherMapTrips();
  const weekly = currentWeekTrips();
  const weeklyTotals = reportTotals(weekly);
  const submitted = weekly.filter((trip) => trip.status === "submitted");
  const view = state.dispatcherView;
  const companyName = state.snapshot?.company?.name || "Delivery operations";
  const workspaceEyebrow = companyName.toLowerCase() === "rivo" ? "Rivo workspace" : `Rivo · ${companyName}`;
  const viewTitle = view === "drivers" ? "Delivery team" : view === "analytics" ? "Operations analytics" : view === "channels" ? "Connections" : view === "accounts" ? "Accounts" : view === "reports" ? "Reports" : view === "settings" ? "Settings" : "Today";
  const viewSubtitle = view === "drivers"
    ? "Manage in-house drivers and the courier partners you use for outside coverage."
    : view === "analytics"
      ? "See service quality, route efficiency, driver workload, and delivery cost in one owner-ready view."
    : view === "channels"
      ? "Connect Shopify, WooCommerce, Wix, or a supported order webhook to one dispatch queue."
      : view === "accounts"
        ? "Track inbound pilots, qualify accounts, and move customers into implementation."
        : view === "reports"
          ? "Review mileage, approve submitted trips, and export weekly records."
          : view === "settings"
            ? "Configure workspace defaults, onboarding, billing, and support."
            : "See what is waiting, what is on the road, and what needs attention.";
  const viewClass = (name) => `dispatch-view${view === name ? " active" : ""}`;

  const content = `
    <div class="topbar dispatch-topbar">
      <div>
        <p class="eyebrow">${h(workspaceEyebrow)}</p>
        <h1 class="page-title">${viewTitle}</h1>
        <p class="page-subtitle">${viewSubtitle}</p>
      </div>
      <div class="toolbar">
        ${view === "operations" ? `<button class="button ghost dashboard-customize-button${state.dashboardCustomizing ? " active" : ""}" data-action="toggle-dashboard-customizer" type="button" aria-pressed="${state.dashboardCustomizing}" title="Arrange dashboard sections">${state.dashboardCustomizing ? "Done" : "Arrange"}</button><button class="button" data-action="open-create-delivery" type="button">New delivery</button>` : ""}
        ${view === "drivers" ? `<button class="button secondary" data-action="open-courier-form" type="button">Add courier</button><button class="button" data-action="open-driver-form" type="button">Add driver</button>` : ""}
        ${view === "channels" ? `<button class="button" data-action="sync-channels" type="button">Sync all</button>` : ""}
        ${view !== "operations" ? `<button class="button secondary mobile-secondary-action" data-action="dispatcher-view" data-view="operations" type="button">Back to today</button>` : ""}
      </div>
    </div>

    ${["channels", "accounts", "settings"].includes(view) ? workspaceToolsNav() : ""}

    <div class="${viewClass("operations")}">
    ${dashboardCustomizerHtml()}
    ${operationsFlowNavHtml(trips, active, selectedPreview)}
    ${dashboardBoardHtml({
      overview: todayAtGlanceHtml(trips),
      assistant: dispatchAssistantPanelHtml(),
      issues: exceptionPanelHtml(trips),
      active: `<div class="dashboard-widget-stack">${courierRequestsPanelHtml()}${activeDeliveriesPanelHtml(active)}</div>`,
      orders: `<section class="operations-orders" id="orders" aria-label="Order queue">${channelOrdersPanel(trips)}</section>`,
      map: `<div class="panel route-preview-panel" id="route-preview"><div class="panel-header"><div><h2 class="panel-title">Route preview</h2><p class="panel-subtitle">Select orders to preview their route. Active driver locations appear automatically.</p></div></div><div class="panel-body">${renderMapBlock("dispatcher-map", mapTrips, { label: selectedPreview.length ? "Selected route" : active.length ? "Live fleet" : "Recent routes" })}</div></div>`,
      create: `<details class="panel manage-panel create-delivery-panel" id="create-delivery"><summary class="manage-summary"><span><span class="panel-title">Create delivery</span><span class="panel-subtitle">Add a manual delivery only when it is not coming from a connected site.</span></span><span class="summary-control" aria-hidden="true">+</span></summary><div class="panel-body">${queuedDeliveryFormHtml()}</div></details>`
    })}
    ${onboardingHtml({ compact: true })}
    </div>

    <section class="${viewClass("drivers")} dashboard-section view-section" id="drivers">
      <div class="driver-access-banner" aria-label="Driver account status">
        <div><p class="eyebrow">Driver access</p><h2>Invitation-only accounts</h2><p>Each driver creates their own password from a single-use link, then signs in with email. You can resend an expired link or issue a password reset anytime.</p></div>
        <span class="delivery-health ${state.snapshot?.invitationEmail?.configured ? "ready" : "manual"}">${state.snapshot?.invitationEmail?.configured ? "Email delivery connected" : "Manual share mode"}</span>
      </div>
      <div class="driver-workspace">
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">Driver roster</h3>
              <p class="panel-subtitle">Each driver sees only their assigned work.</p>
            </div>
          </div>
          <div class="panel-body">
            ${driverCards()}
          </div>
        </div>

        <details class="panel manage-panel" id="add-driver"${state.lastInvite ? " open" : ""}>
          <summary class="manage-summary">
            <span>
              <span class="panel-title">Add a driver</span>
              <span class="panel-subtitle">Create the driver profile, then email or share a secure account link.</span>
            </span>
            <span class="summary-control" aria-hidden="true">+</span>
          </summary>
          <div class="panel-body">
            <form id="add-driver-form" class="form-grid">
              <div class="field">
                <label for="driver-name">Name</label>
                <input class="input" id="driver-name" name="name" required>
              </div>
              <div class="field">
                <label for="driver-phone">Phone</label>
                <input class="input" id="driver-phone" name="phone">
              </div>
              <div class="field">
                <label for="driver-email">Email</label>
                <input class="input" id="driver-email" name="email" type="email" autocomplete="email" required>
              </div>
              <div class="field full">
                <label for="driver-home">Home address</label>
                <input class="input" id="driver-home" name="homeAddress" autocomplete="street-address" placeholder="Used for paid Home → Work and Depot → Home trips" required>
              </div>
              <div class="field">
                <label for="driver-shift">Shift</label>
                <input class="input" id="driver-shift" name="shift" placeholder="Morning, afternoon, evening">
              </div>
              <div class="field">
                <label for="driver-vehicle">Vehicle</label>
                <input class="input" id="driver-vehicle" name="vehicle" required>
              </div>
              <div class="field">
                <label for="driver-rate">Default rate</label>
                <input class="input" id="driver-rate" name="defaultRate" type="number" min="0" step="0.01" value="1.25" required>
              </div>
              <div class="field">
                <label for="driver-capacity">Route capacity</label>
                <input class="input" id="driver-capacity" name="capacity" type="number" min="1" max="100" step="1" value="20" required>
                <small>Maximum active stops used by Smart Dispatch.</small>
              </div>
              <fieldset class="color-field field full">
                <legend>Map colour</legend>
                <div class="color-swatches" role="radiogroup" aria-label="Driver map colour">
                  ${colorSwatchesHtml()}
                </div>
              </fieldset>
              <div class="field full">
                <button class="button" type="submit">Create driver and invitation</button>
              </div>
            </form>
            ${state.lastInvite ? `
              <div class="invite-result ${state.lastInvite.emailSent ? "sent" : "manual"}">
                <div><strong>${state.lastInvite.emailSent ? "Invitation email sent" : "Invitation link ready"}</strong><p>${h(state.lastInvite.message)}</p></div>
                <div class="invite-link-box"><code>${h(state.lastInvite.url)}</code></div>
                <div class="item-actions">
                  ${driverInviteMailto(state.lastInvite) ? `<a class="button" href="${h(driverInviteMailto(state.lastInvite))}">Open email draft</a>` : ""}
                  <button class="button" type="button" data-action="share-driver-link" data-share-url="${h(state.lastInvite.url)}">Share invitation</button>
                  <button class="button secondary" type="button" data-action="copy" data-copy="${h(state.lastInvite.url)}">Copy link</button>
                  <a class="button ghost" href="${h(state.lastInvite.url)}" target="_blank" rel="noreferrer">Open test</a>
                </div>
              </div>` : ""}
          </div>
        </details>
        ${courierPartnersWorkspaceHtml()}
      </div>
    </section>

    ${renderAnalyticsHtml()}

    ${channelsManagementHtml()}

    ${renderAccountsHtml()}

    ${renderSettingsHtml()}

    <section class="${viewClass("reports")} dashboard-section view-section" id="reports">
      <div class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Weekly approval</p>
            <h3 class="panel-title">${submitted.length ? `${submitted.length} report${submitted.length === 1 ? "" : "s"} awaiting review` : "No reports awaiting review"}</h3>
            <p class="panel-subtitle">${formatKm(weeklyTotals.distanceKm)} this week · ${formatMoney(weeklyTotals.amount)} payable after approval.</p>
          </div>
          <form id="report-export-form" class="inline-edit">
            <input class="input" type="week" name="week" value="${h(state.snapshot?.weekKey || weekKeyOf())}" aria-label="Report week">
            <select class="select" name="driverId" aria-label="Report driver">
              <option value="">All drivers</option>
              ${getDrivers().map((driver) => `<option value="${h(driver.id)}">${h(driver.name)}</option>`).join("")}
            </select>
            <button class="button secondary" type="submit">Export CSV</button>
          </form>
        </div>
        <div class="panel-body">
          <div class="table-wrap desktop-table">
            <table>
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Driver</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>Distance</th>
                  <th>Rate</th>
                  <th>Total</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>${tripLogRows(weekly, { approvalActions: true })}</tbody>
            </table>
          </div>
          ${tripLogCards(weekly, { approvalActions: true })}
        </div>
      </div>
    </section>
    ${driverEditModalHtml()}
    ${courierPartnerEditModalHtml()}
    ${courierRequestModalHtml()}
  `;

  app.innerHTML = shellHtml(content);
  requestAnimationFrame(() => {
    syncSectionNavigation();
    applyOrderFilters();
    drawMap("dispatcher-map", mapTrips);
  });
}

function renderDriverSelect() {
  const content = `
    <div class="topbar">
      <div>
        <h1 class="page-title">Driver app</h1>
        <p class="page-subtitle">Log in with your driver account to see assigned trips.</p>
      </div>
    </div>
    <section class="panel">
      <div class="panel-body">
        <div class="empty">This page does not show the driver roster.</div>
      </div>
    </section>
  `;
  app.innerHTML = shellHtml(content);
  requestAnimationFrame(syncSectionNavigation);
}

function renderDriver() {
  const driver = getDrivers()[0];
  if (!driver) {
    renderDriverSelect();
    return;
  }
  const driverTrips = tripsForDriver(driver.id).slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const sortedActiveTrips = driverTrips
    .filter((trip) => trip.status === "active")
    .sort((a, b) => Number(a.routeSequence || 0) - Number(b.routeSequence || 0));
  const publishingTrip = sortedActiveTrips.find((trip) => trip.id === state.publishTripId);
  const currentTrip = publishingTrip || sortedActiveTrips[0];
  let activeRouteTrips = currentTrip?.routeId
    ? driverTrips
        .filter((trip) => trip.status === "active" && trip.routeId === currentTrip.routeId)
        .sort((a, b) => Number(a.routeSequence || 0) - Number(b.routeSequence || 0))
    : [];
  if (publishingTrip) activeRouteTrips = [publishingTrip, ...activeRouteTrips.filter((trip) => trip.id !== publishingTrip.id)];
  const combinedRouteTrip = activeRouteTrips.length
    ? {
        ...currentTrip,
        preserveStopOrder: true,
        stops: [
          { label: "Start", address: currentTrip.routeOrigin || companyPickupAddress() },
          ...activeRouteTrips.map((trip, index) => ({ label: `Stop ${index + 1}: ${trip.customerName}`, address: trip.destination })),
          { label: "Return", address: currentTrip.routeOrigin || companyPickupAddress() }
        ]
      }
    : currentTrip;
  const businessWeekly = currentWeekTrips(driver.id, { businessOnly: true });
  const businessTotals = reportTotals(businessWeekly);
  const needsReview = driverTrips.filter((trip) => ["completed", "rejected", "failed"].includes(trip.status));
  const reportable = businessWeekly.filter((trip) => ["completed", "rejected", "failed"].includes(trip.status));
  const submitted = businessWeekly.filter((trip) => trip.status === "submitted");
  const approved = businessWeekly.filter((trip) => trip.status === "approved");
  const todayKey = new Date().toDateString();
  const todayTrips = driverTrips.filter((trip) => new Date(trip.startedAt).toDateString() === todayKey);
  const todayTotals = reportTotals(todayTrips);
  const mapTrips = combinedRouteTrip ? [combinedRouteTrip] : [];
  const isPublishing = currentTrip && state.publishTripId === currentTrip.id && (state.gpsWatchId !== null || state.simTimer !== null);
  const trackingMessage = isPublishing
    ? "Location sharing is on. Dispatch and customers with a link can see your current position."
    : "Location sharing is off. It only starts when you choose Start location sharing.";

  const content = `
    <div class="topbar driver-topbar">
      <div class="driver-strip">
        <div class="avatar" style="background:${h(driver.color)}22;color:${h(driver.color)}">${h(initials(driver.name))}</div>
        <div>
          <p class="eyebrow">Driver app</p>
          <h1 class="page-title">Hi, ${h(driver.name.split(" ")[0])}</h1>
          <p class="page-subtitle">${h(driver.vehicle)} · ${h(driver.shift || "Shift not set")}</p>
        </div>
      </div>
    </div>

    <section class="driver-section" id="today">
      <div class="section-heading">
        <div>
          <h2 class="section-title">Today</h2>
          <p class="section-subtitle">${todayTrips.length} trip${todayTrips.length === 1 ? "" : "s"} · ${formatKm(todayTotals.distanceKm)}</p>
        </div>
      </div>
      <div class="driver-today-layout">
        <div class="panel driver-focus-card">
        <div class="panel-header">
          <div>
              <p class="eyebrow">${currentTrip ? "Current assignment" : "Ready when you are"}</p>
              <h2 class="panel-title">${currentTrip ? h(currentTrip.customerName) : "Start a trip"}</h2>
              <p class="panel-subtitle">${currentTrip ? h(activeRouteTrips.length > 1 ? `${activeRouteTrips.length} optimized delivery stops` : routeSummary(currentTrip)) : "Enter the route once, then drive. Every trip is logged as business mileage."}</p>
          </div>
          ${currentTrip ? statusPill(currentTrip.status) : ""}
        </div>
        <div class="panel-body">
          ${
            currentTrip
              ? `
                  <div class="driver-current-trip" data-proof-draft>
                    ${renderMapBlock("driver-map", [combinedRouteTrip], { small: true, label: isPublishing ? "Location sharing on" : "Trip route" })}
                    <div class="driver-route-summary">${routeStopLinesHtml(combinedRouteTrip)}</div>
                    <div class="next-stop-card">
                      <div><p class="eyebrow">Next delivery</p><h3>${h(currentTrip.customerName)}</h3><p>${h(currentTrip.destination)}</p></div>
                      <div class="next-stop-meta"><span>${currentTrip.etaMinutes ? `${h(currentTrip.etaMinutes)} min ETA` : "ETA updates after routing"}</span><span>${currentTrip.distanceKm ? formatKm(currentTrip.distanceKm) : "Distance calculating"}</span></div>
                      <div class="next-stop-actions">
                        <a class="button" href="${h(googleMapsDirectionsUrl(currentTrip, { navigate: true, currentLocation: true }))}" target="_blank" rel="noreferrer">Navigate</a>
                        ${currentTrip.customerPhone ? `<a class="button secondary" href="tel:${h(currentTrip.customerPhone)}">Call customer</a><a class="button secondary" href="sms:${h(currentTrip.customerPhone)}">Message</a>` : ""}
                      </div>
                      ${currentTrip.notes ? `<div class="next-stop-note"><strong>Delivery notes</strong><span>${h(currentTrip.notes)}</span></div>` : ""}
                    </div>
                    <div class="privacy-note ${isPublishing ? "sharing" : ""}">
                      <span class="privacy-dot"></span>
                      <span>${h(trackingMessage)}</span>
                  </div>
                    <div class="driver-action-stack">
                      <button class="button driver-primary-action" data-action="start-gps" data-trip-id="${h(currentTrip.id)}" ${isPublishing ? "disabled" : ""}>${isPublishing ? "Location sharing is on" : "Start location sharing"}</button>
                      ${isPublishing ? `<button class="button secondary" data-action="stop-tracking">Pause location sharing</button>` : ""}
                      <a class="button secondary" href="${h(googleMapsDirectionsUrl(combinedRouteTrip, { navigate: true, currentLocation: true }))}" target="_blank" rel="noreferrer">Navigate remaining route</a>
                  </div>
                  <div class="field">
                      <label for="trip-notes-${h(currentTrip.id)}">Optional trip note</label>
                      <textarea class="textarea" id="trip-notes-${h(currentTrip.id)}" placeholder="Waiting time, delivery details, or route notes">${h(currentTrip.notes || "")}</textarea>
                  </div>
                    <div class="form-grid proof-fields">
                      <div class="field">
                        <label for="trip-proof-method-${h(currentTrip.id)}">How did this stop go?</label>
                        <select class="select" id="trip-proof-method-${h(currentTrip.id)}" data-proof-outcome="${h(currentTrip.id)}">
                          <optgroup label="Delivered">
                            <option value="delivered-recipient">Delivered to recipient</option>
                            <option value="delivered-safe">Left at approved location</option>
                            <option value="verified">Signature collected</option>
                            <option value="service">Service completed</option>
                          </optgroup>
                          <optgroup label="Couldn’t deliver">
                            <option value="exception-recipient">Recipient unavailable</option>
                            <option value="exception-address">Address or access problem</option>
                            <option value="exception-refused">Order refused</option>
                            <option value="exception-damaged">Item missing or damaged</option>
                            <option value="exception-unsafe">Unsafe to complete</option>
                            <option value="exception-vehicle">Vehicle or driver issue</option>
                            <option value="exception-other">Other delivery issue</option>
                            <option value="returned">Returned to depot</option>
                          </optgroup>
                        </select>
                      </div>
                      <div class="field">
                        <label for="trip-proof-recipient-${h(currentTrip.id)}">Received by</label>
                        <input class="input" id="trip-proof-recipient-${h(currentTrip.id)}" placeholder="Name or delivery location">
                      </div>
                      <div class="field full exception-proof-fields" data-exception-proof-fields="${h(currentTrip.id)}" hidden>
                        <div class="form-grid compact">
                          <div class="field">
                            <label for="trip-exception-action-${h(currentTrip.id)}">What should happen next?</label>
                            <select class="select" id="trip-exception-action-${h(currentTrip.id)}"><option value="dispatcher">Needs dispatcher</option><option value="retry">Retry later</option><option value="return">Return to depot</option></select>
                          </div>
                          <div class="field">
                            <label for="trip-exception-note-${h(currentTrip.id)}">Note for dispatch</label>
                            <input class="input" id="trip-exception-note-${h(currentTrip.id)}" placeholder="Explain what happened">
                          </div>
                        </div>
                      </div>
                    </div>
                    ${state.snapshot?.proofMedia?.configured ? `
                      <div class="proof-capture" data-proof-capture="${h(currentTrip.id)}">
                        <div class="proof-capture-head"><div><strong>Proof of delivery</strong><span>Time is saved automatically; location is included when sharing is on.</span></div><span class="status available">Secure</span></div>
                        <div class="proof-capture-grid">
                          <div class="proof-photo-capture">
                            <label class="proof-upload-button" for="trip-proof-photo-${h(currentTrip.id)}">Take or choose photo</label>
                            <input id="trip-proof-photo-${h(currentTrip.id)}" data-proof-photo="${h(currentTrip.id)}" type="file" accept="image/jpeg,image/png,image/webp" capture="environment">
                            <img data-proof-photo-preview="${h(currentTrip.id)}" alt="Selected delivery proof" hidden>
                          </div>
                          <div class="signature-capture">
                            <div class="signature-label"><span>Collect signature</span><button class="button ghost compact-action" data-action="clear-signature" data-trip-id="${h(currentTrip.id)}" type="button">Clear</button></div>
                            <canvas width="600" height="180" data-signature-pad="${h(currentTrip.id)}" aria-label="Signature pad"></canvas>
                            <small>Sign inside the box.</small>
                          </div>
                        </div>
                      </div>` : `<div class="empty compact-empty">Photo and signature storage is being connected. Recipient, time, location, notes, and outcome will still be recorded.</div>`}
                    <button class="button success driver-primary-action" data-action="complete-trip" data-trip-id="${h(currentTrip.id)}">Complete stop</button>
                </div>
              `
              : startTripFormHtml("driver", driver.id)
          }
        </div>
      </div>

        <div class="panel driver-today-summary">
        <div class="panel-header">
          <div>
              <h2 class="panel-title">Today’s activity</h2>
              <p class="panel-subtitle">A quick view of the trips logged today.</p>
          </div>
        </div>
        <div class="panel-body">
            <div class="driver-mini-metrics">
              <div><strong>${todayTrips.length}</strong><span>Trips</span></div>
              <div><strong>${formatKm(todayTotals.distanceKm)}</strong><span>Distance</span></div>
              <div><strong>${formatMoney(todayTotals.amount)}</strong><span>Estimated</span></div>
            </div>
            <div class="list driver-recent-list">
              ${todayTrips.length
                ? todayTrips.slice(0, 3).map((trip) => `
                    <div class="driver-trip-row">
                      <div><p class="item-title">${h(trip.customerName)}</p><p class="item-detail">${formatDate(trip.startedAt)} · ${formatKm(trip.distanceKm)}</p></div>
                      ${statusPill(trip.status)}
                    </div>`).join("")
                : `<div class="empty compact-empty">No trips logged today.</div>`}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="driver-section" id="trips">
      <div class="section-heading">
        <div><p class="eyebrow">Trip inbox</p><h2 class="section-title">Trips</h2><p class="section-subtitle">Review recent routes and fix anything that needs attention.</p></div>
        <span class="count-chip">${needsReview.length} need${needsReview.length === 1 ? "s" : ""} review</span>
      </div>
      <div class="driver-inbox-grid">
        <div class="panel">
          <div class="panel-header"><div><h3 class="panel-title">Needs review</h3><p class="panel-subtitle">Submit these trips when the details look right.</p></div></div>
          <div class="panel-body">${tripLogCards(needsReview, { driverActions: true })}</div>
        </div>
        <div class="panel">
          <div class="panel-header"><div><h3 class="panel-title">Recent trips</h3><p class="panel-subtitle">Submitted and approved trips remain visible here.</p></div></div>
          <div class="panel-body">${tripLogCards(driverTrips.filter((trip) => !["completed", "rejected", "failed"].includes(trip.status)))}</div>
        </div>
      </div>
    </section>

    <section class="driver-section" id="report">
      <div class="section-heading">
        <div><p class="eyebrow">This week</p><h2 class="section-title">Mileage report</h2><p class="section-subtitle">Check the week, then send it to dispatch for approval.</p></div>
      </div>
      <div class="panel driver-report-card">
        <div class="panel-body">
          <div class="driver-report-total"><span>Estimated payment</span><strong>${formatMoney(businessTotals.amount)}</strong><small>${formatKm(businessTotals.distanceKm)} across ${businessWeekly.length} trip${businessWeekly.length === 1 ? "" : "s"}</small></div>
          <div class="driver-report-status">
            <div><strong>${reportable.length}</strong><span>Ready to submit</span></div>
            <div><strong>${submitted.length}</strong><span>Awaiting approval</span></div>
            <div><strong>${approved.length}</strong><span>Approved</span></div>
          </div>
          <button class="button driver-primary-action" data-action="submit-week" data-driver-id="${h(driver.id)}" ${reportable.length ? "" : "disabled"}>Submit this week</button>
          <p class="privacy-copy">Only completed business trips are sent to dispatch. You can continue to see your submitted history here.</p>
        </div>
      </div>
    </section>

    <section class="driver-section" id="profile">
      <div class="section-heading"><div><p class="eyebrow">Account</p><h2 class="section-title">Profile</h2></div></div>
      <div class="panel driver-profile-card">
        <div class="panel-body">
          <div class="driver-profile-row"><span>Driver</span><strong>${h(driver.name)}</strong></div>
          <div class="driver-profile-row"><span>Vehicle</span><strong>${h(driver.vehicle)}</strong></div>
          <div class="driver-profile-row"><span>Shift</span><strong>${h(driver.shift || "Not set")}</strong></div>
          <div class="driver-profile-row"><span>Phone</span><strong>${h(driver.phone || "Not set")}</strong></div>
          <div class="privacy-note"><span class="privacy-dot"></span><span>Rivo shares your live location only while you have location sharing turned on for an active trip.</span></div>
          <div class="driver-action-stack">
            ${isStandalone() ? "" : `<button class="button secondary" data-action="install-app" type="button">Install driver app</button>`}
            <button class="button secondary" data-action="logout">Log out</button>
          </div>
        </div>
      </div>
    </section>
  `;

  app.innerHTML = shellHtml(content);
  requestAnimationFrame(() => {
    syncSectionNavigation();
    drawMap("driver-map", mapTrips);
  });
}

function customerMetricHtml(label, value, detail = "") {
  return `
    <div class="metric">
      <div class="metric-label">${h(label)}</div>
      <div class="metric-value">${h(value)}</div>
      <div class="metric-detail">${h(detail)}</div>
    </div>
  `;
}

function renderCustomer() {
  const trip = state.customerTrip;
  const companyName = state.company?.name || "Delivery Tracker";
  const branding = state.company?.branding || {};
  const brandLogo = branding.logoUrl || "/assets/rivo-logo.png";
  const brandColor = /^#[0-9a-f]{6}$/i.test(branding.primaryColor || "") ? branding.primaryColor : "#176b52";
  if (!state.route.token) {
    app.innerHTML = `
      <div class="customer-shell" style="--customer-brand:${h(brandColor)}">
        <header class="customer-header">
          <div class="brand">
            <div class="brand-mark"><img src="${h(brandLogo)}" alt=""></div>
            <div>
              <div class="brand-name" style="color:var(--ink)">${h(companyName)}</div>
              <div class="brand-subtitle" style="color:var(--muted)">Customer tracking</div>
            </div>
          </div>
        </header>
        <main class="customer-main">
          <div class="empty">This tracking link is missing a trip token.</div>
        </main>
      </div>
    `;
    return;
  }

  if (!trip) {
    app.innerHTML = `
      <div class="customer-shell" style="--customer-brand:${h(brandColor)}">
        <header class="customer-header">
          <div class="brand">
            <div class="brand-mark"><img src="${h(brandLogo)}" alt=""></div>
            <div>
              <div class="brand-name" style="color:var(--ink)">${h(companyName)}</div>
              <div class="brand-subtitle" style="color:var(--muted)">Customer tracking</div>
            </div>
          </div>
        </header>
        <main class="customer-main">
          <div class="empty">Loading tracking link.</div>
        </main>
      </div>
    `;
    return;
  }

  const isCourier = Boolean(trip.courier);
  const lastUpdated = trip.location?.timestamp || trip.courier?.updatedAt || trip.endedAt || trip.startedAt;
  const isLive = trip.status === "active" && !isCourier;
  const isInTransit = isLive || trip.courier?.status === "picked-up";
  const delivered = trip.status === "delivered" || ["completed", "submitted", "approved", "rejected"].includes(trip.status);
  const liveEta = trip.etaMinutes && isInTransit ? Math.max(1, Math.round(Number(trip.etaMinutes))) : null;
  const locationText = trip.location
    ? "Live location shared"
    : isCourier
      ? (trip.courier.trackingUrl ? "Courier tracking available" : "Provider updates only")
      : isLive ? "Waiting for driver GPS" : "Tracking complete";

  app.innerHTML = `
    <div class="customer-shell" style="--customer-brand:${h(brandColor)}">
      <header class="customer-header">
        <div class="brand">
          <div class="brand-mark"><img src="${h(brandLogo)}" alt=""></div>
          <div>
            <div class="brand-name" style="color:var(--ink)">${h(companyName)}</div>
            <div class="brand-subtitle" style="color:var(--muted)">Customer tracking</div>
          </div>
        </div>
        <div class="tracking-status">
          ${isInTransit ? `<span class="pulse"></span>` : ""}
          <span>${isLive ? "Live" : statusLabels[trip.status] || trip.status} · ${relativeTime(lastUpdated)}</span>
        </div>
      </header>
      <main class="customer-main">
        <div class="topbar">
          <div>
            <p class="eyebrow">${delivered ? "Delivered" : liveEta ? `${liveEta} minutes away` : "Live delivery status"}</p>
            <h1 class="page-title">${delivered ? "Your delivery has arrived" : isInTransit ? h(branding.trackingHeadline || "Your delivery is on the way") : "Delivery status"}</h1>
            <p class="page-subtitle">${h(trip.customerName)} · ${h(routeSummary(trip, { customer: true }))}</p>
          </div>
          ${statusPill(trip.status)}
        </div>

        <section class="grid three">
          ${isCourier
            ? customerMetricHtml("Courier", trip.courier.name, "Third-party delivery provider")
            : customerMetricHtml("Driver", trip.driver?.name || "Assigned", trip.driver?.vehicle || "")}
          ${customerMetricHtml("Last update", relativeTime(lastUpdated), isLive ? "Live delivery status" : "Latest delivery status")}
          ${customerMetricHtml(isCourier ? "Courier status" : "Current point", isCourier ? (statusLabels[trip.courier.status] || trip.courier.status) : locationText, isCourier ? (trip.courier.referenceNumber ? `Reference ${trip.courier.referenceNumber}` : "Provider reference pending") : trip.location?.accuracy ? `Accuracy ${Math.round(trip.location.accuracy)} m` : "GPS will appear here")}
        </section>

        <section class="grid two" style="margin-top:16px">
          <div class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">${isCourier ? "Delivery route" : "Live route"}</h2>
                <p class="panel-subtitle">${h(routeSummary(trip, { customer: true }))}</p>
              </div>
            </div>
            <div class="panel-body">
              ${renderMapBlock("customer-map", [trip], { label: isLive ? "Live driver position" : isCourier ? "Planned delivery route" : "Delivery route" })}
            </div>
          </div>

          <div class="panel">
            <div class="panel-header">
              <div>
                <h2 class="panel-title">Delivery details</h2>
                <p class="panel-subtitle">Delivery destination</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="list">
                ${routeStopLinesHtml(trip, { customer: true })}
                <div class="item">
                  <div class="item-main">
                    <div class="driver-strip">
                      <div class="avatar${isCourier ? " courier-avatar" : ""}" style="${isCourier ? "" : `background:${h(trip.driver?.color || "#2563eb")}22;color:${h(trip.driver?.color || "#2563eb")}`}">${h(initials(isCourier ? trip.courier.name : trip.driver?.name))}</div>
                      <div>
                        <p class="item-title">${h(isCourier ? trip.courier.name : trip.driver?.name || "Driver")}</p>
                        <p class="item-detail">${h(isCourier ? "Third-party courier" : trip.driver?.vehicle || "Vehicle")}</p>
                      </div>
                    </div>
                    ${statusPill(isCourier ? trip.courier.status : trip.driver?.status || trip.status)}
                  </div>
                </div>
                ${trip.proof ? proofRecordHtml(trip) : ""}
                ${isCourier && trip.courier.trackingUrl ? `<a class="button courier-action" href="${h(trip.courier.trackingUrl)}" target="_blank" rel="noreferrer">Open courier tracking</a>` : ""}
                <a class="button secondary" href="${h(googleMapsDirectionsUrl(trip, { customer: true }))}" target="_blank" rel="noreferrer">Google Maps</a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;

  requestAnimationFrame(() => drawMap("customer-map", [trip], { customer: true }));
}

function render() {
  state.route = parseRoute();
  if (state.route.name === "customer") {
    renderCustomer();
    return;
  }
  if (state.route.name === "invite") {
    renderDriverInvite();
    return;
  }
  if (state.route.name === "setup" || state.setupMode) {
    renderOwnerSetup();
    return;
  }
  if (!state.auth) {
    renderLogin();
    return;
  }
  if (!state.snapshot) {
    app.innerHTML = `<div class="main"><div class="empty">Loading delivery tracker.</div></div>`;
    return;
  }
  if (state.auth.role === "driver") {
    renderDriver();
    return;
  }
  renderDispatcher();
}

function clearGoogleMapView(view) {
  for (const polyline of view.polylines || []) {
    if (polyline?.setMap) polyline.setMap(null);
  }
  for (const marker of view.markers || []) {
    if ("map" in marker) marker.map = null;
    else if (marker?.setMap) marker.setMap(null);
  }
  view.polylines = [];
  view.markers = [];
}

function deactivateGoogleMap(canvasId, message = "") {
  const canvas = document.getElementById(canvasId);
  const wrap = canvas?.closest(".map-wrap");
  const etaEl = document.getElementById(`${canvasId}-eta`);
  if (wrap) wrap.classList.remove("google-active");
  if (etaEl) {
    etaEl.textContent = message;
    etaEl.hidden = !message;
  }
}

function firstMapCenter(trips, options = {}) {
  for (const trip of trips) {
    const liveStop = liveDriverStop(trip);
    if (liveStop) return liveStop.address;
    const stop = googleRouteStops(trip, options).find((item) => typeof item.address === "object");
    if (stop) return stop.address;
  }
  return { lat: 43.651, lng: -79.383 };
}

function loadGoogleMaps() {
  const apiKey = state.mapsConfig?.apiKey;
  if (!apiKey) return Promise.reject(new Error("Google Maps key is not configured."));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (state.googleMapsPromise) return state.googleMapsPromise;

  state.googleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__deliveryTrackerMapsReady_${Date.now()}`;
    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      loading: "async",
      callback: callbackName,
      auth_referrer_policy: "origin"
    });
    if (state.mapsConfig?.mapId) params.set("map_ids", state.mapsConfig.mapId);

    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      delete window[callbackName];
      state.googleMapsPromise = null;
      reject(new Error("Google Maps failed to load."));
    };
    document.head.appendChild(script);
  });

  return state.googleMapsPromise;
}

function loadOpenMap() {
  if (window.maplibregl?.Map) return Promise.resolve(window.maplibregl);
  if (state.openMapPromise) return state.openMapPromise;

  state.openMapPromise = new Promise((resolve, reject) => {
    const stylesheetId = "rova-maplibre-css";
    if (!document.getElementById(stylesheetId)) {
      const stylesheet = document.createElement("link");
      stylesheet.id = stylesheetId;
      stylesheet.rel = "stylesheet";
      stylesheet.href = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
      document.head.appendChild(stylesheet);
    }

    const script = document.createElement("script");
    script.src = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
    script.async = true;
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => {
      state.openMapPromise = null;
      reject(new Error("The open map library failed to load."));
    };
    document.head.appendChild(script);
  });

  return state.openMapPromise;
}

function openMapData(trips) {
  const routes = [];
  const drivers = [];
  const bounds = [];

  for (const trip of trips) {
    const path = trip.path?.length ? trip.path : trip.location ? [trip.location] : [];
    const coordinates = path
      .map((point) => [Number(point.lng), Number(point.lat)])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (!coordinates.length) continue;

    const color = trip.driver?.color || "#2563eb";
    coordinates.forEach((coordinate) => bounds.push(coordinate));
    if (coordinates.length > 1) {
      routes.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "LineString", coordinates }
      });
    }
    drivers.push({
      type: "Feature",
      properties: { color, label: initials(trip.driver?.name || trip.customerName) },
      geometry: { type: "Point", coordinates: coordinates.at(-1) }
    });
  }

  return {
    bounds,
    routes: { type: "FeatureCollection", features: routes },
    drivers: { type: "FeatureCollection", features: drivers }
  };
}

function clearOpenMapView(canvasId) {
  const view = state.openMapViews[canvasId];
  if (!view) return;
  try {
    view.map.remove();
  } catch {
    // The canvas may have been replaced during a view change.
  }
  delete state.openMapViews[canvasId];
}

async function renderOpenMap(canvasId, trips) {
  const canvas = document.getElementById(canvasId);
  const mapEl = document.getElementById(`${canvasId}-google`);
  const etaEl = document.getElementById(`${canvasId}-eta`);
  const wrap = canvas?.closest(".map-wrap");
  if (!canvas || !mapEl || !wrap) return false;

  const data = openMapData(trips);
  const maplibregl = await loadOpenMap();

  let view = state.openMapViews[canvasId];
  if (view?.mapEl !== mapEl) {
    clearOpenMapView(canvasId);
    const googleView = state.googleMapsViews[canvasId];
    if (googleView) {
      clearGoogleMapView(googleView);
      delete state.googleMapsViews[canvasId];
    }
    mapEl.replaceChildren();

    const center = data.bounds[0] || [-96.5, 56.1];
    const map = new maplibregl.Map({
      container: mapEl,
      style: OPEN_MAP_STYLE_URL,
      center,
      zoom: data.bounds.length ? 13 : 3,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    view = { map, mapEl };
    state.openMapViews[canvasId] = view;

    await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("The open map style timed out.")), 15000);
      map.once("load", () => {
        window.clearTimeout(timeout);
        resolve();
      });
      map.once("error", (event) => {
        if (map.loaded()) return;
        window.clearTimeout(timeout);
        reject(event?.error || new Error("The open map style failed to load."));
      });
    });

    map.addSource("rova-live-routes", { type: "geojson", data: data.routes });
    map.addLayer({
      id: "rova-live-routes",
      type: "line",
      source: "rova-live-routes",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.9 }
    });
    map.addSource("rova-live-drivers", { type: "geojson", data: data.drivers });
    map.addLayer({
      id: "rova-live-drivers",
      type: "circle",
      source: "rova-live-drivers",
      paint: {
        "circle-radius": 9,
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3
      }
    });
  } else {
    view.map.getSource("rova-live-routes")?.setData(data.routes);
    view.map.getSource("rova-live-drivers")?.setData(data.drivers);
  }

  if (data.bounds.length) {
    const bounds = data.bounds.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(data.bounds[0], data.bounds[0]));
    if (data.bounds.length === 1) view.map.jumpTo({ center: data.bounds[0], zoom: 14 });
    else view.map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
  } else {
    view.map.jumpTo({ center: [-96.5, 56.1], zoom: 3 });
  }
  view.map.resize();

  if (etaEl) {
    etaEl.textContent = data.drivers.features.length
      ? `${data.drivers.features.length} live driver${data.drivers.features.length === 1 ? "" : "s"} on the map`
      : "Waiting for the driver's first GPS update";
    etaEl.hidden = false;
  }
  wrap.classList.add("google-active");
  return true;
}

function googleRouteRequest(stops, options = {}) {
  const intermediates = stops.slice(1, -1).slice(0, 25).map((stop) => ({
    location: googleStopLocation(stop)
  }));
  const optimizeWaypointOrder = intermediates.length > 1 && options.optimizeWaypointOrder !== false;
  const fields = ["path", "durationMillis", "distanceMeters", "localizedValues"];
  if (optimizeWaypointOrder) fields.push("optimizedIntermediateWaypointIndices");
  return {
    origin: googleStopLocation(stops[0]),
    destination: googleStopLocation(stops.at(-1)),
    intermediates,
    travelMode: "DRIVING",
    routingPreference: "TRAFFIC_AWARE",
    // Google rejects timestamps that arrive even slightly in the past after network latency.
    departureTime: new Date(Date.now() + 60_000),
    optimizeWaypointOrder,
    fields
  };
}

function driverMarkerContent(trip) {
  const marker = document.createElement("div");
  marker.className = "driver-map-pin";
  marker.style.setProperty("--pin-color", trip.driver?.color || "#2563eb");
  marker.textContent = initials(trip.driver?.name || trip.customerName);
  return marker;
}

async function computeGoogleRoute(Route, trip, stops, options = {}) {
  const key = googleRouteCacheKey(trip, options);
  const current = state.googleRouteCache.get(key);
  const now = Date.now();
  if (current?.route && now - current.updatedAt < GOOGLE_ROUTE_CACHE_MS) return current.route;
  if (current?.pending) return current.pending;

  const pending = Route.computeRoutes(googleRouteRequest(stops, { optimizeWaypointOrder: !trip.preserveStopOrder }))
    .then(({ routes }) => {
      const route = routes?.[0] || null;
      state.googleRouteCache.set(key, { route, updatedAt: Date.now() });
      return route;
    })
    .catch((error) => {
      state.googleRouteCache.delete(key);
      throw error;
    });

  state.googleRouteCache.set(key, { pending, updatedAt: current?.updatedAt || 0 });
  return pending;
}

function googleMarkerStops(stops, route) {
  const intermediateStops = stops.slice(1, -1);
  const order = route?.optimizedIntermediateWaypointIndices;
  const hasOptimizedOrder = Array.isArray(order)
    && order.length === intermediateStops.length
    && new Set(order).size === intermediateStops.length
    && order.every((index) => Number.isInteger(index) && index >= 0 && index < intermediateStops.length);
  return hasOptimizedOrder
    ? [stops[0], ...order.map((index) => intermediateStops[index]), stops.at(-1)].filter(Boolean)
    : stops;
}

function googleMarkerLabel(index, total, returnsToOrigin) {
  if (index === 0) return "S";
  if (index === total - 1) return returnsToOrigin ? "R" : "D";
  return String(index);
}

function addGoogleMarker(view, map, markerLibrary, trip, stop, label, options = {}) {
  const position = googleStopLocation(stop);
  if (!position) return;

  if (options.live && state.mapsConfig?.mapId && markerLibrary.AdvancedMarkerElement) {
    const marker = new markerLibrary.AdvancedMarkerElement({
      map,
      position,
      title: trip.driver?.name || "Driver",
      content: driverMarkerContent(trip)
    });
    view.markers.push(marker);
    return;
  }

  if (google.maps.Marker) {
    const marker = new google.maps.Marker({
      map,
      position,
      title: options.live ? (trip.driver?.name || "Driver") : stop.label,
      label
    });
    view.markers.push(marker);
  }
}

async function renderGoogleRoutes(canvasId, trips, options = {}) {
  const canvas = document.getElementById(canvasId);
  const mapEl = document.getElementById(`${canvasId}-google`);
  const etaEl = document.getElementById(`${canvasId}-eta`);
  const wrap = canvas?.closest(".map-wrap");
  if (!canvas || !mapEl || !wrap) return false;

  const routableTrips = trips
    .map((trip) => ({ trip, stops: googleRouteStops(trip, options) }))
    .filter(({ stops }) => stops.length >= 2);
  if (!routableTrips.length) return false;

  let view = state.googleMapsViews[canvasId];
  if (view?.mapEl !== mapEl) {
    if (view) clearGoogleMapView(view);
    view = { map: null, mapEl, polylines: [], markers: [], signature: "", seq: 0 };
    state.googleMapsViews[canvasId] = view;
  }

  const seq = ++state.googleMapsDrawSeq;
  view.seq = seq;

  await loadGoogleMaps();
  const [{ Map, Polyline }, { LatLngBounds }, { Route }, markerLibrary] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("core"),
    google.maps.importLibrary("routes"),
    google.maps.importLibrary("marker").catch(() => ({}))
  ]);
  if (view.seq !== seq) return true;

  if (!view.map) {
    const mapOptions = {
      center: firstMapCenter(trips, options),
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false
    };
    if (state.mapsConfig?.mapId) mapOptions.mapId = state.mapsConfig.mapId;
    view.map = new Map(mapEl, mapOptions);
  }

  clearGoogleMapView(view);
  const bounds = new LatLngBounds();
  let hasBounds = false;
  let rendered = 0;
  const summaries = [];

  for (const { trip, stops } of routableTrips) {
    try {
      const route = await computeGoogleRoute(Route, trip, stops, options);
      if (!route?.path?.length) continue;

      const color = trip.driver?.color || "#2563eb";
      const polyline = new Polyline({
        map: view.map,
        path: route.path,
        strokeColor: color,
        strokeOpacity: 0.86,
        strokeWeight: 5
      });
      view.polylines.push(polyline);

      const liveStop = liveDriverStop(trip);
      const orderedStops = googleMarkerStops(stops, route);
      const markerStops = liveStop ? orderedStops.slice(1) : orderedStops;
      const firstLocation = googleStopLocation(orderedStops[0]);
      const lastLocation = googleStopLocation(orderedStops.at(-1));
      const returnsToOrigin = typeof firstLocation === "object" || typeof lastLocation === "object"
        ? JSON.stringify(firstLocation) === JSON.stringify(lastLocation)
        : String(firstLocation).trim().toLowerCase() === String(lastLocation).trim().toLowerCase();
      markerStops.forEach((stop, index) => {
        const markerIndex = liveStop ? index + 1 : index;
        const label = liveStop && markerIndex < orderedStops.length - 1
          ? String(markerIndex)
          : googleMarkerLabel(markerIndex, orderedStops.length, returnsToOrigin);
        addGoogleMarker(view, view.map, markerLibrary, trip, stop, label);
      });

      if (liveStop) addGoogleMarker(view, view.map, markerLibrary, trip, liveStop, initials(trip.driver?.name), { live: true });

      route.path.forEach((point) => {
        bounds.extend(point);
        hasBounds = true;
      });

      const summary = routeSummaryFromGoogle(route);
      const intermediateCount = Math.max(0, stops.length - 2);
      const optimized = route.optimizedIntermediateWaypointIndices?.length ? " optimized" : "";
      summaries.push([
        trip.customerName,
        summary.duration,
        summary.eta ? `ETA ${summary.eta}` : "",
        summary.distance,
        intermediateCount ? `${intermediateCount} stop${intermediateCount === 1 ? "" : "s"}${optimized}` : ""
      ].filter(Boolean).join(" · "));
      rendered += 1;
    } catch (error) {
      if (isGoogleMapsAccessError(error)) {
        state.googleMapsDenied = true;
        console.warn("Google route access is unavailable. Using the live GPS map fallback.");
        break;
      }
      console.warn("Google route failed", error);
    }
  }

  if (!rendered) return false;
  view.signature = routableTrips.map(({ trip }) => googleRouteCacheKey(trip, options)).join("::");
  if (hasBounds) view.map.fitBounds(bounds, 56);
  if (etaEl) {
    etaEl.textContent = summaries.join(" | ");
    etaEl.hidden = !summaries.length;
  }
  wrap.classList.add("google-active");
  return true;
}

function drawMap(canvasId, trips, options = {}) {
  if (canvasId === "dispatcher-map") {
    const badge = document.querySelector('[data-map-badge-for="dispatcher-map"]');
    const selectedCount = state.selectedOrderIds.size;
    const liveCount = activeTrips().length;
    if (badge) {
      badge.textContent = selectedCount
        ? `Selected route · ${selectedCount} order${selectedCount === 1 ? "" : "s"}`
        : liveCount
          ? `Live fleet · ${liveCount} deliver${liveCount === 1 ? "y" : "ies"}`
          : "Recent routes";
    }
  }
  const useLiveMap = () => renderOpenMap(canvasId, trips).then((rendered) => {
    if (!rendered) deactivateGoogleMap(canvasId);
  }).catch(() => deactivateGoogleMap(canvasId));

  drawCanvasMap(canvasId, trips);
  if (state.mapsConfig?.configured && !state.googleMapsDenied) {
    renderGoogleRoutes(canvasId, trips, options)
      .then((rendered) => {
        if (!rendered) return useLiveMap();
        return null;
      })
      .catch(() => useLiveMap());
    return;
  }
  useLiveMap();
}

function drawCanvasMap(canvasId, trips) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const points = trips.flatMap((trip) => trip.path?.length ? trip.path : trip.location ? [trip.location] : []);
  drawRoads(ctx, rect.width, rect.height);

  if (!points.length) {
    const courierTrip = trips.find((trip) => trip.courier);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#344054";
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.fillText(courierTrip ? "Courier route preview" : "Waiting for driver GPS", rect.width / 2, rect.height / 2 - 10);
    ctx.fillStyle = "#667085";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(courierTrip ? "Use the provider tracking link when it becomes available." : "The live route appears after the driver shares a first location.", rect.width / 2, rect.height / 2 + 16);
    return;
  }

  const lats = points.map((point) => Number(point.lat));
  const lngs = points.map((point) => Number(point.lng));
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  const latPad = Math.max(0.002, (maxLat - minLat) * 0.25);
  const lngPad = Math.max(0.002, (maxLng - minLng) * 0.25);
  minLat -= latPad;
  maxLat += latPad;
  minLng -= lngPad;
  maxLng += lngPad;

  const project = (point) => {
    const x = ((Number(point.lng) - minLng) / (maxLng - minLng || 1)) * (rect.width - 56) + 28;
    const y = rect.height - (((Number(point.lat) - minLat) / (maxLat - minLat || 1)) * (rect.height - 56) + 28);
    return { x, y };
  };

  for (const trip of trips) {
    const color = trip.driver?.color || "#2563eb";
    const path = trip.path?.length ? trip.path : trip.location ? [trip.location] : [];
    if (!path.length) continue;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.beginPath();
    path.forEach((point, index) => {
      const pos = project(point);
      if (index === 0) ctx.moveTo(pos.x, pos.y);
      else ctx.lineTo(pos.x, pos.y);
    });
    ctx.stroke();

    path.forEach((point, index) => {
      if (index > 0 && index < path.length - 1 && index % 2 !== 0) return;
      const pos = project(point);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, index === path.length - 1 ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    const last = project(path.at(-1));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(trip.driver?.name || trip.customerName), last.x, last.y + 0.5);
  }
}

function drawRoads(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
  ctx.lineWidth = 7;
  for (let x = -width; x < width * 2; x += 110) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + width * 0.8, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(15, 23, 42, 0.06)";
  ctx.lineWidth = 5;
  for (let y = 40; y < height; y += 96) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + 24);
    ctx.stroke();
  }
  ctx.restore();
}

function publishLocation(tripId, point) {
  const publish = state.locationPublishPromise
    .catch(() => {})
    .then(async () => {
      const response = await api(`/api/trips/${tripId}/location`, {
        method: "POST",
        body: point
      });
      if (state.publishTripId !== tripId) return response;
      if (response.snapshot) state.snapshot = response.snapshot;
      if (state.route.name === "customer" && response.trip) state.customerTrip = response.trip;
      maybeRender();
      return response;
    })
    .catch((error) => {
      if (state.publishTripId === tripId) toast(error.message);
      return null;
    });
  state.locationPublishPromise = publish;
  return publish;
}

function stopPublishing(showToast = true) {
  if (state.gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
  }
  if (state.simTimer !== null) {
    clearInterval(state.simTimer);
  }
  state.gpsWatchId = null;
  state.simTimer = null;
  state.publishTripId = "";
  state.simOrigin = null;
  state.simStep = 0;
  if (showToast) toast("Publishing stopped");
  maybeRender();
}

function startGps(tripId) {
  if (!navigator.geolocation) {
    toast("This browser does not expose GPS.");
    return;
  }
  stopPublishing(false);
  state.publishTripId = tripId;
  state.gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      publishLocation(tripId, {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed
      });
    },
    (error) => {
      toast(error.message || "GPS permission was not granted.");
      stopPublishing(false);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
  toast("Publishing GPS");
  maybeRender();
}

function startSimulation(tripId) {
  const trip = getTrips().find((item) => item.id === tripId);
  if (!trip) return;
  stopPublishing(false);
  state.publishTripId = tripId;
  state.simOrigin = trip.location || trip.path?.at(-1) || { lat: 43.651, lng: -79.383 };
  state.simStep = 0;
  const tick = () => {
    state.simStep += 1;
    const angle = state.simStep * 0.62;
    const point = {
      lat: Number(state.simOrigin.lat) + state.simStep * 0.0008 + Math.sin(angle) * 0.00028,
      lng: Number(state.simOrigin.lng) + state.simStep * 0.00095 + Math.cos(angle) * 0.00024,
      accuracy: 12,
      heading: (state.simStep * 27) % 360,
      speed: 8
    };
    publishLocation(tripId, point);
  };
  tick();
  state.simTimer = setInterval(tick, 2500);
  toast("Simulated movement started");
  maybeRender();
}

async function submitTrip(tripId) {
  const notes = document.getElementById(`trip-notes-${tripId}`)?.value;
  const response = await api(`/api/trips/${tripId}/submit`, {
    method: "POST",
    body: notes !== undefined ? { notes } : {}
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Trip submitted");
  render();
}

async function submitWeek(driverId) {
  const completed = currentWeekTrips(driverId, { businessOnly: true }).filter((trip) => ["completed", "rejected", "failed"].includes(trip.status));
  if (!completed.length) {
    toast("No completed trips to submit");
    return;
  }
  for (const trip of completed) {
    const response = await api(`/api/trips/${trip.id}/submit`, {
      method: "POST",
      body: {}
    });
    if (response.snapshot) state.snapshot = response.snapshot;
  }
  toast("Week submitted for approval");
  render();
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The signature could not be saved.")), "image/png", 0.92);
  });
}

async function uploadProofMedia(tripId) {
  const formData = new FormData();
  const photo = document.querySelector(`[data-proof-photo="${CSS.escape(tripId)}"]`)?.files?.[0];
  if (photo) {
    if (photo.size > 5 * 1024 * 1024) throw new Error("The proof photo must be 5 MB or smaller.");
    formData.append("photo", photo, photo.name || "delivery-photo.jpg");
  }
  const signature = document.querySelector(`[data-signature-pad="${CSS.escape(tripId)}"]`);
  if (signature?.dataset.signed === "true") {
    formData.append("signature", await canvasBlob(signature), "recipient-signature.png");
  }
  if (!photo && signature?.dataset.signed !== "true") return null;
  return api(`/api/trips/${tripId}/proof-media`, { method: "POST", formData });
}

async function completeTrip(tripId) {
  const originalTrip = getTrips().find((trip) => trip.id === tripId);
  const wasGpsPublishing = state.publishTripId === tripId && state.gpsWatchId !== null;
  const wasSimulating = state.publishTripId === tripId && state.simTimer !== null;
  const activeEditorValue = (attribute) => document.querySelector(`[${attribute}="${CSS.escape(tripId)}"]`)?.value;
  const driverNotes = document.getElementById(`trip-notes-${tripId}`)?.value;
  const activeNotes = activeEditorValue("data-order-notes");
  const proofSelect = document.getElementById(`trip-proof-method-${tripId}`);
  const proofOutcome = proofSelect?.value || (state.auth?.role === "dispatcher" ? "dispatcher-override" : "delivered-recipient");
  const proofMethod = proofSelect?.selectedOptions?.[0]?.textContent?.trim() || (state.auth?.role === "dispatcher" ? "Dispatcher override" : "Delivered to recipient");
  const proofRecipient = document.getElementById(`trip-proof-recipient-${tripId}`)?.value || "";
  const exception = proofOutcome.startsWith("exception-") || proofOutcome === "returned";
  const exceptionNote = document.getElementById(`trip-exception-note-${tripId}`)?.value.trim() || "";
  if (exception && !exceptionNote) throw new Error("Add a note explaining the delivery issue.");
  const signature = document.querySelector(`[data-signature-pad="${CSS.escape(tripId)}"]`);
  if (proofOutcome === "verified" && signature?.dataset.signed !== "true") {
    throw new Error("Collect the recipient signature before choosing Signature collected.");
  }
  const body = {
    proofMethod,
    proofOutcome,
    proofRecipient,
    exceptionNote,
    exceptionNextAction: document.getElementById(`trip-exception-action-${tripId}`)?.value || "dispatcher"
  };
  const notes = activeNotes !== undefined ? activeNotes : driverNotes;
  if (notes !== undefined) body.notes = notes;
  if (state.auth?.role === "dispatcher") {
    body.overrideReason = "Completed from the dispatcher active-delivery controls.";
    const editorFields = {
      customerName: activeEditorValue("data-order-customer"),
      pickup: activeEditorValue("data-order-pickup"),
      destination: activeEditorValue("data-order-destination"),
      stopsText: activeEditorValue("data-dispatch-stops"),
      kmRate: activeEditorValue("data-dispatch-rate")
    };
    for (const [key, value] of Object.entries(editorFields)) {
      if (value !== undefined) body[key] = key === "kmRate" ? Number(value) : value;
    }
  }
  if (wasGpsPublishing || wasSimulating) stopPublishing(false);
  let response;
  try {
    await state.locationPublishPromise.catch(() => {});
    await uploadProofMedia(tripId);
    response = await api(`/api/trips/${tripId}/complete`, {
      method: "POST",
      body
    });
  } catch (error) {
    if (wasGpsPublishing) setTimeout(() => startGps(tripId), 0);
    if (wasSimulating) setTimeout(() => startSimulation(tripId), 0);
    throw error;
  }
  if (response.snapshot) state.snapshot = response.snapshot;
  const nextRouteTrip = originalTrip?.routeId
    ? getTrips()
        .filter((trip) => trip.routeId === originalTrip.routeId && trip.status === "active")
        .sort((a, b) => Number(a.routeSequence || 0) - Number(b.routeSequence || 0))[0]
    : null;
  toast(response.trip?.status === "exception" ? "Delivery issue sent to dispatch" : "Delivery completed");
  render();
  if (nextRouteTrip && wasGpsPublishing) setTimeout(() => startGps(nextRouteTrip.id), 0);
  if (nextRouteTrip && wasSimulating) setTimeout(() => startSimulation(nextRouteTrip.id), 0);
}

async function completeActiveDelivery(tripId, tripName) {
  if (!window.confirm(`Mark ${tripName || "this delivery"} complete? Live tracking will stop and the trip will move to mileage review.`)) return;
  await completeTrip(tripId);
}

async function approveTrip(tripId) {
  const response = await api(`/api/trips/${tripId}/approval`, {
    method: "POST",
    body: { decision: "approved", approvalNotes: "Approved" },
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Trip approved");
  render();
}

async function rejectTrip(tripId) {
  const note = window.prompt("Rejection note for the driver", "Please revise this trip report.");
  if (note === null) return;
  const response = await api(`/api/trips/${tripId}/approval`, {
    method: "POST",
    body: { decision: "rejected", approvalNotes: note },
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Trip rejected");
  render();
}

async function syncWixOrders() {
  const response = await api("/api/integrations/wix/sync", {
    method: "POST",
    body: {}
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  const imported = response.sync?.imported || 0;
  const updated = response.sync?.updated || 0;
  const fetched = response.sync?.ordersFetched || 0;
  const changes = [];
  if (imported) changes.push(`imported ${imported}`);
  if (updated) changes.push(`updated ${updated}`);
  toast(changes.length ? `Wix orders ${changes.join(", ")}` : `No changes from ${fetched} Wix orders checked`);
  render();
}

async function syncChannels(connectionId = "") {
  const response = await api(connectionId ? `/api/integrations/${encodeURIComponent(connectionId)}/sync` : "/api/integrations/sync", {
    method: "POST",
    body: {}
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  const results = response.results || (response.sync ? [response.sync] : []);
  const imported = results.reduce((total, item) => total + Number(item.imported || 0), 0);
  const updated = results.reduce((total, item) => total + Number(item.updated || 0), 0);
  const errors = results.filter((item) => item.error).length;
  toast(errors ? `Sync finished with ${errors} connection error${errors === 1 ? "" : "s"}` : `Sync complete · ${imported} new · ${updated} updated`);
  render();
}

async function connectChannel(form) {
  const body = formObject(form);
  const response = await api("/api/integrations/connect", { method: "POST", body });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.lastWebhook = response.webhookUrl || null;
  toast(`${response.connection?.name || "Sales channel"} connected`);
  render();
}

async function disconnectChannel(connectionId, connectionName) {
  if (!window.confirm(`Disconnect ${connectionName || "this sales channel"}? Imported orders will stay in Rivo.`)) return;
  const response = await api(`/api/integrations/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Sales channel disconnected");
  render();
}

async function dispatchTrip(tripId) {
  const valueFor = (attribute) => document.querySelector(`[${attribute}="${CSS.escape(tripId)}"]`)?.value;
  const driverId = document.querySelector(`[data-dispatch-driver="${CSS.escape(tripId)}"]`)?.value;
  const kmRate = document.querySelector(`[data-dispatch-rate="${CSS.escape(tripId)}"]`)?.value;
  const stopsText = document.querySelector(`[data-dispatch-stops="${CSS.escape(tripId)}"]`)?.value || "";
  const response = await api(`/api/trips/${tripId}/dispatch`, {
    method: "POST",
    body: {
      driverId,
      kmRate: Number(kmRate),
      stopsText,
      customerName: valueFor("data-order-customer"),
      pickup: valueFor("data-order-pickup"),
      destination: valueFor("data-order-destination"),
      notes: valueFor("data-order-notes")
    }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Order dispatched");
  render();
}

async function retryExceptionTrip(tripId) {
  const trip = getTrips().find((item) => item.id === tripId);
  if (!trip) throw new Error("This delivery is no longer available.");
  const driverId = document.querySelector(`[data-exception-driver="${CSS.escape(tripId)}"]`)?.value || trip.driverId || "";
  if (!driverId) throw new Error("Choose a driver for the retry.");
  const response = await api(`/api/trips/${tripId}/dispatch`, {
    method: "POST",
    body: {
      driverId,
      kmRate: Number(trip.kmRate || getDriver(driverId)?.defaultRate || 0),
      customerName: trip.customerName,
      pickup: trip.pickup,
      destination: trip.destination,
      stops: trip.stops,
      notes: trip.notes
    }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast(`Retry sent to ${response.trip?.driver?.name || "driver"}`);
  render();
}

async function closeExceptionTrip(tripId) {
  const note = document.querySelector(`[data-exception-resolution="${CSS.escape(tripId)}"]`)?.value.trim() || "";
  if (!note) throw new Error("Add a resolution note before closing this issue.");
  const response = await api(`/api/trips/${tripId}/complete`, {
    method: "POST",
    body: {
      proofOutcome: "dispatcher-failed",
      proofMethod: "Delivery closed as failed",
      overrideReason: note
    }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Delivery closed as failed and kept in mileage review");
  render();
}

async function dispatchSelectedRoute() {
  const tripIds = getTrips().filter((trip) => state.selectedOrderIds.has(trip.id)).map((trip) => trip.id);
  if (!tripIds.length) throw new Error("Select at least one order.");
  const driverId = document.getElementById("bulk-order-driver")?.value || "";
  const kmRate = Number(document.getElementById("bulk-order-rate")?.value || 0);
  const response = await api("/api/routes/dispatch", {
    method: "POST",
    body: {
      tripIds,
      driverId,
      kmRate,
      origin: companyPickupAddress()
    }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.selectedOrderIds.clear();
  toast(response.optimized ? `${response.trips.length} orders dispatched as an optimized route` : `${response.trips.length} orders dispatched as one route`);
  render();
}

async function bulkUpdateTrips(action, tripIds, extra = {}) {
  const response = await api("/api/trips/bulk", {
    method: "POST",
    body: { action, tripIds, ...extra }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  return response;
}

async function assignSelectedOrders() {
  const tripIds = getTrips().filter((trip) => state.selectedOrderIds.has(trip.id)).map((trip) => trip.id);
  if (!tripIds.length) throw new Error("Select at least one order.");
  const driverId = document.getElementById("bulk-order-driver")?.value || "";
  const kmRate = Number(document.getElementById("bulk-order-rate")?.value || 0);
  const response = await bulkUpdateTrips("assign", tripIds, { driverId, kmRate });
  state.selectedOrderIds.clear();
  toast(`${response.updated} order${response.updated === 1 ? "" : "s"} assigned`);
  render();
}

async function markSelectedOrdersDelivered() {
  const tripIds = getTrips().filter((trip) => state.selectedOrderIds.has(trip.id)).map((trip) => trip.id);
  if (!tripIds.length) throw new Error("Select at least one order.");
  const overrideReason = window.prompt(
    `Why are ${tripIds.length} selected order${tripIds.length === 1 ? "" : "s"} being marked delivered by dispatch?`,
    "Delivery confirmed by dispatch"
  );
  if (overrideReason === null) return;
  if (!overrideReason.trim()) throw new Error("Add a reason for the dispatcher override.");
  const response = await bulkUpdateTrips("delivered", tripIds, { overrideReason: overrideReason.trim() });
  state.selectedOrderIds.clear();
  toast(`${response.updated} order${response.updated === 1 ? "" : "s"} marked delivered`);
  render();
}

async function completeSelectedActiveTrips() {
  const tripIds = getTrips().filter((trip) => state.selectedActiveTripIds.has(trip.id)).map((trip) => trip.id);
  if (!tripIds.length) throw new Error("Select at least one active delivery.");
  const overrideReason = window.prompt(
    `Why is dispatch completing ${tripIds.length} selected deliver${tripIds.length === 1 ? "y" : "ies"}?`,
    "Delivery confirmed by dispatch"
  );
  if (overrideReason === null) return;
  if (!overrideReason.trim()) throw new Error("Add a reason for the dispatcher override.");
  const response = await bulkUpdateTrips("complete", tripIds, { overrideReason: overrideReason.trim() });
  state.selectedActiveTripIds.clear();
  toast(`${response.updated} deliver${response.updated === 1 ? "y" : "ies"} completed`);
  render();
}

async function prepareOptimizationPlan() {
  const tripIds = queuedTrips().map((trip) => trip.id);
  if (!tripIds.length) throw new Error("There are no queued deliveries to optimize.");
  state.optimizerLoading = true;
  render();
  try {
    const response = await api("/api/routes/recommendations", { method: "POST", body: { tripIds } });
    state.optimizerPlan = response.plan;
    toast("Optimization plan ready");
  } finally {
    state.optimizerLoading = false;
    render();
  }
}

async function autoAssignOrders() {
  const tripIds = queuedTrips().map((trip) => trip.id);
  const response = await api("/api/routes/auto-assign", { method: "POST", body: { tripIds } });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.optimizerPlan = null;
  toast(`${response.assigned} order${response.assigned === 1 ? "" : "s"} assigned${response.optimizedRoutes ? ` across ${response.optimizedRoutes} optimized route${response.optimizedRoutes === 1 ? "" : "s"}` : ""}`);
  render();
}

async function saveActiveRouteOrder(group) {
  const tripIds = Array.from(group.querySelectorAll(":scope > [data-active-trip-id]")).map((item) => item.dataset.activeTripId);
  if (tripIds.length < 2) return;
  const response = await api("/api/routes/reorder", {
    method: "POST",
    body: { tripIds, origin: companyPickupAddress() }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Route order updated");
  render();
}

async function moveActiveRouteStop(tripId, direction) {
  const item = document.querySelector(`[data-active-trip-id="${CSS.escape(tripId)}"]`);
  const group = item?.closest("[data-active-route-driver]");
  if (!item || !group) return;
  const items = Array.from(group.querySelectorAll(":scope > [data-active-trip-id]"));
  const index = items.indexOf(item);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) {
    toast(direction === "up" ? "This is already the first stop" : "This is already the last stop");
    return;
  }
  if (direction === "up") group.insertBefore(item, items[targetIndex]);
  else group.insertBefore(items[targetIndex], item);
  await saveActiveRouteOrder(group);
}

async function saveOrderChanges(tripId) {
  const valueFor = (attribute) => document.querySelector(`[${attribute}="${CSS.escape(tripId)}"]`)?.value;
  const body = {
    customerName: valueFor("data-order-customer"),
    pickup: valueFor("data-order-pickup"),
    destination: valueFor("data-order-destination"),
    stopsText: valueFor("data-dispatch-stops"),
    notes: valueFor("data-order-notes")
  };
  const kmRate = valueFor("data-dispatch-rate");
  if (kmRate !== undefined) body.kmRate = Number(kmRate);
  const response = await api(`/api/trips/${tripId}`, {
    method: "PATCH",
    body
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Order changes saved");
  render();
}

async function markOrderDelivered(tripId, orderLabel) {
  const overrideReason = window.prompt(
    `Why is ${orderLabel || "this order"} being marked delivered by dispatch?`,
    "Delivery confirmed by dispatch"
  );
  if (overrideReason === null) return;
  if (!overrideReason.trim()) throw new Error("Add a reason for the dispatcher override.");
  const response = await api(`/api/trips/${tripId}/delivered`, {
    method: "POST",
    body: { overrideReason: overrideReason.trim() }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Order marked delivered");
  render();
}

async function deleteDriver(driverId, driverName) {
  const driverTrips = tripsForDriver(driverId);
  const activeCount = driverTrips.filter((trip) => trip.status === "active").length;
  if (activeCount) throw new Error(`Reassign or finish ${activeCount} active deliver${activeCount === 1 ? "y" : "ies"} before archiving this driver.`);
  const message = `Archive ${driverName}? Their account access will stop, but ${driverTrips.length ? `${driverTrips.length} historical trip${driverTrips.length === 1 ? "" : "s"}` : "their profile history"} will be preserved.`;
  if (!window.confirm(message)) return;
  const response = await api(`/api/drivers/${encodeURIComponent(driverId)}`, {
    method: "DELETE"
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.editingDriverId = "";
  toast("Driver archived · delivery history preserved");
  render();
}

async function setDriverHome(driverId, driverName, currentAddress) {
  const homeAddress = window.prompt(`Home address for ${driverName}`, currentAddress || "");
  if (homeAddress === null) return;
  if (!homeAddress.trim()) throw new Error("Enter a home address.");
  const response = await api(`/api/drivers/${encodeURIComponent(driverId)}`, {
    method: "PATCH",
    body: { homeAddress: homeAddress.trim() }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Home address saved");
  render();
}

async function copyDriverInvite(driverId) {
  const response = await api(`/api/drivers/${encodeURIComponent(driverId)}/invite`, {
    method: "POST",
    body: {}
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.lastInvite = {
    url: response.inviteUrl,
    email: response.driver?.email || "",
    name: response.driver?.name || "",
    emailSent: Boolean(response.emailSent),
    message: response.emailSent
      ? "The driver can open the email and create a password. The same secure link is shown here for verification."
      : `Automatic email is not connected. Share this link with the driver so they can create a password. ${response.emailMessage || ""}`.trim()
  };
  render();
  let copied = false;
  try {
    await copyText(response.inviteUrl);
    copied = true;
  } catch {
    copied = false;
  }
  toast(response.emailSent ? "Invitation email sent" : copied ? "Invitation link copied" : "Invitation link ready");
}

async function updateDriverProfile(form) {
  const body = formObject(form);
  const driverId = String(body.driverId || "");
  body.defaultRate = Number(body.defaultRate || 0);
  body.capacity = Number(body.capacity || 20);
  delete body.driverId;
  const response = await api(`/api/drivers/${encodeURIComponent(driverId)}`, { method: "PATCH", body });
  if (response.snapshot) state.snapshot = response.snapshot;
  if (response.identityChanged && response.inviteUrl) {
    state.lastInvite = {
      url: response.inviteUrl,
      email: response.driver?.email || body.email || "",
      name: response.driver?.name || "",
      emailSent: Boolean(response.emailSent),
      message: response.emailSent
        ? "The login email changed, so old sessions and links were revoked and a fresh invitation was emailed."
        : `The login email changed, so old sessions and links were revoked. Share this fresh invitation: ${response.emailMessage || "Automatic email is not connected."}`
    };
  }
  state.editingDriverId = "";
  toast(response.identityChanged ? (response.emailSent ? "Profile saved · fresh invite emailed" : "Profile saved · fresh invite ready") : "Driver profile saved");
  render();
}

async function createCourierPartner(form) {
  const body = formObject(form);
  const response = await api("/api/couriers", { method: "POST", body });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Courier partner saved");
  render();
}

async function updateCourierPartner(form) {
  const body = formObject(form);
  const courierPartnerId = String(body.courierPartnerId || "");
  delete body.courierPartnerId;
  const response = await api(`/api/couriers/${encodeURIComponent(courierPartnerId)}`, { method: "PATCH", body });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.editingCourierId = "";
  toast("Courier partner updated");
  render();
}

async function archiveCourierPartner(courierPartnerId, courierName) {
  if (!window.confirm(`Archive ${courierName || "this courier partner"}? Historical requests will stay in Rivo.`)) return;
  const response = await api(`/api/couriers/${encodeURIComponent(courierPartnerId)}`, { method: "DELETE" });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.editingCourierId = "";
  toast("Courier partner archived");
  render();
}

async function createCourierRequest(form) {
  const body = formObject(form);
  const tripIds = [...state.courierRequestTripIds];
  if (!tripIds.length) throw new Error("Select at least one order.");
  if (body.requestedPickupAt) body.requestedPickupAt = new Date(body.requestedPickupAt).toISOString();
  body.tripIds = tripIds;
  const response = await api("/api/courier-requests", { method: "POST", body });
  if (response.snapshot) state.snapshot = response.snapshot;
  state.courierRequestTripIds = [];
  state.selectedOrderIds.clear();
  toast(response.deliverySent ? "Courier request emailed" : "Courier request saved · not sent yet");
  render();
  requestAnimationFrame(() => document.querySelector(".courier-requests-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

async function updateCourierRequest(form) {
  const courierRequestId = form.dataset.courierRequestUpdate || "";
  const response = await api(`/api/courier-requests/${encodeURIComponent(courierRequestId)}`, {
    method: "PATCH",
    body: formObject(form)
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast("Courier request updated");
  render();
}

async function updateLeadStage(leadId, stage) {
  const response = await api(`/api/leads/${encodeURIComponent(leadId)}`, {
    method: "PATCH",
    body: { stage }
  });
  if (response.snapshot) state.snapshot = response.snapshot;
  toast(`Lead moved to ${leadStageLabels[stage] || stage}`);
  render();
}

async function loginTeam(identifier, password) {
  state.loginError = "";
  state.ownerRecoveryIdentifier = String(identifier || "").trim();
  try {
    const response = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { identifier, password }
    });
    state.auth = response.session;
    state.snapshot = response.snapshot;
    state.ownerRecoveryMode = false;
    state.ownerRecoveryError = "";
    writeStoredAuth(state.auth);
    connectSnapshotStream();
    window.history.replaceState({}, "", dispatcherPath());
    render();
  } catch (error) {
    state.auth = null;
    state.snapshot = null;
    state.loginError = error.message || "Login failed.";
    if (error.code === "password_upgrade_required") state.ownerRecoveryMode = true;
    writeStoredAuth(null);
    renderLogin();
  }
}

async function setupOwnerAccount(body) {
  state.setupError = "";
  body.name = String(body.name || body.username || "Owner").trim();
  try {
    const response = await api("/api/auth/setup", {
      method: "POST",
      auth: false,
      body
    });
    state.auth = response.session;
    state.snapshot = response.snapshot;
    state.company = response.snapshot?.company || state.company;
    state.setupMode = false;
    state.loginError = "";
    writeStoredAuth(state.auth);
    connectSnapshotStream();
    window.history.replaceState({}, "", dispatcherPath());
    render();
  } catch (error) {
    state.auth = null;
    state.snapshot = null;
    state.setupError = error.message || "Account setup failed.";
    writeStoredAuth(null);
    renderOwnerSetup();
  }
}

async function logoutTeam() {
  try {
    await api("/api/auth/logout", {
      method: "POST",
      body: {}
    });
  } catch {
    // Losing the server-side logout call should not keep this browser signed in.
  }
  stopPublishing(false);
  state.auth = null;
  state.snapshot = null;
  state.loginError = "";
  stopLiveRefresh();
  writeStoredAuth(null);
  renderLogin();
}

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "bulk-order-rate") {
    state.bulkRate = Number(target.value || 0);
    return;
  }
  if (!target.matches("[data-order-search-input]")) return;
  state.orderQuery = target.value;
  applyOrderFilters();
  drawMap("dispatcher-map", dispatcherMapTrips());
});

function signaturePoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
  };
}

app.addEventListener("pointerdown", (event) => {
  const canvas = event.target.closest?.("[data-signature-pad]");
  if (!canvas) return;
  event.preventDefault();
  markDraftDirty(canvas);
  activeSignatureCanvas = canvas;
  canvas.setPointerCapture?.(event.pointerId);
  const point = signaturePoint(canvas, event);
  const context = canvas.getContext("2d");
  context.strokeStyle = "#122033";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(point.x, point.y);
  canvas.signatureLastPoint = point;
  canvas.signatureDistance = canvas.dataset.signed === "true" ? 10 : 0;
});

app.addEventListener("pointermove", (event) => {
  if (!activeSignatureCanvas) return;
  event.preventDefault();
  const point = signaturePoint(activeSignatureCanvas, event);
  const context = activeSignatureCanvas.getContext("2d");
  const previousPoint = activeSignatureCanvas.signatureLastPoint || point;
  activeSignatureCanvas.signatureDistance = Number(activeSignatureCanvas.signatureDistance || 0)
    + Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
  activeSignatureCanvas.signatureLastPoint = point;
  if (activeSignatureCanvas.signatureDistance >= 8) activeSignatureCanvas.dataset.signed = "true";
  context.lineTo(point.x, point.y);
  context.stroke();
});

for (const eventName of ["pointerup", "pointercancel"]) {
  app.addEventListener(eventName, () => {
    if (!activeSignatureCanvas) return;
    activeSignatureCanvas.getContext("2d").closePath();
    activeSignatureCanvas = null;
  });
}

app.addEventListener("click", async (event) => {
  if (event.target.matches("[data-modal-backdrop]")) {
    state.editingDriverId = "";
    state.editingCourierId = "";
    state.courierRequestTripIds = [];
    render();
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const actionButton = target.closest("button");
  if (actionButton?.disabled) return;
  if (actionButton) actionButton.disabled = true;
  try {
    if (action === "toggle-password") {
      const input = document.getElementById(target.dataset.target || "");
      if (!input) return;
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      target.textContent = reveal ? "Hide" : "Show";
      target.setAttribute("aria-pressed", String(reveal));
      return;
    }
    if (action === "copy") {
      await copyText(target.dataset.copy || "");
      return;
    }
    if (action === "dispatcher-view") {
      const view = target.dataset.view;
      if (!DISPATCHER_VIEWS.has(view)) return;
      state.dispatcherView = view;
      window.history.replaceState({}, "", dispatcherPath());
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (action === "toggle-dashboard-customizer") {
      state.dashboardCustomizing = !state.dashboardCustomizing;
      render();
      return;
    }
    if (action === "reset-dashboard-layout") {
      state.dashboardLayout = defaultDashboardLayout();
      saveDashboardLayout();
      render();
      toast("Dashboard layout reset");
      return;
    }
    if (action === "toggle-dashboard-widget") {
      const widgetId = target.dataset.widgetId || "";
      if (!dashboardWidgetDefinition(widgetId)) return;
      const hidden = new Set(state.dashboardLayout.hidden);
      if (hidden.has(widgetId)) hidden.delete(widgetId);
      else hidden.add(widgetId);
      state.dashboardLayout.hidden = [...hidden];
      saveDashboardLayout();
      render();
      return;
    }
    if (action === "resize-dashboard-widget") {
      const widgetId = target.dataset.widgetId || "";
      if (!dashboardWidgetDefinition(widgetId)) return;
      state.dashboardLayout.widths[widgetId] = state.dashboardLayout.widths[widgetId] === "wide" ? "half" : "wide";
      saveDashboardLayout();
      render();
      return;
    }
    if (action === "move-dashboard-widget") {
      if (moveDashboardWidget(target.dataset.widgetId || "", target.dataset.direction || "down")) render();
      return;
    }
    if (action === "route-preset") {
      const form = target.closest("form");
      const purpose = form?.querySelector('[name="customerName"]');
      const pickup = form?.querySelector('[name="pickup"]');
      const destination = form?.querySelector('[name="destination"]');
      if (purpose) purpose.value = target.dataset.purpose || "";
      if (pickup) pickup.value = target.dataset.pickup || "";
      if (destination) destination.value = target.dataset.destination || "";
      destination?.focus();
      return;
    }
    if (action === "set-driver-home") {
      await setDriverHome(
        target.dataset.driverId,
        target.dataset.driverName || "driver",
        target.dataset.homeAddress || ""
      );
      return;
    }
    if (action === "copy-driver-invite") {
      await copyDriverInvite(target.dataset.driverId);
      return;
    }
    if (action === "share-driver-link") {
      await shareLink(target.dataset.shareUrl || "", "Join Rivo as a driver");
      return;
    }
    if (action === "edit-driver") {
      state.editingDriverId = target.dataset.driverId || "";
      render();
      return;
    }
    if (action === "close-driver-editor") {
      state.editingDriverId = "";
      render();
      return;
    }
    if (action === "edit-courier") {
      state.editingCourierId = target.dataset.courierId || "";
      render();
      return;
    }
    if (action === "close-courier-editor") {
      state.editingCourierId = "";
      render();
      return;
    }
    if (action === "archive-courier") {
      await archiveCourierPartner(target.dataset.courierId, target.dataset.courierName);
      return;
    }
    if (action === "request-selected-courier") {
      state.courierRequestTripIds = getTrips().filter((trip) => state.selectedOrderIds.has(trip.id)).map((trip) => trip.id);
      if (!state.courierRequestTripIds.length) throw new Error("Select at least one order.");
      render();
      return;
    }
    if (action === "close-courier-request") {
      state.courierRequestTripIds = [];
      render();
      return;
    }
    if (action === "go-to-couriers") {
      state.courierRequestTripIds = [];
      state.dispatcherView = "drivers";
      render();
      requestAnimationFrame(() => {
        const panel = document.getElementById("add-courier");
        if (panel) {
          panel.open = true;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      return;
    }
    if (action === "lead-stage") {
      await updateLeadStage(target.dataset.leadId, target.dataset.stage);
      return;
    }
    if (action === "share-link") {
      await shareLink(target.dataset.shareUrl || "", target.dataset.shareTitle || "Delivery link");
      return;
    }
    if (action === "install-app") {
      await installApp();
      return;
    }
    if (action === "show-setup") {
      if (state.ownerCreated) {
        state.loginError = "Owner account already exists. Please log in.";
        renderLogin();
        return;
      }
      state.setupMode = true;
      state.setupError = "";
      window.history.replaceState({}, "", "/?setup=1");
      renderOwnerSetup();
      return;
    }
    if (action === "show-login") {
      state.setupMode = false;
      state.setupError = "";
      window.history.replaceState({}, "", dispatcherPath());
      renderLogin();
      return;
    }
    if (action === "toggle-owner-recovery") {
      state.ownerRecoveryMode = !state.ownerRecoveryMode;
      state.ownerRecoveryError = "";
      state.loginError = "";
      renderLogin();
      requestAnimationFrame(() => document.getElementById(state.ownerRecoveryMode ? "recovery-identifier" : "login-identifier")?.focus());
      return;
    }
    if (action === "logout") {
      await logoutTeam();
      return;
    }
    if (action === "open-driver-form") {
      const formPanel = document.getElementById("add-driver");
      if (formPanel) {
        formPanel.open = true;
        formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (action === "open-courier-form") {
      const formPanel = document.getElementById("add-courier");
      if (formPanel) {
        formPanel.open = true;
        formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (action === "open-create-delivery") {
      if (state.dashboardLayout.hidden.includes("create")) {
        state.dashboardLayout.hidden = state.dashboardLayout.hidden.filter((id) => id !== "create");
        saveDashboardLayout();
        render();
      }
      requestAnimationFrame(() => {
        const formPanel = document.getElementById("create-delivery");
        if (!formPanel) return;
        formPanel.open = true;
        formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        requestAnimationFrame(() => formPanel.querySelector("input, select, textarea")?.focus());
      });
      return;
    }
    if (action === "sync-wix") {
      await syncWixOrders();
      return;
    }
    if (action === "sync-channels") {
      await syncChannels();
      return;
    }
    if (action === "sync-channel") {
      await syncChannels(target.dataset.connectionId);
      return;
    }
    if (action === "disconnect-channel") {
      await disconnectChannel(target.dataset.connectionId, target.dataset.connectionName);
      return;
    }
    if (action === "dispatch-trip") {
      await dispatchTrip(target.dataset.tripId);
      return;
    }
    if (action === "retry-exception") {
      await retryExceptionTrip(target.dataset.tripId);
      return;
    }
    if (action === "close-exception") {
      await closeExceptionTrip(target.dataset.tripId);
      return;
    }
    if (action === "dispatch-selected-route") {
      await dispatchSelectedRoute();
      return;
    }
    if (action === "assign-selected-orders") {
      await assignSelectedOrders();
      return;
    }
    if (action === "mark-selected-delivered") {
      await markSelectedOrdersDelivered();
      return;
    }
    if (action === "show-route-preview") {
      document.querySelector("#dispatcher-map")?.closest(".map-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
      drawMap("dispatcher-map", dispatcherMapTrips());
      return;
    }
    if (action === "clear-order-selection") {
      state.selectedOrderIds.clear();
      syncSelectionControls("order");
      drawMap("dispatcher-map", dispatcherMapTrips());
      return;
    }
    if (action === "complete-selected-active") {
      await completeSelectedActiveTrips();
      return;
    }
    if (action === "clear-active-selection") {
      state.selectedActiveTripIds.clear();
      syncSelectionControls("active");
      return;
    }
    if (action === "optimize-deliveries") {
      await prepareOptimizationPlan();
      return;
    }
    if (action === "apply-optimization") {
      await autoAssignOrders();
      return;
    }
    if (action === "clear-optimization") {
      state.optimizerPlan = null;
      render();
      return;
    }
    if (action === "focus-alert") {
      if (target.dataset.alertType === "unassigned") {
        state.orderFilter = "queued";
        applyOrderFilters();
        document.querySelector("[data-order-card]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        document.querySelector(".active-deliveries-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (action === "auto-assign-orders") {
      await autoAssignOrders();
      return;
    }
    if (action === "save-order") {
      await saveOrderChanges(target.dataset.tripId);
      return;
    }
    if (action === "save-active-delivery") {
      await saveOrderChanges(target.dataset.tripId);
      return;
    }
    if (action === "complete-active-delivery") {
      await completeActiveDelivery(target.dataset.tripId, target.dataset.tripName);
      return;
    }
    if (action === "move-route-stop") {
      await moveActiveRouteStop(target.dataset.tripId, target.dataset.direction);
      return;
    }
    if (action === "mark-delivered") {
      await markOrderDelivered(target.dataset.tripId, target.dataset.orderLabel);
      return;
    }
    if (action === "delete-driver") {
      await deleteDriver(target.dataset.driverId, target.dataset.driverName || "this driver");
      return;
    }
    if (action === "start-gps") {
      startGps(target.dataset.tripId);
      return;
    }
    if (action === "start-sim") {
      startSimulation(target.dataset.tripId);
      return;
    }
    if (action === "stop-tracking") {
      stopPublishing(true);
      return;
    }
    if (action === "clear-signature") {
      const canvas = document.querySelector(`[data-signature-pad="${CSS.escape(target.dataset.tripId)}"]`);
      if (canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        canvas.dataset.signed = "false";
        canvas.signatureLastPoint = null;
        canvas.signatureDistance = 0;
        markDraftDirty(canvas);
      }
      return;
    }
    if (action === "complete-trip") {
      await completeTrip(target.dataset.tripId);
      return;
    }
    if (action === "submit-trip") {
      await submitTrip(target.dataset.tripId);
      return;
    }
    if (action === "submit-week") {
      await submitWeek(target.dataset.driverId);
      return;
    }
    if (action === "approve-trip") {
      await approveTrip(target.dataset.tripId);
      return;
    }
    if (action === "reject-trip") {
      await rejectTrip(target.dataset.tripId);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    if (actionButton?.isConnected) actionButton.disabled = false;
  }
});

app.addEventListener("dragstart", (event) => {
  const dashboardHandle = event.target.closest("[data-dashboard-drag-handle]");
  const dashboardWidget = dashboardHandle?.closest("[data-dashboard-widget]");
  if (dashboardWidget) {
    draggedDashboardWidget = dashboardWidget;
    dashboardWidget.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dashboardWidget.dataset.dashboardWidget || "");
    return;
  }
  const handle = event.target.closest("[data-route-drag-handle]");
  const item = handle?.closest("[data-active-trip-id]");
  if (!item) return;
  draggedActiveTrip = item;
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.activeTripId || "");
});

app.addEventListener("dragover", (event) => {
  if (draggedDashboardWidget) {
    const board = event.target.closest(".dashboard-board");
    if (!board) return;
    event.preventDefault();
    const target = event.target.closest("[data-dashboard-widget]");
    if (!target || target === draggedDashboardWidget) return;
    const box = target.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2
      || (event.clientY <= box.bottom && event.clientX < box.left + box.width / 2);
    board.insertBefore(draggedDashboardWidget, before ? target : target.nextSibling);
    return;
  }
  const group = event.target.closest("[data-active-route-driver]");
  if (!group || !draggedActiveTrip || group.dataset.activeRouteKey !== draggedActiveTrip.dataset.routeKey) return;
  event.preventDefault();
  const target = event.target.closest("[data-active-trip-id]");
  if (!target || target === draggedActiveTrip) return;
  const box = target.getBoundingClientRect();
  group.insertBefore(draggedActiveTrip, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
});

app.addEventListener("dragend", async () => {
  if (draggedDashboardWidget) {
    const widget = draggedDashboardWidget;
    draggedDashboardWidget = null;
    widget.classList.remove("dragging");
    const visibleOrder = [...document.querySelectorAll("[data-dashboard-widget]")]
      .map((item) => item.dataset.dashboardWidget)
      .filter(Boolean);
    const remaining = state.dashboardLayout.order.filter((id) => !visibleOrder.includes(id));
    state.dashboardLayout.order = [...visibleOrder, ...remaining];
    saveDashboardLayout();
    toast("Dashboard layout saved");
    return;
  }
  const item = draggedActiveTrip;
  draggedActiveTrip = null;
  if (!item) return;
  item.classList.remove("dragging");
  const group = item.closest("[data-active-route-driver]");
  if (!group) return;
  try {
    await saveActiveRouteOrder(group);
  } catch (error) {
    toast(error.message);
    render();
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  const submitButton = form.querySelector('[type="submit"]');
  const submitLabel = submitButton?.textContent || "";
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    submitButton.textContent = "Working…";
  }
  try {
    if (form.matches("[data-courier-request-update]")) {
      await updateCourierRequest(form);
      return;
    }
    if (form.matches("[data-channel-connect]")) {
      await connectChannel(form);
      return;
    }
    if (form.id === "login-form") {
      const body = formObject(form);
      await loginTeam(String(body.identifier || ""), String(body.password || ""));
      return;
    }

    if (form.id === "owner-recovery-form") {
      const body = formObject(form);
      state.ownerRecoveryError = "";
      if (body.password !== body.confirmPassword) {
        state.ownerRecoveryError = "Passwords do not match.";
        renderLogin();
        return;
      }
      try {
        const response = await api("/api/auth/owner-recovery", {
          method: "POST",
          auth: false,
          body: { identifier: body.identifier, setupCode: body.setupCode, password: body.password }
        });
        state.auth = response.session;
        state.snapshot = response.snapshot;
        state.company = response.snapshot?.company || state.company;
        state.ownerRecoveryMode = false;
        state.ownerRecoveryError = "";
        state.loginError = "";
        writeStoredAuth(state.auth);
        connectSnapshotStream();
        window.history.replaceState({}, "", dispatcherPath());
        render();
        toast("Password upgraded");
      } catch (error) {
        state.ownerRecoveryError = error.message || "Owner recovery failed.";
        renderLogin();
      }
      return;
    }

    if (form.id === "owner-setup-form") {
      await setupOwnerAccount(formObject(form));
      return;
    }

    if (form.id === "accept-invite-form") {
      const body = formObject(form);
      state.inviteActionError = "";
      if (body.password !== body.confirmPassword) {
        state.inviteActionError = "Passwords do not match.";
        renderDriverInvite();
        return;
      }
      try {
        const response = await api("/api/auth/invite/accept", {
          method: "POST",
          auth: false,
          body: { token: state.route.token, password: body.password }
        });
        state.auth = response.session;
        state.snapshot = response.snapshot;
        writeStoredAuth(state.auth);
        window.history.replaceState({}, "", dispatcherPath());
        connectSnapshotStream();
        render();
      } catch (error) {
        state.inviteActionError = error.message || "Account creation failed. Try again.";
        renderDriverInvite();
      }
      return;
    }

    if (form.id === "create-delivery-form") {
      const body = formObject(form);
      const response = await api("/api/deliveries", { method: "POST", body });
      if (response.snapshot) state.snapshot = response.snapshot;
      state.optimizerPlan = null;
      toast("Delivery added to the queue");
      render();
      return;
    }

    if (form.id === "dispatcher-start-trip" || form.id === "driver-start-trip") {
      const body = formObject(form);
      body.kmRate = Number(body.kmRate);
      const response = await api("/api/trips", {
        method: "POST",
        body
      });
      if (response.snapshot) state.snapshot = response.snapshot;
      toast("Delivery created");
      render();
      if (state.auth?.role === "driver" && response.trip?.id) {
        setTimeout(() => startGps(response.trip.id), 0);
      }
      return;
    }

    if (form.id === "add-driver-form") {
      const body = formObject(form);
      body.defaultRate = Number(body.defaultRate);
      body.capacity = Number(body.capacity || 20);
      const response = await api("/api/drivers", {
        method: "POST",
        body
      });
      if (response.snapshot) state.snapshot = response.snapshot;
      let inviteCopied = false;
      try {
        await copyText(response.inviteUrl);
        inviteCopied = true;
      } catch {
        inviteCopied = false;
      }
      state.lastInvite = {
        url: response.inviteUrl,
        email: response.driver?.email || body.email || "",
        name: response.driver?.name || body.name || "",
        emailSent: Boolean(response.emailSent),
        message: response.emailSent
          ? "The driver received a secure link to create their password. Keep the link below available in case they need it resent."
          : `Driver added. ${inviteCopied ? "The secure link was also copied." : "Use the controls below to share it."} ${response.emailMessage || ""}`.trim()
      };
      toast(response.emailSent ? "Driver invited" : inviteCopied ? "Invite link copied" : "Driver added");
      render();
      return;
    }

    if (form.id === "edit-driver-form") {
      await updateDriverProfile(form);
      return;
    }

    if (form.id === "add-courier-form") {
      await createCourierPartner(form);
      return;
    }

    if (form.id === "edit-courier-form") {
      await updateCourierPartner(form);
      return;
    }

    if (form.id === "courier-request-form") {
      await createCourierRequest(form);
      return;
    }

    if (form.id === "company-settings-form") {
      const response = await api("/api/company", { method: "PATCH", body: formObject(form) });
      if (response.snapshot) state.snapshot = response.snapshot;
      toast("Workspace settings saved");
      render();
      return;
    }

    if (form.id === "report-export-form") {
      const data = formObject(form);
      const params = new URLSearchParams();
      if (data.week) params.set("week", data.week);
      if (data.driverId) params.set("driverId", data.driverId);
      const response = await fetch(`/api/reports/weekly.csv?${params.toString()}`, {
        headers: state.auth?.token ? { Authorization: `Bearer ${state.auth.token}` } : {}
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "The report could not be exported.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `rova-delivery-report-${data.week || state.snapshot?.weekKey || "current"}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      toast("Report downloaded");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    if (submitButton?.isConnected) {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
      submitButton.textContent = submitLabel;
    }
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.editingDriverId) return;
  state.editingDriverId = "";
  render();
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-proof-outcome]")) {
    const exception = target.value.startsWith("exception-") || target.value === "returned";
    const fields = document.querySelector(`[data-exception-proof-fields="${CSS.escape(target.dataset.proofOutcome)}"]`);
    if (fields) fields.hidden = !exception;
    return;
  }
  if (target.matches("[data-proof-photo]")) {
    const preview = document.querySelector(`[data-proof-photo-preview="${CSS.escape(target.dataset.proofPhoto)}"]`);
    const file = target.files?.[0];
    if (preview && file) {
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    } else if (preview) {
      preview.removeAttribute("src");
      preview.hidden = true;
    }
    return;
  }
  if (target.matches("[data-order-filter]")) {
    state.orderFilter = target.value;
    applyOrderFilters();
    drawMap("dispatcher-map", dispatcherMapTrips());
    return;
  }
  if (target.matches("[data-order-select]")) {
    if (target.checked) state.selectedOrderIds.add(target.value);
    else state.selectedOrderIds.delete(target.value);
    syncSelectionControls("order");
    drawMap("dispatcher-map", dispatcherMapTrips());
    return;
  }
  if (target.matches("[data-active-order-select]")) {
    if (target.checked) state.selectedActiveTripIds.add(target.value);
    else state.selectedActiveTripIds.delete(target.value);
    syncSelectionControls("active");
    return;
  }
  if (target.matches("[data-select-all-orders]")) {
    for (const checkbox of Array.from(document.querySelectorAll("[data-order-select]")).filter((item) => !item.closest("[data-order-card]")?.hidden)) {
      if (target.checked) state.selectedOrderIds.add(checkbox.value);
      else state.selectedOrderIds.delete(checkbox.value);
    }
    syncSelectionControls("order");
    drawMap("dispatcher-map", dispatcherMapTrips());
    return;
  }
  if (target.matches("[data-select-all-active]")) {
    for (const checkbox of document.querySelectorAll("[data-active-order-select]")) {
      if (target.checked) state.selectedActiveTripIds.add(checkbox.value);
      else state.selectedActiveTripIds.delete(checkbox.value);
    }
    syncSelectionControls("active");
    return;
  }
  const rateTargetId = target.dataset?.rateSource;
  if (!rateTargetId) return;
  const driver = getDriver(target.value);
  const rateInput = document.getElementById(rateTargetId);
  if (driver && rateInput) rateInput.value = driver.defaultRate;
  if (target.id === "bulk-order-driver") {
    state.bulkDriverId = target.value;
    state.bulkRate = Number(driver?.defaultRate || 0);
    drawMap("dispatcher-map", dispatcherMapTrips());
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  maybeRender();
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  toast("Installed");
  maybeRender();
});

window.addEventListener("hashchange", syncSectionNavigation);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js?v=46").catch(() => {});
  });
}

window.addEventListener("resize", () => {
  if (state.route.name === "customer") {
    drawMap("customer-map", state.customerTrip ? [state.customerTrip] : [], { customer: true });
  } else if (state.auth?.role === "driver") {
    const driver = getDrivers()[0];
    const driverActive = driver ? tripsForDriver(driver.id).filter((item) => item.status === "active") : [];
    const trip = activeRoutePreviewTrips(driverActive)[0] || driverActive[0] || null;
    drawMap("driver-map", trip ? [trip] : []);
  } else {
    drawMap("dispatcher-map", dispatcherMapTrips());
  }
});

function stopLiveRefresh() {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  state.refreshGeneration += 1;
}

function scheduleLiveRefresh(refresh, generation, delay = document.hidden ? 15000 : 4000) {
  if (generation !== state.refreshGeneration) return;
  state.refreshTimer = setTimeout(refresh, delay);
}

function reconcilePublishing(previousSnapshot, nextSnapshot) {
  const publishingTripId = state.publishTripId;
  if (!publishingTripId) return;
  const previousTrip = previousSnapshot?.trips?.find((trip) => trip.id === publishingTripId);
  const nextTrip = nextSnapshot?.trips?.find((trip) => trip.id === publishingTripId);
  if (nextTrip?.status === "active") return;
  const wasGpsPublishing = state.gpsWatchId !== null;
  const wasSimulating = state.simTimer !== null;
  const nextRouteTrip = previousTrip?.routeId
    ? (nextSnapshot?.trips || [])
        .filter((trip) => trip.routeId === previousTrip.routeId && trip.status === "active")
        .sort((left, right) => Number(left.routeSequence || 0) - Number(right.routeSequence || 0))[0]
    : null;
  stopPublishing(false);
  if (nextRouteTrip && wasGpsPublishing) setTimeout(() => startGps(nextRouteTrip.id), 0);
  if (nextRouteTrip && wasSimulating) setTimeout(() => startSimulation(nextRouteTrip.id), 0);
}

function connectSnapshotStream() {
  stopLiveRefresh();
  if (!state.auth?.role) return;
  const generation = state.refreshGeneration;
  const refresh = async () => {
    if (generation !== state.refreshGeneration || !state.auth?.role) return;
    try {
      const response = await api("/api/me");
      if (generation !== state.refreshGeneration) return;
      state.auth = response.session;
      const previousSnapshot = state.snapshot;
      const serialized = JSON.stringify(response.snapshot);
      const changed = serialized !== state.lastSnapshotSerialized;
      state.snapshot = response.snapshot;
      reconcilePublishing(previousSnapshot, response.snapshot);
      state.lastSnapshotSerialized = serialized;
      writeStoredAuth(state.auth);
      if (changed) maybeRender();
    } catch {
      // A temporary network failure should not sign out a driver mid-route.
    } finally {
      scheduleLiveRefresh(refresh, generation);
    }
  };
  scheduleLiveRefresh(refresh, generation);
}

function connectCustomerStream(token) {
  stopLiveRefresh();
  if (!token) return;
  const generation = state.refreshGeneration;
  const refresh = async () => {
    if (generation !== state.refreshGeneration) return;
    try {
      const response = await api(`/api/share/${encodeURIComponent(token)}`, { auth: false, cache: "no-store" });
      if (generation !== state.refreshGeneration) return;
      state.company = response.company;
      state.customerTrip = response.trip;
      maybeRender();
    } catch {
      // Keep the last known delivery state visible during temporary outages.
    } finally {
      scheduleLiveRefresh(refresh, generation);
    }
  };
  scheduleLiveRefresh(refresh, generation);
}

async function refreshMapsConfig() {
  try {
    const config = await api("/api/maps/config", { auth: false });
    state.mapsConfig = {
      configured: Boolean(config.configured),
      apiKey: config.apiKey || "",
      mapId: config.mapId || ""
    };
    state.googleMapsDenied = false;
  } catch {
    state.mapsConfig = { configured: false, apiKey: "", mapId: "" };
    state.googleMapsDenied = false;
  }
}

async function init() {
  render();
  await refreshMapsConfig();
  try {
    if (state.route.name === "customer") {
      if (state.route.token) {
        const response = await api(`/api/share/${encodeURIComponent(state.route.token)}`, { auth: false, cache: "no-store" });
        state.company = response.company;
        state.customerTrip = response.trip;
        connectCustomerStream(state.route.token);
      }
      render();
      return;
    }
    if (state.route.name === "invite") {
      state.inviteError = "";
      state.inviteProfile = null;
      if (!state.route.token) throw new Error("This invitation link is incomplete.");
      const profile = await api(`/api/auth/invite?token=${encodeURIComponent(state.route.token)}`, { auth: false });
      state.inviteProfile = profile;
      renderDriverInvite();
      return;
    }

    const setup = await api("/api/setup/status", { auth: false });
    state.company = setup.company || state.company;
    state.setupEnabled = Boolean(setup.setupEnabled);
    state.ownerCreated = Boolean(setup.ownerCreated);
    if (state.route.name === "setup") {
      if (state.ownerCreated) {
        state.setupMode = false;
        state.loginError = "Owner account already exists. Please log in.";
        window.history.replaceState({}, "", dispatcherPath());
        renderLogin();
        return;
      }
      state.setupMode = true;
      renderOwnerSetup();
      return;
    }

    const response = await api("/api/me");
    state.auth = response.session;
    state.snapshot = response.snapshot;
    state.lastSnapshotSerialized = JSON.stringify(response.snapshot);
    writeStoredAuth(state.auth);
    connectSnapshotStream();
    render();
  } catch (error) {
    if (state.route.name === "invite") {
      state.inviteProfile = null;
      state.inviteError = error.message || "This invitation is invalid or has expired.";
      renderDriverInvite();
      return;
    }
    state.auth = null;
    state.snapshot = null;
    writeStoredAuth(null);
    state.loginError = error.message || "Please log in again.";
    renderLogin();
  }
}

init();
