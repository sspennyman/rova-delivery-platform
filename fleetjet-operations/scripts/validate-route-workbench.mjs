import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/app.js", "utf8");
const extract = name => {
  const marker = source.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
};
const trips = [{id:"a",pickup:"Depot",destination:"One",customerName:"One"}, {id:"b",pickup:"Depot",destination:"Two",customerName:"Two"}, {id:"c",pickup:"Depot",destination:"Three",customerName:"Three"}];
const state = { selectedOrderIds:new Set(["a","b"]), routeDraftIds:["b","a","removed"], routeDraftLoading:false, bulkDriverId:"driver-one", bulkRate:0, snapshot:{} };
const calls = [];
const sandbox = {
  state, getTrips:()=>trips, getDrivers:()=>[{id:"driver-one"}], getDriver:()=>({id:"driver-one",name:"Test driver",defaultRate:0}),
  activeTrips:()=>[], companyPickupAddress:()=>"Depot", driverOptions:()=>'<option value="driver-one">Test driver</option>',
  h:String, defaultDriverRate:()=>1, formatKm:value=>`${value} km`,
  document:{getElementById:id=>({value:id === "bulk-order-driver" ? "driver-one" : "0"})},
  api:async (path,request)=>{calls.push({path,request});return {trips:request.body.tripIds.map(id=>({id})),snapshot:{updated:true}};},
  render:()=>{}, toast:()=>{}, refreshRouteDraft:()=>{}
};
vm.createContext(sandbox);
vm.runInContext(["selectedRouteOrders","selectedOrderPreviewTrips","routePlanPanelHtml","dispatchSelectedRoute","optimizeRouteDraft"].map(extract).join("\n"), sandbox);
const ids = () => Array.from(sandbox.selectedRouteOrders(),trip=>trip.id);
assert.deepEqual(ids(),["b","a"],"manual stop order is retained and removed orders are pruned");
state.selectedOrderIds.add("c");
assert.deepEqual(ids(),["b","a","c"],"new selections append without resetting reviewed order");
state.selectedOrderIds.delete("a");
assert.deepEqual(ids(),["b","c"]);
assert.deepEqual(Array.from(sandbox.selectedOrderPreviewTrips()[0].stops,stop=>stop.address),["Depot","Two","Three","Depot"]);
const panel = sandbox.routePlanPanelHtml();
assert.match(panel,/data-draft-stop="b"/);
assert.match(panel,/Move Two up" disabled/);
assert.match(panel,/Move Three down" disabled/);
assert.match(panel,/id="bulk-order-rate"[^>]+value="0"/,"zero rate survives panel refresh");
await sandbox.dispatchSelectedRoute();
assert.deepEqual(Array.from(calls[0].request.body.tripIds),["b","c"]);
assert.equal(calls[0].request.body.preserveStopOrder,true);
assert.equal(calls[0].request.body.kmRate,0);
assert.equal(state.selectedOrderIds.size,0);
assert.equal(state.routeDraftIds.length,0);
assert.equal(state.operationsPane,"active");

state.selectedOrderIds = new Set(["a","b"]);
state.routeDraftIds = [];
sandbox.api = async()=>({tripIds:["b","a"],optimized:true,distanceKm:12,durationMinutes:20});
await sandbox.optimizeRouteDraft();
assert.deepEqual(ids(),["b","a"]);
assert.equal(state.routeDraftLoading,false);
assert.equal(state.routeDraftPlan.optimized,true);
assert.match(sandbox.routePlanPanelHtml(),/Google-optimized order/);
// A response for an older selection must not overwrite the user's new route.
let release;
sandbox.api = ()=>new Promise(resolve=>{release=resolve;});
const pending = sandbox.optimizeRouteDraft();
state.selectedOrderIds.delete("b");
release({tripIds:["a","b"],optimized:true});
await pending;
assert.deepEqual(ids(),["a"]);
assert.equal(state.routeDraftLoading,false);
state.selectedOrderIds.clear();
assert.match(sandbox.routePlanPanelHtml(),/Build a route/);
assert.doesNotMatch(sandbox.routePlanPanelHtml(),/id="bulk-order-driver"/,"empty route has no misleading send controls");
console.log("Route workbench checks passed: ordered selection, pruning, fixed preview, accessible reordering, rate preservation, exact dispatch order and stale optimization guard.");
