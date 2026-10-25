import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/app.js", "utf8");
const start = source.indexOf("function syncSectionNavigation(");
const end = source.indexOf("\n}\n", start) + 2;
const ids = ["trips", "report", "today", "profile"];
const links = ids.map(id => ({
  dataset: { sectionLink: id },
  getAttribute: name => name === "href" ? `#${id}` : null,
  classList: { toggle() {} },
  setAttribute(name, value) { this[name] = value; },
  removeAttribute(name) { delete this[name]; }
}));
const sections = ids.map(id => ({ id, hidden: false }));
const maps = [], scrolls = [], shell = {};
const sandbox = {
  state: { auth: { role: "driver" }, driverMapTrips: [{ id: "current-route" }] },
  window: { location: { hash: "" }, scrollTo: options => scrolls.push(options) },
  document: {
    querySelectorAll: selector => selector === "[data-section-link]" ? links : sections,
    querySelector: () => ({ setAttribute: (key, value) => shell[key] = value })
  },
  requestAnimationFrame: fn => fn(),
  drawMap: (id, trips) => maps.push({ id, trips })
};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);
sandbox.syncSectionNavigation();
assert.deepEqual(sections.filter(s => !s.hidden).map(s => s.id), ["today"], "An assigned driver opens directly to today's route");
assert.equal(links[2]["aria-current"], "page");
assert.equal(maps.length, 1);
for (const id of ids) {
  sandbox.window.location.hash = `#${id}`;
  sandbox.syncSectionNavigation({ type: "hashchange" });
  assert.deepEqual(sections.filter(s => !s.hidden).map(s => s.id), [id]);
  assert.equal(shell["data-driver-view"], id);
}
assert.equal(maps.length, 2);
assert.equal(maps[0].id, "driver-map");
assert.equal(maps[0].trips[0].id, "current-route", "delivery map uses the driver's current route");
assert.equal(scrolls.length, 4);
sandbox.window.location.hash = "#unknown";
sandbox.syncSectionNavigation();
assert.deepEqual(sections.filter(s => !s.hidden).map(s => s.id), ["today"]);
sandbox.state.driverMapTrips = [];
sandbox.window.location.hash = "";
const mapsBeforeMileage = maps.length;
sandbox.syncSectionNavigation();
assert.deepEqual(sections.filter(s => !s.hidden).map(s => s.id), ["trips"], "Without assigned stops, the driver's trips are the default");
assert.equal(maps.length, mapsBeforeMileage, "The hidden delivery map does not load over mileage");
const before = sections.map(s => s.hidden);
sandbox.state.auth.role = "dispatcher";
sandbox.window.location.hash = "#today";
sandbox.syncSectionNavigation();
assert.deepEqual(sections.map(s => s.hidden), before, "driver panel visibility does not change dispatcher screens");
console.log("Driver navigation checks passed: route-first with assignments, mileage-first without, one visible panel, correct map, scroll reset and dispatcher isolation.");
