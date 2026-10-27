import {shopifyOrigin,getShopifyOrder} from './shopify.js';
import {digest,equal,verifyShopifyQuery,verifyShopifyWebhook,verifyWixWebhook,verifyWixInstance,wixAppAccessToken} from './marketplace-security.js';
import {marketplaceStore} from './marketplace-store.js';
import {workspaceKey} from './workspaces.js';
const origin='https://app.floraljet.llc';
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const stateCookie=value=>`rivo_market_state=${value}; Path=/; Max-Age=${value?'600':'0'}; HttpOnly; Secure; SameSite=Lax`;
const cookie=request=>String(request.headers.get('cookie')||'').match(/(?:^|;\s*)rivo_market_state=([^;]+)/)?.[1]||'';
async function tokenRequest(store,env,body) {
  const response=await fetch(`${shopifyOrigin(store)}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({client_id:env.SHOPIFY_CLIENT_ID,client_secret:env.SHOPIFY_CLIENT_SECRET,...body}),signal:AbortSignal.timeout(15000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok || !value.access_token)throw Error('Shopify authorization failed. Reconnect the store.');
  return {accessToken:value.access_token,refreshToken:value.refresh_token||'',scope:value.scope||'',expiresAt:Number(value.expires_in)>0?Date.now()+Number(value.expires_in)*1000:null};
}
export async function restoreMarketplaceCredentials(connection,credentials,env) {
  if(connection.authMode==='wix-app' && (!credentials.apiKey || credentials.expiresAt<Date.now()+60000)) return {...credentials,...await wixAppAccessToken(connection.externalId,env)};
  if(connection.authMode==='shopify-oauth' && credentials.expiresAt && credentials.expiresAt<Date.now()+60000) {
    if(!credentials.refreshToken)throw Error('Shopify authorization expired. Reconnect the store.');
    return tokenRequest(connection.storeUrl,env,{grant_type:'refresh_token',refresh_token:credentials.refreshToken});
  }
  return credentials;
}
export async function handleMarketplace(request,env,ctx,api) {
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/marketplace/'))return null;
  const provider=path.split('/')[3];
  if(!['wix','shopify'].includes(provider))return json({error:'Unknown marketplace.'},404);
  const configured=provider==='wix'?Boolean(env.WIX_APP_ID&&env.WIX_APP_SECRET):Boolean(env.SHOPIFY_CLIENT_ID&&env.SHOPIFY_CLIENT_SECRET);
  if(path.endsWith('/status') && request.method==='GET') {const auth=configured?await api.authenticate(request,env,url):null;return json({configured,provider,connected:Boolean(auth?.providers?.includes(provider))});}
  if(!configured)return json({error:`The ${provider==='wix'?'Wix':'Shopify'} marketplace installation is not available yet. Existing connections still work.`},503);
  const store=await marketplaceStore(env);
  if(path==='/api/marketplace/shopify/callback' && request.method==='GET') {
    if(!await verifyShopifyQuery(url,env.SHOPIFY_CLIENT_SECRET) || !equal(cookie(request),url.searchParams.get('state')))return json({error:'Invalid or expired Shopify authorization. Start again.'},401);
    const state=await store.consume(await digest(url.searchParams.get('state')||''));
    if(!state || state.external_id!==url.searchParams.get('shop'))return json({error:'Authorization has expired. Start again.'},401);
    const credentials=await tokenRequest(state.external_id,env,{code:url.searchParams.get('code')||'',expiring:'1'});
    if(!credentials.refreshToken || !credentials.expiresAt || !credentials.scope.split(',').some(s=>s==='read_orders'||s==='write_orders'))return json({error:'Shopify did not grant the required expiring order access.'},403);
    await api.link(state.workspace_key,'shopify',state.external_id,credentials,store);
    return new Response(null,{status:303,headers:{Location:`${origin}/marketplace/shopify?connected=1`,'Set-Cookie':stateCookie(''),'Cache-Control':'no-store'}});
  }
  if(path.endsWith('/webhooks') && request.method==='POST') {
    if(Number(request.headers.get('content-length')||0)>1048576)return json({error:'Payload too large.'},413);
    let raw;try{raw=await boundedText(request);}catch{return json({error:'Payload too large.'},413);}
    let id,type,eventId,payload;
    try {
      if(provider==='shopify') {
        if(!await verifyShopifyWebhook(raw,request.headers.get('X-Shopify-Hmac-Sha256'),env.SHOPIFY_CLIENT_SECRET))return json({error:'Invalid webhook signature.'},401);
        id=new URL(shopifyOrigin(request.headers.get('X-Shopify-Shop-Domain')||'')).hostname;
        type=request.headers.get('X-Shopify-Topic')||'';eventId=request.headers.get('X-Shopify-Event-Id')||request.headers.get('X-Shopify-Webhook-Id')||await digest(raw);payload=JSON.parse(raw);
      } else {
        payload=await verifyWixWebhook(raw,env.WIX_WEBHOOK_PUBLIC_KEY);id=payload.instanceId;type=payload.eventType;eventId=payload.id||payload.eventId||await digest(raw);
      }
    } catch {return json({error:'Invalid marketplace event.'},401);}
    const installation=await store.installation(provider,id);
    if(!installation)return json({received:true});
    // Authenticate first. Only platform-verified identities can select a workspace.
    const inner=provider==='wix' ? (typeof payload.data==='string'?JSON.parse(payload.data):payload.data||payload) : payload;
    const event=await store.enqueue(await digest(`${provider}:${id}:${eventId}`),provider,id,type,{orderId:provider==='shopify'?String(payload.id||''):String(payload.entityId||inner.entityId||inner.metadata?.entityId||inner.entity?.id||inner.order?.id||inner.id||''),privacy:provider==='shopify'&&['customers/data_request','customers/redact','shop/redact'].includes(type)?await api.encrypt(env,payload):null});
    if(event.status==='complete')return json({received:true,duplicate:true});
    try {
      await processEvent(event,installation,env,store,api);
      return json({received:true});
    } catch {
      await store.fail(event.event_key);
      // Non-2xx is intentional: the platform retries instead of acknowledging lost work.
      return json({error:'The event is saved but could not be applied. Please retry.'},503);
    }
  }
  const auth=await api.authenticate(request,env,url);
  if(!auth)return json({error:'Sign into your Rivo dispatcher workspace first.'},401);
  if(path==='/api/marketplace/shopify/privacy' && request.method==='GET') {
    const events=await store.privacy(auth.key);
    return json({requests:events.map(({event_key,event_type,external_id,status,created_at,completed_at,last_error})=>({id:event_key,type:event_type,shop:external_id,status,createdAt:created_at,completedAt:completed_at,resolution:last_error||''}))});
  }
  const privacyMatch=path.match(/^\/api\/marketplace\/shopify\/privacy\/([a-f0-9]{64})(?:\/(resolve))?$/);
  if(privacyMatch) {
    const event=(await store.privacy(auth.key)).find(e=>e.event_key===privacyMatch[1]);
    if(!event)return json({error:'Request not found.'},404);
    if(request.method==='GET'&&!privacyMatch[2]) {
      const payload=JSON.parse(event.payload_json),details=payload.privacy?await api.decrypt(env,payload.privacy):null;
      return json({id:event.event_key,type:event.event_type,shop:event.external_id,status:event.status,request:details,records:details?await api.privacyExport(auth.key,event,details,env):[]});
    }
    if(request.method==='POST'&&privacyMatch[2]) {
      const body=await api.body(request),note=String(body.note||'').trim();
      if(body.confirmation!=='RESOLVED'||note.length<20||note.length>1000)return json({error:'Describe the completed export or erasure and retention review, then confirm RESOLVED. This action does not erase delivery records.'},400);
      await store.resolvePrivacy(event.event_key,note);return json({resolved:true});
    }
    return json({error:'Method not allowed.'},405);
  }
  if(path==='/api/marketplace/shopify/connect' && request.method==='POST') {
    const body=await api.body(request);let shop;try{shop=new URL(shopifyOrigin(body.shop||'')).hostname;}catch{return json({error:'Enter a valid .myshopify.com store domain.'},400);}
    const existing=await store.installation('shopify',shop);
    if(existing && existing.workspace_key!==auth.key)return json({error:'This store belongs to another Rivo workspace.'},409);
    const state=crypto.randomUUID()+crypto.randomUUID();await store.state(await digest(state),shop,auth.key);
    const target=new URL(`https://${shop}/admin/oauth/authorize`);target.search=new URLSearchParams({client_id:env.SHOPIFY_CLIENT_ID,scope:'read_orders',redirect_uri:`${origin}/api/marketplace/shopify/callback`,state});
    return json({authorizationUrl:target.toString()},200,{'Set-Cookie':stateCookie(state)});
  }
  if(path==='/api/marketplace/wix/connect' && request.method==='POST') {
    const body=await api.body(request);let identity;try{identity=await verifyWixInstance(String(body.instance||''),env);}catch{return json({error:'Wix authorization expired. Open Rivo from Wix again.'},401);}
    const id=identity.instanceId;
    const existing=await store.installation('wix',id);
    if(existing&&existing.workspace_key!==auth.key)return json({error:'This site belongs to another Rivo workspace.'},409);
    const grant=await wixAppAccessToken(id,env);
    await api.link(auth.key,'wix',id,{instanceId:id,siteId:identity.siteId,...grant},store);
    return json({connected:true});
  }
  return json({error:'Not found.'},404);
}
async function processEvent(event,installation,env,store,api) {
  const type=event.event_type;
  if(type==='app/uninstalled'||type==='APP_REMOVED_WEBHOOK'||type==='AppInstanceRemoved'||type==='AppRemoved'||type==='wix.devcenter.apps.v1.app_instance_removed') {
    await api.disconnect(installation,env);await store.revoke(event.provider,event.external_id);await store.finish(event.event_key);return;
  }
  if(['customers/data_request','customers/redact','shop/redact'].includes(type)) {
    // Durable, encrypted privacy inbox: completion is tracked separately from receipt.
    // These requests require the documented retention review before erasure/export.
    return;
  }
  if(event.provider==='wix' && !/order|fulfillment/i.test(type)){await store.finish(event.event_key);return;}
  if(installation.revoked_at){await store.finish(event.event_key);return;}
  for(let attempt=0;attempt<3;attempt++) {
    try {await api.synchronize(installation,event,env,getShopifyOrder);break;}
    catch(error){if(error.code!=='STATE_CONFLICT' || attempt===2)throw error;}
  }
  await store.finish(event.event_key);
}
export function marketplaceEnvironment(env,key) {return {...env,RIVO_STATE_KEY:workspaceKey(key),...(key==='primary'?{}:{WIX_API_KEY:'',WIX_SITE_ID:''})};}

async function boundedText(request) {
  if(!request.body)return '';
  const reader=request.body.getReader(),parts=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw Error('Too large');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return new TextDecoder().decode(bytes);
}
