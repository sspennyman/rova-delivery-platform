const text = new TextEncoder();
export const bytes = value => Uint8Array.from(atob(String(value).replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
export const base64 = value => btoa(String.fromCharCode(...value));
export async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export async function hmac(secret,value) {const key=await crypto.subtle.importKey('raw',text.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,text.encode(value)));}
export function equal(a,b) {a=String(a||'');b=String(b||'');let mismatch=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;}
export async function verifyShopifyQuery(url,secret,now=Date.now()) {
  if(!secret)return false;
  const params=[...url.searchParams];
  if(new Set(params.map(([key])=>key)).size!==params.length)return false;
  const timestamp=Number(url.searchParams.get('timestamp'));
  if(!timestamp || Math.abs(now-timestamp*1000)>300000)return false;
  const message=params.filter(([key])=>key!=='hmac').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&');
  const expected=[...await hmac(secret,message)].map(b=>b.toString(16).padStart(2,'0')).join('');
  return equal(expected,url.searchParams.get('hmac'));
}
export async function verifyShopifyWebhook(raw,signature,secret) {return Boolean(secret && signature && equal(base64(await hmac(secret,raw)),signature));}
export async function verifyWixWebhook(raw,pem,now=Date.now()) {
  const [header,body,signature,...extra]=String(raw).trim().split('.');
  if(!header||!body||!signature||extra.length||!pem)throw Error('Invalid Wix signature.');
  const meta=JSON.parse(new TextDecoder().decode(bytes(header)));
  if(meta.alg!=='RS256')throw Error('Invalid Wix signature algorithm.');
  const key=await crypto.subtle.importKey('spki',bytes(pem.replace(/-----[^-]+-----|\s/g,'')),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(signature),text.encode(`${header}.${body}`)))throw Error('Invalid Wix signature.');
  const payload=JSON.parse(new TextDecoder().decode(bytes(body)));
  if(payload.exp && payload.exp*1000<now || payload.iat && payload.iat*1000>now+60000)throw Error('Expired Wix event.');
  const data=typeof payload.data==='string'?JSON.parse(payload.data):payload.data;
  if(!data?.instanceId || !data?.eventType)throw Error('Invalid Wix event.');
  return data;
}
export async function verifyWixInstance(instance,env,fetcher=fetch) {
  if(!instance || instance.length>16000 || !env.WIX_APP_ID)throw Error('Open this app from your Wix dashboard.');
  const response=await fetcher('https://www.wixapis.com/oauth2/token-info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:instance}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok || data.active!==true || String(data.client_id)!==String(env.WIX_APP_ID) || !data.instance_id || Number(data.exp)*1000<Date.now())throw Error('Wix authorization expired. Reopen Rivo from your Wix dashboard.');
  return {instanceId:String(data.instance_id),siteId:String(data.site_id || '')};
}
export async function wixAppAccessToken(instanceId,env,fetcher=fetch) {
  if(!env.WIX_APP_ID || !env.WIX_APP_SECRET)throw Error('Wix app credentials are not configured.');
  const response=await fetcher('https://www.wixapis.com/oauth2/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:env.WIX_APP_ID,client_secret:env.WIX_APP_SECRET,instance_id:instanceId}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.access_token)throw Error('Wix access could not be restored. Reopen Rivo in Wix.');
  return {apiKey:data.access_token,expiresAt:Date.now()+Math.max(60,Number(data.expires_in)||14400)*1000};
}
