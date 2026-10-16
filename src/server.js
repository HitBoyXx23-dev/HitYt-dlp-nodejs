import http from 'node:http';
import { resolve, videoId } from './index.js';
const host = process.env.HITYT_HOST || '127.0.0.1';
const port = Number(process.env.HITYT_PORT || 8788);
const token = process.env.HITYT_API_TOKEN;
const server = http.createServer(async (req,res) => {
  const send = (status,obj) => {res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));};
  if (token && req.headers.authorization !== `Bearer ${token}`) return send(401,{error:'Unauthorized'});
  if (req.method==='GET' && req.url==='/health') return send(200,{ok:true,engine:'hityt-node'});
  if (req.method!=='POST' || req.url!=='/api/resolve') return send(404,{error:'Not found'});
  try {
    let body=''; for await (const chunk of req) {body+=chunk; if(body.length>8192) throw Error('Request too large');}
    const {url,resolver='auto'}=JSON.parse(body);
    videoId(url);
    const data=await resolve(url,{resolver});
    return send(200,data);
  } catch(e) {return send(400,{error:e.message,details:e.errors?.map(x=>x.message)});}
});
server.listen(port,host,()=>console.log(`HitYt Node API http://${host}:${port}`));
