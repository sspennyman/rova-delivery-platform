import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('dist/client');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://127.0.0.1:5195');let p=u.pathname==='/'?'/index.html':u.pathname;if(!extname(p))p+='.html';const path=resolve(root,'.'+p);if(!path.startsWith(root+'/')){res.writeHead(403);res.end();return}try{const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}}).listen(5195,'127.0.0.1',()=>console.log('Rivo marketing preview: http://127.0.0.1:5195'));
