import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {collectionIntent,isEndMarker,stripAlias}=createRequire(import.meta.url)('../src/watch/collection.cjs');
test('collection intent recognizes short and natural phrasings',()=>{
 for(const s of ['收集','开始收集聊天','下面的聊天记录你都要读取下','帮我收集接下来的聊天记录','我发你一堆聊天','收集，帮我总结争议点'])assert.equal(collectionIntent(s),true,s);
 for(const s of ['不要收集','收集是什么意思','如何实现收集聊天功能','查看这个 PR'])assert.equal(collectionIntent(s),false,s);
});
test('only a standalone configured marker closes a batch',()=>{
 assert.ok(isEndMarker(' 1111 '));assert.ok(isEndMarker('mmmm'));
 for(const s of ['主咪1111','主咪，1111','主咪mmmm','zhumi1111','zhumi mmmm'])assert.equal(isEndMarker(s),false,s);
 for(const s of ['订单1111','1111还有下文','mmmmmm','1111\n第二行'])assert.equal(isEndMarker(s),false);
 assert.ok(isEndMarker('DONE',['DONE']));assert.equal(isEndMarker('1111',['DONE']),false);
 assert.equal(isEndMarker('主咪1111',['1111'],{allowAssistantPrefixOnEnd:false}),false);
 assert.equal(isEndMarker('主咪1111 后面还有内容'),false);
});
test('aliases and collection patterns are configurable',()=>{
 assert.equal(stripAlias('主咪收集'),'收集');assert.equal(stripAlias('zhumi123任务'),null);
 assert.ok(collectionIntent('开始存材料',{startPatterns:['^开始存材料$']}));
 assert.equal(collectionIntent('收集',{enabled:false}),false);
 assert.ok(isEndMarker('阿木done',['done'],{aliases:['阿木'],allowAssistantPrefixOnEnd:true}));
 assert.ok(collectionIntent(stripAlias('主咪1111')));
 assert.ok(collectionIntent(stripAlias('主咪，1111')));
 assert.ok(collectionIntent(stripAlias('zhumi1111')));
 assert.ok(collectionIntent('BEGIN',{startTokens:['BEGIN']}));
 assert.equal(collectionIntent('1111',{startTokens:['BEGIN']}),false);
});
test('explicit 1111 start wins with trailing instructions and does not match longer numbers',()=>{
 for(const s of ['主咪1111 总结下下面说的聊天内容','主咪1111，总结待办','主咪1111总结下面的聊天'])assert.ok(collectionIntent(stripAlias(s)),s);
 for(const s of ['11111','1111abc'])assert.equal(collectionIntent(s),false,s);
 assert.equal(collectionIntent('1111 总结',{allowInstructionAfterStartToken:false}),false);
});
