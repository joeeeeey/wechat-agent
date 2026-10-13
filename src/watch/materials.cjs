const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_BYTES=25*1024*1024;
const sourceById=(page,id)=>page.locator(`[data-zhumi-material="${id}"]`);
function selectMaterials(text,items){
 const ids=[...new Set(text.match(/\bA[1-9]\d*\b/g)||[])];
 if(ids.length)return ids.map(id=>{const m=items.find(a=>a.id===id);if(!m)throw new Error('Unknown material '+id);return m;});
 if(!/附件|文件|图片|截图|转发|这些材料|这个材料/.test(text))return [];
 const available=items.filter(m=>!m.assignedTo&&Date.now()-Date.parse(m.observedAt)<600000);
 if(available.length>1&&!/这些|所有|全部|一起|批|转发/.test(text))throw new Error('有多个待处理材料，请用 A 编号指定，或明确说“这些附件”。');
 return available;
}
async function capture(page,item,directory,config={}){
 const maxBytes=config.maxBytes||MAX_BYTES;
 if(item.path){await fs.access(item.path);return item;}
 if(item.kind==='unsupported')return {...item,representation:'visible unsupported message only',unavailable:true};
 const node=sourceById(page,item.id);
 if(await node.count()!==1||!await node.isVisible())throw new Error('材料已不在当前页面，请重新发送');
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 let imageDownload;
 if(item.kind==='image'){
  imageDownload=node.locator('.msg-image a.icon__download');
 }
 if(item.kind==='image'&&await imageDownload.count()===0){
  const image=node.locator('.msg-image img');
  if(!await image.evaluate(e=>e.complete&&e.naturalWidth>0))throw new Error('图片尚未加载');
  const file=path.join(directory,item.id+'-'+crypto.randomUUID()+'.png');
  await image.screenshot({path:file,timeout:10000});await fs.chmod(file,0o600);
  return {...item,path:file,representation:'rendered image preview; not original-resolution file',bytes:(await fs.stat(file)).size};
 }
 if(!['file','image'].includes(item.kind))return {...item,representation:'visible text'};
 const card=item.kind==='image'?imageDownload:node.locator('a.msg-file');
 if(item.kind==='image')await node.hover();
 if(await card.count()!==1)throw new Error('文件下载控件不可用');
 // Native page download action only. No private API, cookie, signed URL or page navigation.
 const downloadPromise=page.waitForEvent('download',{timeout:30000});
 downloadPromise.catch(()=>{});
 await card.click({timeout:5000});
 let download;
 try{download=await downloadPromise;}catch{throw new Error('文件下载未返回；请在页面确认文件是否过期。不会自动再次点击。');}
 const suggested=path.basename(download.suggestedFilename()).replace(/[\x00-\x1f]/g,'_');
 const suffix=/\.(txt|md|csv|json|pdf|png|jpe?g|webp|docx|xlsx|zip)$/i.exec(suggested)?.[0]?.toLowerCase()||'.bin';
 // WeChat may use a request URL as the download name. Never persist its query tokens.
 const filename=/[?&=]|skey|token|cgi-bin/i.test(suggested)?(item.kind==='image'?'image':'attachment')+suffix:suggested.slice(0,160)||'attachment.bin';
 const partial=path.join(directory,item.id+'-'+crypto.randomUUID()+'.partial');
 try{
  const stream=await download.createReadStream();if(!stream)throw new Error('下载内容不可用');
  const out=await fs.open(partial,'wx',0o600);let bytes=0;
  try{for await(const chunk of stream){bytes+=chunk.length;if(bytes>maxBytes){stream.destroy();await download.cancel();throw new Error('附件超过配置的大小限制');}await out.write(chunk);}}finally{await out.close();}
  const file=partial.replace(/\.partial$/,'-'+filename);await fs.rename(partial,file);
  return {...item,path:file,filename,bytes,representation:'file downloaded through visible WeChat UI'};
 }catch(error){await fs.rm(partial,{force:true});throw error;}
 finally{await download.delete().catch(()=>{});}
}
module.exports={selectMaterials,capture,MAX_BYTES};
