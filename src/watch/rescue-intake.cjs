const fs=require('node:fs');
const path=require('node:path');
const {root,atomic}=require('./config.cjs');
const file=path.join(root,'rescue-intake.json');
function read(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {paused:false};return {paused:true,invalid:true};}}
function pause(attemptId){atomic(file,{paused:true,attemptId,pausedAt:new Date().toISOString()});}
function resume(attemptId){const state=read();if(state.attemptId!==attemptId)throw Error('Rescue attempt changed');atomic(file,{...state,paused:false,resumedAt:new Date().toISOString()});}
module.exports={read,pause,resume};
