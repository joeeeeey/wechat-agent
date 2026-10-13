import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('system config validates atomic edits, redacts private settings, and preserves local runtime limits',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-config-test-'));
 process.env.WECHAT_AGENT_HOME=home;
 const require=createRequire(import.meta.url);
 const config=require('../src/watch/config.cjs');
 const {safeView,updateConfig,applyLive,describe}=require('../src/watch/system-config.cjs');
 try{
  const original=config.defaults();
  delete original.response; // Configs installed before response preferences remain editable.
  original.workspace=path.join(home,'private-work');
  original.harness.args=['private-argument'];original.rescue.envFile='/private/credentials';
  config.atomic(config.configPath,original);
  const initial=safeView();
  for(const text of [original.workspace,'private-argument','/private/credentials']){
   assert.ok(!JSON.stringify(initial).includes(text));assert.ok(!describe().includes(text));
  }
  const changed=updateConfig({'助手名':'小咪','检查间隔':10,'回复风格':'详细'},{expectedRevision:initial.revision});
  assert.deepEqual(changed.values['assistant.aliases'],['小咪','主咪','zhumi']);
  assert.equal(changed.values['response.language'],'中文');
  assert.equal(config.readConfig().monitoring.pollSeconds,10);
  assert.throws(()=>updateConfig({'检查间隔':20},{expectedRevision:initial.revision}),/重新读取/);
  const before=fs.readFileSync(config.configPath,'utf8');
  for(const patch of [{'助手名':'bad','检查间隔':0},{'harness.command':'arbitrary'},{'execution.enabled':false},JSON.parse('{"__proto__":{}}'),{'结束符':[]},{'附件大小上限':1.5},{'登录提醒':'false'}])assert.throws(()=>updateConfig(patch));
  assert.equal(fs.readFileSync(config.configPath,'utf8'),before,'Invalid patches are all-or-nothing');
  updateConfig({'接收时长':48,'登录提醒':false,'结束符':['1111','done']});
  const next=config.readConfig();next.harness.command='other';next.workspace='/other';
  const live=applyLive(original,next);
  assert.equal(live.monitoring.hours,24);assert.equal(live.harness.command,original.harness.command);assert.equal(live.workspace,original.workspace);
  assert.equal(live.monitoring.pollSeconds,10);assert.equal(live.loginReminders.enabled,false);assert.deepEqual(live.collection.endMarkers,['1111','done']);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('fixed /ai syntax distinguishes native commands from addressed tasks',()=>{
 const {parseSystem}=createRequire(import.meta.url)('../src/watch/system-config.cjs');
 for(const text of ['/ai',' /ai help ','/AI 帮助'])assert.equal(parseSystem(text).kind,'help');
 assert.equal(parseSystem('/ai config').kind,'config');assert.equal(parseSystem('/ai status').kind,'status');
 assert.deepEqual(parseSystem('/ai config set 检查间隔 10').patch,{'检查间隔':10});
 assert.deepEqual(parseSystem('/ai config set 结束符 ["1111","mmmm"]').patch,{'结束符':['1111','mmmm']});
 assert.deepEqual(parseSystem('/ai config set 登录提醒 false').patch,{'登录提醒':false});
 assert.equal(parseSystem('/ai config set').kind,'error');
 assert.deepEqual(parseSystem('/ai 帮我改成英文'),{kind:'task',body:'帮我改成英文'});
 assert.equal(parseSystem('/aide'),null);assert.equal(parseSystem('转发 /ai config'),null);
});
