import os from 'node:os';
import {randomUUID} from 'node:crypto';

const fields={
 name:{env:'WECHAT_AGENT_NAME',label:'助手名称',valid:v=>label(v)},
 deviceName:{env:'WECHAT_AGENT_DEVICE_NAME',label:'机器名称',valid:v=>label(v)},
 language:{env:'WECHAT_AGENT_LANGUAGE',label:'回复语言',valid:v=>label(v)},
 timezone:{env:'WECHAT_AGENT_TIMEZONE',label:'时区',valid:v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}}},
 style:{env:'WECHAT_AGENT_STYLE',label:'回复风格',valid:v=>['简短','详细'].includes(v)},
 monitoringHours:{env:'WECHAT_AGENT_MONITORING_HOURS',label:'接收时长',valid:v=>Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=24},
 requireTarget:{env:'WECHAT_AGENT_REQUIRE_TARGET',label:'设备定向',valid:v=>['true','false'].includes(String(v))},
};
function label(value){return typeof value==='string'&&value.trim().length>0&&value.length<=60&&!/[\r\n\[\]\x00-\x1f]/.test(value)&&!value.startsWith('/');}
export function initializeSettings(saved={},legacy={},computer={name:os.hostname(),system:os.type()}){
 return {version:1,deviceId:saved.deviceId||randomUUID(),name:legacy.name||'主咪',deviceName:`${computer.name} · ${computer.system}`.slice(0,60),language:'中文',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',style:'简短',monitoringHours:24,requireTarget:false,...saved};
}
export function effectiveSettings(saved,env=process.env){
 const result={...saved},locked=[];
 for(const [key,field] of Object.entries(fields)){
  if(env[field.env]===undefined)continue;
  const value=env[field.env];if(!field.valid(value))throw Error(`Invalid ${field.env}`);
  result[key]=key==='monitoringHours'?Number(value):key==='requireTarget'?value==='true':value;locked.push(key);
 }
 return {values:result,locked};
}
export function matchMessage(message,settings){
 if(message.direction==='outgoing'||message.text.startsWith('[AI]'))return null;
 const text=message.text;let body=null;
 if(text.startsWith('/ai '))body=text.slice(4).trim();
 else for(const separator of ['，',',','：',':'])if(text.startsWith(settings.name+separator)){body=text.slice(settings.name.length+1).trim();break;}
 if(body===null)return null;
 if(body.startsWith('[')){
  const target=body.match(/^\[([^\]]+)\]\s+([\s\S]+)$/);if(!target)return null;
  if(target[1]!==settings.deviceId)return null;
  return target[2].trim();
 }
 return settings.requireTarget?null:body;
}
export function intro(settings,state){
 const steps={name:'助手名称',deviceName:'机器名称',style:'回复风格',permission:'执行权限（开启/暂不开启）',rescue:'云端救援（需要/不需要）'};
 const resume=state.setupStep?` 正在设置：${steps[state.setupStep]}；请继续回答，或 /ai 取消设置。`:'';
 return `你好，我是${settings.name}，运行在「${settings.deviceName}」。设备 ID：${settings.deviceId}。\n${state.stage==='ready'?'已保留原设置。':'发送 /ai 默认 使用默认身份，或 /ai 设置 逐项配置。'} /ai 帮助 查看指令。${settings.requireTarget?'当前要求 /ai ['+settings.deviceId+'] 指令。':''}${state.paused?'当前已暂停任务；/ai 继续 可恢复。':''}${resume}`;
}
const help='设置：/ai 设置；查看：/ai 查看设置；改名：/ai 把你改名叫小咪；机器名称：/ai 设置 机器名称 工作 Mac；语言/时区/风格/接收时长同样设置。设备定向：/ai 设置 设备定向 true。固定入口 /ai 始终有效。多设备请使用 /ai [设备ID] 指令，且每台都开启设备定向。';
function summary(values,locked){return Object.entries(fields).map(([k,f])=>`${f.label}：${values[k]}${locked.includes(k)?'（环境变量锁定）':''}`).join('\n')+`\n设备 ID：${values.deviceId}`;}
function change(saved,key,value,locked){
 const field=fields[key];if(locked.includes(key))return `${field.label}由环境变量 ${field.env} 覆盖，请在本机修改；本次未保存。`;
 if(!field.valid(value))return `无效的${field.label}。名称限 1–60 字；风格为简短/详细；接收时长为 1–24 整数；设备定向为 true/false；时区使用如 Asia/Shanghai。`;
 saved[key]=key==='monitoringHours'?Number(value):key==='requireTarget'?value==='true':value.trim();
 return `已保存${field.label}：${saved[key]}。${key==='monitoringHours'?'下次启动生效；不会延长本轮授权或微信登录。':''}`;
}
export function configure(text,saved,state,env=process.env){
 const {values,locked}=effectiveSettings(saved,env);
 if(text==='帮助')return help;
 if(text==='查看设置')return summary(values,locked);
 if(text==='取消设置'){delete state.setupStep;return '已退出设置。已保存项保留；执行权限不变。';}
 if(text==='设置'){state.setupStep='name';return '助手叫什么？回复 /ai 名称，或 /ai 默认。随时 /ai 取消设置。';}
 const rename=text.match(/^把你改名叫(.+)$/);
 if(rename)return change(saved,'name',rename[1],locked);
 const command=text.match(/^设置 (助手名称|机器名称|语言|时区|风格|接收时长|设备定向) (.+)$/);
 if(command){const keys={'助手名称':'name','机器名称':'deviceName','语言':'language','时区':'timezone','风格':'style','接收时长':'monitoringHours','设备定向':'requireTarget'};return change(saved,keys[command[1]],command[2],locked);}
 if(text==='设置 救援'||text==='开启救援')return '云端救援是可选项。请在本机私有 .env 配置 WECHAT_RESCUE_ENABLED=true 及 Cloudflare 参数，再运行部署计划；不要在微信发送密钥。聊天不会自动部署或开启扫码。';
 if(state.setupStep){
  const step=state.setupStep;
  if(step==='name'||step==='deviceName'){
   let receipt='沿用当前名称。';
   if(text!=='默认'){receipt=change(saved,step,text,locked);if(receipt.startsWith('无效'))return receipt;}
   state.setupStep=step==='name'?'deviceName':'style';return receipt+(step==='name'?'机器叫什么？回复 /ai 名称 或 /ai 默认。':'回复风格？/ai 简短 或 /ai 详细；也可 /ai 默认。');
  }
  if(step==='style'){
   const receipt=text==='默认'?'保留当前风格。':change(saved,'style',text,locked);if(receipt.startsWith('无效'))return receipt;
   state.setupStep='permission';return receipt+'是否开启本机任务执行？/ai 开启 或 /ai 暂不开启。';
  }
  if(step==='permission'){
   if(!['开启','暂不开启'].includes(text))return '请明确回复 /ai 开启 或 /ai 暂不开启。';
   state.stage=text==='开启'?'ready':'permission';state.setupStep='rescue';return '是否需要云端救援？/ai 需要 或 /ai 不需要。';
  }
  if(step==='rescue'){
   if(!['需要','不需要'].includes(text))return '请回复 /ai 需要 或 /ai 不需要。';
   delete state.setupStep;state.rescueRequested=text==='需要';return text==='需要'?'设置已保存。请在本机私有 .env 配置救援；不要把密钥发到微信。尚未部署云端。':'设置已保存。无需 Cloudflare；现有云端资源不会自动删除。';
  }
 }
 if(state.stage!=='ready'){
  if(text==='默认'){state.stage='permission';return '已使用默认身份。任务执行仍需明确开启：/ai 开启。救援默认关闭。';}
  if(text==='开启'&&state.stage==='permission'){state.stage='ready';return '已开启任务执行，只执行你明确要求的范围。/ai 设置 可继续配置。';}
  return '尚未开启任务执行。发送 /ai 默认 或 /ai 设置；准备好后 /ai 开启。';
 }
 if(text.startsWith('设置 '))return help;
 return null;
}
