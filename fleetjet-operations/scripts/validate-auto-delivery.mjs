import assert from "node:assert/strict";
import { detectAutomaticCompletion, prepareAutomaticStops } from "../worker/auto-delivery.js";
import worker from "../worker/index.js";

const base = Date.now() - 600000;
const target = { lat: 45.4, lng: -75.7 };
const fixtureTrip = (id = "stop-a", sequence = 0) => ({ id, driverId: "driver-a", routeId: "route-a", routeSequence: sequence,
  status: "active", tripType: "business", customerName: "Fixture customer", pickup: "Fixture depot", destination: `Fixture address ${id}`,
  startedAt: new Date(base - 600000).toISOString(), path: [], distanceKm: 0, kmRate: .72,
  stops: [{ address: "Fixture depot" }, { address: `Fixture address ${id}` }],
  autoDelivery: { address: `Fixture address ${id}`, startedAt: new Date(base - 600000).toISOString(), target, status: "watching" } });
const fixtureDb = () => ({ company: { operations: { autoComplete: true } }, drivers: [{ id: "driver-a" }], trips: [fixtureTrip()], mileageTrips: [{ category: "personal", distanceKm: 8 }] });
const point = (seconds, offset = 0, speed = 0) => ({ lat: target.lat + offset, lng: target.lng, accuracy: 5, speed, timestamp: new Date(base + seconds * 1000).toISOString() });
const feed = (db,seconds,offset=0,speed=0) => detectAutomaticCompletion(db,"driver-a",point(seconds,offset,speed),base+seconds*1000);
const stopThenDepart = db => {
  feed(db,0,.004,10); feed(db,30,0,0); feed(db,60,0,0); feed(db,90,0,0); feed(db,120,0,0);
  assert.equal(db.trips[0].status,"active","dwell alone does not prove a delivery");
  feed(db,150,.004,10); return feed(db,170,.005,10);
};
let db = fixtureDb();
const privateBefore = JSON.stringify(db.mileageTrips);
assert.equal(stopThenDepart(db)?.status,"completed");
assert.equal(db.trips[0].endedAt,point(120).timestamp,"use observed stop time, not upload time");
assert.equal(db.trips[0].completionSource,"gps-detected");
assert.equal(db.trips[0].completionTimeEstimated,true);
assert.match(db.trips[0].proof.method,/handoff not verified/);
assert.equal(db.trips[0].proof.kind,"gps-detected");
assert.equal(db.trips[0].distanceKm,0,"don't invent mileage");
assert.equal(JSON.stringify(db.mileageTrips),privateBefore,"no personal mileage reclassification");
assert.equal(feed(db,180,.006,10),null,"completion is idempotent");

db = fixtureDb(); feed(db,0,.004,10); feed(db,30,0,12); feed(db,60,.004,10); feed(db,90,.005,10);
assert.equal(db.trips[0].status,"active","a drive-by never completes");
db = fixtureDb(); feed(db,0,.004,10); feed(db,30,0,0); feed(db,60,0,0); feed(db,90,.004,10); feed(db,110,.005,10);
assert.equal(db.trips[0].status,"active","short stops never complete");
db = fixtureDb(); feed(db,0,.004,10); feed(db,30,0,0); feed(db,60,0,0); feed(db,200,0,0); feed(db,230,.004,10); feed(db,250,.005,10);
assert.equal(db.trips[0].status,"active","a signal gap cannot establish sustained dwell");
db = fixtureDb();
for (const seconds of [0,30,60,90,120,150,170]) {
  const p = point(seconds,seconds===0||seconds>=150?.004:0,0);
  assert.equal(detectAutomaticCompletion(db,"driver-a",p,base+1000000),null);
}
assert.equal(db.trips[0].autoDelivery.lastAt,undefined,"offline replay is not live evidence");
db = fixtureDb();
for (const seconds of [0,30,60,90,120,150,170]) {
  const p = { ...point(seconds,seconds===0||seconds>=150?.004:0,0), accuracy: 100 };
  detectAutomaticCompletion(db,"driver-a",p,base+seconds*1000);
}
assert.equal(db.trips[0].status,"active","poor GPS accuracy cannot complete");
db = fixtureDb(); db.company.operations.requirePhoto=true;
assert.equal(stopThenDepart(db),null); assert.equal(db.trips[0].autoDelivery.status,"proof-required");
db.trips[0].pendingProofMedia={photo:{token:"fixture-photo"}};
assert.equal(feed(db,190,.006,10)?.status,"completed","required proof is honored");
db = fixtureDb(); db.company.operations.requireSignature=true;
assert.equal(stopThenDepart(db),null);
db = fixtureDb(); db.company.operations.autoComplete=false;
assert.equal(stopThenDepart(db),null);
db = fixtureDb(); db.trips[0].stops.push({address:"Other customer"});
assert.equal(stopThenDepart(db),null,"multi-address records need explicit confirmation");
db = fixtureDb(); db.trips[0].tripType="personal"; assert.equal(stopThenDepart(db),null);
db = fixtureDb(); db.trips.push({...fixtureTrip("other",1),routeId:"another-route"}); assert.equal(stopThenDepart(db),null,"ambiguous routes are not guessed");
db = fixtureDb(); db.trips.push(fixtureTrip("stop-b",1));
stopThenDepart(db); feed(db,200,.004,10); feed(db,230,0,0); feed(db,260,0,0); feed(db,290,0,0); feed(db,320,0,0); feed(db,350,.004,10); feed(db,370,.005,10);
assert.deepEqual(db.trips.map(t=>t.status),["completed","completed"],"automatically advance in assigned stop order");

const originalFetch = globalThis.fetch;
let mapsCalls=0;
globalThis.fetch=async (_url,options) => {
  mapsCalls++;
  assert.equal(options.headers["x-goog-fieldmask"],"routes.legs.endLocation");
  return Response.json({routes:[{legs:[{endLocation:{latLng:{latitude:45.4,longitude:-75.7}}},{endLocation:{latLng:{latitude:45.5,longitude:-75.8}}}]}]});
};
db=fixtureDb(); delete db.trips[0].autoDelivery; db.trips.push(fixtureTrip("stop-b",1)); delete db.trips[1].autoDelivery;
await prepareAutomaticStops(db,"driver-a",{GOOGLE_MAPS_SERVER_API_KEY:"fixture-only"});
assert.equal(mapsCalls,1,"one bounded Google request resolves all pending stops");
assert.equal(db.trips[1].autoDelivery.target.lat,45.5);
await prepareAutomaticStops(db,"driver-a",{GOOGLE_MAPS_SERVER_API_KEY:"fixture-only"});
assert.equal(mapsCalls,1,"target resolution is cached, not billed per GPS point");
globalThis.fetch=originalFetch;

// Exercise the actual authenticated native upload -> persisted delivery flow for both phone platforms.
delete globalThis.__deliveryTrackerDb;
const env={DISPATCHER_USERNAME:"auto-fixture",DISPATCHER_PASSWORD:"fixture-password-only"};
const call=(path,token,body)=>worker.fetch(new Request("https://app.floraljet.llc"+path,{method:body===undefined?"GET":"POST",headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil(){}});
const login=await (await call("/api/auth/login",null,{identifier:env.DISPATCHER_USERNAME,password:env.DISPATCHER_PASSWORD})).json();
const token=login.session.token;
const profile=await (await call("/api/me/driver-profile",token,{name:"Fixture Owner"})).json();
const driverId=profile.driver.id;
const nativeDb=globalThis.__deliveryTrackerDb;
const realNow=Date.now;
try {
  for (const source of ["ios","android"]) {
    const deviceId=`fixture-${source}-device-00000001`;
    assert.equal((await call("/api/my-mileage/consent",token,{enabled:true,deviceId,source})).status,200);
    nativeDb.mileageTracking[driverId].enabledAt=new Date(base-1000).toISOString();
    nativeDb.trips=[{...fixtureTrip(),driverId}];
    nativeDb.company.operations.autoComplete=true;
    nativeDb.company.operations.requirePhoto=false;
    nativeDb.company.operations.requireSignature=false;
    let seq=0;
    for (const seconds of [0,30,60,90,120,150,170]) {
      Date.now=()=>base+seconds*1000;
      const p=point(seconds,seconds===0||seconds>=150?.004:0,seconds===0||seconds>=150?10:0);
      const response=await call("/api/my-mileage/points",token,{deviceId,points:[{...p,at:base+seconds*1000,seq:++seq}]});
      assert.equal(response.status,200,await response.clone().text());
    }
    assert.equal(nativeDb.trips[0].status,"completed",`${source} upload completes assigned stop`);
    assert.equal(nativeDb.trips[0].completionSource,"gps-detected");
    assert.equal((await call("/api/trips/stop-a/undo-auto-completion",null,{})).status,401);
    assert.equal((await call("/api/trips/stop-a/undo-auto-completion",token,{})).status,200);
    assert.equal(nativeDb.trips[0].status,"active");
    assert.equal(nativeDb.trips[0].proofHistory.at(-1).kind,"gps-detected","undo preserves audit");
    const corrected=await call("/api/trips/stop-a/complete",token,{completedEarlier:true,proofOutcome:"dispatcher-override",overrideReason:"Owner confirmed it was completed previously"});
    assert.equal(corrected.status,200,await corrected.clone().text());
    assert.equal(nativeDb.trips[0].endedAt,null,"historical correction never invents a time");
    assert.equal(nativeDb.trips[0].completionTimeUnknown,true);
    const snapshot=await (await call("/api/bootstrap",token)).json();
    assert.equal(snapshot.analytics.averageDeliveryMinutes,null,"unknown historical duration is excluded from averages");
  }
} finally { Date.now=realNow; globalThis.fetch=originalFetch; }
console.log("Auto-delivery detection, safeguards, iOS/Android upload integration, undo and historical correction passed.");
