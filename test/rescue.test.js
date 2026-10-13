import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {routeRescue,current,expire,claim,transition,sealPNG,openPNG,visible} from '../infra/cloudflare/wechat-rescue/rescue.mjs';
import {RescueDevice,ExistingLoginScreen} from '../src/rescue-device.js';
import {RescueD1} from '../src/rescue-d1.js';
import {chromium} from 'playwright';
const schema=readFileSync(new URL('../infra/cloudflare/wechat-rescue/schema.sql',import.meta.url),'utf8');
export function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
 return {sqlite,prepare:sql=>({bind:(...params)=>({first:async()=>sqlite.prepare(sql).get(...params)??null,run:async()=>sqlite.prepare(sql).run(...params)})})};
}
const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
const {kty,n,e}=await crypto.subtle.exportKey('jwk',pair.publicKey),publicKey={kty,n,e};
function heartbeat(DB,state='login_required',time=new Date().toISOString()){
 DB.sqlite.prepare('INSERT OR REPLACE INTO device_heartbeat VALUES (?,?,?,?,NULL)').run('local-device',state,time,time);
}
async function api(DB,method='POST',body={publicKey},options={}){
 const {owner='owner@example.com',path='/api/rescue',enabled='true',headers={}}=options;
 return routeRescue(new Request('https://rescue.example'+path,{method,headers:{Origin:'https://rescue.example','X-Rescue-Intent':'1','Content-Type':'application/json',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{DB,RESCUE_QR_ENABLED:enabled},owner,{'Cache-Control':'no-store'});
}
async function setup(){const DB=database();heartbeat(DB);const r=await api(DB);assert.equal(r.status,201);return {DB,row:await r.json()};}
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]); // encryption fixture only, not a QR

test('disabled feature, cross-origin, missing intent, oversized and private-key bodies rejected',async()=>{
 const DB=database();heartbeat(DB);
 assert.equal((await api(DB,'POST',{publicKey},{enabled:'false'})).status,503);
 for(const headers of [{Origin:'https://evil.example'},{'X-Rescue-Intent':''},{'Content-Type':'text/plain'}])assert.equal((await api(DB,'POST',{publicKey},{headers})).status,403);
 assert.equal((await api(DB,'POST',' '.repeat(2049))).status,400);
 assert.equal((await api(DB,'POST',{publicKey:{...publicKey,d:'private'}})).status,400);
 assert.equal(await current(DB),null);
});
test('fresh online or login-required observations allow explicit QR generation',async()=>{
 for(const state of ['offline','unknown','disconnected']){
  const DB=database();heartbeat(DB,state);assert.equal((await api(DB)).status,409);
 }
 for(const time of [new Date(Date.now()-100000).toISOString(),new Date(Date.now()+100000).toISOString(),'bad']){
  const DB=database();heartbeat(DB,'login_required',time);assert.equal((await api(DB)).status,409);
 }
 assert.equal((await api(database())).status,409);
 const online=database();heartbeat(online,'online');assert.equal((await api(online)).status,201);
});
test('concurrent requests admit exactly one; cancel is owner/id-bound; cooldown survives cancellation',async()=>{
 const DB=database();heartbeat(DB);
 const responses=await Promise.all([api(DB),api(DB)]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const row=await current(DB);
 assert.deepEqual(await (await api(DB,'GET',null,{owner:'other@example.com'})).json(),{state:'idle'});
 await api(DB,'POST',{id:row.id},{path:'/api/rescue/cancel',owner:'other@example.com'});
 assert.equal((await current(DB)).state,'requested');
 await api(DB,'POST',{id:'old-attempt'},{path:'/api/rescue/cancel'});
 assert.equal((await current(DB)).state,'requested');
 await api(DB,'POST',{id:row.id},{path:'/api/rescue/cancel'});
 assert.equal((await current(DB)).state,'cancelled');
 assert.equal((await current(DB)).public_key,null);
 assert.equal((await api(DB)).status,409);
 DB.sqlite.exec('UPDATE rescue_attempt SET created_at=0');
 assert.equal((await api(DB)).status,201);
});
test('encryption only opens with initiating key and attempt id; rejects non-PNG/oversize',async()=>{
 const envelope=await sealPNG(png,publicKey,'one');
 assert.deepEqual(await openPNG(envelope,pair.privateKey,'one'),png);
 await assert.rejects(()=>openPNG(envelope,pair.privateKey,'two'));
 const other=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['decrypt','encrypt']);
 await assert.rejects(()=>openPNG(envelope,other.privateKey,'one'));
 await assert.rejects(()=>sealPNG(new Uint8Array(65537),publicKey,'one'));
 await assert.rejects(()=>sealPNG(new Uint8Array(10),publicKey,'one'));
});
test('cancel/expiry fence late device writes and clear encrypted payload',async()=>{
 const {DB,row}=await setup();await claim(DB,row.id);
 assert.equal(await claim(DB,row.id),null);
 await api(DB,'POST',{id:row.id},{path:'/api/rescue/cancel'});
 assert.equal(await transition(DB,row.id,'preparing','awaiting_scan','{}'),null);
 DB.sqlite.prepare("UPDATE rescue_attempt SET state='awaiting_scan',envelope='{}',public_key='{}',expires_at=0").run();
 assert.equal(visible(await current(DB),'owner@example.com').envelope,null);
 await expire(DB);
 assert.equal((await current(DB)).state,'expired');assert.equal((await current(DB)).envelope,null);
 assert.equal(await transition(DB,row.id,'awaiting_scan','completed'),null);
});
test('device requires acknowledged intake pause and fails closed without image reads',async()=>{
 for(const state of ['online','unknown','login_required']){
  const {DB}=await setup();let reads=0;
  const device=new RescueDevice({DB,screen:{state:async()=>state,qrPNG:async()=>{reads++;return png;}},intake:{pause:async()=>{},isPaused:async()=>false}});
  await device.tick();assert.equal((await current(DB)).state,'failed');assert.equal(reads,0);
 }
});
test('cancellation during intake pause prevents pixel read',async()=>{
 const {DB,row}=await setup();let reads=0;
 const device=new RescueDevice({DB,screen:{state:async()=>'login_required',qrPNG:async()=>{reads++;return png;}},intake:{pause:async()=>{await api(DB,'POST',{id:row.id},{path:'/api/rescue/cancel'});},isPaused:async()=>true}});
 await device.tick();assert.equal(reads,0);assert.equal((await current(DB)).state,'cancelled');
});
test('isolated DOM: capture only dummy square, encrypt, await observed online, clear payload',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try {
  const page=await browser.newPage();
  await page.setContent('<div id="login"><div id="qr" style="width:128px;height:128px;background:#246"></div></div>');
  const screen=new ExistingLoginScreen(page,{online:'#chat',login:'#login',qr:'#qr'});
  const {DB,row}=await setup();let paused=false;
  const device=new RescueDevice({DB,screen,intake:{pause:async()=>{paused=true;},isPaused:async()=>paused,resume:async()=>{paused=false;}}});
  await Promise.all([device.tick(),device.tick()]);
  const ready=await current(DB);assert.equal(ready.state,'awaiting_scan');assert.equal(paused,true);
  const bytes=await openPNG(JSON.parse(ready.envelope),pair.privateKey,row.id);assert.equal(bytes[0],137);
  await device.tick();assert.equal((await current(DB)).envelope,ready.envelope,'Unchanged QR is not republished');
  await page.locator('#qr').evaluate(n=>n.style.background='#642');await device.tick();
  assert.notEqual((await current(DB)).envelope,ready.envelope,'Changed QR updates the same rescue attempt');
  await page.locator('#login').evaluate(n=>n.remove());await device.tick();
  assert.equal((await current(DB)).state,'awaiting_scan'); // QR absence alone is not success
  await page.setContent('<textarea id="chat"></textarea>');await device.tick();
  assert.equal((await current(DB)).state,'completed');assert.equal((await current(DB)).envelope,null);
  assert.equal(paused,false); // verified online resumes only through the supplied intake adapter
 }finally{await browser.close();}
});
test('D1 adapter uses bounded authenticated POST and redacts API errors',async()=>{
 let call;
 const DB=new RescueD1({account:'a'.repeat(32),database:'b'.repeat(8)+'-1111-1111-1111-'+ 'b'.repeat(12),token:'fixture-only',fetcher:async(url,opts)=>{call={url,opts};return Response.json({success:true,result:[{success:true,results:[{id:'one'}]}]});}});
 assert.deepEqual(await DB.prepare('SELECT ?').bind(1).first(),{id:'one'});
 assert.equal(call.opts.redirect,'error');assert.deepEqual(JSON.parse(call.opts.body),{sql:'SELECT ?',params:[1]});
 DB.fetcher=async()=>{throw Error('private failure');};
 await assert.rejects(()=>DB.prepare('SELECT 1').bind().run(),{message:'Rescue database unavailable'});
});

test('isolated rescue web UI: initiate, decrypt dummy image, cancel and hide it',async()=>{
 const {rescueHTML,rescueClient}=await import('../infra/cloudflare/wechat-rescue/rescue-ui.mjs');
 const DB=database();heartbeat(DB);
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try {
  const page=await browser.newPage();let errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://rescue.example/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(path.startsWith('/api/rescue')){
    const response=await routeRescue(new Request(r.url(),{method:r.method(),headers:await r.allHeaders(),...(r.method()==='POST'?{body:r.postData()}: {})}),{DB,RESCUE_QR_ENABLED:'true'},'owner@example.com',{'Cache-Control':'no-store'});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});return;
   }
   await route.fulfill({headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'"},contentType:path==='/rescue.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8',body:path==='/rescue.js'?rescueClient:'<!doctype html><html><meta charset="utf-8"><body>'+rescueHTML+'</body></html>'});
  });
  await page.goto('https://rescue.example/');await page.locator('#rescue-start').click();
  await page.waitForFunction(()=>document.querySelector('#rescue-state').textContent!=='尚未发起',null,{timeout:5000});
  assert.equal(await page.locator('#rescue-state').textContent(),'等待工作 Mac 接收',JSON.stringify({errors,row:await current(DB)}));
  const row=await current(DB);await claim(DB,row.id);
  const dummy=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const envelope=await sealPNG(dummy,JSON.parse(row.public_key),row.id);
  await transition(DB,row.id,'preparing','awaiting_scan',JSON.stringify(envelope));
  await page.waitForFunction(()=>{const img=document.querySelector('#rescue-qr');return !img.hidden && img.naturalWidth===1;});
  const firstURL=await page.locator('#rescue-qr').getAttribute('src');
  const changed=await sealPNG(dummy,JSON.parse(row.public_key),row.id);
  await transition(DB,row.id,'awaiting_scan','awaiting_scan',JSON.stringify(changed));
  await page.waitForFunction(first=>document.querySelector('#rescue-qr').src!==first,firstURL);
  await page.locator('#rescue-cancel').click();
  await page.waitForFunction(()=>document.querySelector('#rescue-state').textContent==='已取消救援');
  assert.equal(await page.locator('#rescue-qr').isVisible(),false);
  assert.equal((await current(DB)).state,'cancelled');assert.equal((await current(DB)).envelope,null);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('expired login QR refresh uses only its visible control, never page navigation',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage();
  await page.setContent('<div id="login"><div id="qr" style="width:128px;height:128px;background:#246"></div><button id="refresh">刷新</button></div>');
  await page.locator('#refresh').evaluate(e=>e.onclick=()=>e.remove());
  const screen=new ExistingLoginScreen(page,{online:'#chat',login:'#login',qr:'#qr',refresh:'#refresh'});
  let navigations=0;page.on('framenavigated',()=>navigations++);
  const bytes=await screen.qrPNG();assert.equal(bytes[0],137);assert.equal(await page.locator('#refresh').count(),0);assert.equal(navigations,0);
 }finally{await browser.close();}
});

test('configured device ID scopes rescue requests and device polling',async()=>{
 const DB=database(),device='custom-computer',time=new Date().toISOString();
 DB.sqlite.prepare('INSERT INTO device_heartbeat VALUES (?,?,?,?,NULL)').run(device,'login_required',time,time);
 const request=new Request('https://rescue.example/api/rescue',{method:'POST',headers:{Origin:'https://rescue.example','X-Rescue-Intent':'1','Content-Type':'application/json'},body:JSON.stringify({publicKey})});
 const response=await routeRescue(request,{DB,DEVICE_ID:device,RESCUE_QR_ENABLED:'true'},'owner@example.com',{});
 assert.equal(response.status,201);
 assert.equal(await current(DB),null);
 assert.equal((await current(DB,device)).device_id,device);
 const agent=new RescueDevice({DB,deviceId:device,screen:{state:async()=> 'online'},intake:{}});
 await agent.tick();
 assert.equal((await current(DB,device)).state,'failed');
});
