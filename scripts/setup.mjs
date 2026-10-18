#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import readline from 'node:readline/promises';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {home,root,configPath,defaults,validate,atomic}=require('../src/watch/config.cjs');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shellQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function run(command,args,options={}){
 const result=spawnSync(command,args,{cwd:repo,stdio:'inherit',...options});
 if(result.error||result.status!==0)throw Error(`Command failed: ${path.basename(command)} (see local output)`);
}
function executable(name){
 for(const dir of (process.env.PATH||'').split(path.delimiter)){
  const file=path.resolve(dir,name);try{fs.accessSync(file,fs.constants.X_OK);return file;}catch{}
 }
 return null;
}
function help(command,args){const r=spawnSync(command,args,{encoding:'utf8',timeout:15000});if(r.error||r.status!==0)throw Error('Cannot inspect the selected CLI. Check its installation.');return r.stdout;}
function installSkill(kind){
 const base=kind==='codex'?path.join(os.homedir(),'.codex','skills'):path.join(os.homedir(),'.claude','skills');
 const dest=path.join(base,'wechat-agent'),source=path.join(repo,'skills/wechat-agent');
 fs.mkdirSync(base,{recursive:true});
 try{
  const stat=fs.lstatSync(dest);
  if(!stat.isSymbolicLink())throw Error(`Existing skill directory preserved: ${dest}. Move it yourself before installing this skill.`);
  const prior=fs.readlinkSync(dest);
  if(prior!==source&&!prior.startsWith(path.join(home,'releases'))&&!prior.startsWith(path.join(home,'app')))throw Error(`Existing skill symlink belongs to another installation: ${dest}`);
  fs.unlinkSync(dest);
 }catch(e){if(e.code!=='ENOENT')throw e;}
 fs.symlinkSync(source,dest,'dir');console.log('Skill installed:',dest);
}
export function renderLauncher({installHome=home,repository=repo,node=process.execPath}={}){
 return `#!/bin/sh\nexport WECHAT_AGENT_HOME=${shellQuote(installHome)}\nexport PATH=${shellQuote(path.dirname(node))}:"$PATH"\nif [ "\${1:-}" = setup ]; then\n shift\n exec ${shellQuote(node)} ${shellQuote(path.join(repository,'scripts/setup.mjs'))} "$@"\nfi\nexec ${shellQuote(node)} ${shellQuote(path.join(repository,'src/watch/cli.cjs'))} "$@"\n`;
}
function writeLauncher(){
 const bin=path.join(home,'bin');fs.mkdirSync(bin,{recursive:true,mode:0o700});
 const launcher=renderLauncher();
 const file=path.join(bin,'wechat-agent');fs.writeFileSync(file,launcher,{mode:0o700});fs.chmodSync(file,0o700);return file;
}
export async function setup(){
 if(process.platform!=='darwin')throw Error('Guided setup currently supports macOS only');
 if(Number(process.versions.node.split('.')[0])<22)throw Error('Node 22+ required; use the README bootstrap command');
 process.umask(0o077);
 // /dev/tty keeps prompts interactive when bootstrap is piped to bash.
 const input=fs.createReadStream('/dev/tty'),output=fs.createWriteStream('/dev/tty');
 const rl=readline.createInterface({input,output});
 const ask=async(q,fallback='')=>(await rl.question(q+(fallback?` [${fallback}]`:'')+': ')).trim()||fallback;
 const yes=async(q,fallback=false)=>/^(y|yes|是)$/i.test(await ask(q,fallback?'y':'n'));
 try{
  console.log('WeChat Agent — macOS setup. Use an already installed and authenticated Codex or Claude CLI.');
  let c=fs.existsSync(configPath)?readExisting():defaults();
  const installed=['codex','claude'].filter(executable);
  if(!installed.length)throw Error('Install and sign in to Codex or Claude CLI first, then rerun setup.');
  let backend=await ask(`选择 AI CLI (${installed.join('/')})`,installed.includes(c.harness.backend)?c.harness.backend:installed[0]);
  if(!installed.includes(backend))throw Error('Choose one of the installed CLIs');
  const command=executable(backend);
  const flags=help(command,backend==='codex'?['exec','--help']:['--help']);
  if(backend==='codex'&&!flags.includes('--output-schema'))throw Error('Upgrade Codex CLI: --output-schema support is required');
  if(backend==='claude'&&!['--output-format','--resume','--permission-prompts','--permission-mode','--dangerously-skip-permissions'].every(f=>flags.includes(f)))throw Error('Upgrade Claude CLI: JSON output, resume and full-permission mode support required');
  c.harness={...c.harness,backend,command,args:backend===c.harness.backend?c.harness.args||[]:[]};
  c.assistant.displayName=await ask('助手名称',c.assistant.displayName);
  const aliases=(await ask('唤醒别名（逗号分隔，名称会自动保留）',c.assistant.aliases.join(','))).split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  c.assistant.aliases=[...new Set([c.assistant.displayName,...aliases])];
  c.device.displayName=await ask('机器显示名称',c.device.displayName);
  c.workspace=path.resolve((await ask('AI 工作目录（默认是独立持久工作区）',c.workspace)).replace(/^~(?=\/|$)/,os.homedir()));
  c.monitoring.hours=Number(await ask('本轮接收时长（小时，最多 168）',String(c.monitoring.hours)));
  c.collection.endMarkers=(await ask('收集结束符（逗号分隔；单独发送）',c.collection.endMarkers.join(','))).split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  c.collection.semantic.enabled=await yes('是否启用 AI 语义识别收集意图？明确口令始终直接匹配',false);
  if(c.collection.semantic.enabled){
   if(backend==='claude'&&!['--json-schema','--tools','--strict-mcp-config','--no-session-persistence'].every(f=>flags.includes(f)))throw Error('Upgrade Claude CLI for semantic classification');
   c.collection.semantic={...c.collection.semantic,backend,command,args:[]};
  }
  if(backend==='codex'){
   const permission=await ask('Codex 权限：1=只读，2=工作区写入，3=全机权限（默认）','3');
   const sandbox={'1':'read-only','2':'workspace-write','3':'danger-full-access'}[permission];if(!sandbox)throw Error('Invalid permission choice');
   c.harness.sandbox=sandbox;c.harness.approvalPolicy='never';
   console.log('非交互执行不会停下来审批；权限不足时会回报阻碍。');
  }else{
   const permission=await ask('Claude 权限：1=沿用本机限制，2=全权限（与本机 Codex 全机模式一致）','2');
   c.harness.permissionMode={'1':'dontAsk','2':'bypassPermissions'}[permission];
   if(!c.harness.permissionMode)throw Error('Invalid permission choice');
   console.log(c.harness.permissionMode==='bypassPermissions'?'Claude 将以全权限模式运行，不等待交互批准。':'Claude 将沿用本机权限；需要批准的操作会回报阻碍。');
  }
  c.execution.enabled=await yes('允许通过此微信入口执行你明确请求的任务？',false);
  validate(c);fs.mkdirSync(c.workspace,{recursive:true,mode:0o700});atomic(configPath,c);
  for(const name of installed)if(await yes(`安装 wechat-agent skill 到 ${name}？`,name===backend))installSkill(name);
  c.rescue.enabled=await yes('配置可选 Cloudflare 救援/状态页？默认无需云服务',false);
  if(c.rescue.enabled){
   const env=path.join(home,'rescue.env');
   if(!fs.existsSync(env)){
    let template=fs.readFileSync(path.join(repo,'.env.example'),'utf8').replace('WECHAT_RESCUE_ENABLED=false','WECHAT_RESCUE_ENABLED=true').replace('WECHAT_RESCUE_DEVICE_ID=my-computer',`WECHAT_RESCUE_DEVICE_ID=${c.device.id}`);
    template+=`\nWECHAT_RESCUE_STATE_PATH=${path.join(root,'health.json')}\n`;
    fs.writeFileSync(env,template,{mode:0o600});
   }
   console.log('请在本机文件中填写 Cloudflare token/account/zone、域名、Access team 和允许登录的邮箱。不要发到微信。\n'+env);
   run('open',['-e',env]);
   await ask('保存后按回车继续（留空配置可以稍后再做）');
   c.rescue.envFile=env;
   c.rescue.qrEnabled=await yes('启用救援页显示本机微信登录二维码，并在扫码成功后恢复接收新任务？',false);
   let rescueEnv=fs.readFileSync(env,'utf8');
   rescueEnv=rescueEnv.replace(/^WECHAT_RESCUE_QR_ENABLED=.*$/gm,'');
   fs.writeFileSync(env,rescueEnv+'\nWECHAT_RESCUE_QR_ENABLED='+String(c.rescue.qrEnabled)+'\n',{mode:0o600});
   const python=executable('python3');
   if(python&&await yes('现在校验配置并查看只读部署计划？',false)){
    run(python,['scripts/wechat_rescue_apply.py','--env-file',env]);
    if(await yes('按刚才计划创建/更新 Cloudflare 资源？',false)){
     run(python,['scripts/wechat_rescue_apply.py','--env-file',env,'--apply']);
     // Runtime needs the same D1 identity as the deployed site; keep it private.
     run(python,['scripts/wechat_rescue_runtime_config.py','--env-file',env]);
     if(await yes('安装本机状态心跳 LaunchAgent？',false))run(python,['scripts/wechat_rescue_install.py','--env-file',env,'--apply']);
    }
   }else console.log('救援配置已保留，尚未部署。稍后按 docs/runbook/wechat-rescue.md 完成；本地微信不受影响。');
  }
  atomic(configPath,c);
  // Also supports `npm run setup` from a source checkout.
  run('npm',['ci']);run(process.execPath,[path.join(repo,'node_modules/playwright/cli.js'),'install','chromium']);
  const launcher=writeLauncher();console.log('配置已保存：'+configPath+'\n以后使用：'+launcher+' start | status | stop | restart');
  console.log('扫码连接后，在微信发送 /ai help 查看用法、/ai config 查看配置、/ai status 查看状态。\n例如：/ai config set 回复风格 详细；也可以用唤醒词让助手按自然语言修改偏好。检查和反馈间隔仅限本机配置后重启 watch。');
  if(c.execution.enabled&&await yes('现在打开 Playwright、扫码并开始接收任务？',true))run(process.execPath,[path.join(repo,'src/watch/cli.cjs'),'start','--hours',String(c.monitoring.hours)]);
 }finally{rl.close();input.destroy();output.end();}
}
function readExisting(){return validate(JSON.parse(fs.readFileSync(configPath,'utf8')));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))setup().catch(e=>{console.error(e.message);process.exitCode=1;});
