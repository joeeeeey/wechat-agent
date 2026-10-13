const fs=require('node:fs');
const path=require('node:path');
const {atomic}=require('./config.cjs');
async function checkLoginReminders({root,settings={},snapshot,send,now=Date.now()}){
 if(settings.enabled===false||snapshot.connection!=='online'||!snapshot.loginDetectedAt)return;
 const file=path.join(root,'login-reminders.json');
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 if(state.loginDetectedAt!==snapshot.loginDetectedAt)state={loginDetectedAt:snapshot.loginDetectedAt,sent:{}};
 const expiry=Date.parse(state.loginDetectedAt)+(settings.estimatedHours||24)*3600000;
 if(now>=expiry)return;
 const due=(settings.beforeMinutes||[60,30,10]).filter(m=>!state.sent[m]&&now>=expiry-m*60000);
 if(!due.length)return;
 const threshold=Math.min(...due);
 for(const m of due)state.sent[m]={state:m===threshold?'sending':'skipped_late',at:new Date(now).toISOString()};
 atomic(file,state);
 try{
  await send(`登录续期提醒 🐱 按约 ${settings.estimatedHours||24} 小时有效期估算，还剩约 ${Math.ceil((expiry-now)/60000)} 分钟。实际掉线时间可能提前或延后；重新扫码后会自动重新计时，不会刷新页面。`);
  state.sent[threshold].state='verified';
 }catch{state.sent[threshold].state='delivery_uncertain';}
 atomic(file,state);
}
module.exports={checkLoginReminders};
