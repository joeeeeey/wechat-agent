function connectedMessage(c){
 const alias=c.assistant.aliases[0];
 const lines=[
  `已连接，我会每 ${c.monitoring.pollSeconds} 秒检查新消息 🐾`,
  `发“${alias}”加任务，也可发“/ai 帮我检查项目”。`,
  '',
  '⚙️ 直接在微信里查看和修改配置：',
  '/ai help — 查看命令和用法',
  '/ai config — 查看当前配置和可修改项',
  '/ai status — 查看运行状态和监控截止时间',
  '/ai config set 助手名 小助手 — 修改助手名称',
  '/ai config set 回复风格 详细 — 修改回复风格',
  `也可以说“${alias}，把回复风格改为详细，以后用中文回复”。`,
  '助手名、唤醒词、机器名等偏好可热更新；改名后 /ai 始终可用。检查和反馈间隔仅限本机配置，重启 watch 生效。',
 ];
 if(c.collection.enabled!==false){
  const token=(c.collection.startTokens||['1111'])[0];
  const instruction=c.collection.allowInstructionAfterStartToken===false?'':' 总结下面的聊天';
  const endings=(c.collection.endMarkers||['1111','mmmm']).map(s=>`“${s}”`).join(' 或 ');
  lines.push('',`收集聊天可发“${alias} ${token}${instruction}”，最后单独发 ${endings}。收集期间配置命令也只算材料，请在收集结束后修改配置。`);
 }
 lines.push('图片和文件单独到达不会触发回复。');
 return lines.join('\n');
}
module.exports={connectedMessage};
