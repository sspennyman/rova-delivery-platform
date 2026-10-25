import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {localD1} from './local-d1.mjs';
const env={DB:localD1(),DISPATCHER_USERNAME:'fixture',DISPATCHER_PASSWORD:'fixture-password',WIX_API_KEY:'fixture-only',WIX_SITE_ID:'fixture-site',WIX_SYNC_LIMIT:'1',WIX_SYNC_LOOKBACK_DAYS:'1'};
const originalFetch=globalThis.fetch;
let sourceRequests=0;
const offline={id:'offline-pending',number:'27529',status:'APPROVED',paymentStatus:'NOT_PAID',fulfillmentStatus:'NOT_FULFILLED',createdDate:new Date(Date.now()-3600000).toISOString(),shippingInfo:{title:'Local delivery',logistics:{shippingDestination:{address:{addressLine:'123 Fixture Street',city:'Ottawa'},contactDetails:{firstName:'Fixture',lastName:'Customer'}}}}};
globalThis.fetch=async(url,options)=>{sourceRequests++;assert.equal(url,'https://www.wixapis.com/ecom/v1/orders/search');const q=JSON.parse(options.body).search;return Response.json({orders:[offline,{...offline,id:'old-import-blocked',createdDate:'2024-01-01T00:00:00Z'}],metadata:{hasNext:false}});};
async function call(path,token,body={}){const r=await worker.fetch(new Request('https://app.floraljet.llc'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),env);return {status:r.status,...await r.json()};}
try{
 const login=await call('/api/auth/login',null,{identifier:'fixture',password:'fixture-password'});assert.equal(login.status,200);
 const sync=await call('/api/integrations/sync',login.session.token);assert.equal(sync.status,200);
 const imported=sync.snapshot.trips.find(t=>t.source?.orderId===offline.id);assert.ok(imported,'pending offline order imported');assert.ok(!sync.snapshot.trips.some(t=>t.source?.orderId==='old-import-blocked'),'old source order must not be imported');assert.equal(imported.status,'queued');assert.equal(imported.source.fulfillmentMethod,'delivery');assert.equal(imported.source.paymentStatus,'NOT_PAID');assert.equal(imported.driverId,'','sync never dispatches or approves payment');
 const beforeAutomatic=sourceRequests;
 const automatic=await call('/api/integrations/sync',login.session.token,{automatic:true});assert.equal(automatic.status,200);assert.equal(automatic.results.length,0);assert.equal(sourceRequests,beforeAutomatic,'second dashboard does not immediately re-poll the source');
 const repeat=await call('/api/integrations/sync',login.session.token);assert.equal(repeat.results[0].imported,0);assert.equal(repeat.snapshot.trips.filter(t=>t.source?.orderId===offline.id).length,1);
 assert.equal(sourceRequests,beforeAutomatic*2,'manual refresh bypasses automatic throttle');
 console.log('Full Wix pending import passed: approved offline order reaches dispatch queue with unpaid state retained, no assignment, strict 24-hour coverage and replay without duplicates.');
}finally{globalThis.fetch=originalFetch;}
