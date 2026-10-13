const DEFAULT_MARKERS=['1111','mmmm'];
function startToken(body,config={}){
 const s=body.trim();
 for(const token of config.startTokens||['1111']){
  if(!s.startsWith(token))continue;
  const tail=s.slice(token.length);
  if(!tail)return {token,instruction:''};
  if(config.allowInstructionAfterStartToken===false)continue;
  // A delimited or Chinese instruction may follow, but 11111 / 1111abc is not a marker.
  if(/^[\s，,：:。！!、\u3400-\u9fff]/u.test(tail))return {token,instruction:tail.replace(/^[\s，,：:。！!、]+/u,'')};
 }
 return null;
}
function collectionIntent(body,config={}){
 if(config.enabled===false)return false;
 const s=body.trim();
 if(startToken(s,config))return true;
 if(/^(?:不要|别|停止|取消)/.test(s))return false;
 if(config.startPatterns)return config.startPatterns.some(p=>new RegExp(p,'u').test(s));
 return /^(?:开始)?收集(?:聊天(?:记录)?|消息|材料|内容)?(?:[，,。！!：:\s]|$)/.test(s)
  || /^(?:请|帮我|麻烦你|我想让你|我希望你)?[，,\s]*(?:把)?(?:下面|接下来|稍后|一会儿|等会)[\s\S]{0,100}(?:聊天|消息|记录|内容|材料)[\s\S]{0,60}(?:收集|读取|读一下|读下|看一下|看下|看看|接收)/.test(s)
  || /^(?:我(?:要|会|准备)?发(?:给)?你)[\s\S]{0,30}(?:一堆|一批|一些|很多|多条)[\s\S]{0,20}(?:聊天|消息|记录|材料)/.test(s)
  || /^(?:请|帮我|麻烦你)?[，,\s]*(?:收集|接收)[\s\S]{0,30}(?:下面|接下来)[\s\S]{0,30}(?:聊天|消息|记录|材料)/.test(s);
}
function stripAlias(text,aliases=['主咪','zhumi'],markers=DEFAULT_MARKERS){
 const s=text.trimStart();
 for(const alias of [...aliases].sort((a,b)=>b.length-a.length)){
  if(s.slice(0,alias.length).toLowerCase()!==alias.toLowerCase())continue;
  const tail=s.slice(alias.length);
  if(/[A-Za-z0-9_]$/.test(alias)&&/^[A-Za-z0-9_]/.test(tail)&&!startToken(tail,{startTokens:markers}))continue;
  return tail.replace(/^[\s,，:：、!！。]+/u,'').trim();
 }
 return null;
}
function isEndMarker(text,markers=DEFAULT_MARKERS,config={}){
 if(markers.includes(text.trim()))return true;
 if(config.allowAssistantPrefixOnEnd!==true)return false;
 const body=stripAlias(text,config.aliases||['主咪','zhumi'],markers);
 return body!==null&&markers.includes(body);
}
module.exports={collectionIntent,isEndMarker,stripAlias,startToken,DEFAULT_MARKERS};
