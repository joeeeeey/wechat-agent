const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {root,readConfig,atomic}=require('./config.cjs');
const gate=require('./rescue-intake.cjs');
const {call}=require('./control.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function dotenv(text){
 const values={};for(const raw of text.split('\n')){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const match=/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw Error('Invalid rescue environment file');
  let value=match[2].trim();if(/^['"]/.test(value)){if(value.at(-1)!==value[0])throw Error('Invalid rescue environment value');value=value.slice(1,-1);}else value=value.split(' #')[0].trim();values[match[1]]=value;
 }return values;
}
function credentials(envFile){
 const env={...dotenv(fs.readFileSync(envFile,'utf8')),...process.env};
 if(env.WECHAT_RESCUE_ENABLED!=='true')throw Error('Rescue is not enabled locally');
 let auth=env;
 if(env.WECHAT_RESCUE_CREDENTIALS_FILE){
  try{auth=dotenv(execFileSync('sops',['--decrypt','--input-type','dotenv','--output-type','dotenv',env.WECHAT_RESCUE_CREDENTIALS_FILE],{encoding:'utf8',timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:{...process.env,SOPS_AGE_KEY_FILE:process.env.SOPS_AGE_KEY_FILE||path.join(require('node:os').homedir(),'.config/sops/age/keys.txt')}}));}
  catch{throw Error('Rescue credential access failed');}
 }
 return {account:auth.CLOUDFLARE_ACCOUNT_ID,token:auth.CLOUDFLARE_API_TOKEN,database:env.WECHAT_RESCUE_DATABASE_ID,deviceId:env.WECHAT_RESCUE_DEVICE_ID};
}
async function startRescue(page){
 if(globalThis.wechatRescue)return globalThis.wechatRescue;
 const cfg=readConfig();if(!cfg.rescue?.qrEnabled)return null;
 const auth=credentials(cfg.rescue.envFile);if(auth.deviceId!==cfg.device.id)throw Error('Rescue device identity mismatch');
 const {RescueD1}=await import('../rescue-d1.js');
 const {RescueDevice,ExistingLoginScreen}=await import('../rescue-device.js');
 const DB=new RescueD1(auth);
 const screen=new ExistingLoginScreen(page,{online:'.page-logined textarea.chat-panel__input-container',login:'.login-scan__panel',qr:'.qrcode img.qrcode-img',refresh:'.qrcode .mask__refresh'});
 const intake={
  async pause(id){
   gate.pause(id);
   for(let n=0;n<100;n++){
    let s={};try{s=JSON.parse(fs.readFileSync(path.join(root,'supervisor.json'),'utf8'));}catch{}
    let alive=false;try{if(s.pid){process.kill(s.pid,0);alive=true;}}catch{}
    if(!alive||s.status!=='running'||s.rescuePause?.attemptId===id)return;
    await delay(100);
   }
   throw Error('Intake pause not acknowledged');
  },
  async isPaused(id){return gate.read().paused&&gate.read().attemptId===id;},
  async resume(id){await call({action:'rescue_resume',attemptId:id});}
 };
 const device=new RescueDevice({DB,screen,intake,deviceId:cfg.device.id});
 let busy=false;
 const tick=async()=>{
  if(busy||page.isClosed())return;busy=true;
  try{
   const connection=await screen.state();
   atomic(path.join(root,'health.json'),{deviceId:cfg.device.id,connection,lastObservedAt:new Date().toISOString()});
   const paused=gate.read();
   if(paused.paused&&paused.attemptId&&await screen.state()==='online')await intake.resume(paused.attemptId);
   await device.tick();
   atomic(path.join(root,'rescue-health.json'),{enabled:true,connection,lastCheckAt:new Date().toISOString(),intakePaused:gate.read().paused});
  }catch{atomic(path.join(root,'rescue-health.json'),{enabled:true,status:'unavailable',lastCheckAt:new Date().toISOString(),intakePaused:gate.read().paused});}
  finally{busy=false;}
 };
 const timer=setInterval(()=>void tick(),5000);
 page.on('close',()=>clearInterval(timer));globalThis.wechatRescue={timer,tick};void tick();return globalThis.wechatRescue;
}
module.exports={startRescue,dotenv};
