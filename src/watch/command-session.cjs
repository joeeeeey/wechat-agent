const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {atomic}=require('./config.cjs');
// Provider-neutral stdin/stdout adapter. Claude's JSON result additionally persists its session ID.
class CommandSession extends EventEmitter {
 constructor({workspace,harness}){super();this.workspace=workspace;this.harness=harness;this.file=path.join(workspace,'runtime/command-session.json');this.meta=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{};}
 async connect(){return this.meta.threadId||null;}
 async start(prompt){
  if(this.active)throw Error('A turn is already active');
  const turnId=randomUUID(),h=this.harness,args=[...(h.args||[])];
  if(h.backend==='claude'){
   const permissionMode=h.permissionMode||'bypassPermissions';
   args.push('-p','--output-format','json','--permission-mode',permissionMode,'--permission-prompts','none');
   if(permissionMode==='bypassPermissions')args.push('--dangerously-skip-permissions');
   if(this.meta.threadId)args.push('--resume',this.meta.threadId);
  }
  const child=spawn(h.command,args,{cwd:this.workspace,env:process.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',failure;this.active={turnId,child};
  const stop=()=>{try{process.platform==='win32'?child.kill():process.kill(-child.pid,'SIGTERM');}catch{}};
  const timer=setTimeout(()=>{failure=Error('Harness timeout; effects must be checked before retry');stop();},h.timeoutMs||600000);
  const done=new Promise((resolve,reject)=>{
   child.stdout.on('data',c=>{output+=c;this.emit('activity',{});if(output.length>1000000){failure=Error('Harness output limit');stop();}});
   child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
   child.on('error',()=>{clearTimeout(timer);this.active=null;reject(Error('Cannot launch configured harness'));});
   child.on('close',code=>{
    clearTimeout(timer);this.active=null;
    if(failure||code!==0){reject(failure||Error('Harness execution failed'));return;}
    try{
     let text=output.trim();
     if(h.backend==='claude'){
      const result=JSON.parse(text);if(result.is_error)throw Error('Claude returned an error');
      if(!result.session_id||!result.result)throw Error('Claude returned no session/result');
      if(this.meta.threadId&&this.meta.threadId!==result.session_id)throw Error('Claude session identity changed');
      this.meta.threadId=result.session_id;atomic(this.file,this.meta);text=result.result;
     }
     let result;try{result=JSON.parse(text);}catch{result={status:'succeeded',response:text};}
     if(!['succeeded','blocked','failed'].includes(result.status)||typeof result.response!=='string'||!result.response.trim())throw Error('Invalid harness result');
     resolve(result);
    }catch(e){reject(e);}
   });
  });
  done.catch(()=>{});child.stdin.end(prompt);return {turnId,done};
 }
 async steer(){return {accepted:false,reason:'serial-adapter'};}
 async interrupt(){if(this.active){try{process.kill(-this.active.child.pid,'SIGTERM');}catch{}}}
 close(){void this.interrupt();}
}
module.exports={CommandSession};
