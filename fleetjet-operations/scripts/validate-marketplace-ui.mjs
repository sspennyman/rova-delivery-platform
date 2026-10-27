import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const paths=[];
const env={ASSETS:{async fetch(request){const url=new URL(request.url);paths.push(url.pathname);return url.pathname==='/marketplace.html'?new Response(null,{status:308,headers:{Location:'/marketplace'+url.search}}):new Response('<h1>Connect your store</h1>',{headers:{'Content-Type':'text/html'}});}}};
for(const provider of ['wix','shopify']) {
 const response=await worker.fetch(new Request('https://app.floraljet.llc/marketplace/'+provider+'?instance=fixture'),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.match(await response.text(),/Connect your store/);
 if(provider==='wix'){assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors https:\/\/manage.wix.com/);assert.equal(response.headers.get('X-Frame-Options'),null);}
 else assert.equal(response.headers.get('X-Frame-Options'),'DENY');
}
assert.deepEqual(paths,['/marketplace.html','/marketplace','/marketplace.html','/marketplace']);
console.log('Marketplace setup passed: canonical asset redirects resolved internally, provider URLs preserved, setup uncached, Wix-only iframe allowance.');
