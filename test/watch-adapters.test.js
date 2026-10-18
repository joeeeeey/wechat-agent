import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {CodexSession}=require('../src/watch/codex-session.cjs');
const {CommandSession}=require('../src/watch/command-session.cjs');
const {checkLoginReminders}=require('../src/watch/login-reminders.cjs');
function serverMock(calls){return ()=>{
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 child.stdin.on('data',chunk=>{for(const line of chunk.toString().trim().split('\n')){const r=JSON.parse(line);calls.push(r);
  if(r.id===undefined)continue;
  const result=r.method==='thread/start'?{thread:{id:'persistent-fixture'}}:r.method==='thread/resume'?{thread:{id:r.params.threadId}}:r.method==='turn/start'?{turn:{id:'turn-1'}}:r.method==='turn/steer'?{turnId:'turn-1'}:{};
  queueMicrotask(()=>child.stdout.write(JSON.stringify({id:r.id,result})+'\n'));
 }});return child;
};}
test('Codex resumes native identity and forwards configured permissions without granting full access',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-native-test-'));const calls=[];
 try{
  const a=new CodexSession({workspace,spawnProcess:serverMock(calls)});await a.connect();
 assert.equal(calls.find(c=>c.method==='thread/start').params.sandbox,'danger-full-access');
  const b=new CodexSession({workspace,spawnProcess:serverMock(calls)});await b.connect();
  assert.equal(calls.find(c=>c.method==='thread/resume').params.threadId,'persistent-fixture');
  const turn=await b.start('fixture',{});
  assert.equal((await b.steer('follow-up','message-1')).accepted,true);
  b.handle({method:'item/completed',params:{threadId:'persistent-fixture',turnId:turn.turnId,item:{type:'agentMessage',phase:'final_answer',text:JSON.stringify({status:'succeeded',response:'done'})}}});
  b.handle({method:'turn/completed',params:{threadId:'persistent-fixture',turn:{id:turn.turnId,status:'completed'}}});
  assert.equal((await turn.done).response,'done');a.close();b.close();
 }finally{await fs.rm(workspace,{recursive:true,force:true});}
});
test('Claude adapter resumes saved session and queues rather than claiming steering',async()=>{
 const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-claude-test-'));
 try{
  const file=path.join(workspace,'fake-cli');
  await fs.writeFile(file,'#!/usr/bin/env node\nlet s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{require("fs").writeFileSync("args.json",JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({session_id:"claude-fixture",result:JSON.stringify({status:"succeeded",response:"ok"})}));});\n',{mode:0o700});
  const harness={backend:'claude',command:file,args:[],permissionMode:'bypassPermissions'};
  const a=new CommandSession({workspace,harness});await (await a.start('hello')).done;
  const b=new CommandSession({workspace,harness});await (await b.start('again')).done;
  const args=JSON.parse(await fs.readFile(path.join(workspace,'args.json'),'utf8'));
  assert.ok(args.includes('--resume'));assert.ok(args.includes('claude-fixture'));
  assert.ok(args.includes('--dangerously-skip-permissions'));assert.ok(args.includes('--permission-mode'));assert.ok(args.includes('bypassPermissions'));assert.equal((await b.steer('input')).accepted,false);
 }finally{await fs.rm(workspace,{recursive:true,force:true});}
});
test('login reminders fire once per threshold and reset on observed relogin',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-reminder-test-'));const messages=[];
 const login=Date.parse('2026-01-01T00:00:00Z');const snapshot={connection:'online',loginDetectedAt:new Date(login).toISOString()};
 try{
  for(const minutes of [61,60,60,30,10])await checkLoginReminders({root,snapshot,send:async text=>messages.push(text),now:login+(1440-minutes)*60000});
  assert.equal(messages.length,3);
  await checkLoginReminders({root,snapshot:{...snapshot,loginDetectedAt:new Date(login+86400000).toISOString()},send:async t=>messages.push(t),now:login+86400000});
  assert.equal(messages.length,3);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
