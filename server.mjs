import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, open } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const folder = process.env.VIDEO_DIR;
const password = process.env.ADMIN_PASSWORD;
if (!folder || !password) throw Error('Set VIDEO_DIR and ADMIN_PASSWORD before starting');
await mkdir(folder, {recursive:true});
const db = new DatabaseSync(join(folder, 'catalog.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT, nationality TEXT, description TEXT, extension TEXT)');
const rows = db.prepare('SELECT * FROM videos ORDER BY rowid DESC');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'};
const assets = new Set(['index.html','admin.html','videos.js','firstcare-home-banner.jpg','firstcare-logo.png',...['ph','mg','mm','lk','id','in','tz','ke'].map(code=>code+'.svg')]);
const digest = value => createHash('sha256').update(value).digest();
const limit = 100 * 1024 * 1024;
function reply(res,status,message='') {res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(message)}
async function serve(req,res,file) {
 const {size}=await stat(file);
 const headers={'Content-Type':types[extname(file)],'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
 let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if(m && m[1]) {start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end}
  else if(m && m[2]) start=Math.max(0,size-Number(m[2]));
  if(!m || !(m[1]||m[2]) || start>end){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return}
  status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
 }
 res.writeHead(status,{...headers,'Content-Length':end-start+1});
 if(req.method==='HEAD'||!size)return res.end();
 await pipeline(createReadStream(file,{start,end}),res);
}
async function handler(req,res){
 const url=new URL(req.url,'http://localhost');
 const path=url.pathname;
 if(['GET','HEAD'].includes(req.method)){
  if(path==='/api/videos'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   return res.end(JSON.stringify(rows.all().map(v=>({...v,type:'mp4',url:'/media/'+v.id+v.extension}))));
  }
  const name=path==='/'?'index.html':path.slice(1);
  if(assets.has(name))return serve(req,res,join(root,name));
  if(/^\/media\/[a-f0-9-]{36}\.(mp4|webm|mov)$/.test(path)){
   const id=path.slice(7,43),v=db.prepare('SELECT extension FROM videos WHERE id=?').get(id);
   if(v && v.extension===extname(path))return serve(req,res,join(folder,path.slice(7)));
  }
  return reply(res,404);
 }
 if(path!=='/api/videos' && !/^\/api\/videos\/[a-f0-9-]{36}$/.test(path))return reply(res,404);
 if(!timingSafeEqual(digest(req.headers.authorization||''),digest('Bearer '+password)))return reply(res,401,'كلمة مرور الإدارة غير صحيحة.');
 if(req.method==='DELETE' && path.startsWith('/api/videos/')){
  const id=path.split('/').pop(),v=db.prepare('SELECT extension FROM videos WHERE id=?').get(id);
  if(!v)return reply(res,404);
  db.prepare('DELETE FROM videos WHERE id=?').run(id);
  await unlink(join(folder,id+v.extension));
  return reply(res,204);
 }
 if(req.method!=='POST'||path!=='/api/videos')return reply(res,405);
 const size=Number(req.headers['content-length']);
 if(!Number.isSafeInteger(size)||size<=0||size>limit)return reply(res,413,'اختر فيديو حجمه ١٠٠ ميجابايت أو أقل.');
 const info=['title','nationality','description'].map(k=>url.searchParams.get(k)?.trim()||'');
 const ext=url.searchParams.get('ext');
 if(!info[0]||!info[1]||info[0].length>120||info[1].length>60||info[2].length>1500||!['.mp4','.mov','.webm'].includes(ext))return reply(res,400,'تحقق من بيانات الفيديو وصيغته.');
 const id=randomUUID(),file=join(folder,id+ext);
 try{
  await pipeline(req,createWriteStream(file,{flags:'wx'}));
  const fd=await open(file);
  const header=Buffer.alloc(12);
  try{await fd.read(header,0,12,0)}finally{await fd.close()}
  const valid=ext==='.webm'?header.readUInt32BE(0)===0x1a45dfa3:['ftyp','moov','mdat','wide','free'].includes(header.toString('ascii',4,8));
  if(!valid){await unlink(file);return reply(res,415,'الملف ليس فيديو بالصيغة المحددة.')}
  db.prepare('INSERT INTO videos VALUES (?,?,?,?,?)').run(id,...info,ext);
 }catch(err){await unlink(file).catch(()=>{});throw err}
 reply(res,201);
}
http.createServer((req,res)=>handler(req,res).catch(err=>{
 if(!res.headersSent&&!res.destroyed)reply(res,err.code==='ENOENT'?404:500,'تعذر إتمام العملية.');
 else res.destroy();
})).listen(Number(process.env.PORT||3000),'0.0.0.0');
