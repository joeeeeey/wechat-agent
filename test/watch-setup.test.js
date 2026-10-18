import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {renderLauncher} from '../scripts/setup.mjs';
const {defaults,validate}=createRequire(import.meta.url)('../src/watch/config.cjs');
const {connectedMessage}=createRequire(import.meta.url)('../src/watch/onboarding.cjs');
const {stripAlias,collectionIntent,isEndMarker}=createRequire(import.meta.url)('../src/watch/collection.cjs');
test('connected collection examples work with renamed aliases and custom marker settings',()=>{
 for(const allowInstructionAfterStartToken of [true,false]){
  const c=defaults();c.assistant.aliases=['helper'];
  c.collection={...c.collection,startTokens:['BEGIN'],endMarkers:['DONE'],allowInstructionAfterStartToken};
  const message=connectedMessage(c);
  const start=message.match(/收集聊天可发“([^”]+)”/)[1];
  const end=message.match(/最后单独发 “([^”]+)”/)[1];
  assert.equal(collectionIntent(stripAlias(start,c.assistant.aliases,c.collection.startTokens),c.collection),true);
  assert.equal(isEndMarker(end,c.collection.endMarkers,c.collection),true);
  c.collection.enabled=false;
  assert.equal(connectedMessage(c).includes('收集聊天可发'),false);
 }
});
test('guided configuration requires opt-in and validates executable settings',()=>{
 const c=defaults();assert.equal(c.execution.enabled,false);assert.equal(c.rescue.enabled,false);assert.equal(c.harness.sandbox,'danger-full-access');assert.equal(c.harness.permissionMode,'bypassPermissions');assert.equal(validate(c),c);
 assert.throws(()=>validate({...c,workspace:'relative'}),/absolute/);
 assert.throws(()=>validate({...c,monitoring:{...c.monitoring,pollSeconds:0}}),/interval/);
 assert.throws(()=>validate({...c,collection:{...c.collection,semantic:{enabled:true}}}),/classifier/);
});
test('installed launcher preserves paths and argv without shell interpolation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-launcher-test-'));
 const repository=path.join(root,"repo with ' quote"),installHome=path.join(root,'private $(must-not-run)');
 await fs.mkdir(path.join(repository,'src/watch'),{recursive:true});
 await fs.writeFile(path.join(repository,'src/watch/cli.cjs'),'console.log(JSON.stringify({args:process.argv.slice(2),root:process.env.WECHAT_AGENT_HOME}));');
 const launcher=path.join(root,'agent');await fs.writeFile(launcher,renderLauncher({repository,installHome}),{mode:0o700});
 try{
  const result=spawnSync('/bin/sh',[launcher,'status','literal $(echo unsafe)'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const parsed=JSON.parse(result.stdout);assert.equal(parsed.root,installHome);assert.deepEqual(parsed.args,['status','literal $(echo unsafe)']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
