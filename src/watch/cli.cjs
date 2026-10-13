#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {home,root,readConfig,atomic}=require('./config.cjs');
const {call}=require('./control.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
process.umask(0o077);
function alive(pid){if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
const read=(name,fallback={})=>{try{return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
function command(pid){try{return execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();}catch{return '';}}
function launch(script,log){
 const fd=fs.openSync(path.join(root,log),'a',0o600);
 const child=spawn(process.execPath,[path.join(__dirname,script)],{cwd:root,env:process.env,stdio:['ignore',fd,fd],detached:true});
 fs.closeSync(fd);child.unref();return child.pid;
}
async function status(){
 const s=read('supervisor.json');let browser;
 try{const b=await call({action:'status'});browser={connection:b.connection,collection:b.collection,lastObservedAt:b.lastObservedAt};}catch{browser={connection:'unavailable'};}
 return {status:s.status||'not_started',pid:s.pid||null,alive:alive(s.pid),stopAt:s.stopAt||null,session:s.session||null,browser};
}
async function stop(){
 const s=read('supervisor.json');
 if(alive(s.pid)){
  if(!command(s.pid).includes(path.join(__dirname,'supervisor.cjs')))throw Error('Supervisor PID identity mismatch');
  const busy=Object.values(s.jobs||{}).filter(j=>['queued','running','dispatching','steering','steered','ack_pending','result_pending'].includes(j.phase));
  if(busy.length)throw Error('Work is active. Finish or cancel it in the assistant before restarting.');
  process.kill(s.pid,'SIGTERM');
  for(let n=0;n<150&&alive(s.pid);n++)await sleep(100);
  if(alive(s.pid))throw Error('Supervisor did not exit. Inspect locally before restarting.');
 }
 s.status='paused_local';atomic(path.join(root,'supervisor.json'),s);
}
async function ensureSharedLock(){
 const lock=path.join(home,'session.lock');
 if(fs.existsSync(lock)){
  let prior;try{prior=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw Error('Legacy session lock exists. Stop the old controller first.');}
  if(prior?.kind!=='wechat-agent-watch')throw Error('Another controller owns session.lock; stop it before using watch.');
  const b=read('browser-process.json');
  if(alive(prior.pid)&&prior.pid!==b.pid)throw Error('Another watch startup is running');
  if(alive(b.pid))return;
  fs.unlinkSync(lock);
 }
 fs.writeFileSync(lock,JSON.stringify({kind:'wechat-agent-watch',pid:process.pid}),{flag:'wx',mode:0o600});
}
async function start({hours,restartBrowser=false}){
 const c=readConfig();if(!c.execution.enabled)throw Error('Run setup and explicitly enable requested task execution first');
 const previous=read('supervisor.json');if(alive(previous.pid))throw Error('Watch already running; use status or restart');
 await ensureSharedLock();
 if(restartBrowser){
  const b=read('browser-process.json');
  if(alive(b.pid)){
   if(!command(b.pid).includes(path.join(__dirname,'browser-entry.cjs')))throw Error('Browser PID identity mismatch');
   await call({action:'shutdown_browser'});
   for(let n=0;n<100&&alive(b.pid);n++)await sleep(100);
   if(alive(b.pid))throw Error('Browser did not close; do not launch another one');
  }
 }
 let browser;try{browser=await call({action:'status'});}catch{}
 if(!browser){
  const b=read('browser-process.json');if(alive(b.pid))throw Error('Browser is alive but unavailable; inspect locally');
  const sock=path.join(root,'control.sock');if(fs.existsSync(sock))fs.unlinkSync(sock);
  const pid=launch('browser-entry.cjs','browser.log');
  atomic(path.join(home,'session.lock'),{kind:'wechat-agent-watch',pid});
  console.log('A dedicated browser is opening. Scan with WeChat; login is detected automatically. Do not refresh.');
  for(let n=0;n<300;n++){
   if(!alive(pid))throw Error('Browser exited; inspect '+path.join(root,'browser.log'));
   try{browser=await call({action:'status'});}catch{}
   if(browser?.connection==='online')break;
   await sleep(2000);
  }
 }
 if(browser?.connection!=='online')throw Error('Login required. Browser left untouched; scan and run start again.');
 const stopAt=hours?new Date(Date.now()+hours*3600000).toISOString():previous.stopAt||new Date(Date.now()+c.monitoring.hours*3600000).toISOString();
 if(Date.parse(stopAt)<=Date.now())throw Error('Monitoring expired. Start with --hours 24 (or another explicit duration).');
 if(Object.values(previous.jobs||{}).some(j=>['running','dispatching','steering','steered'].includes(j.phase)))throw Error('Interrupted task needs local inspection before restarting; do not replay it');
 atomic(path.join(root,'supervisor.json'),{...previous,status:'running',startedAt:previous.startedAt||new Date().toISOString(),stopAt,jobs:previous.jobs||{},checkIntervalSeconds:c.monitoring.pollSeconds,progressIntervalSeconds:c.monitoring.progressSeconds});
 const pid=launch('supervisor.cjs','supervisor.log');
 for(let n=0;n<90;n++){
  if(!alive(pid))throw Error('Watch startup failed. Inspect '+path.join(root,'supervisor.log'));
  const s=read('supervisor.json');
  if(s.pid===pid&&s.lastCheckAt&&s.lastCheckAt!==previous.lastCheckAt){
   await call({action:'respond',phase:'progress',body:`已连接，我会每 ${c.monitoring.pollSeconds} 秒检查新消息 🐾\n发“${c.assistant.aliases[0]}”加任务；收集聊天可发“${c.assistant.aliases[0]}1111 总结下面的聊天”，最后单独发 1111 或 mmmm。图片和文件单独到达不会触发回复。`});
   console.log(JSON.stringify(await status(),null,2));return;
  }
  await sleep(1000);
 }
 throw Error('Startup not verified. Inspect local logs before retrying.');
}
async function main(){
 if(process.platform!=='darwin')throw Error('The watch lifecycle command currently supports macOS only');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const args=process.argv.slice(2),action=args.shift()||'status';
 const index=args.indexOf('--hours'),hours=index>=0?Number(args[index+1]):undefined;
 if(index>=0&&(!Number.isFinite(hours)||hours<=0||hours>168))throw Error('--hours must be > 0 and <= 168');
 if(action==='status'){console.log(JSON.stringify(await status(),null,2));return;}
 if(!['start','stop','restart'].includes(action))throw Error('Usage: npm run watch -- start|status|stop|restart [--browser] [--hours N]');
 const guard=path.join(root,'lifecycle.lock');
 try{fs.writeFileSync(guard,String(process.pid),{flag:'wx',mode:0o600});}
 catch{const pid=Number(fs.readFileSync(guard,'utf8'));if(alive(pid))throw Error('Another lifecycle operation is running');fs.unlinkSync(guard);fs.writeFileSync(guard,String(process.pid),{flag:'wx',mode:0o600});}
 try{if(action==='stop'||action==='restart')await stop();if(action!=='stop')await start({hours,restartBrowser:args.includes('--browser')});}
 finally{fs.unlinkSync(guard);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={alive,status};
