import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { handleMileage, mileageSnapshot } from "../worker/mileage.js";

// No network, real accounts, GPS, signing or production writes.
const db = { drivers: [{ id: "ios-fixture", name: "iOS Fixture", defaultRate: 0.72 }] };
const deviceId = "ios-fixture-phone-0001";
const session = { role: "driver", driverId: "ios-fixture", name: "iOS Fixture" };
async function request(path, body) {
  const url = new URL("https://fixture.invalid" + path);
  return handleMileage({ request: new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }), url, db, session, save: async () => {}, isDispatcher: () => false, onLive: () => {} });
}
let response = await request("/api/mileage/consent", { enabled: true, source: "ios", deviceId });
assert.equal(response.status, 200);
assert.equal((await response.json()).tracking.source, "ios", "iPhone must not silently become browser tracking");
const now = Date.now(), base = now - 900_000;
db.mileageTracking[session.driverId].enabledAt = new Date(base - 1000).toISOString();
const drive = Array.from({ length: 10 }, (_, i) => ({
  seq: base + i, at: base + i * 20_000, lat: 45.42 + i * .001, lng: -75.7, accuracy: 5, speed: 5.5
}));
const stops = Array.from({ length: 10 }, (_, i) => ({ ...drive.at(-1), seq: base + 10 + i, at: base + (10 + i) * 20_000, speed: 0 }));
const points = [...drive, ...stops];
response = await request("/api/mileage/points", { deviceId, points });
assert.equal(response.status, 200);
assert.equal((await response.json()).ack, points.at(-1).seq);
const [trip] = mileageSnapshot(db, session.driverId).trips;
assert.equal(trip.source, "ios");
assert.equal(trip.state, "complete", "driving starts and stationary fixes finish without manual trip buttons");
assert.equal(trip.category, "unclassified", "no implied business or tax claim");
assert.ok(trip.distanceKm > .99 && trip.distanceKm < 1.01);
await request("/api/mileage/points", { deviceId, points });
assert.equal(db.mileageTrips.length, 1, "native retries cannot duplicate a drive");
assert.equal(db.mileageTrips[0].distanceKm, trip.distanceKm);
assert.equal(mileageSnapshot(db).trips, undefined, "dispatch cannot read private iPhone drives");
assert.equal((await request("/api/mileage/review", { tripIds: [trip.id], category: "business", purpose: "Customer delivery" })).status, 200);
assert.equal((await request("/api/mileage/reports", { week: trip.week, expectedKmRate: .72 })).status, 201);
assert.equal(db.mileageReports[0].kmRate, .72);
assert.equal(db.mileageReports[0].items[0].source, "ios");
assert.equal(db.mileageReports[0].totalAmount, Math.round(trip.distanceKm * 72) / 100);
assert.equal((await request("/api/mileage/consent", { enabled: false, deviceId })).status, 200);
assert.equal((await request("/api/mileage/points", { deviceId, points })).status, 409);

// iOS web UI must neither duplicate native GPS nor offer a misleading browser switch.
const source = fs.readFileSync("public/trip-maps.js", "utf8").replaceAll("export function", "function") + "\n" + fs.readFileSync("public/mileage.js", "utf8").replace(/^import[^\n]+\n/gm, "").replace("export function createMileageUI", "function createMileageUI");
for (const [ua, expected] of [["RivoIOS/0.1.0", "iPhone"], ["RivoAndroid/1.0", "Android"]]) {
  let watches = 0;
  const context = vm.createContext({ navigator: { userAgent: ua, onLine: true, geolocation: { watchPosition() { watches++; return 1; }, clearWatch() {} } },
    localStorage: { getItem: () => deviceId, setItem() {} }, crypto: { randomUUID: () => deviceId },
    document: { addEventListener() {}, querySelectorAll: () => [] }, window: { addEventListener() {} }, setInterval() {}, URL, Date, console });
  vm.runInContext(source, context);
  const data = { ...mileageSnapshot(db, session.driverId), tracking: { enabled: true, source: expected === "iPhone" ? "ios" : "android", deviceId, lastFixAt: new Date().toISOString() } };
  const ui = context.createMileageUI({ api: async () => data, getAuth: () => session, getData: () => data, setData() {}, render() {}, toast() {} });
  ui.mount();
  assert.equal(watches, 0, "native app must not start a browser mileage recorder");
  assert.match(ui.settingsHtml(), new RegExp(expected + " tracking app"));
  assert.doesNotMatch(ui.settingsHtml(), /Enable browser tracking/);
  assert.equal(ui.summaryHtml(), "", "native shells use compact native tracking status");
  assert.doesNotMatch(ui.settingsHtml(), /data-mileage="pause"/, "native pause stays in Settings so capture stops locally even offline");
  if (expected === "iPhone") {
    assert.match(ui.settingsHtml(), /Always and Precise Location/);
    assert.match(ui.settingsHtml(), /Turn Auto-track off in Settings/);
    assert.equal(ui.summaryHtml(), "", "iPhone uses its compact native status rather than a duplicate tracking card");
    assert.doesNotMatch(ui.settingsHtml(), /data-mileage="pause"/);
  }
}

const plist = path => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8" }));
const project = plist("ios/RivoMileage.xcodeproj/project.pbxproj"), objects = project.objects;
const target = Object.values(objects).find(o => o.isa === "PBXNativeTarget");
assert.ok(target);
for (const phaseID of target.buildPhases) assert.ok(objects[phaseID], "every build phase exists");
const compile = objects[target.buildPhases.find(id => objects[id].isa === "PBXSourcesBuildPhase")];
const compiledFiles = compile.files.map(id => objects[objects[id].fileRef].path);
for (const directory of ["ios/App", "ios/Core"]) {
  for (const file of fs.readdirSync(directory).filter(f => f.endsWith(".swift"))) assert.ok(compiledFiles.includes(file), `${file} is in Xcode Sources`);
}
const info = plist("ios/App/Info.plist");
assert.ok(info.UIBackgroundModes.includes("location"));
assert.ok(info.NSLocationAlwaysAndWhenInUseUsageDescription.includes("personal"));
assert.equal(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads, undefined);
assert.equal(plist("ios/App/PrivacyInfo.xcprivacy").NSPrivacyTracking, false);
const app = fs.readdirSync("ios/App").filter(f => f.endsWith(".swift")).map(f => fs.readFileSync("ios/App/" + f, "utf8")).join("\n");
assert.match(app, /pausesLocationUpdatesAutomatically = false/);
assert.match(app, /allowsBackgroundLocationUpdates = true/);
assert.match(app, /startMonitoringSignificantLocationChanges/);
assert.match(app, /httpCookieStore\.add\(self\)/);
assert.match(app, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
assert.doesNotMatch(app, /evaluateJavaScript/);
assert.match(app, /message\.frameInfo\.isMainFrame/);
assert.match(app, /acceptsSignOutCommand/);
assert.match(app, /add\(self, name: "rivoPrivacy"\)/);
assert.match(app, /await store\.deleteCookie\(cookie\)/);
assert.match(app, /runJavaScriptConfirmPanelWithMessage/, "delivery completion confirmation works inside the native shell");

// Simulate a failed network logout. Native stop must happen before any API call.
const appSource = fs.readFileSync("public/app.js", "utf8"), start = appSource.indexOf("async function logoutTeam()");
const logoutSource = appSource.slice(start, appSource.indexOf("\n}\n", start) + 2);
for (const native of [true, false]) {
  const events = [];
  const context = vm.createContext({ window: native ? { webkit: { messageHandlers: { rivoPrivacy: { postMessage: value => events.push(value) } } } } : {},
    mileageUI: { stop: () => events.push("stop-web") }, personalMileageUI: { stop: () => events.push("stop-personal") }, api: async () => { events.push("network"); throw Error("offline fixture"); },
    assignmentAlerts: { disable: async () => {} }, stopPublishing() {}, state: { auth: session, snapshot: {} }, stopLiveRefresh() {}, writeStoredAuth() {}, renderLogin() {} });
  vm.runInContext(logoutSource, context);
  await context.logoutTeam();
  assert.equal(context.state.auth, null);
  if (native) assert.deepEqual(events, ["signOut", "stop-web", "stop-personal", "network"]);
  else assert.deepEqual(events, ["stop-web", "stop-personal", "network"]);
}
console.log("iPhone companion checks passed: local native protocol, auto drive/stop, replay, privacy, weekly CAD/km report, native-only UI and Xcode resource wiring. This is not an iOS app build or a real-phone test.");
