const crypto=require('node:crypto');
const {readConfig,validate,atomic,configPath}=require('./config.cjs');
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=100&&!/[\r\n\x00]/.test(v);
const bool=v=>typeof v==='boolean';
const list=v=>Array.isArray(v)&&v.length>0&&v.length<=20&&v.every(label);
const number=(min,max)=>v=>Number.isFinite(v)&&v>=min&&v<=max;
const fields={
 'assistant.displayName':{name:'助手名',check:label},
 'assistant.aliases':{name:'唤醒词',check:list},
 'device.displayName':{name:'机器名',check:label},
 'response.language':{name:'语言',check:label},
 'response.style':{name:'回复风格',check:v=>['简短','详细'].includes(v)},
 'monitoring.pollSeconds':{name:'检查间隔',check:number(1,300)},
 'monitoring.progressSeconds':{name:'进度间隔',check:number(10,3600)},
 'monitoring.hours':{name:'接收时长',check:number(0.01,168),effect:'next_start'},
 'collection.enabled':{name:'收集开关',check:bool},
 'collection.startTokens':{name:'开始标记',check:list},
 'collection.endMarkers':{name:'结束符',check:list},
 'collection.allowInstructionAfterStartToken':{name:'开始后附带说明',check:bool},
 'collection.semantic.enabled':{name:'语义识别',check:bool},
 'loginReminders.enabled':{name:'登录提醒',check:bool},
 'loginReminders.estimatedHours':{name:'预计登录时长',check:number(1,168)},
 'loginReminders.beforeMinutes':{name:'提前提醒分钟',check:v=>Array.isArray(v)&&v.length>0&&v.length<=10&&v.every(number(1,10080))},
 'attachments.enabled':{name:'附件读取',check:bool},
 'attachments.maxBytes':{name:'附件大小上限',check:v=>Number.isSafeInteger(v)&&v>0&&v<=1024*1024*1024}
};
const get=(object,key)=>key.split('.').reduce((value,part)=>value?.[part],object);
function put(object,key,value){const parts=key.split('.');let dest=object;for(const p of parts.slice(0,-1))dest=dest[p]??={};dest[parts.at(-1)]=value;}
const revision=c=>crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
function safeView(c=readConfig()){
 const values={};for(const key of Object.keys(fields)){const value=get(c,key);if(value!==undefined)values[key]=value;}
 values['response.language']??='中文';values['response.style']??='简短';
 return {revision:revision(c),values,localOnly:['workspace','device.id','harness','browser','execution','rescue'],note:'配置不包含密钥、执行器参数或私有路径。接收时长仅用于尚无截止时间的首次启动；已有监控需本机 start --hours 显式续期。'};
}
function canonical(key){return Object.hasOwn(fields,key)?key:Object.keys(fields).find(k=>fields[k].name===key);}
function updateConfig(patch,{expectedRevision}={}){
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).length>20)throw Error('请提供 1–20 个配置字段。');
 const old=readConfig();if(expectedRevision&&revision(old)!==expectedRevision)throw Error('配置已被其他操作更新，请重新读取后再修改。');
 const next=structuredClone(old),changes=[];
 next.response??={language:'中文',style:'简短'};
 for(const [requested,value] of Object.entries(patch)){
  const key=canonical(requested);if(!key)throw Error('这个字段不能通过微信修改。用 /ai config 查看可修改项；执行器、权限、路径、救援凭据请在本机配置。');
  if(!fields[key].check(value))throw Error(`配置值无效：${key}。未保存任何改动。`);
  put(next,key,typeof value==='string'?value.trim():Array.isArray(value)?value.map(v=>typeof v==='string'?v.trim():v):value);changes.push({key,effect:fields[key].effect||'live'});
 }
 if(Object.keys(patch).some(k=>canonical(k)==='assistant.displayName'))next.assistant.aliases=[...new Set([next.assistant.displayName,...next.assistant.aliases])];
 validate(next);atomic(configPath,next);
 return {...safeView(next),changes,message:changes.map(({key,effect})=>`${fields[key].name}（${key}）：${JSON.stringify(get(next,key))} — ${effect==='next_start'?'仅首次启动默认值；已有监控需本机 start --hours 续期':'已保存，自动生效；后续任务使用新值'}`).join('\n')+'\n不刷新浏览器。正在收集的批次沿用开始时的结束符。'};
}
function describe(c=readConfig()){
 const view=safeView(c);
 return '当前可配置项：\n'+Object.entries(view.values).map(([key,value])=>`${fields[key].name} · ${key} = ${JSON.stringify(value)}`).join('\n')+'\n\n修改示例：\n/ai config set 检查间隔 10\n/ai config set 助手名 小咪\n/ai config set 结束符 ["1111","done"]\n也可以说“主咪，把检查间隔改为 10 秒”。\n'+view.note;
}
const HELP='系统命令（改名后 /ai 仍可用）：\n/ai help — 查看帮助\n/ai config — 查看可修改配置（不显示密钥）\n/ai config set 字段 值 — 修改配置\n/ai status — 查看监控、会话与收集状态\n/ai 任务内容 — 固定任务入口\n\n示例：/ai config set 检查间隔 10\n/ai config set 结束符 ["1111","mmmm"]\n也可让助手按你的自然语言要求改配置。\n\n收集：/ai 1111 总结下面的聊天；结束时单独发 1111 或 mmmm。收集期间所有消息（包括 /ai 命令）都是材料，结束后才处理。';
function parseSystem(text){
 const match=/^\/ai(?:\s+([\s\S]*))?$/i.exec(text.trim());if(!match)return null;
 const body=(match[1]||'help').trim();
 if(/^(help|帮助)$/i.test(body))return {kind:'help'};
 if(/^(status|状态)$/i.test(body))return {kind:'status'};
 if(/^(config|配置|查看配置)$/i.test(body))return {kind:'config'};
 const set=/^(?:config|配置)\s+set\s+(\S+)\s+([\s\S]+)$/i.exec(body);
 if(set){let value;try{value=JSON.parse(set[2]);}catch{value=set[2];}return {kind:'set',patch:{[set[1]]:value}};}
 if(/^(config|配置)\s+set(?:\s|$)/i.test(body))return {kind:'error',message:'格式：/ai config set 字段 值；数组和布尔值使用 JSON，如 ["1111","mmmm"] 或 true。'};
 return {kind:'task',body};
}
function applyLive(current,next){
 const result=structuredClone(current);
 for(const [key,spec] of Object.entries(fields))if(spec.effect!=='next_start'&&get(next,key)!==undefined)put(result,key,get(next,key));
 return result;
}
module.exports={fields,safeView,updateConfig,describe,parseSystem,applyLive,HELP};
