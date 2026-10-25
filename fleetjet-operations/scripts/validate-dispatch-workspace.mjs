import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { outsideDailyOrderWindow } from "../public/order-window.js";
import { isNonDeliveryOrder, fulfillmentMethodForTrip } from "../public/order-fulfillment.js";
const source = fs.readFileSync("public/app.js", "utf8");
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
};
const context = {
  outsideDailyOrderWindow,
  isNonDeliveryOrder,
  fulfillmentMethodForTrip,
  state: { operationsPane: "orders", selectedOrderIds: new Set(), snapshot: {} },
  h: String, getDrivers: () => [], orderFilterToolbarHtml: () => "",
  queuedOrderItem: trip => `<row>${trip.id}</row>`
};
vm.createContext(context);
vm.runInContext(extract("bulkOrderToolbarHtml") + "\n" + extract("channelOrdersPanel"), context);
// Queue rendering uses a stub toolbar; the real toolbar is checked separately for history.
const toolbar = context.bulkOrderToolbarHtml;
context.bulkOrderToolbarHtml = () => "";
const trips = [{id:"queued-fixture", status:"queued"}, {id:"complete-fixture",status:"completed"}, {id:"active-fixture",status:"active"}, {id:"courier-fixture",status:"queued",courier:{isOpen:true}}, {id:"pickup-fixture",status:"queued",source:{system:"wix",fulfillmentMethod:"customer-pickup"}}, {id:"pos-fixture",status:"store-sale",source:{system:"wix",fulfillmentMethod:"in-store"}}, {id:"review-fixture",status:"order-review",source:{system:"wix",fulfillmentMethod:"needs-details"}}];
for (const trip of trips) if (trip.source?.system === "wix") trip.source.createdDate = new Date().toISOString();
let html = context.channelOrdersPanel(trips);
assert.match(html, /<row>queued-fixture/);
for (const id of ["complete-fixture", "active-fixture", "courier-fixture", "pickup-fixture", "pos-fixture", "review-fixture"]) assert.ok(!html.includes(`<row>${id}`));
context.state.operationsPane = "history";
html = context.channelOrdersPanel(trips);
assert.match(html, /<row>complete-fixture/);
assert.ok(!html.includes("<row>queued-fixture"));
const historyTools = toolbar([trips[1]]);
assert.equal(historyTools, "", "History does not offer incomplete bulk selection");
assert.doesNotMatch(historyTools, /Send to driver|Mark delivered|Assign without starting/);
assert.match(source, /routePreviewOpen: false/);
assert.match(source, /data-action="close-route-preview"/);
assert.match(source, /companyPickupAddress\(\) \|\| first.pickup/);
Object.assign(context, { getTrips: () => trips, relativeTime: () => "just now", proofRecordHtml: () => "Previous proof" });
vm.runInContext(extract("pickupOrdersHtml"), context);
const pickupHtml = context.pickupOrdersHtml();
for (const label of ["Customer pickup", "Pickup or delivery?", "Needs delivery", "Add to delivery queue", "Sync orders"]) assert.ok(pickupHtml.includes(label));
assert.doesNotMatch(pickupHtml, /Point-of-sale order · no delivery requested/);
assert.doesNotMatch(pickupHtml, /data-order-select|data-action="dispatch-order"|Mark delivered|Send to driver/);
console.log("PASS: separate queue/history, no redispatch actions in history, optional map and pickup fallback");
