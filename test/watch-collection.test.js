import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {collectionIntent,collectionCandidate,isEndMarker,stripAlias}=createRequire(import.meta.url)('../src/watch/collection.cjs');
test('only collection-related language goes to optional semantic routing',()=>{
 for(const body of ['在吗','在吗？','你好','帮我检查这个 PR','总结刚才的聊天','读取附件 A1'])assert.equal(collectionCandidate(body),false,body);
 for(const body of ['收集是什么意思','我接下来会搬几段群里的讨论过来，先攒着，等我说完再一起看','我待会发你一些截图','先别回复，等我发完'])assert.equal(collectionCandidate(body),true,body);
});
test('collection intent recognizes short and natural phrasings',()=>{
 for(const s of ['收集','开始收集聊天','下面的聊天记录你都要读取下','帮我收集接下来的聊天记录','我发你一堆聊天','收集，帮我总结争议点'])assert.equal(collectionIntent(s),true,s);
 for(const s of ['不要收集','收集是什么意思','如何实现收集聊天功能','查看这个 PR'])assert.equal(collectionIntent(s),false,s);
});
test('only a standalone configured marker closes a batch',()=>{
 assert.ok(isEndMarker(' 1111 '));assert.ok(isEndMarker('mmmm'));
 for(const s of ['小助手1111','小助手，1111','小助手mmmm','ai1111','ai mmmm'])assert.equal(isEndMarker(s),false,s);
 for(const s of ['订单1111','1111还有下文','mmmmmm','1111\n第二行'])assert.equal(isEndMarker(s),false);
 assert.ok(isEndMarker('DONE',['DONE']));assert.equal(isEndMarker('1111',['DONE']),false);
 assert.equal(isEndMarker('小助手1111',['1111'],{allowAssistantPrefixOnEnd:false}),false);
 assert.equal(isEndMarker('小助手1111 后面还有内容'),false);
});
test('aliases and collection patterns are configurable',()=>{
 assert.equal(stripAlias('小助手收集'),'收集');assert.equal(stripAlias('ai123任务'),null);
 assert.ok(collectionIntent('开始存材料',{startPatterns:['^开始存材料$']}));
 assert.equal(collectionIntent('收集',{enabled:false}),false);
 assert.ok(isEndMarker('阿木done',['done'],{aliases:['阿木'],allowAssistantPrefixOnEnd:true}));
 assert.ok(collectionIntent(stripAlias('小助手1111')));
 assert.ok(collectionIntent(stripAlias('小助手，1111')));
 assert.ok(collectionIntent(stripAlias('ai1111')));
 assert.ok(collectionIntent('BEGIN',{startTokens:['BEGIN']}));
 assert.equal(collectionIntent('1111',{startTokens:['BEGIN']}),false);
});
test('explicit 1111 start wins with trailing instructions and does not match longer numbers',()=>{
 for(const s of ['小助手1111 总结下下面说的聊天内容','小助手1111，总结待办','小助手1111总结下面的聊天'])assert.ok(collectionIntent(stripAlias(s)),s);
 for(const s of ['11111','1111abc'])assert.equal(collectionIntent(s),false,s);
 assert.equal(collectionIntent('1111 总结',{allowInstructionAfterStartToken:false}),false);
});
