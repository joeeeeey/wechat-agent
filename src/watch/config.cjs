const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID}=require('node:crypto');
const home=path.resolve(process.env.WECHAT_AGENT_HOME||path.join(os.homedir(),'.local/share/wechat-agent'));
const root=path.join(home,'watch');
const configPath=path.join(root,'config.json');
function defaults(){return {
 schemaVersion:1,workspace:path.join(root,'workspace'),
 assistant:{displayName:'主咪',aliases:['主咪','zhumi']},
 device:{id:randomUUID(),displayName:os.hostname()},
 monitoring:{hours:24,pollSeconds:20,progressSeconds:45},
 loginReminders:{enabled:true,estimatedHours:24,beforeMinutes:[60,30,10]},
 browser:{channel:'chromium'},
 harness:{backend:'codex',command:'codex',args:[],approvalPolicy:'never',sandbox:'workspace-write'},
 collection:{enabled:true,startTokens:['1111'],allowInstructionAfterStartToken:true,endMarkers:['1111','mmmm'],allowAssistantPrefixOnEnd:false,semantic:{enabled:false,timeoutMs:25000,minimumConfidence:0.9,maxInputChars:1600}},
 attachments:{enabled:true,maxBytes:25*1024*1024},
 execution:{enabled:false},rescue:{enabled:false}
};}
function validate(c){
 if(!path.isAbsolute(c.workspace||''))throw new Error('workspace must be an absolute path');
 if(!['codex','claude','command'].includes(c.harness?.backend))throw new Error('Unsupported harness backend');
 if(typeof c.harness.command!=='string'||!c.harness.command)throw new Error('Configure a local harness command');
 if(c.harness.args&&!Array.isArray(c.harness.args))throw new Error('harness.args must be an argv array');
 if(c.harness.backend==='codex'&&!['read-only','workspace-write','danger-full-access'].includes(c.harness.sandbox||'workspace-write'))throw new Error('Invalid Codex sandbox');
 for(const text of [c.assistant?.displayName,c.device?.id,c.device?.displayName,...c.assistant?.aliases||[]])if(typeof text!=='string'||!text.trim()||text.length>100||/[\r\n\x00]/.test(text))throw new Error('Invalid identity/alias');
 if(!c.assistant?.aliases?.length)throw new Error('At least one assistant alias is required');
 const m=c.monitoring;if(!m||!Number.isFinite(m.hours)||m.hours<=0||m.hours>168||!Number.isFinite(m.pollSeconds)||m.pollSeconds<1||m.pollSeconds>300||!Number.isFinite(m.progressSeconds)||m.progressSeconds<10)throw new Error('Invalid monitoring interval/duration');
 const col=c.collection||{};
 if(c.attachments?.maxBytes!==undefined&&(!Number.isSafeInteger(c.attachments.maxBytes)||c.attachments.maxBytes<=0))throw new Error('Invalid attachment byte limit');
 if(c.loginReminders&&(!Number.isFinite(c.loginReminders.estimatedHours)||c.loginReminders.estimatedHours<=0||!Array.isArray(c.loginReminders.beforeMinutes)||c.loginReminders.beforeMinutes.some(m=>!Number.isFinite(m)||m<=0)))throw new Error('Invalid login reminder settings');
 for(const list of [col.startTokens||['1111'],col.endMarkers||['1111','mmmm']])if(!Array.isArray(list)||!list.length||list.some(v=>typeof v!=='string'||!v.trim()||v.length>80||/[\r\n]/.test(v)))throw new Error('Invalid collection markers');
 for(const pattern of col.startPatterns||[])new RegExp(pattern,'u');
 if(col.semantic?.enabled&&(!col.semantic.command||!Array.isArray(col.semantic.args)))throw new Error('Semantic classifier needs command and args');
 if(col.semantic?.enabled&&(!Number.isFinite(col.semantic.timeoutMs)||col.semantic.timeoutMs<1000||col.semantic.timeoutMs>30000||!Number.isFinite(col.semantic.minimumConfidence)||col.semantic.minimumConfidence<0||col.semantic.minimumConfidence>1||!['codex','claude'].includes(col.semantic.backend)))throw new Error('Invalid semantic classifier settings');
 return c;
}
function readConfig(){return validate(JSON.parse(fs.readFileSync(configPath,'utf8')));}
function atomic(file,data){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
module.exports={home,root,configPath,defaults,validate,readConfig,atomic};
