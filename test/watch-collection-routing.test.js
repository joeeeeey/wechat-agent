import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

test('ordinary requests bypass collection classifier; capped mixed batches close once with configurable limits',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-collection-routing-'));process.env.WECHAT_AGENT_HOME=home;
 const require=createRequire(import.meta.url),config=require('../src/watch/config.cjs');
 const marker=path.join(home,'classifier-invoked');
 const cfg=config.defaults();delete cfg.collection.maxMessages;
 cfg.collection.semantic={...cfg.collection.semantic,enabled:true,backend:'codex',command:process.execPath,args:['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'called');setInterval(()=>{},1000);`,'--'],timeoutMs:1000};
 config.atomic(config.configPath,cfg);
 const {start}=require('../src/watch/bridge.cjs'),{call}=require('../src/watch/control.cjs'),{updateConfig,safeView}=require('../src/watch/system-config.cjs');
 const browser=await chromium.launch({headless:true,channel:'chromium'});
 try{
  const page=await browser.newPage();
  await page.setContent('<div class="page-logined"><textarea class="chat-panel__input-container"></textarea><a class="chat-send__button">发送</a><ul class="msg-list"></ul></div>');
  await page.evaluate(()=>{document.querySelector('.chat-send__button').onclick=()=>{const input=document.querySelector('textarea');const li=document.createElement('li');li.className='msg-list__item';const d=document.createElement('div');d.className='msg-text';d.innerText=input.value;li.append(d);document.querySelector('.msg-list').append(li);input.value='';};});
  const append=(text,kind='text')=>page.locator('.msg-list').evaluate((list,{text,kind})=>{const li=document.createElement('li');li.className='msg-list__item';
   if(kind==='text'){const d=document.createElement('div');d.className='msg-text';d.innerText=text;li.append(d);}
   else li.innerHTML=kind==='image'?'<div class="msg-image"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div>':'<a class="msg-file">fixture.txt</a>';
   list.append(li);
  },{text,kind});
  await start(page);
  for(const text of ['主咪在吗','主咪 在吗','zhumi 你好','主咪帮我检查这个 PR'])await append(text);
  let requests=await call({action:'requests'});
  assert.equal(requests.length,4);assert.ok(requests.every(r=>r.status==='received'&&r.intentDetection.source==='pattern_miss'));
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  assert.equal(globalThis.zhumiBridge.state.deliveries.length,0,'No misleading collection reply for ordinary requests');
  await append('主咪我接下来会搬几段群里的讨论过来，先攒着，等我说完再一起看');
  requests=await call({action:'requests'});
  assert.equal(requests.at(-1).status,'waiting_intent_confirmation');assert.equal(requests.at(-1).intentDetection.source,'timeout');
  assert.match(globalThis.zhumiBridge.state.deliveries.at(-1).text,/识别服务暂时未返回/);
  await fs.stat(marker);
  assert.equal(safeView().values['collection.maxMessages'],30,'Older configs have a visible default');
  await append('主咪1111 总结');await call({action:'requests'});
  const batchId=globalThis.zhumiBridge.state.collection.requestId;
  for(let n=0;n<29;n++)await append(`材料${n}`,n===10?'file':'text');
  await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.collection.entries.length,29);
  await append('last','image');await append('/ai config set 助手名 不应执行');await call({action:'requests'});
  assert.equal(globalThis.zhumiBridge.state.collection,null);
  const batch=globalThis.zhumiBridge.state.requests.find(r=>r.id===batchId);
  assert.equal(batch.collectionCount,30);assert.equal(batch.collectionCloseReason,'limit');assert.equal(batch.status,'received');assert.equal(batch.materialIds.length,2);
  assert.equal(config.readConfig().assistant.displayName,'主咪','Overflow in the same burst never executes');
  const saved=JSON.parse(await fs.readFile(batch.collectionArtifact.path,'utf8'));assert.equal(saved.entries.length,30);assert.equal(saved.entries.at(-1).kind,'image');
  const count=globalThis.zhumiBridge.state.requests.length;await append('1111');await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.requests.length,count,'Late terminator does not redispatch');
  for(const invalid of [0,-1,1.5,1001,'30'])assert.throws(()=>updateConfig({'收集上限':invalid}));
  updateConfig({'收集上限':3});await append('主咪收集');await call({action:'requests'});updateConfig({'收集上限':2});
  await append('第一');await append('第二');await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.collection.entries.length,2,'Open batch keeps its captured limit');
  await append('第三');await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.requests.at(-1).collectionCount,3);
  await append('主咪收集');await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.collection.maxMessages,2);
  await append('file','file');await append('image','image');await call({action:'requests'});assert.equal(globalThis.zhumiBridge.state.requests.at(-1).collectionCount,2);
  assert.equal(globalThis.zhumiBridge.state.collection,null);
 }finally{
  if(globalThis.zhumiBridge){await new Promise(r=>globalThis.zhumiBridge.server.close(r));delete globalThis.zhumiBridge;}
  await browser.close();await fs.rm(home,{recursive:true,force:true});
 }
});
