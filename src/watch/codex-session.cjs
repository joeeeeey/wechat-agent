'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');

function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', {mode:0o600});
  fs.renameSync(tmp, file);
}

// A single process owns the persisted thread. No automatic replay or fresh-thread fallback.
class CodexSession extends EventEmitter {
  constructor({binary='codex', workspace, model, effort, approvalPolicy='never', sandbox='workspace-write', threadId, spawnProcess=spawn}) {
    super(); Object.assign(this, {binary, workspace, model, effort, approvalPolicy, sandbox, spawnProcess});
    this.file = path.join(workspace, 'runtime', 'session.json');
    this.meta = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    if(!this.meta.threadId&&threadId)this.meta.threadId=threadId;
    this.pending = new Map(); this.seq = 0; this.active = null;
  }
  persist() { atomicJson(this.file, {...this.meta, backend:'codex-app-server', workspace:this.workspace,
    model:this.model, effort:this.effort, updatedAt:new Date().toISOString()}); }
  async connect() {
    if (this.ready) return this.ready;
    this.ready = this.open();
    return this.ready;
  }
  async open() {
    this.child = this.spawnProcess(this.binary, ['app-server'], {
      cwd:this.workspace, env:process.env, stdio:['pipe','pipe','pipe']
    });
    // Do not persist raw model/tool output or stderr; these can contain sensitive data.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Codex app-server disconnected; inspect before retry')));
    readline.createInterface({input:this.child.stdout}).on('line', line => {
      let event; try { event=JSON.parse(line); } catch { return; }
      this.handle(event);
    });
    await this.rpc('initialize', {clientInfo:{name:'wechat_agent', title:'WeChat Agent', version:'2.0.0'}});
    this.send({method:'initialized', params:{}});
    const params={cwd:this.workspace, model:this.model, approvalPolicy:this.approvalPolicy, sandbox:this.sandbox};
    const result = this.meta.threadId
      ? await this.rpc('thread/resume', {...params, threadId:this.meta.threadId})
      : await this.rpc('thread/start', params);
    if (this.meta.threadId && result.thread.id !== this.meta.threadId) throw new Error('Thread identity changed');
    this.meta.threadId=result.thread.id; this.persist();
    return this.meta.threadId;
  }
  send(message) { this.child.stdin.write(JSON.stringify(message)+'\n'); }
  rpc(method, params) {
    const id=++this.seq;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => {this.pending.delete(id); reject(new Error(`${method} response uncertain`));}, 60000);
      this.pending.set(id,{resolve,reject,timer});
      try { this.send({id,method,params}); } catch(e) {clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  handle(message) {
    if (message.id !== undefined && !message.method) {
      const pending=this.pending.get(message.id); if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      if(message.error) {const error=new Error(message.error.message);error.rpcCode=message.error.code;pending.reject(error);}
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      // Never fabricate a user answer or silently approve server-initiated requests.
      this.send({id:message.id,error:{code:-32601,message:'Interactive request unsupported; report blocker via WeChat'}});
      return;
    }
    const p=message.params || {};
    if(p.threadId && p.threadId!==this.meta.threadId)return;
    const active=this.active; if(!active)return;
    if(message.method==='turn/started' && !active.turnId) active.turnId=p.turn.id;
    if(p.turnId && active.turnId && p.turnId!==active.turnId)return;
    this.emit('activity', {method:message.method});
    if(message.method==='item/completed' && p.item?.type==='agentMessage') {
      if(p.item.phase==='final_answer' || !p.item.phase)active.text=p.item.text;
    }
    if(message.method==='turn/completed') {
      if(active.turnId && p.turn.id!==active.turnId)return;
      this.active=null; this.meta.lastTurnId=p.turn.id; this.meta.lastTurnStatus=p.turn.status;this.persist();
      if(p.turn.status!=='completed')active.reject(new Error('Codex turn '+p.turn.status));
      else {
        try {const result=JSON.parse(active.text || '');
          if(!['succeeded','blocked','failed'].includes(result.status)||typeof result.response!=='string'||!result.response.trim())throw new Error('Invalid structured final');
          active.resolve(result);
        } catch {active.reject(new Error('Codex did not return a valid structured final'));}
      }
    }
  }
  async start(prompt, schema) {
    await this.connect();
    if(this.active)throw new Error('A turn is already active');
    let resolve,reject;
    const done=new Promise((yes,no)=>{resolve=yes;reject=no;});
    // Attach immediately: a completion can arrive before the start RPC response.
    done.catch(()=>{});
    const active=this.active={resolve,reject,text:null,turnId:null};
    try {
      const response=await this.rpc('turn/start',{threadId:this.meta.threadId,
        input:[{type:'text',text:prompt}],cwd:this.workspace,model:this.model,
        effort:this.effort,approvalPolicy:this.approvalPolicy,outputSchema:schema});
      active.turnId=response.turn.id;
      return {turnId:active.turnId,done};
    } catch(error) {if(this.active===active)this.active=null;reject(error);throw error;}
  }
  async steer(prompt, messageId) {
    const active=this.active;
    if(!active?.turnId)return {accepted:false,reason:'no-active-turn'};
    try {
      const result=await this.rpc('turn/steer',{threadId:this.meta.threadId,expectedTurnId:active.turnId,
        input:[{type:'text',text:prompt}],clientUserMessageId:messageId});
      if(result.turnId!==active.turnId)throw new Error('Steer returned an unexpected turn');
      return {accepted:true,turnId:result.turnId};
    } catch(error) {
      // Only a definite server rejection at the completion boundary is safe to queue.
      if(error.rpcCode && /no active turn|not active|turn.*mismatch|expected.*turn/i.test(error.message))return {accepted:false,reason:'turn-completed'};
      throw error;
    }
  }
  async interrupt() {
    if(this.active?.turnId)await this.rpc('turn/interrupt',{threadId:this.meta.threadId,turnId:this.active.turnId});
  }
  fail(error) {
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();
    if(this.active){this.active.reject(error);this.active=null;}
    this.ready=null; this.emit('disconnected');
  }
  close() {this.child?.kill();}
}
module.exports={CodexSession,atomicJson};
