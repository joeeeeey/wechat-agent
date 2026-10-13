import {openPNG} from './rescue.mjs';
export const rescueHTML=`<section><h2>微信扫码恢复</h2><p>微信掉线后，点击下方按钮获取这台电脑当前的登录二维码。二维码变化时会自动更新，最多展示两分钟；请用手机微信扫码并确认。登录成功后自动恢复接收新任务，不重复执行旧消息。</p><button id="rescue-start">显示登录二维码</button> <button id="rescue-cancel" disabled>取消</button><p id="rescue-state" aria-live="polite">尚未发起</p><img id="rescue-qr" hidden alt="本次微信登录二维码" width="256" height="256"></section><script src="/rescue.js" defer></script>`;
export const rescueClient=`(()=>{
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const openPNG=${openPNG.toString()};
const start=document.getElementById('rescue-start'),cancel=document.getElementById('rescue-cancel'),
 status=document.getElementById('rescue-state'),img=document.getElementById('rescue-qr');
let attempt=null,key=null,url=null,timer=null,deadline=null,generation=0,lastEnvelope=null;
function clearImage(){img.hidden=true;img.removeAttribute('src');if(url)URL.revokeObjectURL(url);url=null;lastEnvelope=null;}
function stop(){generation++;clearImage();clearTimeout(timer);clearTimeout(deadline);key=null;attempt=null;cancel.disabled=true;start.disabled=false;}
async function api(path,body){const response=await fetch(path,{cache:'no-store',redirect:'error',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Rescue-Intent':'1'},body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('暂不可用（'+response.status+'）');return response.json();}
async function poll(epoch){
 try{
  const s=await api('/api/rescue');if(epoch!==generation)return;
  if(s.id!==attempt || Date.now()>=s.expiresAt){stop();status.textContent='救援已结束或过期';return;}
  const names={requested:'等待工作 Mac 接收',preparing:'正在准备扫码',awaiting_scan:'请用手机微信扫码并确认登录',completed:'微信已在线，正在恢复接收新任务',cancelled:'已取消',failed:'无法准备扫码；请在工作 Mac 检查',expired:'二维码已过期'};
  status.textContent=names[s.state]||'状态未知';
  if(!['requested','preparing','awaiting_scan'].includes(s.state)){stop();return;}
  if(s.state==='awaiting_scan'&&!s.envelope)clearImage();
  if(s.state==='awaiting_scan' && s.envelope && s.envelope.data!==lastEnvelope){
   const bytes=await openPNG(s.envelope,key,s.id);if(epoch!==generation)return;
   if(Date.now()>=s.expiresAt){stop();status.textContent='二维码已过期';return;}
   clearImage();lastEnvelope=s.envelope.data;url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));img.src=url;img.hidden=false;
  }
  timer=setTimeout(()=>poll(epoch),2000);
 }catch{if(epoch===generation){stop();status.textContent='救援连接中断，二维码已隐藏；请检查网络或重新登录救援页。';}}
}
start.addEventListener('click',async()=>{
 stop();const epoch=generation;start.disabled=true;
 try{
  const pair=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']);
  if(epoch!==generation)return;
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const s=await api('/api/rescue',{publicKey:{kty:jwk.kty,n:jwk.n,e:jwk.e}});if(epoch!==generation)return;
  key=pair.privateKey;attempt=s.id;cancel.disabled=false;
  deadline=setTimeout(()=>{if(epoch===generation){stop();status.textContent='二维码已过期';}},Math.max(0,s.expiresAt-Date.now()));
  await poll(epoch);
 }catch{if(epoch===generation){stop();status.textContent='暂不能获取二维码：请确认电脑在线且微信需要登录；已有登录正常时无需救援。';}}
});
cancel.addEventListener('click',async()=>{const id=attempt;stop();start.disabled=true;try{await api('/api/rescue/cancel',{id});status.textContent='已取消救援';}catch{status.textContent='二维码已隐藏；服务端取消未确认，将按时过期。';}finally{start.disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearImage();else if(attempt){clearTimeout(timer);poll(generation);}});
window.addEventListener('pagehide',stop);
})();`;
