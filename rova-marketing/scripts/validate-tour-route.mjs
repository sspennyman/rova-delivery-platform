import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const svg=html.match(/<div class="tour-map"><svg[^]*?<\/svg>/)[0];
const path=svg.match(/data-tour-route[^>]*d="([^"]+)"/)[1];
const streets=svg.match(/class="tour-street" d="([^"]+)"/)[1];
function segments(d){let x=0,y=0,result=[];for(const [,cmd,values] of d.matchAll(/([MHV])([\d .,-]+)/g)){const n=values.trim().split(/[ ,]+/).map(Number);if(cmd==='M'){[x,y]=n;continue;}const nx=cmd==='H'?n[0]:x,ny=cmd==='V'?n[0]:y;result.push([x,y,nx,ny]);x=nx;y=ny;}return result;}
const roads=segments(streets), route=segments(path);
const blocks=[...svg.match(/class="tour-blocks">([^]*?)<\/g>/)[1].matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map(m=>m.slice(1).map(Number));
for(const [x,y,nx,ny] of route){
 assert.ok(roads.some(([a,b,c,d])=>y===ny&&b===d&&y===b&&Math.min(x,nx)>=Math.min(a,c)&&Math.max(x,nx)<=Math.max(a,c)||x===nx&&a===c&&x===a&&Math.min(y,ny)>=Math.min(b,d)&&Math.max(y,ny)<=Math.max(b,d)),'each route segment follows a drawn street');
 const steps=Math.ceil(Math.hypot(nx-x,ny-y));for(let i=0;i<=steps;i++){const px=x+(nx-x)*i/steps,py=y+(ny-y)*i/steps;for(const [bx,by,w,h] of blocks){const dx=px-Math.max(bx,Math.min(px,bx+w)),dy=py-Math.max(by,Math.min(py,by+h));assert.ok(Math.hypot(dx,dy)>=16,'vehicle including outline never overlaps a building');}}
}
console.log('Tour route geometry passed: every segment follows a street and the vehicle clears every building.');
