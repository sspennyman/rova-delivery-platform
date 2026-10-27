import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {localD1} from './local-d1.mjs';
const env={DB:localD1()};
async function request(path,body,token,headers={}){const r=await worker.fetch(new Request('https://app.floraljet.llc'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,data:await r.json()};}
async function tool(name,args={},actor='fixture-chat-a'){return request('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},null,actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':'chat@example.test'}:{});}
const register=email=>request('/api/auth/register',{name:'Fixture owner',companyName:email.startsWith('a')?'Alpha Fixture':'Beta Fixture',email,password:'fixture-password-123'});
try {
 const a=await register('alpha@example.test'),b=await register('beta@example.test');assert.equal(a.status,201);assert.equal(b.status,201);
 const token=a.data.session.token;
 assert.equal((await tool('rivo_connection_status',{},null)).status,401);
 assert.equal((await tool('rivo_dispatch_summary')).data.result.isError,true,'no workspace read before approval');
 const start=(await tool('rivo_connect_workspace')).data.result.structuredContent;
 const code=new URL(start.approvalUrl).searchParams.get('code');assert.ok(code);
 assert.equal((await request('/api/chatgpt/connection?code='+code)).status,401);
 assert.equal((await request('/api/chatgpt/approve',{code,confirmation:'ALLOW_READ_ACCESS'})).status,401);
 assert.equal((await request('/api/chatgpt/approve',{code},token)).status,400);
 assert.equal((await request('/api/chatgpt/approve',{code,confirmation:'ALLOW_READ_ACCESS'},token)).status,200);
 assert.equal((await request('/api/chatgpt/approve',{code,confirmation:'ALLOW_READ_ACCESS'},token)).status,400,'one-use approval');
 await request('/api/deliveries',{customerName:'Alpha recipient',pickup:'123 Fixture Road',destination:'456 Example Avenue'},token);
 await request('/api/deliveries',{customerName:'Beta private recipient',pickup:'123 Fixture Road',destination:'789 Private Avenue'},b.data.session.token);
 const summary=await tool('rivo_dispatch_summary');assert.equal(summary.data.result.structuredContent.workspace,'Alpha Fixture');
 const orders=(await tool('rivo_list_deliveries')).data.result.structuredContent;assert.equal(orders.orders.length,1);assert.equal(orders.orders[0].customerName,'Alpha recipient');assert.ok(!JSON.stringify(orders).includes('shareToken'));assert.ok(!JSON.stringify(orders).includes('Beta private'));
 assert.equal((await tool('rivo_list_deliveries',{limit:100})).data.result.isError,true);
 assert.equal((await tool('rivo_dispatch_summary',{},'fixture-chat-b')).data.result.isError,true,'other ChatGPT identities isolated');
 assert.equal((await tool('rivo_list_deliveries',{workspace:b.data.snapshot.company.workspaceKey})).data.result.isError,true,'caller cannot choose another workspace');
 const connection=(await request('/api/chatgpt/connection',null,token)).data.connections[0];
 await request('/api/chatgpt/revoke',{id:connection.id},b.data.session.token);
 assert.equal((await tool('rivo_connection_status')).data.result.structuredContent.connected,true,'other workspace cannot revoke approval');
 await request('/api/chatgpt/revoke',{id:connection.id},token);
 assert.equal((await tool('rivo_dispatch_summary')).data.result.isError,true,'revocation is immediate');
 const expiredStart=(await tool('rivo_connect_workspace')).data.result.structuredContent;
 await env.DB.prepare('UPDATE rivo_chat_approvals SET expires_at=0').run();
 assert.equal((await request('/api/chatgpt/approve',{code:new URL(expiredStart.approvalUrl).searchParams.get('code'),confirmation:'ALLOW_READ_ACCESS'},token)).status,400);
 const page=await worker.fetch(new Request('https://app.floraljet.llc/chatgpt/connect?code=fixture'),{ASSETS:{async fetch(r){return new URL(r.url).pathname==='/chatgpt-connect.html'?new Response(null,{status:308,headers:{Location:'/chatgpt-connect'}}):new Response('<h1>Connect ChatGPT</h1>');}}});assert.equal(page.status,200);assert.equal(page.headers.get('Location'),null);assert.equal(page.headers.get('Referrer-Policy'),'no-referrer');
 console.log('ChatGPT integration passed: explicit dispatcher consent, one-use/expired approval links, authenticated identity and workspace isolation, bounded read-only tools, credential-free projections and immediate revocation.');
}finally{env.DB.close();}
