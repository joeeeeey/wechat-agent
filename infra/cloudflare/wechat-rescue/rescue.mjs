// Authenticated, opt-in rescue protocol. Never contains browser credentials.
export const DEVICE = 'work-mac-joey';
export const ACTIVE = "('requested','preparing','awaiting_scan')";
export const TTL = 120000;
export async function expire(DB, now = Date.now()) {
  await DB.prepare(`UPDATE rescue_attempt SET state='expired', envelope=NULL, public_key=NULL WHERE state IN ${ACTIVE} AND expires_at<=?`).bind(now).run();
}
export async function current(DB) {
  return DB.prepare('SELECT * FROM rescue_attempt WHERE device_id=?').bind(DEVICE).first();
}
export async function transition(DB, id, from, to, envelope = null, now = Date.now()) {
  return DB.prepare(`UPDATE rescue_attempt SET state=?, envelope=?, public_key=CASE WHEN ?='awaiting_scan' THEN public_key ELSE NULL END WHERE device_id=? AND id=? AND state=? AND expires_at>? RETURNING id`)
    .bind(to, envelope, to, DEVICE, id, from, now).first();
}
export async function claim(DB, id, now = Date.now()) {
  return DB.prepare("UPDATE rescue_attempt SET state='preparing' WHERE device_id=? AND id=? AND state='requested' AND expires_at>? RETURNING *").bind(DEVICE,id,now).first();
}
export function visible(row, owner, now = Date.now()) {
  if (!row || row.owner !== owner) return {state:'idle'};
  const expired = ['requested','preparing','awaiting_scan'].includes(row.state) && row.expires_at <= now;
  return {id:row.id,state:expired?'expired':row.state,expiresAt:row.expires_at,
    envelope:!expired && row.state==='awaiting_scan' ? JSON.parse(row.envelope) : null};
}
async function boundedJSON(request) {
  if (!request.body) throw new Error('Missing body');
  const reader=request.body.getReader(); let chunks=[], size=0;
  try {
    while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
      if(size>2048) { await reader.cancel(); throw new Error('Too large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;
  for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function routeRescue(request, env, owner, headers) {
  const path=new URL(request.url).pathname;
  const reply=(body,status=200)=>Response.json(body,{status,headers});
  if(env.RESCUE_QR_ENABLED!=='true')return reply({error:'Remote rescue is not enabled'},503);
  if(!['/api/rescue','/api/rescue/cancel'].includes(path))return reply({error:'Not found'},404);
  if(request.method!=='GET' && request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(request.method==='GET' && path!=='/api/rescue')return reply({error:'Method not allowed'},405);
  if(request.method==='POST' && (request.headers.get('Origin')!==new URL(request.url).origin ||
      request.headers.get('X-Rescue-Intent')!=='1' || request.headers.get('Content-Type')!=='application/json'))
    return reply({error:'Invalid request origin'},403);
  await expire(env.DB);
  if(request.method==='GET')return reply(visible(await current(env.DB),owner));
  let input;
  try {input=await boundedJSON(request);}catch{return reply({error:'Invalid body'},400);}
  if(path==='/api/rescue/cancel') {
    if(typeof input?.id!=='string')return reply({error:'Attempt required'},400);
    await env.DB.prepare(`UPDATE rescue_attempt SET state='cancelled', envelope=NULL, public_key=NULL WHERE device_id=? AND id=? AND owner=? AND state IN ${ACTIVE}`).bind(DEVICE,input.id,owner).run();
    return reply(visible(await current(env.DB),owner));
  }
  const key=input?.publicKey;
  // Only a browser-generated public RSA-2048 key. Reject all private key fields.
  if(!key || Object.keys(key).some(k=>!['kty','n','e'].includes(k)) || key.kty!=='RSA' ||
      !/^[A-Za-z0-9_-]{342}$/.test(key.n ?? '') || key.e!=='AQAB')return reply({error:'Invalid public key'},400);
  try {await crypto.subtle.importKey('jwk',key,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);}
  catch{return reply({error:'Invalid public key'},400);}
  const now=Date.now(), id=crypto.randomUUID();
  // One atomic statement checks fresh observed logout and enforces a 5-minute cooldown.
  const row=await env.DB.prepare(`INSERT INTO rescue_attempt(device_id,id,owner,state,created_at,expires_at,public_key,envelope)
    SELECT ?,?,?,'requested',?,?,?,NULL WHERE EXISTS (SELECT 1 FROM device_heartbeat
      WHERE device_id=? AND connection_state='login_required'
      AND julianday(received_at) BETWEEN julianday(?) - 90.0/86400 AND julianday(?) + 5.0/86400
      AND julianday(observed_at) BETWEEN julianday(?) - 90.0/86400 AND julianday(?) + 5.0/86400)
    ON CONFLICT(device_id) DO UPDATE SET id=excluded.id,owner=excluded.owner,state=excluded.state,
      created_at=excluded.created_at,expires_at=excluded.expires_at,public_key=excluded.public_key,envelope=NULL
    WHERE rescue_attempt.created_at<=? AND rescue_attempt.state NOT IN ${ACTIVE} RETURNING *`)
    .bind(DEVICE,id,owner,now,now+TTL,JSON.stringify(key),DEVICE,...Array(4).fill(new Date(now).toISOString()),now-300000).first();
  return row?reply(visible(row,owner),201):reply({error:'Requires fresh login-required state, no active attempt, and five-minute cooldown'},409);
}
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function sealPNG(bytes, publicKey, id) {
  if(bytes.length>65536 || ![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw new Error('Invalid QR image');
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)},key,bytes);
  const rsa=await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,await crypto.subtle.exportKey('raw',key));
  // Chunk encoding avoids argument limits for the ciphertext.
  const encode=buffer=>{let out='';for(const b of new Uint8Array(buffer))out+=String.fromCharCode(b);return btoa(out);};
  return {iv:b64(iv),key:encode(wrapped),data:encode(encrypted)};
}
export async function openPNG(envelope, privateKey, id) {
  const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,unb64(envelope.key));
  const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(envelope.iv),additionalData:new TextEncoder().encode(id)},key,unb64(envelope.data)));
}
