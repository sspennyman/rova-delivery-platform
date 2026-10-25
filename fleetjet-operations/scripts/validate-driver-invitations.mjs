import assert from 'node:assert/strict';
import {sendDriverInvite} from '../worker/driver-invitations.js';
const env={RESEND_API_KEY:'fake-provider-secret-sentinel',INVITE_FROM_EMAIL:'Rivo <invites@example.test>'};
const driver={name:'Test driver',email:'driver@example.test',inviteTokenHash:'test-hash'};
const url='https://example.test/operations?invite=test-only';
let calls=0;
assert.equal((await sendDriverInvite({},driver,url,()=>{calls++;})).sent,false);
assert.equal(calls,0);
let first;
const successful=async(endpoint,options)=>{ assert.equal(endpoint,'https://api.resend.com/emails'); assert.equal(options.redirect,'error'); assert.ok(options.signal); const payload=JSON.parse(options.body); assert.deepEqual(payload.to,[driver.email]); assert.ok(payload.text.includes(url)); assert.ok(!payload.text.includes(env.RESEND_API_KEY)); first ??=options.headers['idempotency-key']; assert.equal(options.headers['idempotency-key'],first); return Response.json({id:'provider-test-id'}); };
assert.equal((await sendDriverInvite(env,driver,url,successful)).providerMessageId,'provider-test-id');
assert.equal((await sendDriverInvite(env,driver,url,successful)).sent,true);
for(const status of [401,403,429,500]){const r=await sendDriverInvite(env,driver,url,async()=>new Response('private provider detail',{status}));assert.equal(r.sent,false);assert.ok(!r.reason.includes('private provider detail'));}
assert.equal((await sendDriverInvite(env,driver,url,async()=>Response.json({}))).sent,false);
assert.equal((await sendDriverInvite(env,driver,url,async()=>{throw Error('secret details');})).sent,false);
console.log('Driver invitation checks passed: setup failure, exact recipient/link, timeout, no redirects, idempotency, provider acceptance validation and private error redaction. Inbox receipt remains an external test.');
