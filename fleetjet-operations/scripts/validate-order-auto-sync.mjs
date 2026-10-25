import assert from 'node:assert/strict';
import {createOrderAutoSync} from '../public/order-auto-sync.js';
let time = 100000, calls = 0, fail = false, release;
let context = {role:'dispatcher',token:'workspace-a',visible:true,online:true,connected:true,editing:false};
const sync = createOrderAutoSync({getContext:()=>context,now:()=>time,request:async()=>{calls++;if(fail)throw Error('source offline');return {ok:true};}});
for (const patch of [{role:'driver'}, {visible:false}, {online:false}, {connected:false}, {editing:true}]) {
 const before={...context}; Object.assign(context,patch); assert.equal(await sync.run(),null); context=before;
}
assert.equal(calls,0);
assert.deepEqual(await sync.run(),{ok:true});assert.equal(calls,1);
assert.equal(await sync.run(),null); time+=60000;await sync.run();assert.equal(calls,2);
await sync.run({manual:true});assert.equal(calls,3,'manual refresh bypasses interval');
time+=60000;fail=true;await assert.rejects(sync.run());assert.equal(await sync.run(),null,'errors back off');
time+=60000;fail=false;await sync.run();assert.equal(calls,5,'retry recovers after failure');
const slow=createOrderAutoSync({getContext:()=>context,request:()=>new Promise(resolve=>release=resolve)});
const first=slow.run();await Promise.resolve();assert.equal(await slow.run({manual:true}),null,'no concurrent manual/automatic requests');
context={...context,token:'workspace-b'};release({snapshot:{private:'workspace-a'}});assert.equal(await first,null,'late data cannot cross workspace sessions');
console.log('Auto sync passed: visibility/offline/editing/role guards, one-minute polling, manual override, single-flight, error backoff and workspace isolation.');
