import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from '../worker/index.js';
import {localD1} from './local-d1.mjs';
const env={DB:localD1(),DISPATCHER_USERNAME:'fixture',DISPATCHER_PASSWORD:'fixture-password',INTEGRATION_ENCRYPTION_KEY:'fixture-encryption-not-production',SHOPIFY_CLIENT_ID:'fixture-client',SHOPIFY_CLIENT_SECRET:'fixture-secret'};
const originalFetch=globalThis.fetch;
const order={id:'gid://shopify/Order/123',legacyResourceId:'123',name:'#1001',createdAt:new Date().toISOString(),displayFinancialStatus:'PENDING',displayFulfillmentStatus:'UNFULFILLED',shippingAddress:{firstName:'Fixture',lastName:'Customer',address1:'123 Example Street',city:'Ottawa'},lineItems:{nodes:[]}};
globalThis.fetch=async(url,options)=>{
 if(String(url).endsWith('/admin/oauth/access_token'))return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',scope:'read_orders',expires_in:3600});
 if(String(url).endsWith('/graphql.json'))return Response.json({data:{order}});
 throw Error('Unexpected outgoing call');
};
async function call(path,{method='GET',body,headers={}}={}){const response=await worker.fetch(new Request('https://app.floraljet.llc'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);const payload=response.headers.get('Content-Type')?.includes('json')?await response.json():null;return {response,payload};}
try {
 const login=await call('/api/auth/login',{method:'POST',body:{identifier:'fixture',password:'fixture-password'}});assert.equal(login.response.status,200);const auth={Authorization:'Bearer '+login.payload.session.token};
 assert.equal((await call('/api/marketplace/shopify/connect',{method:'POST',body:{shop:'fixture.myshopify.com'}})).response.status,401);
 const start=await call('/api/marketplace/shopify/connect',{method:'POST',headers:auth,body:{shop:'fixture.myshopify.com'}});assert.equal(start.response.status,200);
 const grant=new URL(start.payload.authorizationUrl),state=grant.searchParams.get('state');assert.equal(grant.searchParams.get('scope'),'read_orders');
 const params=new URLSearchParams({code:'fixture-code',shop:'fixture.myshopify.com',state,timestamp:String(Math.floor(Date.now()/1000))});const message=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');params.set('hmac',createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update(message).digest('hex'));
 const callback='/api/marketplace/shopify/callback?'+params;
 assert.equal((await call(callback)).response.status,401,'state must be bound to browser cookie');
 const cookie={Cookie:'rivo_market_state='+state};const success=await call(callback,{headers:cookie});assert.equal(success.response.status,303);
 assert.equal((await call(callback,{headers:cookie})).response.status,401,'authorization state is one-use');
 const headers={'X-Shopify-Hmac-Sha256':createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update('{"id":123}').digest('base64'),'X-Shopify-Shop-Domain':'fixture.myshopify.com','X-Shopify-Topic':'orders/create','X-Shopify-Event-Id':'fixture-event'};
 const event=await call('/api/marketplace/shopify/webhooks',{method:'POST',headers,body:'{"id":123}'});assert.equal(event.response.status,200);
 const replay=await call('/api/marketplace/shopify/webhooks',{method:'POST',headers,body:'{"id":123}'});assert.equal(replay.payload.duplicate,true);
 const snapshot=(await call('/api/me',{headers:auth})).payload.snapshot;assert.equal(snapshot.integrations.connections.length,1);assert.equal(snapshot.trips.filter(t=>t.source?.system==='shopify').length,1);assert.equal(snapshot.trips.find(t=>t.source?.system==='shopify').source.paymentStatus,'PENDING');
 assert.ok(!JSON.stringify(snapshot).includes('fixture-access'),'tokens never appear in public snapshots');
 const tampered=await call('/api/marketplace/shopify/webhooks',{method:'POST',headers,body:'{"id":124}'});assert.equal(tampered.response.status,401);
 const privacyBody=JSON.stringify({shop_domain:'fixture.myshopify.com',customer:{id:456,email:'fixture@example.invalid'},orders_requested:[123]});
 const privacyHeaders={...headers,'X-Shopify-Topic':'customers/data_request','X-Shopify-Event-Id':'fixture-privacy','X-Shopify-Hmac-Sha256':createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update(privacyBody).digest('base64')};
 assert.equal((await call('/api/marketplace/shopify/webhooks',{method:'POST',headers:privacyHeaders,body:privacyBody})).response.status,200);
 assert.equal((await call('/api/marketplace/shopify/privacy')).response.status,401);
 const inbox=await call('/api/marketplace/shopify/privacy',{headers:auth});assert.equal(inbox.payload.requests.length,1);assert.ok(!JSON.stringify(inbox.payload).includes('fixture@example.invalid'));
 const privacyPath='/api/marketplace/shopify/privacy/'+inbox.payload.requests[0].id;
 const privacyExport=await call(privacyPath,{headers:auth});assert.equal(privacyExport.payload.records.length,1);assert.ok(!JSON.stringify(privacyExport.payload.records).includes('shareToken'));
 assert.equal((await call(privacyPath+'/resolve',{method:'POST',headers:auth,body:{note:'done'}})).response.status,400);
 assert.equal((await call(privacyPath+'/resolve',{method:'POST',headers:auth,body:{note:'Fixture export completed and retention reviewed.',confirmation:'RESOLVED'}})).response.status,200);
 assert.equal((await call(privacyPath,{headers:auth})).payload.request,null,'completed request personal payload is cleared');
 const uninstall=await call('/api/marketplace/shopify/webhooks',{method:'POST',headers:{...headers,'X-Shopify-Topic':'app/uninstalled','X-Shopify-Event-Id':'fixture-uninstall'},body:'{"id":123}'});assert.equal(uninstall.response.status,200);
 const after=(await call('/api/me',{headers:auth})).payload.snapshot;assert.equal(after.integrations.connections.length,0);assert.equal(after.trips.filter(t=>t.source?.system==='shopify').length,1,'uninstall preserves operational history');
 console.log('Marketplace integration passed: real auth/database boundary, OAuth cookie/state/replay guards, encrypted credentials, signed background imports without a dashboard, event dedupe, tamper rejection and uninstall cleanup.');
}finally{globalThis.fetch=originalFetch;env.DB.close();}
