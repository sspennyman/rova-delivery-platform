import {digest} from './marketplace-security.js';
const origin='https://app.floraljet.llc';
const tools=[
  {name:'rivo_connection_status',description:'Check whether this ChatGPT account has an approved Rivo workspace connection.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'rivo_connect_workspace',description:'Start a Rivo workspace connection. Returns a short-lived link for a dispatcher to review and approve 30 days of read access. Never request passwords or API keys in chat.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'rivo_dispatch_summary',description:'Read the connected workspace’s current dispatch counts and delivery kilometres recorded in the past 24 hours. Requires dispatcher-approved access.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'rivo_list_deliveries',description:'Read recent business deliveries and active routes from the connected Rivo workspace, including customer names, delivery addresses and phone numbers. Use only when needed for the user’s delivery task. Private personal mileage, credentials and live GPS trails are excluded.',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:50},status:{type:'string',maxLength:40}},additionalProperties:false}},
  {name:'rivo_list_drivers',description:'Read driver names, vehicle labels and availability from the connected Rivo workspace. Does not include precise location, contact details or private mileage.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
].map(tool=>({...tool,annotations:{readOnlyHint:tool.name!=='rivo_connect_workspace',destructiveHint:false,idempotentHint:tool.name!=='rivo_connect_workspace',openWorldHint:false}}));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function directory(env) {
  if(!env.DB)throw Error('Persistent storage is required.');
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_chat_approvals (code_hash TEXT PRIMARY KEY,actor_hash TEXT NOT NULL,actor_email TEXT NOT NULL,expires_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rivo_chat_links (actor_hash TEXT PRIMARY KEY,workspace_key TEXT NOT NULL,actor_email TEXT NOT NULL,approved_at TEXT NOT NULL,expires_at INTEGER NOT NULL)')
  ]);
  return {
    async link(actor){return env.DB.prepare('SELECT * FROM rivo_chat_links WHERE actor_hash=? AND expires_at>?').bind(actor,Date.now()).first();},
    async start(actor,email){const code=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('DELETE FROM rivo_chat_approvals WHERE expires_at<? OR actor_hash=?').bind(Date.now(),actor).run();await env.DB.prepare('INSERT INTO rivo_chat_approvals(code_hash,actor_hash,actor_email,expires_at) VALUES (?,?,?,?)').bind(await digest(code),actor,email,Date.now()+600000).run();return code;},
    async pending(code){if(typeof code!=='string'||code.length>160)return null;return env.DB.prepare('SELECT * FROM rivo_chat_approvals WHERE code_hash=? AND expires_at>?').bind(await digest(code),Date.now()).first();},
    async approve(pending,key){const consumed=await env.DB.prepare('DELETE FROM rivo_chat_approvals WHERE code_hash=?').bind(pending.code_hash).run();if(Number(consumed.meta?.changes)!==1)throw Error('Approval link has already been used.');await env.DB.prepare('INSERT INTO rivo_chat_links(actor_hash,workspace_key,actor_email,approved_at,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(actor_hash) DO UPDATE SET workspace_key=excluded.workspace_key,actor_email=excluded.actor_email,approved_at=excluded.approved_at,expires_at=excluded.expires_at').bind(pending.actor_hash,key,pending.actor_email,new Date().toISOString(),Date.now()+30*86400000).run();},
    async links(key){return (await env.DB.prepare('SELECT actor_hash,actor_email,approved_at,expires_at FROM rivo_chat_links WHERE workspace_key=? AND expires_at>?').bind(key,Date.now()).all()).results||[];},
    async revoke(actor,key){await env.DB.prepare('DELETE FROM rivo_chat_links WHERE actor_hash=? AND workspace_key=?').bind(actor,key).run();}
  };
}
export async function handleChatgpt(request,env,api) {
  const url=new URL(request.url),path=url.pathname;
  if(path!=='/mcp'&&!path.startsWith('/api/chatgpt/'))return null;
  if(path==='/mcp') {
    if(request.method!=='POST')return json({error:'Use the Rivo plugin in ChatGPT to connect.'},405);
    const rpc=await api.body(request),id=rpc.id??null;
    const reply=result=>json({jsonrpc:'2.0',id,result});
    if(rpc.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
    if(rpc.method==='initialize')return reply({protocolVersion:['2026-07-28','2025-06-18','2025-03-26'].includes(rpc.params?.protocolVersion)?rpc.params.protocolVersion:'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'Rivo',version:'1.0.0'},instructions:'Read-only access requires a Rivo dispatcher to approve the connection. Never collect passwords in chat.'});
    if(rpc.method?.startsWith('notifications/'))return new Response(null,{status:204});
    if(rpc.method==='ping')return reply({});
    if(rpc.method==='tools/list')return reply({tools});
    if(rpc.method!=='tools/call')return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found.'}});
    // Sites authenticates /mcp and supplies these verified caller headers. A
    // separate Rivo dispatcher approval is required before any workspace read.
    const actorId=request.headers.get('oai-authenticated-user-id');
    if(!actorId||actorId.length>256)return json({jsonrpc:'2.0',id,error:{code:-32001,message:'Connect through the Rivo plugin to authenticate.'}},401);
    const output=(value,isError=false)=>reply({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError});
    try {
      const name=rpc.params?.name,args=rpc.params?.arguments??{};
      if(!tools.some(t=>t.name===name))return output({error:'Unknown Rivo tool.'},true);
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>name!=='rivo_list_deliveries'||!['limit','status'].includes(k)))return output({error:'Unsupported tool arguments.'},true);
      const store=await directory(env),actor=await digest(actorId),link=await store.link(actor);
      if(name==='rivo_connection_status')return output({connected:Boolean(link),...(link?{expiresAt:new Date(link.expires_at).toISOString()}:{nextStep:'Use rivo_connect_workspace and approve the connection in your signed-in Rivo dispatcher account.'})});
      if(name==='rivo_connect_workspace') {
        const code=await store.start(actor,String(request.headers.get('oai-authenticated-user-email')||'').slice(0,254));
        return output({approvalUrl:origin+'/chatgpt/connect?code='+encodeURIComponent(code),expiresInMinutes:10,access:'Read dispatch summaries, recent deliveries, driver availability and delivery-distance totals for 30 days. A dispatcher must approve in Rivo.'});
      }
      if(!link)return output({error:'Rivo workspace approval is required. Use rivo_connect_workspace first.'},true);
      if(name==='rivo_list_deliveries'&&(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>50)||args.status!==undefined&&(typeof args.status!=='string'||args.status.length>40)))return output({error:'Use limit 1–50 and a status up to 40 characters.'},true);
      return output(await api.read(link.workspace_key,name,args,env));
    } catch{return output({error:'Rivo could not complete this request. Try again or reconnect the workspace.'},true);}
  }
  const auth=await api.authenticate(request,env,url);
  if(!auth)return json({error:'Sign into your Rivo dispatcher workspace first.'},401);
  const store=await directory(env);
  if(path==='/api/chatgpt/connection'&&request.method==='GET') {
    const pending=await store.pending(url.searchParams.get('code'));
    return json({workspace:await api.workspaceName(auth.key,env),pending:pending?{email:pending.actor_email,expiresAt:new Date(pending.expires_at).toISOString()}:null,connections:(await store.links(auth.key)).map(l=>({id:l.actor_hash,email:l.actor_email,approvedAt:l.approved_at,expiresAt:new Date(l.expires_at).toISOString()}))});
  }
  if(path==='/api/chatgpt/approve'&&request.method==='POST') {
    const body=await api.body(request),pending=await store.pending(body.code);
    if(body.confirmation!=='ALLOW_READ_ACCESS'||!pending)return json({error:'Confirm read access using an unexpired approval link.'},400);
    await store.approve(pending,auth.key);return json({connected:true});
  }
  if(path==='/api/chatgpt/revoke'&&request.method==='POST') {
    const body=await api.body(request);
    if(!/^[a-f0-9]{64}$/.test(body.id||''))return json({error:'Choose a connection to disconnect.'},400);
    await store.revoke(body.id,auth.key);return json({disconnected:true});
  }
  return json({error:'Not found.'},404);
}
