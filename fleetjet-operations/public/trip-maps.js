const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function coordinate(point) {
  const lng = Array.isArray(point) ? point[0] : point?.lng;
  const lat = Array.isArray(point) ? point[1] : point?.lat;
  return typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng) && Number.isFinite(lat)
    && Math.abs(lng) <= 180 && Math.abs(lat) <= 85 ? [lng, lat] : null;
}
export function tripMapData(trip) {
  const path = (trip.previewPath || []).map(coordinate).filter(Boolean);
  const start = coordinate(trip.start) || path[0];
  const end = coordinate(trip.end) || path.at(-1);
  return {path, start, end, recorded: path.length > 1, points: path.length ? path : [start,end].filter(Boolean)};
}
export function tripPlaceLabel(value, fallback) {
  const label = String(value || "").trim();
  return label && !/^GPS\s*:/i.test(label) && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(label) ? label : fallback;
}
export function tripMapHtml(trip) {
  const data = tripMapData(trip);
  const note = data.recorded ? trip.previewIncomplete ? "Partial recorded GPS preview" : "Recorded GPS preview" : data.points.length ? "Start & finish only · older route not saved" : "No GPS map for this trip";
  return `<figure class="mileage-map-preview"><div class="mileage-trip-map" data-trip-map="${escape(trip.id)}" role="img" aria-label="${escape(note)}"><span class="mileage-map-loading">${data.points.length ? "Loading trip map…" : "Manual trip · no GPS route"}</span></div><figcaption>${escape(note)}</figcaption></figure>`;
}
export function createTripMaps({loadMap, getTrips, personal}) {
  let observer, revision = 0;
  const views = new Map();
  const pending = new Set();
  function remove(element) {
    const view = views.get(element);
    if (!view) return;
    view.disposed = true;
    view.resize?.disconnect();
    try { view.map.remove(); } catch { /* The containing page may already be gone. */ }
    views.delete(element);
  }
  function stop() {
    revision++;
    observer?.disconnect();
    pending.clear();
    for (const element of views.keys()) remove(element);
  }
  async function draw(element, trip) {
    if (views.has(element) || pending.has(element)) return;
    const data = tripMapData(trip), generation = revision;
    if (!data.points.length || !loadMap) return;
    pending.add(element);
    try {
      const lib = await loadMap();
      if (generation !== revision || !element.isConnected) return;
      element.replaceChildren();
      const map = new lib.Map({container:element,style:"https://tiles.openfreemap.org/styles/positron",center:data.start || data.points[0],zoom:13,interactive:false,attributionControl:false});
      const view = {map,disposed:false};
      views.set(element,view);
      map.addControl(new lib.AttributionControl({compact:true}));
      const bounds = data.points.reduce((result,p)=>result.extend(p),new lib.LngLatBounds(data.points[0],data.points[0]));
      map.fitBounds(bounds,{padding:32,maxZoom:data.recorded ? 15 : 13,duration:0});
      map.once("load",()=>{
        if (view.disposed || generation !== revision || !element.isConnected) return;
        if (data.recorded) {
          map.addSource("trip-path",{type:"geojson",data:{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:data.path}}});
          map.addLayer({id:"trip-path-casing",type:"line",source:"trip-path",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#fff","line-width":7}});
          map.addLayer({id:"trip-path",type:"line",source:"trip-path",layout:{"line-cap":"round","line-join":"round"},paint:{"line-color":"#245bd6","line-width":4}});
        }
        for (const [point,label] of [[data.start,"A"],[data.end,"B"]]) {
          if (!point) continue;
          const marker = document.createElement("span");
          marker.className = "mileage-map-pin";
          marker.textContent = label;
          marker.setAttribute("aria-hidden","true");
          new lib.Marker({element:marker,offset:label === "A" ? [-8,0] : [8,0]}).setLngLat(point).addTo(map);
        }
        element.querySelectorAll("canvas").forEach(canvas=>canvas.setAttribute("aria-hidden","true"));
      });
      map.on("error",()=>{
        if (view.disposed || map.loaded()) return;
        remove(element);
        const message = document.createElement("span");
        message.className = "mileage-map-loading";
        message.textContent = "Map unavailable · your trip is still saved";
        element.replaceChildren(message);
      });
      if (typeof ResizeObserver !== "undefined") {
        view.resize = new ResizeObserver(()=>{if (!view.disposed) map.resize();});
        view.resize.observe(element);
      }
    } catch {
      if (generation !== revision || !element.isConnected) return;
      remove(element);
      element.textContent = "Map unavailable · your trip is still saved";
    } finally { pending.delete(element); }
  }
  function mount() {
    stop();
    const trips = new Map(getTrips().map(trip=>[trip.id,trip]));
    const elements = [...document.querySelectorAll("[data-trip-map]")].filter(element=>Boolean(element.closest("[data-personal-mileage]")) === personal);
    if (typeof IntersectionObserver === "undefined") {
      elements.slice(0,6).forEach(element=>{const trip=trips.get(element.dataset.tripMap);if(trip) void draw(element,trip);});
      return;
    }
    observer = new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{
      const trip=trips.get(target.dataset.tripMap);
      if (isIntersecting && trip) void draw(target,trip); else remove(target);
    }));
    elements.forEach(element=>observer.observe(element));
  }
  return {mount,stop};
}
