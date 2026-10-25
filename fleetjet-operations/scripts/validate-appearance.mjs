import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('public/appearance.js','utf8');
function setup({hour=12,cookie='',saved='',blocked=false}={}){
 let currentHour=hour,cookies=cookie;const store=new Map([['rivoAppearanceV1',saved]]),events={},intervals=[];
 const root={dataset:{}};
 const doc={documentElement:root,readyState:'loading',querySelectorAll:()=>[],addEventListener(name,fn){events[name]=fn}};
 Object.defineProperty(doc,'cookie',{get:()=>cookies,set:value=>{if(blocked)throw Error('blocked');cookies=value.split(';')[0];}});
 const window={addEventListener(name,fn){events[name]=fn}};
 const context=vm.createContext({document:doc,window,location:{hostname:'app.floraljet.llc',protocol:'https:'},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},Date:class extends Date{getHours(){return currentHour}},Set,MutationObserver:class{},setInterval(fn){intervals.push(fn)}});
 vm.runInContext(source,context);
 return {api:window.RivoAppearance,root,store,getCookie:()=>cookies,setCookie:value=>{cookies=value},at:h=>{currentHour=h;intervals.forEach(fn=>fn())}};
}
const auto=setup({hour:6});assert.equal(auto.root.dataset.theme,'dark');auto.at(7);assert.equal(auto.root.dataset.theme,'light');auto.at(18);assert.equal(auto.root.dataset.theme,'light');auto.at(19);assert.equal(auto.root.dataset.theme,'dark');auto.at(23);assert.equal(auto.root.dataset.theme,'dark');
auto.api.setPreference('light');auto.at(23);assert.equal(auto.root.dataset.theme,'light');assert.equal(auto.store.get('rivoAppearanceV1'),'light');assert.equal(auto.getCookie(),'rivo_theme=light');
auto.api.setPreference('dark');auto.at(12);assert.equal(auto.root.dataset.theme,'dark');
auto.api.setPreference('auto');assert.equal(auto.root.dataset.theme,'light');
const shared=setup({cookie:'rivo_theme=dark',saved:'light'});assert.equal(shared.root.dataset.theme,'dark','shared domain cookie wins over stale per-origin storage');shared.setCookie('rivo_theme=light');shared.at(22);assert.equal(shared.root.dataset.theme,'light','native/browser preference changes are picked up without reload');
const invalid=setup({saved:'not-a-theme',hour:12});assert.equal(invalid.api.getPreference(),'auto');invalid.api.setPreference('not-a-theme');assert.equal(invalid.root.dataset.theme,'light');
const noCookies=setup({blocked:true});noCookies.api.setPreference('dark');assert.equal(noCookies.root.dataset.theme,'dark','cookie blocking cannot break the display control');
assert.equal(fs.readFileSync((fs.existsSync('../rivo-site')?'../rivo-site':'../rova-marketing')+'/assets/appearance.js','utf8'),source,'site/app share the same preference behavior');
assert.equal(fs.readFileSync((fs.existsSync('../rivo-site')?'../rivo-site':'../rova-marketing')+'/assets/appearance.css','utf8'),fs.readFileSync('public/appearance.css','utf8'));
console.log('Appearance passed: local-time 7/19 boundaries, manual overrides, persistence, cross-origin cookie preference, native changes without reload, invalid values and blocked-cookie fallback.');
