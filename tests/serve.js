const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname),relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,relative);
  if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.writeHead(404);return response.end('Not found')}
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(response);
}).listen(4173,'127.0.0.1');
