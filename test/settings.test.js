import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeSettings,effectiveSettings,matchMessage,configure,intro} from '../src/settings.js';
const fresh=()=>initializeSettings({}, {},{name:'test-machine',system:'TestOS'});
test('defaults and restart preserve name and device identity',()=>{
 const s=fresh();assert.equal(s.name,'主咪');assert.equal(s.deviceName,'test-machine · TestOS');
 s.name='小咪';assert.deepEqual(initializeSettings(JSON.parse(JSON.stringify(s))),s);
 assert.equal(initializeSettings({}, {name:'原名'}).name,'原名');
});
test('fixed entry survives renames; names only match at beginning and outgoing never matches',()=>{
 const s=fresh(),m=text=>matchMessage({text},s);
 assert.equal(m('/ai test'),'test');assert.equal(m('主咪，test'),'test');
 assert.equal(m('我说主咪，test'),null);assert.equal(m('[AI] /ai test'),null);
 assert.equal(matchMessage({text:'/ai test',direction:'outgoing'},s),null);
 configure('把你改名叫小咪',s,{stage:'ready'},{});
 assert.equal(m('/ai test'),'test');assert.equal(m('主咪，test'),null);assert.equal(m('小咪，test'),'test');
});
test('strict multi-device targeting admits exactly one device and rejects malformed targets',()=>{
 const a=fresh(),b=fresh();a.requireTarget=b.requireTarget=true;
 const message={text:`/ai [${a.deviceId}] 做事`};
 assert.equal(matchMessage(message,a),'做事');assert.equal(matchMessage(message,b),null);
 assert.equal(matchMessage({text:'/ai 做事'},a),null);
 assert.equal(matchMessage({text:'/ai [missing 做事'},a),null);
});
test('guided setup requires explicit execution permission and cloud request does not enable cloud',()=>{
 const s=fresh(),state={stage:'name'};
 for(const text of ['设置','小咪','工作 Mac','详细'])configure(text,s,state,{});
 assert.notEqual(state.stage,'ready');configure('随便',s,state,{});assert.notEqual(state.stage,'ready');
 configure('开启',s,state,{});assert.equal(state.stage,'ready');
 const reply=configure('需要',s,state,{});assert.match(reply,/尚未部署/);assert.equal(state.rescueRequested,true);
 assert.equal(s.name,'小咪');assert.equal(s.deviceName,'工作 Mac');assert.equal(s.style,'详细');
 assert.equal(configure('帮我检查 PR',s,state,{}),null);
});
test('default setup never grants execution implicitly, cancellation preserves permission',()=>{
 const s=fresh(),state={};configure('默认',s,state,{});assert.equal(state.stage,'permission');
 configure('开启',s,state,{});assert.equal(state.stage,'ready');
 configure('设置',s,state,{});configure('取消设置',s,state,{});assert.equal(state.stage,'ready');assert.equal(state.setupStep,undefined);
});
test('env wins and locked edits report failure without changing stored value',()=>{
 const s=fresh(),env={WECHAT_AGENT_NAME:'锁定名'};
 assert.equal(effectiveSettings(s,env).values.name,'锁定名');
 assert.match(configure('把你改名叫小咪',s,{stage:'ready'},env),/未保存/);assert.equal(s.name,'主咪');
 assert.throws(()=>effectiveSettings(s,{WECHAT_AGENT_MONITORING_HOURS:'999'}),/Invalid/);
});
test('invalid fields and task text cannot silently change configuration',()=>{
 const s=fresh(),state={stage:'ready'};
 assert.match(configure('设置 时区 garbage',s,state,{}),/无效/);
 assert.match(configure('设置 接收时长 0',s,state,{}),/无效/);
 assert.equal(configure('研究如何改名叫小咪',s,state,{}),null);assert.equal(s.name,'主咪');
 assert.match(configure('设置 接收时长 2',s,state,{}),/下次启动生效/);assert.equal(s.monitoringHours,2);
 assert.match(intro(s,state),new RegExp(s.deviceId));
});
test('restart greeting preserves pending setup and paused state',()=>{
 const s=fresh(),state={stage:'ready',paused:true};configure('设置',s,state,{});
 configure('新名称',s,state,{});
 const greeting=intro(initializeSettings(JSON.parse(JSON.stringify(s))),JSON.parse(JSON.stringify(state)));
 assert.match(greeting,/正在设置：机器名称/);assert.match(greeting,/当前已暂停/);
});
