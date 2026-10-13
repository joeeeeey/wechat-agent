import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const {defaults}=createRequire(import.meta.url)('../src/watch/config.cjs');
test('configured command backend runs a completed batch once and does not react to bare materials',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-supervisor-test-'));const root=path.join(home,'watch');await fs.mkdir(root);
 const cfg=defaults();cfg.workspace=path.join(root,'workspace');cfg.execution.enabled=true;cfg.monitoring.pollSeconds=1;cfg.loginReminders.enabled=false;
 cfg.harness={backend:'command',command:process.execPath,args:['-e','let p="";process.stdin.on("data",c=>p+=c);process.stdin.on("end",()=>console.log(JSON.stringify({status:"succeeded",response:p.includes("Response style: 详细")&&p.includes("Reply language: English")?"new preferences":p.includes("chat-batch")?"batch read":"missing materials"})));']};
 await fs.writeFile(path.join(root,'config.json'),JSON.stringify(cfg));
 const received=[],transcript=path.join(root,'batch.json');await fs.writeFile(transcript,'{"entries":[{"text":"sample"}]}');
 const request={id:'R1',body:'总结材料',status:'received',receivedAt:new Date().toISOString(),collectionClosedAt:new Date().toISOString(),materialIds:[]};
 const requests=[request],polls=[];
 const server=http.createServer((req,res)=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{
  const c=JSON.parse(text);let result;
  if(c.action==='status')result={connection:'online'};
  else if(c.action==='requests'){polls.push(Date.now());result=requests;}
  else if(c.action==='materials')throw Error('Bare materials must never trigger unsolicited notices');
  else if(c.action==='capture')result=[{kind:'chat-batch',path:transcript}];
  else if(c.action==='respond'){received.push(c);result={state:'visible_in_web_ui'};}
  else result={};res.end(JSON.stringify({ok:true,result}));
 });});
 await new Promise(r=>server.listen(path.join(root,'control.sock'),r));
 await fs.writeFile(path.join(root,'rescue-intake.json'),JSON.stringify({paused:true,attemptId:'persisted-rescue'}));
 const child=spawn(process.execPath,['src/watch/supervisor.cjs'],{env:{...process.env,WECHAT_AGENT_HOME:home},stdio:['ignore','pipe','pipe']});
 let diagnostics='';child.stderr.on('data',c=>diagnostics+=c);child.stdout.resume();
 try{
  for(let n=0;n<40;n++){
   let snapshot={};try{snapshot=JSON.parse(await fs.readFile(path.join(root,'supervisor.json'),'utf8'));}catch{}
   if(snapshot.rescuePause?.attemptId==='persisted-rescue')break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(received.length,0,'A persisted rescue pause blocks dispatch after process startup');
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'supervisor.json'),'utf8')).rescuePause.attemptId,'persisted-rescue');
  await fs.writeFile(path.join(root,'rescue-intake.json'),JSON.stringify({paused:false,attemptId:'persisted-rescue'}));
  for(let n=0;n<100&&!received.some(r=>r.phase==='completed');n++)await new Promise(r=>setTimeout(r,100));
  assert.equal(received.find(r=>r.phase==='completed')?.body,'batch read',diagnostics);
  await new Promise(r=>setTimeout(r,1100));assert.equal(received.filter(r=>r.phase==='completed').length,1);
  const saved=JSON.parse(await fs.readFile(path.join(root,'supervisor.json'),'utf8'));assert.equal(saved.jobs.R1.phase,'completed');
  cfg.monitoring.pollSeconds=300;cfg.monitoring.progressSeconds=20;cfg.monitoring.hours=48;cfg.response={language:'English',style:'详细'};
  await fs.writeFile(path.join(root,'config.json.tmp'),JSON.stringify(cfg));await fs.rename(path.join(root,'config.json.tmp'),path.join(root,'config.json'));
  for(let n=0;n<30;n++){
   const current=JSON.parse(await fs.readFile(path.join(root,'supervisor.json'),'utf8'));
   if(current.checkIntervalSeconds!==1)break;
   await new Promise(r=>setTimeout(r,100));
  }
  const reloaded=JSON.parse(await fs.readFile(path.join(root,'supervisor.json'),'utf8'));
  assert.equal(reloaded.checkIntervalSeconds,1);assert.equal(reloaded.progressIntervalSeconds,45);assert.equal(reloaded.stopAt,saved.stopAt,'Hot reload must not renew authorization');
  requests.push({...request,id:'R2',body:'检查新偏好'});
  for(let n=0;n<80&&!received.some(r=>r.requestId==='R2'&&r.phase==='completed');n++)await new Promise(r=>setTimeout(r,100));
  assert.equal(received.find(r=>r.requestId==='R2'&&r.phase==='completed')?.body,'new preferences',diagnostics);
  await new Promise(r=>setTimeout(r,2200));
  assert.ok(polls.at(-1)-polls.at(-2)<5000,'Polling stays responsive despite a raw file edit to 300 seconds');
  assert.equal(received.filter(r=>r.phase==='completed').length,2,'Reload does not replay completed work');
 }finally{
  const closed=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');
  await Promise.race([closed,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');
  await new Promise(r=>server.close(r));await fs.rm(home,{recursive:true,force:true});
 }
});
