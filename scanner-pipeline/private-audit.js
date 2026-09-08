const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');}
function hash(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function copyTree(src,dest){fs.cpSync(src,dest,{recursive:true,force:true,filter:p=>!p.includes(`${path.sep}private-publications${path.sep}`)&&!p.endsWith(`${path.sep}private-publications`)});}
function validateReport(reportDir,model,review){
  const errors=[],warnings=[];const htmlPath=path.join(reportDir,'index.html');
  if(!fs.existsSync(htmlPath))errors.push('Generate the Audit before publishing.');
  if(!review?.publishing?.humanApproved)errors.push('Human approval is required before a private link can be created.');
  if(!model?.clinic?.name||model.clinic.name==='Clinic')errors.push('Clinic name is missing.');
  if(model?.economics?.status!=='scenario-calculated')warnings.push('Revenue economics still need clinic inputs.');
  const html=fs.existsSync(htmlPath)?fs.readFileSync(htmlPath,'utf8'):'';
  if(/Loading clinic|\[Your image here\]/i.test(html))errors.push('The Audit contains an unfinished placeholder.');
  for(const value of Object.values(model?.visuals||{})){if(value&&!/^https?:|^data:/i.test(value)&&!fs.existsSync(path.join(reportDir,value)))errors.push(`Missing report image: ${value}`);}
  return {ok:errors.length===0,errors,warnings};
}
function publishPrivateAudit({reportDir,model,review,baseUrl,expiresInDays=30}){
  const validation=validateReport(reportDir,model,review);if(!validation.ok){const error=new Error(validation.errors.join(' '));error.validation=validation;throw error;}
  const token=crypto.randomBytes(32).toString('base64url');const id=crypto.randomUUID();
  const root=path.join(reportDir,'private-publications');const dir=path.join(root,id);fs.mkdirSync(dir,{recursive:true});
  for(const name of ['index.html','owner-report-model.json','assets','evidence']){const source=path.join(reportDir,name);if(fs.existsSync(source))copyTree(source,path.join(dir,name));}
  const storePath=path.join(root,'index.json');const store=readJson(storePath,{schemaVersion:'2.3.0',publications:[]});
  const publishedAt=new Date();const expiresAt=new Date(publishedAt.getTime()+Math.max(1,Number(expiresInDays)||30)*86400000);
  const record={id,tokenHash:hash(token),clinic:model.clinic,publishedAt:publishedAt.toISOString(),expiresAt:expiresAt.toISOString(),revokedAt:null,status:'active',warnings:validation.warnings};
  store.publications.unshift(record);writeJson(storePath,store);
  return {record,url:`${String(baseUrl).replace(/\/$/,'')}/private/${token}`,validation};
}
function findPublication(reportDir,token){const store=readJson(path.join(reportDir,'private-publications','index.json'),{publications:[]});const digest=hash(token);const record=store.publications.find(x=>x.tokenHash===digest);if(!record||record.revokedAt||new Date(record.expiresAt)<=new Date())return null;return {...record,dir:path.join(reportDir,'private-publications',record.id)};}
function publishingState(reportDir){const store=readJson(path.join(reportDir,'private-publications','index.json'),{publications:[]});const events=readJson(path.join(reportDir,'private-publications','activity.json'),[]);const counts={audit_opened:0,evidence_viewed:0,preview_started:0,implementation_requested:0};for(const event of events)if(Object.hasOwn(counts,event.type))counts[event.type]++;return {publications:store.publications.map(({tokenHash,...x})=>x),counts,lastEvent:events[0]||null};}
function revokePublication(reportDir,id){const file=path.join(reportDir,'private-publications','index.json');const store=readJson(file,{schemaVersion:'2.3.0',publications:[]});const record=store.publications.find(x=>x.id===id);if(!record)return false;record.revokedAt=new Date().toISOString();record.status='revoked';writeJson(file,store);return true;}
function recordActivity(reportDir,record,type,req){const allowed=['audit_opened','evidence_viewed','preview_started','implementation_requested'];if(!allowed.includes(type))return;const file=path.join(reportDir,'private-publications','activity.json');const events=readJson(file,[]);const cookie=String(req?.headers?.cookie||'').match(/(?:^|;\s*)eden_audit_session=([^;]+)/)?.[1]||crypto.randomBytes(12).toString('hex');events.unshift({type,publicationId:record.id,at:new Date().toISOString(),sessionHash:hash(cookie),userAgent:String(req?.headers?.['user-agent']||'').slice(0,160)});writeJson(file,events.slice(0,5000));return cookie;}
function safePublicFile(root,relative){const full=path.resolve(root,relative||'index.html');return full===path.resolve(root)||full.startsWith(path.resolve(root)+path.sep)?full:null;}
module.exports={validateReport,publishPrivateAudit,findPublication,publishingState,revokePublication,recordActivity,safePublicFile};
