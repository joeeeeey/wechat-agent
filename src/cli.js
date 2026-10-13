import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { FileHelper } from './browser.js';
import { promptFor, runHarness } from './core.js';
import {initializeSettings,effectiveSettings,matchMessage,intro,configure} from './settings.js';
process.umask(0o077);
const root = path.resolve(process.env.WECHAT_AGENT_HOME ?? path.join(os.homedir(), '.local/share/wechat-agent'));
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const save = (name, value) => { const target = path.join(root, name); fs.writeFileSync(target + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(target + '.tmp', target); };
const read = (name, fallback) => { const p = path.join(root, name); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback; };
if (process.argv[2] === 'init') {
  if (fs.existsSync(path.join(root, 'config.json'))) throw new Error('Config already exists; edit it locally');
  save('config.json', { command: '/absolute/path/to/your-agent-wrapper', args: [], cwd: os.homedir(), timeoutMs: 600000 });
  console.log(`Edit ${path.join(root, 'config.json')}. Harness reads prompt on stdin and returns only final plain text on stdout.`);
  process.exit(0);
}
const config = read('config.json', null);
if (!config || !path.isAbsolute(config.command) || !path.isAbsolute(config.cwd)) throw new Error('Run init and configure absolute harness command/cwd first');
if (!fs.existsSync(config.command)) throw new Error('Configured harness executable does not exist');
// Exclusive lock deliberately survives crashes; never steal a possibly active session.
const lock = path.join(root, 'session.lock');
try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch { throw new Error(`Session lock exists: ${lock}. Confirm its process has stopped before removing it.`); }
let state = read('state.json', { stage: 'name', jobs: [], history: [] });
for (const job of state.jobs) if (['running', 'reply_pending'].includes(job.status)) job.status = 'interrupted_no_retry';
const settings=initializeSettings(read('settings.json',{}),state);
save('settings.json',settings);
let effective=effectiveSettings(settings).values;
const deadline=Date.now()+effective.monitoringHours*3600000;
save('state.json', state);
const status = value => save('health.json', { state: value, updatedAt: new Date().toISOString() });
let context;
try {
  context = await chromium.launchPersistentContext(path.join(root, 'browser-profile'), { headless: false });
  const page = context.pages()[0] ?? await context.newPage();
  // Exactly one initial navigation for this NEW dedicated session. No reload/reconnect loop.
  await page.goto('https://filehelper.weixin.qq.com/');
  const bridge = new FileHelper(page, config.selectors);
  status('waiting_for_scan');
  console.log('Scan the QR in the dedicated browser. Keep this page open. Do not expose its profile or QR remotely.');
  while (!(await bridge.loggedIn())) {
    if(Date.now()>=deadline)throw new Error('Monitoring authorization expired before login');
    await new Promise(r => setTimeout(r, 1000));
  }
  const seen = new Set((await bridge.messages()).map(m => m.id));
  status('connected');
  await bridge.send(intro(effective,state));
  while (Date.now()<deadline) {
    if (!(await bridge.loggedIn())) { status('disconnected'); console.log('Login lost. Tasks paused; page left untouched.'); break; }
    const messages = await bridge.messages();
    for (const message of messages) {
      if(Date.now()>=deadline)break;
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      effective=effectiveSettings(settings).values;
      const text = matchMessage(message,effective);
      if (!text) continue;
      if (text === '暂停') { state.paused = true; save('state.json', state); await bridge.send('已暂停新任务。/ai 继续 可恢复。'); continue; }
      if (text === '继续') { state.paused = false; save('state.json', state); await bridge.send('已恢复。'); continue; }
      const settingReply=configure(text,settings,state);
      if(settingReply!==null){save('settings.json',settings);save('state.json',state);await bridge.send(settingReply);continue;}
      if (state.paused) continue;
      const job = { id: randomUUID(), status: 'running', startedAt: new Date().toISOString() };
      state.jobs.push(job); state.jobs = state.jobs.slice(-200); save('state.json', state);
      await bridge.send(`开始处理任务 ${job.id.slice(0, 8)}。`);
      let result;
      try { result = await runHarness(config, promptFor({...state,name:effective.name,preferences:JSON.stringify({userPreferences:state.preferences,deviceName:effective.deviceName,language:effective.language,timezone:effective.timezone,style:effective.style})}, text, state.history)); }
      catch { job.status = 'failed'; save('state.json', state); await bridge.send('Agent 执行失败或超时；不会自动重试。请在本机检查 harness，操作可能已经部分执行。'); continue; }
      job.status = 'reply_pending'; save('state.json', state);
      await bridge.send(result.slice(0, 3500) + (result.length > 3500 ? '\n（回复过长，已截断）' : ''));
      job.status = 'completed'; state.history = [...state.history, { request: text, response: result.slice(0, 3500) }].slice(-6); save('state.json', state);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  if(Date.now()>=deadline){status('monitoring_expired');await bridge.send('本轮任务接收时间已到期；浏览器保持原样，未自动重新登录。');}
} catch {
  status('blocked'); console.error('Session blocked. No automatic task replay or browser recovery. Inspect locally; reply delivery may be uncertain.');
  process.exitCode = 1;
} finally {
  // Leave the existing page untouched; the owner decides when to close/restart it.
  if (!context) fs.unlinkSync(lock);
}
