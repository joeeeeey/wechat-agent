import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker, {authenticate} from './worker.mjs';
const env = {ACCESS_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'rescue-test', ALLOWED_EMAILS: '["owner@example.com"]'};
const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test'};
const certs = async () => Response.json({keys:[jwk]});
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function request(overrides={}) {
  const claims = {iss:'https://'+env.ACCESS_DOMAIN,aud:[env.ACCESS_AUD],email:'owner@example.com',exp:Math.floor(Date.now()/1000)+60,...overrides};
  const input = encode({alg:'RS256',kid:'test'})+'.'+encode(claims);
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input))).toString('base64url');
  return new Request('https://rescue.example.com/',{headers:{'Cf-Access-Jwt-Assertion':input+'.'+sig}});
}
test('valid signed allowlisted identity accepted',async()=>assert.equal(await authenticate(await request(),env,certs),'owner@example.com'));
for (const [label,overrides] of Object.entries({expired:{exp:1},wrongIssuer:{iss:'https://attacker.example'},wrongAudience:{aud:['wrong']},unlisted:{email:'other@example.com'},future:{nbf:Math.floor(Date.now()/1000)+600}})) {
  test(label+' rejected',async()=>assert.rejects(()=>request(overrides).then(r=>authenticate(r,env,certs))));
}
test('forged signature rejected',async()=>{
  const r=await request(); const p=r.headers.get('Cf-Access-Jwt-Assertion').split('.');
  p[2]=Buffer.alloc(256).toString('base64url');
  await assert.rejects(()=>authenticate(new Request(r,{headers:{'Cf-Access-Jwt-Assertion':p.join('.')}}),env,certs));
});
test('unauthenticated request never reads database',async()=>{
  const response=await worker.fetch(new Request('https://rescue.example.com/'),env);
  assert.equal(response.status,401); assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('fresh online, disconnected, stale device, stale observation and absent device', async()=>{
  const {summarize}=await import('./worker.mjs');
  const now=Date.now(), fresh=new Date(now-10000).toISOString(), old=new Date(now-100000).toISOString();
  const row={connection_state:'online',observed_at:fresh,received_at:fresh,recovered_at:null};
  assert.equal(summarize(row,now).connection,'online');
  assert.equal(summarize({...row,connection_state:'disconnected'},now).connection,'disconnected');
  assert.equal(summarize({...row,received_at:old},now).deviceOnline,false);
  assert.equal(summarize({...row,observed_at:old},now).connection,'unknown');
  assert.equal(summarize({...row,observed_at:'bad'},now).connection,'unknown');
  assert.equal(summarize(null,now).deviceOnline,false);
});
test('authenticated status returns telemetry and handles database failure',async()=>{
  const r=await request();await authenticate(r,env,certs);
  const req=new Request('https://rescue.example.com/api/status',{headers:r.headers});
  const row={connection_state:'online',observed_at:new Date().toISOString(),received_at:new Date().toISOString()};
  const DB={prepare:()=>({bind:()=>({first:async()=>row})})};
  const response=await worker.fetch(req,{...env,DB});
  assert.equal(response.status,200);assert.equal((await response.json()).connection,'online');
  const broken={prepare:()=>{throw Error('private database details');}};
  const failure=await worker.fetch(req,{...env,DB:broken});
  assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/private/);
});
test('status and script endpoints require authentication',async()=>{
  for(const path of ['/api/status','/app.js'])assert.equal((await worker.fetch(new Request('https://rescue.example.com'+path),env)).status,401);
});
