import {DEVICE,expire,current,claim,transition,sealPNG} from '../infra/cloudflare/wechat-rescue/rescue.mjs';

// Caller owns authenticated DB access and a VERIFIED existing login-page adapter.
// No browser discovery, attach, reload, navigation, click, service restart or intake replay.
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
        if(await this.screen.state()==='online')await transition(this.DB,row.id,'awaiting_scan','completed',null,Date.now(),this.deviceId);
        return;
      }
      const leased=await claim(this.DB,row.id,Date.now(),this.deviceId);
      if(!leased)return;
      try {
        // Refuse healthy or ambiguous pages. A lost observation is not confirmed logout.
        if(await this.screen.state()!=='login_required')throw Error('Not a login screen');
        await this.intake.pause(row.id);
        if(!await this.intake.isPaused(row.id))throw Error('Intake not paused');
        // Recheck cancellation/expiry and screen state after pause, before reading pixels.
        const latest=await current(this.DB,this.deviceId);
        if(latest?.id!==row.id || latest.state!=='preparing' || latest.expires_at<=Date.now())return;
        if(await this.screen.state()!=='login_required')throw Error('Screen changed');
        const png=await this.screen.qrPNG();
        const envelope=await sealPNG(png,JSON.parse(leased.public_key),row.id);
        await transition(this.DB,row.id,'preparing','awaiting_scan',JSON.stringify(envelope),Date.now(),this.deviceId);
      } catch {
        // Never persist raw browser errors, pixels or credentials. Intake stays paused.
        await transition(this.DB,row.id,'preparing','failed',null,Date.now(),this.deviceId);
      }
    } finally {this.busy=false;}
  }
}

// Opt-in library only: callers must supply verified selectors and the page itself.
// It never opens or discovers a browser. Current production ingress has no adapter.
export class ExistingLoginScreen {
  constructor(page,{online,login,qr}) {
    if(!online || !login || !qr)throw Error('Verified selectors required');
    this.page=page;this.selectors={online,login,qr};
  }
  async state() {
    if(await this.page.locator(this.selectors.online).isVisible())return 'online';
    if(await this.page.locator(this.selectors.login).isVisible() && await this.page.locator(this.selectors.qr).count()===1 && await this.page.locator(this.selectors.qr).isVisible())return 'login_required';
    return 'unknown';
  }
  async qrPNG() {
    if(await this.state()!=='login_required')throw Error('Login required');
    const qr=this.page.locator(this.selectors.qr),box=await qr.boundingBox();
    if(!box || box.width<64 || box.height<64 || box.width>512 || box.height>512 || Math.abs(box.width-box.height)>4)throw Error('Unexpected QR bounds');
    return qr.screenshot({type:'png',timeout:3000});
  }
}
