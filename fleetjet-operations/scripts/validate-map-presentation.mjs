import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/app.js", "utf8");
const extract = name => {
  const marker = source.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n",start)+2);
};
const renderedMarkers=[], markerInstances=[], lines=[], maps=[];
let fitCount=0;
const wrap={classList:{add(){}}};
let mapEl={replaceChildren(){}};
const eta={hidden:true,textContent:""};
const canvas={closest:()=>wrap};
const route={path:[{lat:43.65,lng:-79.38},{lat:43.66,lng:-79.39},{lat:43.67,lng:-79.4},{lat:43.65,lng:-79.38}],durationMillis:1200000,distanceMeters:12500,
  legs:[{startLocation:{lat:43.65,lng:-79.38},endLocation:{lat:43.66,lng:-79.39}},{endLocation:{lat:43.67,lng:-79.4}},{endLocation:{lat:43.65,lng:-79.38}}]};
const trip={id:"route-one",status:"queued",customerName:"2 selected orders",preserveStopOrder:true,driver:{id:"one",name:"Test driver",color:"#245bd6"},
  stops:[{label:"Start",address:"Depot"},{label:"Stop 1: One",address:"One"},{label:"Stop 2: Two",address:"Two"},{label:"Return",address:"Depot"}]};
class MapStub {
  constructor(element, options){this.options=options;this.center=options.center;this.zoom=options.zoom;maps.push(this);}
  fitBounds(){fitCount++;}
  getCenter(){return this.center;}
  getZoom(){return this.zoom;}
  setCenter(center){this.center=center;}
  setZoom(zoom){this.zoom=zoom;}
}
class PolylineStub {constructor(options){lines.push(options);}setMap() {}}
class BoundsStub {extend() {}}
const state={mapsConfig:{},googleMapsViews:{},openMapViews:{},googleMapsDrawSeq:0,googleRouteCache:new Map()};
const sandbox={
  state, Date, GOOGLE_ROUTE_CACHE_MS:30000,
  h:String, routeStops:t=>t.stops||[], firstMapCenter:()=>({lat:43.65,lng:-79.38}), companyPickupAddress:()=>"Depot",
  liveDriverStop:()=>null, trackingStatus:()=>"No GPS yet", initials:()=>"TD", clearOpenMapView:()=>{},
  loadGoogleMaps:async()=>{},
  document:{getElementById:id=>id.endsWith("-google")?mapEl:id.endsWith("-eta")?eta:canvas},
  google:{maps:{SymbolPath:{CIRCLE:0},Marker:class{constructor(options){this.map=options.map;renderedMarkers.push(options);markerInstances.push(this);}setMap(map) {this.map=map;}},
    importLibrary:async name=>name === "maps"?{Map:MapStub,Polyline:PolylineStub}:name === "core"?{LatLngBounds:BoundsStub}:name === "routes"?{Route:{computeRoutes:async()=>({routes:[route]})}}:{}}}
};
vm.createContext(sandbox);
const names=["renderMapBlock","mapViewportKey","fitRouteMap","cleanGoogleMapStyle","clearGoogleMapView","googleRouteStops","googleStopLocation","googleStopKey","googleRouteCacheKey","googleRouteRequest","computeGoogleRoute","googlePlannedStopPositions","googleMarkerStops","googleCoordinate","googleWaypointPosition","googleMarkerLabel","addGoogleMarker","formatEtaTime","formatDurationFromMillis","routeSummaryFromGoogle","plannedGoogleEstimateLines","googleMapHomePosition","renderGoogleRoutes"];
vm.runInContext(names.map(extract).join("\n"),sandbox);
const roundTripStops=[{label:"Pickup",address:"Depot"},{label:"Delivery",address:"Customer"},{label:"Return",address:"Depot"}];
const roundTripRoute={durationMillis:68*60000,distanceMeters:41900,legs:[{durationMillis:33*60000,distanceMeters:21000},{durationMillis:35*60000,distanceMeters:20900}]};
const estimates=sandbox.plannedGoogleEstimateLines(roundTripRoute,roundTripStops);
assert.match(estimates[0],/1 delivery.*33 min.*21\.0 km/,"delivery driving time excludes the return leg");
assert.match(estimates[1],/Return to depot estimate.*35 min.*20\.9 km/);
assert.doesNotMatch(estimates[0],/1 hr 8 min/,"68-minute round trip is not presented as a 68-minute delivery");
assert.match(sandbox.plannedGoogleEstimateLines({...roundTripRoute,legs:[]},roundTripStops)[0],/Full route estimate \(includes return to depot\)/,"missing leg metrics never become fabricated outbound or return times");
assert.match(sandbox.plannedGoogleEstimateLines({durationMillis:33*60000,distanceMeters:21000,legs:[roundTripRoute.legs[0]]},roundTripStops.slice(0,2))[0],/1 delivery.*Driving estimate from pickup.*33 min/);
let detachedLegacy=0, detachedPolyline=0;
const advancedMarker={map:{}};
const cleanupView={markers:[{map:{},setMap(map){assert.equal(map,null);detachedLegacy++;}},advancedMarker],polylines:[{setMap(map){assert.equal(map,null);detachedPolyline++;}}]};
sandbox.clearGoogleMapView(cleanupView);
assert.equal(detachedLegacy,1,"legacy markers must detach through setMap even when they expose a map property");
assert.equal(advancedMarker.map,null,"advanced markers detach through their map property");
assert.equal(detachedPolyline,1);
assert.equal(cleanupView.markers.length,0);
assert.equal(cleanupView.polylines.length,0);
const html=sandbox.renderMapBlock("dispatcher-map",[trip,trip]);
assert.equal((html.match(/Test driver/g)||[]).length,1,"driver legend is deduplicated");
assert.ok(html.indexOf('class="route-map-footer"') > html.indexOf('class="map-wrap'),"details belong below the street map");
assert.match(html,/data-action="fit-route-map"/);
assert.match(html,/aria-expanded="false"/);
assert.equal(await sandbox.renderGoogleRoutes("dispatcher-map",[trip]),true);
assert.equal(maps[0].options.gestureHandling,"cooperative","map must not steal normal page scrolling");
assert.ok(maps[0].options.styles.some(style=>style.featureType === "poi"),"unrelated POI labels are quieted");
assert.deepEqual(renderedMarkers.map(marker=>marker.label.text),["D","1","2"],"numbered stops match the list; the depot is not duplicated");
assert.ok(renderedMarkers.every(marker=>marker.icon.strokeColor === "#ffffff"));
assert.equal(lines.length,2,"a white casing makes the colored road route readable");
assert.equal(fitCount,1);
maps[0].center={lat:43.7,lng:-79.5};maps[0].zoom=14;
const previousMarkers=[...markerInstances];
await sandbox.renderGoogleRoutes("dispatcher-map",[trip]);
assert.ok(previousMarkers.every(marker=>marker.map===null),"refresh removes previous stop and driver pins before drawing the current route");
assert.equal(fitCount,1,"ordinary refresh does not reset the camera");
mapEl={replaceChildren(){}};
await sandbox.renderGoogleRoutes("dispatcher-map",[trip]);
assert.equal(fitCount,1,"re-rendering the dashboard also retains the camera");
assert.equal(maps[1].zoom,14);
assert.equal(maps[1].center.lat,43.7);
sandbox.fitRouteMap("dispatcher-map");
assert.equal(fitCount,2,"Fit route deliberately resets the view");
trip.stops=[trip.stops[0],trip.stops[2],trip.stops[1],trip.stops[3]];
await sandbox.renderGoogleRoutes("dispatcher-map",[trip]);
assert.equal(fitCount,3,"reordered stops get a newly fitted preview");
await sandbox.renderGoogleRoutes("dispatcher-map",[]);
assert.match(eta.textContent,/Select orders/);
assert.equal(eta.hidden,false);
assert.equal(maps[1].center.lat,43.65,"an empty fleet centers the street map on the depot, not a driver");
assert.equal(maps[1].zoom,13);
assert.equal(state.googleMapsViews["dispatcher-map"].markers.length,1,"an empty fleet still shows its depot pin");
assert.match(eta.textContent,/driver GPS is not required/);
const liveTrip={...trip,status:"active",location:{lat:44,lng:-80}};
sandbox.liveDriverStop=t=>t.location?{label:"Driver",address:t.location,live:true}:null;
assert.equal(sandbox.googleRouteStops(liveTrip,{planned:true})[0].address,"Depot","dispatcher route origin stays the planned pickup, even with live GPS");
assert.notEqual(sandbox.googleRouteStops(liveTrip)[0].address,"Depot","customer live route still uses the driver location");
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.googleCoordinate({latLng:{lat:43.65,lng:-79.38}}))),{lat:43.65,lng:-79.38},"Google DirectionalLocation resolves marker coordinates");
sandbox.console={warn(){}};
sandbox.google.maps.importLibrary=async name=>name === "maps"?{Map:MapStub,Polyline:PolylineStub}:name === "core"?{LatLngBounds:BoundsStub}:name === "routes"?{Route:{computeRoutes:async()=>{throw new Error("PERMISSION_DENIED");}}}:name === "geocoding"?{Geocoder:class{async geocode(){return {results:[{geometry:{location:{lat:43.66,lng:-79.39}}}]};}}}:{};
state.googleRouteCache.clear();
const beforePins=renderedMarkers.length;
assert.equal(await sandbox.renderGoogleRoutes("dispatcher-map",[trip],{planned:true}),true,"routing denial keeps a usable Google map instead of GPS-only fallback");
assert.ok(renderedMarkers.length>beforePins,"planned stop pins appear without driver GPS when directions are unavailable");
assert.match(eta.textContent,/GPS is not required/);
assert.equal(state.googleMapsDenied,undefined,"routing denial does not disable the base map");
state.googleRouteCache.clear();
state.googleStopPositionCache.clear();
const withGeocoding = sandbox.google.maps.importLibrary;
sandbox.google.maps.importLibrary = async name => name === "geocoding"
  ? {Geocoder:class { async geocode() { throw new Error("REQUEST_DENIED"); } }}
  : withGeocoding(name);
assert.equal(await sandbox.renderGoogleRoutes("dispatcher-map",[trip],{planned:true}),false,"a map with neither routes nor resolved stops must use the open-map fallback");
state.googleRouteCache.clear();
sandbox.google.maps.importLibrary=async name=>name === "maps"?{Map:MapStub,Polyline:PolylineStub}:name === "core"?{LatLngBounds:BoundsStub}:name === "routes"?{
  Route:{computeRoutes:async()=>{throw new Error("Routes unavailable");}},
  DirectionsService:class{async route(request){assert.equal(request.origin,"Depot");return {routes:[{overview_path:route.path,waypoint_order:[0,1],legs:route.legs.map(leg=>({start_location:leg.startLocation,end_location:leg.endLocation,distance:{value:4000},duration:{value:400}}))}]};}}
}:{};
const beforeLines=lines.length;
assert.equal(await sandbox.renderGoogleRoutes("dispatcher-map",[trip],{planned:true}),true);
assert.equal(lines.length,beforeLines+2,"compatible Google directions draw a road-following route without any GPS");
sandbox.selectedOrderPreviewTrips=()=>[];
sandbox.activeTrips=()=>[];
sandbox.queuedTrips=()=>[{id:"waiting1",status:"queued",customerName:"Customer",pickup:"Depot",destination:"One",location:null}];
sandbox.companyPickupAddress=()=>"Depot";
sandbox.getTrips=()=>[];
vm.runInContext(extract("dispatcherMapTrips"),sandbox);
const waiting=sandbox.dispatcherMapTrips();
assert.equal(waiting.length,1,"unassigned orders are visible without requiring selection or driver GPS");
assert.equal(waiting[0].stops[1].address,"One");
assert.equal(waiting[0].location,null);
sandbox.queuedTrips=()=>[];
sandbox.getTrips=()=>[{status:"completed",location:{lat:44,lng:-80}}];
assert.equal(sandbox.dispatcherMapTrips().length,0,"today's idle map does not masquerade old completed trips as active routes");
vm.runInContext(["liveDriverStop","firstMapCenter"].map(extract).join("\n"),sandbox);
assert.equal(sandbox.liveDriverStop({location:{lat:44,lng:-80,timestamp:new Date(Date.now()-120000).toISOString()}}),null,"stale GPS is not shown as a live driver pin");
assert.equal(sandbox.liveDriverStop({location:{lat:44,lng:-80}}),null,"undated GPS is not shown as live");
assert.equal(sandbox.liveDriverStop({location:{lat:44,lng:-80,timestamp:new Date().toISOString()}}).address.lat,44,"fresh GPS remains available");
assert.equal(sandbox.firstMapCenter([{...trip,location:{lat:44,lng:-80,timestamp:new Date().toISOString()}}],{planned:true}).lat,43.65,"planned maps do not center on a driver instead of the depot");
assert.equal(sandbox.formatDurationFromMillis(undefined),"","missing route data is not a fabricated one-minute estimate");
assert.doesNotMatch(extract("drawCanvasMap"),/drawRoads\(/,"unavailable maps must not draw imaginary streets");
assert.doesNotMatch(extract("loadGoogleMaps"), /auth_referrer_policy/, "do not override Google's default referrer handling for path-restricted keys");
assert.match(extract("loadGoogleMaps"), /window\.gm_authFailure = handleGoogleMapsAuthFailure/, "late Google authorization errors must trigger recovery");
state.mapRequests={"dispatcher-map":{trips:[trip],options:{planned:true}}};
const recovered=[];
sandbox.drawMap=(...args)=>recovered.push(args);
vm.runInContext(extract("handleGoogleMapsAuthFailure"),sandbox);
sandbox.handleGoogleMapsAuthFailure();
assert.equal(state.googleMapsDenied,true);
assert.equal(recovered.length,1,"authorization failure immediately redraws the visible map using the street-map fallback");
assert.equal(state.googleMapsViews["dispatcher-map"].seq,-1,"stale Google renders cannot overwrite the recovered map");
console.log("Map presentation checks passed: external details, deduplicated legend, numbered pins, depot handling, calm road style, route contrast, camera retention, Fit route and honest empty states.");
