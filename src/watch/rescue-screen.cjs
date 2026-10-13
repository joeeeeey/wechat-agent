const fs=require('node:fs');
const path=require('node:path');
const {root,atomic}=require('./config.cjs');

function ownLifecycle(context,previous){
 if(previous&&previous!==context)previous.removeAllListeners('close');
 process.removeAllListeners('SIGTERM');
 process.on('SIGTERM',()=>void context.close());
 context.removeAllListeners('close');
 context.on('close',()=>{try{fs.unlinkSync(path.join(root,'control.sock'));}catch{}process.exit(0);});
}

class RecoveryScreen{
 constructor(page,{ExistingLoginScreen,chromium,channel='chromium',lifecycle=ownLifecycle}){
  Object.assign(this,{currentPage:page,ExistingLoginScreen,chromium,channel,lifecycle});this.staged=null;
 }
 get page(){return this.staged?.page||this.currentPage;}
 adapter(){return new this.ExistingLoginScreen(this.page,{online:'.page-logined textarea.chat-panel__input-container',login:'.login-scan__panel',qr:'.qrcode img.qrcode-img',refresh:'.qrcode .mask__refresh'});}
 async state(){return this.adapter().state();}
 async prepare(attemptId){
  if(this.staged?.attemptId===attemptId)return;
  if(this.staged)await this.discard();
  if(await this.state()!=='online')return;
  const profile=fs.mkdtempSync(path.join(root,'rescue-browser-'));fs.chmodSync(profile,0o700);
  const context=await this.chromium.launchPersistentContext(profile,{channel:this.channel,headless:true,acceptDownloads:true});
  try{
   const page=context.pages()[0]||await context.newPage();
   await page.goto('https://filehelper.weixin.qq.com/',{waitUntil:'domcontentloaded',timeout:20000});
   await page.locator('.qrcode img.qrcode-img').waitFor({state:'visible',timeout:15000});
   this.staged={page,context,attemptId,profile};
  }catch{await context.close();throw Error('Could not prepare login page');}
 }
 async qrPNG(){
  // Retain refresh throttling across ticks.
  if(this.imagePage!==this.page){this.imagePage=this.page;this.imageAdapter=this.adapter();}
  return this.imageAdapter.qrPNG();
 }
 async adopt(){
  if(!this.staged)return;
  if(await this.state()!=='online')throw Error('New login is not confirmed');
  const next=this.staged,previous=this.currentPage.context();
  const prior=globalThis.zhumiBridge;
  await new Promise(resolve=>prior.server.close(resolve));delete globalThis.zhumiBridge;
  const socket=path.join(root,'control.sock');if(fs.existsSync(socket))fs.unlinkSync(socket);
  this.lifecycle(next.context,previous);
  await require('./bridge.cjs').start(next.page);
  this.currentPage=next.page;this.staged=null;
  atomic(path.join(root,'active-browser.json'),{profile:next.profile,headless:true,adoptedAt:new Date().toISOString()});
  await previous.close();
 }
 async discard(){if(this.staged){const context=this.staged.context;this.staged=null;await context.close();}}
}
module.exports={RecoveryScreen,ownLifecycle};
