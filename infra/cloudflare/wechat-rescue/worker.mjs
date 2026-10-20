// QR payloads are encrypted to the initiating browser; no cookies or credentials.
import {routeRescue} from './rescue.mjs';
import {rescueClient,rescueHTML} from './rescue-ui.mjs';
const decoder = new TextDecoder();
const unbase64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let keyCache;
export async function authenticate(request, env, fetcher = fetch) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) throw new Error('Unauthorized');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Unauthorized');
  const header = JSON.parse(decoder.decode(unbase64(parts[0])));
  const claims = JSON.parse(decoder.decode(unbase64(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://${env.ACCESS_DOMAIN}`;
  if (header.alg !== 'RS256' || claims.iss !== issuer || !Number.isFinite(claims.exp) ||
      claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now) ||
      !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD) ||
      !JSON.parse(env.ALLOWED_EMAILS).includes(claims.email)) throw new Error('Unauthorized');
  if (!keyCache || keyCache.issuer !== issuer || keyCache.expires <= now) {
    const response = await fetcher(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error('Authentication unavailable');
    keyCache = { issuer, expires: now + 300, keys: (await response.json()).keys };
  }
  const jwk = keyCache.keys.find(key => key.kid === header.kid);
  if (!jwk) throw new Error('Unauthorized');
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unbase64(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]))) throw new Error('Unauthorized');
  return claims.email;
}
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
export function summarize(row, now = Date.now(), device = 'local-device') {
  const fresh = value => Number.isFinite(Date.parse(value)) && now - Date.parse(value) >= -5000 && now - Date.parse(value) <= 90000;
  const deviceOnline = !!row && fresh(row.received_at);
  const connection = deviceOnline && fresh(row.observed_at) && ['online','offline','disconnected','login_required'].includes(row.connection_state) ? row.connection_state : 'unknown';
  return {device, deviceOnline, connection,
    heartbeatAt: row?.received_at ?? null, observedAt: row?.observed_at ?? null,
    recoveredAt: row?.recovered_at ?? null};
}
const client = `const $=id=>document.getElementById(id);
const time=value=>value?new Date(value).toLocaleString():'暂无';
async function update(){
 try{
  const response=await fetch('/api/status',{cache:'no-store',redirect:'error'});
  if(!response.ok)throw new Error('unavailable');
  const s=await response.json();
  $('device').textContent=s.deviceOnline?'工作 Mac：心跳正常':'工作 Mac：未收到近期心跳';
  $('wechat').textContent='微信：'+({online:'在线',offline:'离线',disconnected:'连接中断',login_required:'需要重新登录',unknown:'状态未知或观测已过期'}[s.connection]||'状态未知');
  $('heartbeat').textContent=time(s.heartbeatAt);$('observed').textContent=time(s.observedAt);$('recovered').textContent=time(s.recoveredAt);
  $('help').textContent=!s.deviceOnline?'检查工作 Mac 是否开机、联网及心跳服务是否运行。':s.connection==='online'?'连接正常。手动重新登录后，本页会自动更新恢复状态。':s.connection==='unknown'?'本机心跳正常，但微信观测不可用。请在工作 Mac 检查微信页面和状态监测。':'请在工作 Mac 上完成微信登录；检测到恢复在线后，本页会自动显示确认时间。';
  $('updated').textContent='页面更新：'+new Date().toLocaleTimeString();
 }catch{ $('device').textContent='状态暂不可用';$('wechat').textContent='无法确认微信是否在线';$('help').textContent='请检查网络；邮箱登录会话过期时，重新打开救援页登录。';$('updated').textContent='本次更新失败，历史时间仅供参考'; }
}
$('refresh').addEventListener('click',update);update();setInterval(update,15000);`;
export default {
  async fetch(request, env) {
    let owner;
    try { owner = await authenticate(request, env); }
    catch { return new Response('Unauthorized', {status: 401, headers}); }
    if (new URL(request.url).pathname.startsWith('/api/rescue')) {
      try { return await routeRescue(request,env,owner,headers); }
      catch { return Response.json({error:'Rescue unavailable'},{status:503,headers}); }
    }
    if (request.method !== 'GET') return new Response('Method not allowed', {status: 405, headers});
    const path = new URL(request.url).pathname;
    if (path === '/rescue.js' && env.RESCUE_QR_ENABLED === 'true') return new Response(rescueClient,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
    if (path === '/app.js') return new Response(client, {headers: {...headers, 'Content-Type': 'text/javascript; charset=utf-8'}});
    if (path === '/api/status') {
      try {
        const row = await env.DB.prepare('SELECT connection_state, observed_at, received_at, recovered_at FROM device_heartbeat WHERE device_id = ?').bind(env.DEVICE_ID || 'local-device').first();
        return Response.json(summarize(row, Date.now(), env.DEVICE_ID || 'local-device'), {headers});
      } catch { return Response.json({error: 'Status unavailable'}, {status: 503, headers}); }
    }
    if (path !== '/') return new Response('Not found', {status: 404, headers});
    return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小助手 · 微信状态</title><style>body{font-family:system-ui;max-width:680px;margin:6vh auto;padding:20px;background:#f5f4ef;color:#26352c}main{background:white;padding:28px;border-radius:20px}p{line-height:1.8}button{padding:12px 20px;border-radius:10px;border:1px solid #789;background:#edf4ef;cursor:pointer}dt{margin-top:14px;color:#58675f}dd{margin:4px 0;overflow-wrap:anywhere}small{color:#58675f}</style><main><h1>🐱 小助手 · 微信状态</h1><p>工作设备状态</p><section aria-live="polite"><h2 id="device">正在读取设备状态…</h2><p id="wechat">微信状态待确认</p><p id="help">正在连接状态服务。</p></section><dl><dt>设备最后心跳</dt><dd id="heartbeat">暂无</dd><dt>微信最后观测</dt><dd id="observed">暂无</dd><dt>最近一次恢复在线确认</dt><dd id="recovered">暂无</dd></dl><p><button id="refresh">更新状态</button></p><small id="updated">每 15 秒自动更新；超过 90 秒未收到心跳会显示失联。</small><p>${env.RESCUE_QR_ENABLED === 'true' ? '扫码救援已启用；仅响应本页主动发起的短时请求。' : '这是状态监测页。需要重新登录时，请在工作 Mac 操作微信；本页不提供扫码或远程操作。'}</p>${env.RESCUE_QR_ENABLED === 'true' ? rescueHTML : ''}<noscript>请启用 JavaScript 以查看实时状态。</noscript></main><script src="/app.js" defer></script></html>`,
      {headers: {...headers, 'Content-Type': 'text/html; charset=utf-8'}});
  }
};
