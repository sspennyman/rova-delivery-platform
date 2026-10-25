import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('public/app.js', 'utf8');
const storage = new Map();
let success, failure, watches = 0, cleared = 0, permission = 'granted';
const trips = [{ id: 'qa-trip', status: 'active' }];
const context = vm.createContext({
  state: { auth: { role: 'driver', driverId: 'qa-driver' }, gpsWatchId: null, simTimer: null, publishTripId: '' },
  navigator: { geolocation: {
    watchPosition: (ok, err) => { success = ok; failure = err; return ++watches; },
    clearWatch: () => { cleared++; }
  }, permissions: { query: async () => ({ state: permission }) } },
  document: { hidden: false },
  sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  getTrips: () => trips, maybeRender: () => {}, toast: () => {}, clearInterval: () => {},
  publishLocation: () => {}, relativeTime: () => '2 minutes ago'
});
vm.runInContext(source.slice(source.indexOf('function rememberGps('), source.indexOf('function startSimulation(')), context);
vm.runInContext(source.slice(source.indexOf('function trackingStatus('), source.indexOf('function activeTripItem(')), context);
context.startGps('qa-trip');
assert.equal(watches, 1);
failure({ code: 3 });
assert.equal(cleared, 0, 'a GPS timeout must not stop the watch');
assert.match(context.state.gpsMessage, /retrying/);
context.state.gpsWatchId = null; // model a page reload retaining this tab's intent
await context.resumeGps();
assert.equal(watches, 2, 'same active trip resumes with existing permission');
context.stopPublishing();
await context.resumeGps();
assert.equal(watches, 2, 'explicit pause must not auto-resume');
context.startGps('qa-trip');
failure({ code: 1 });
assert.equal(context.state.gpsWatchId, null);
assert.equal(storage.size, 0, 'denied permission clears resume intent');
context.rememberGps('qa-trip');
permission = 'prompt';
await context.resumeGps();
assert.equal(watches, 3, 'resume must not prompt for fresh permission');
permission = 'granted';
context.state.auth.driverId = 'other-driver';
await context.resumeGps();
assert.equal(watches, 3, 'a different driver must not inherit consent');
context.state.auth.driverId = 'qa-driver';
trips[0].status = 'completed';
await context.resumeGps();
assert.equal(watches, 3, 'completed deliveries must not resume');
assert.match(context.trackingStatus({}), /No GPS received/);
assert.equal(context.trackingStatus({ location: { timestamp: new Date().toISOString() } }), 'GPS live');
assert.match(context.trackingStatus({ location: { timestamp: new Date(Date.now() - 120000).toISOString() } }), /GPS stale/);
console.log('Tracking regression checks passed: timeout, reload, pause, permission, identity, completion and freshness.');
