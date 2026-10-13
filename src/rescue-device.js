import {DEVICE,expire,current,claim,transition,sealPNG} from '../infra/cloudflare/wechat-rescue/rescue.mjs';

// Caller owns authenticated DB access and a VERIFIED existing login-page adapter.
// No browser discovery, page reload, navigation, service restart or intake replay.
export class RescueDevice {
  constructor({DB,screen,intake,deviceId=DEVICE}) { this.deviceId=deviceId; this.DB=DB; this.screen=screen; this.intake=intake; this.busy=false; }
  async tick() {
    if(this.busy)return;
    this.busy=true;
    try {
      await expire(this.DB);
      const row=await current(this.DB,this.deviceId);
      if(!row || !['requested','awaiting_scan'].includes(row.state))return;
      if(row.state==='awaiting_scan') {
        // Completion requires an observed chat UI, not merely disappearance of the QR.
        const state=await this.screen.state();
        if(state==='online'){
          await transition(this.DB,row.id,'awaiting_scan','completed',null,Date.now(),this.deviceId);
          if(await this.intake.isPaused(row.id))await this.intake.resume?.(row.id);
        }else if(state==='login_required'){
          try{
          const png=await this.screen.qrPNG();
          const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',png))).join(',');
          if(this.lastImage?.id!==row.id||this.lastImage?.fingerprint!==fingerprint){
            const envelope=await sealPNG(png,JSON.parse(row.public_key),row.id);
            await transition(this.DB,row.id,'awaiting_scan','awaiting_scan',JSON.stringify(envelope),Date.now(),this.deviceId);
            this.lastImage={id:row.id,fingerprint};
          }
          }catch{
            await transition(this.DB,row.id,'awaiting_scan','awaiting_scan',null,Date.now(),this.deviceId);this.lastImage=null;
          }
        }else{
          await transition(this.DB,row.id,'awaiting_scan','awaiting_scan',null,Date.now(),this.deviceId);this.lastImage=null;
        }
        return;
      }
      const leased=await claim(this.DB,row.id,Date.now(),this.deviceId);
      if(!leased)return;
      try {
        await this.intake.pause(row.id);
        if(!await this.intake.isPaused(row.id))throw Error('Intake not paused');
        // An explicit request may prepare a separate login page while the current
        // one remains online. Adoption happens only after observed login.
        await this.screen.prepare?.(row.id);
        if(await this.screen.state()!=='login_required')throw Error('Not a login screen');
        // Recheck cancellation/expiry and screen state after pause, before reading pixels.
        const latest=await current(this.DB,this.deviceId);
        if(latest?.id!==row.id || latest.state!=='preparing' || latest.expires_at<=Date.now())return;
        if(await this.screen.state()!=='login_required')throw Error('Screen changed');
        const png=await this.screen.qrPNG();
        const envelope=await sealPNG(png,JSON.parse(leased.public_key),row.id);
        await transition(this.DB,row.id,'preparing','awaiting_scan',JSON.stringify(envelope),Date.now(),this.deviceId);
        this.lastImage={id:row.id,fingerprint:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',png))).join(',')};
      } catch {
        // Never persist raw browser errors, pixels or credentials. Intake stays paused.
        await transition(this.DB,row.id,'preparing','failed',null,Date.now(),this.deviceId);
      }
    } finally {this.busy=false;}
  }
}

// Callers supply the already-owned page. QR refresh is an explicit login-screen
// control, never a page reload; it is used only during an owner-requested rescue.
export class ExistingLoginScreen {
  constructor(page,{online,login,qr,refresh}) {
    if(!online || !login || !qr)throw Error('Verified selectors required');
    this.page=page;this.selectors={online,login,qr,refresh};this.lastRefresh=0;
  }
  async state() {
    if(await this.page.locator(this.selectors.online).isVisible())return 'online';
    if(await this.page.locator(this.selectors.login).isVisible() && await this.page.locator(this.selectors.qr).count()===1 && await this.page.locator(this.selectors.qr).isVisible())return 'login_required';
    return 'unknown';
  }
  async qrPNG() {
    if(await this.state()!=='login_required')throw Error('Login required');
    if(this.selectors.refresh&&await this.page.locator(this.selectors.refresh).isVisible()){
      if(Date.now()-this.lastRefresh<30000)throw Error('QR refresh cooling down');
      this.lastRefresh=Date.now();
      await this.page.locator(this.selectors.refresh).click({timeout:3000});
      await this.page.locator(this.selectors.refresh).waitFor({state:'hidden',timeout:5000});
    }
    const qr=this.page.locator(this.selectors.qr),box=await qr.boundingBox();
    if(!box || box.width<64 || box.height<64 || box.width>512 || box.height>512 || Math.abs(box.width-box.height)>4)throw Error('Unexpected QR bounds');
    return qr.screenshot({type:'png',timeout:3000});
  }
}
