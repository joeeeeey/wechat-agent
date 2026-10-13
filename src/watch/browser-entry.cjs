const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {root,readConfig,atomic}=require('./config.cjs');
const {start}=require('./bridge.cjs');
process.umask(0o077);
(async()=>{
 const c=readConfig();
 if(fs.existsSync(path.join(root,'control.sock')))throw Error('Existing browser socket; stop its owner before starting another browser');
 const context=await chromium.launchPersistentContext(path.join(root,'browser-profile'),{channel:c.browser?.channel||'chromium',headless:false,acceptDownloads:true});
 context.on('close',()=>{try{fs.unlinkSync(path.join(root,'control.sock'));}catch{}process.exit(0);});
 process.on('SIGTERM',()=>void context.close());
 const page=context.pages()[0]||await context.newPage();
 // Only the initial navigation for this explicitly started browser. Never reload/reconnect.
 await page.goto('https://filehelper.weixin.qq.com/',{waitUntil:'domcontentloaded'});
 await page.bringToFront();
 await start(page);
 atomic(path.join(root,'browser-process.json'),{pid:process.pid,entry:__filename,startedAt:new Date().toISOString()});
})().catch(e=>{console.error(e.message);process.exit(1);});
