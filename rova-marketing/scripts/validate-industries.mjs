import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const names=['florists','retail','food-delivery','courier-teams'];
const home=await readFile(new URL('index.html',root),'utf8');
const hub=await readFile(new URL('industries.html',root),'utf8');
const sitemap=await readFile(new URL('sitemap.xml',root),'utf8');
assert.match(home,/href="\/industries"/);
for(const name of names){
  const page=await readFile(new URL(name+'.html',root),'utf8');
  assert.match(home,new RegExp('href="/'+name+'"'));
  assert.match(hub,new RegExp('href="/'+name+'"'));
  assert.match(sitemap,new RegExp('https://floraljet.llc/'+name));
  assert.equal((page.match(/<h1>/g)||[]).length,1);
  assert.match(page,/7 days free/);
  assert.match(page,/app.floraljet.llc\/signup/);
  assert.match(page,/ILLUSTRATIVE DELIVERY WORKFLOW/);
  assert.match(page,/local demonstration data/);
  assert.doesNotMatch(page,/14.day|14 days|testimonials|trusted by|millions|HIPAA/);
}
for(const file of ['index.html','pricing.html','contact.html'])assert.doesNotMatch(await readFile(new URL(file,root),'utf8'),/14.day|14 days/);
console.log('Industry pages, navigation, product captions, seven-day offer and sitemap passed.');
