const http=require('node:http');
const path=require('node:path');
const {root}=require('./config.cjs');
function call(command){return new Promise((resolve,reject)=>{
 const req=http.request({socketPath:path.join(root,'control.sock'),path:'/',method:'POST',headers:{'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const r=JSON.parse(data);if(!r.ok)throw new Error(r.error);resolve(r.result);}catch(e){reject(e);}});});
 req.on('error',reject);req.setTimeout(60000,()=>req.destroy(new Error('Browser bridge timed out')));req.end(JSON.stringify(command));
});}
module.exports={call};
if(require.main===module){const fs=require('node:fs');const input=fs.readFileSync(process.argv[2]||0,'utf8');call(JSON.parse(input)).then(result=>console.log(JSON.stringify({ok:true,result}))).catch(e=>{console.error(e.message);process.exitCode=1;});}
