import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const {selectMaterials,capture}=createRequire(import.meta.url)('../src/watch/materials.cjs');
test('material selection requires task intent or explicit IDs and disambiguates',()=>{
 const items=['A1','A2'].map(id=>({id,observedAt:new Date().toISOString()}));
 assert.deepEqual(selectMaterials('你好',items),[]);
 assert.throws(()=>selectMaterials('读取文件',items),/多个/);
 assert.equal(selectMaterials('读取这些附件',items).length,2);
 assert.equal(selectMaterials('看看 A2',items)[0].id,'A2');
 assert.throws(()=>selectMaterials('读取 A3',items),/Unknown/);
});
test('native file click downloads bytes without page navigation',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage({acceptDownloads:true});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhumi-download-test-'));
 try{
  await page.setContent('<div data-zhumi-material="A1"><a class="msg-file" href="#">sample.txt</a></div>');
  await page.evaluate(()=>{const a=document.querySelector('a');a.href=URL.createObjectURL(new Blob(['ZHUMI fixture 123'],{type:'text/plain'}));a.download='sample.txt';});
  let navigations=0;page.on('framenavigated',()=>navigations++);
  const result=await capture(page,{id:'A1',kind:'file'},dir);
  assert.equal(await fs.readFile(result.path,'utf8'),'ZHUMI fixture 123');
  assert.equal(navigations,0);
 }finally{await browser.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('unsupported merged messages remain explicitly unavailable',async()=>{
 const item=await capture(null,{id:'A1',kind:'unsupported',visibleText:'无法显示此消息'},'/unused');
 assert.equal(item.unavailable,true);assert.equal(item.path,undefined);
});
test('download filename cannot persist query credentials',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage({acceptDownloads:true});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhumi-filename-test-'));
 try{
  await page.setContent('<div data-zhumi-material="A1"><a class="msg-file" href="#">download</a></div>');
  await page.evaluate(()=>{const a=document.querySelector('a');a.href=URL.createObjectURL(new Blob(['safe fixture']));a.download='download&skey=FAKE_TEST_ONLY.txt';});
  const result=await capture(page,{id:'A1',kind:'file'},dir);
  assert.equal(result.filename,'attachment.txt');assert.ok(!result.path.includes('skey'));assert.ok(!result.path.includes('FAKE_TEST'));
 }finally{await browser.close();await fs.rm(dir,{recursive:true,force:true});}
});
