import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {ExistingLoginScreen} from '../src/rescue-device.js';

test('online QR generation stages a separate page; cancel preserves it and confirmed login adopts without replay',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-rescue-screen-'));process.env.WECHAT_AGENT_HOME=home;
 const require=createRequire(import.meta.url);const config=require('../src/watch/config.cjs');config.atomic(config.configPath,config.defaults());
 const {RecoveryScreen}=require('../src/watch/rescue-screen.cjs');const {start}=require('../src/watch/bridge.cjs');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const oldContext=await browser.newContext();const oldPage=await oldContext.newPage();
  const online='<div class="page-logined"><textarea class="chat-panel__input-container"></textarea><ul class="msg-list"><li class="msg-list__item"><div class="msg-text">小助手旧消息不执行</div></li></ul></div>';
  await oldPage.setContent(online);await start(oldPage);const epoch=globalThis.zhumiBridge.state.sessionEpoch;
  const factory={launchPersistentContext:async()=>{
   const context=await browser.newContext();
   await context.route('https://filehelper.weixin.qq.com/**',route=>route.fulfill({contentType:'text/html',body:'<div class="login-scan__panel"><div class="qrcode"><img class="qrcode-img" width="160" height="160" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div></div>'}));
   return context;
  }};
  const screen=new RecoveryScreen(oldPage,{ExistingLoginScreen,chromium:factory,lifecycle:()=>{}});
  await screen.prepare('one');assert.equal(await screen.state(),'login_required');assert.equal(oldPage.isClosed(),false);assert.notEqual(screen.page,oldPage);
  assert.ok((await screen.qrPNG()).length>0);
  await assert.rejects(()=>screen.adopt(),/not confirmed/);
  await screen.discard();assert.equal(screen.page,oldPage);assert.equal(await screen.state(),'online');
  await screen.prepare('two');const replacement=screen.page;await replacement.setContent(online);
  const closeOld=oldContext.close.bind(oldContext);let closeStarted=false;
  oldContext.close=()=>{closeStarted=true;return new Promise(()=>{});};
  const gate=require('../src/watch/rescue-intake.cjs');gate.pause('two');
  let deadline;
  try{await Promise.race([screen.adopt(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Adoption blocked on old context cleanup')),2000);})]);}
  finally{clearTimeout(deadline);}
  assert.equal(closeStarted,true);assert.equal(screen.retiredContexts.size,1);
  const {call}=require('../src/watch/control.cjs');
  assert.equal((await call({action:'rescue_resume',attemptId:'two'})).resumed,true);
  assert.equal(gate.read().paused,false,'Successful login resumes even if old Chromium never closes');
  assert.equal(screen.currentPage,replacement);assert.equal(replacement.isClosed(),false);
  await replacement.locator('.msg-list').evaluate(e=>e.insertAdjacentHTML('beforeend','<li class="msg-list__item"><div class="msg-text">/ai 在吗</div></li>'));
  assert.equal((await call({action:'requests'})).at(-1).body,'在吗','New input is processed through the adopted page');
  oldContext.close=closeOld;await closeOld();
  assert.notEqual(globalThis.zhumiBridge.state.sessionEpoch,epoch);assert.equal(globalThis.zhumiBridge.state.requests.length,1);
 }finally{
  if(globalThis.zhumiBridge){await new Promise(r=>globalThis.zhumiBridge.server.close(r));delete globalThis.zhumiBridge;}
  await browser.close();await fs.rm(home,{recursive:true,force:true});
 }
});
