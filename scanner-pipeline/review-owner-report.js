const fs=require('fs');
const path=require('path');
const http=require('http');
const {exec}=require('child_process');
const {buildOwnerReportModel,buildOwnerReviewTemplate,writeOwnerReportFiles}=require('./owner-report');
const {generateAuditVisuals}=require('./audit-visuals');
const {publishPrivateAudit,findPublication,publishingState,revokePublication,recordActivity,safePublicFile}=require('./private-audit');
const {syncPublishedAuditJob}=require('../audits/durable/publish-sync-v240');
const {profileFromModel,aiReply,renderPreviewPage}=require('./receptionist-preview');
const {normalizeActionPlanReview}=require('./action-plan-v250');

function resolveSnapshot(input){
  if(!input)throw new Error('Snapshot path required.');
  const full=path.resolve(input);
  if(!fs.existsSync(full))throw new Error(`Snapshot not found: ${full}`);
  return full;
}
function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8');}
function safeText(v){return typeof v==='string'?v:'';}
function normalizeReportCopy(value,depth=0){
  if(depth>8)return null;
  if(typeof value==='string')return value.trim();
  if(Array.isArray(value))return value.map(x=>normalizeReportCopy(x,depth+1)).filter(x=>typeof x==='string');
  if(!value||typeof value!=='object')return {};
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(['__proto__','prototype','constructor'].includes(key))continue;
    if(typeof item==='string'||Array.isArray(item)||(item&&typeof item==='object'))out[key]=normalizeReportCopy(item,depth+1);
  }
  return out;
}

function normalizeEvidenceResolutions(value={}){
  const allowed=new Set(['resolved','accepted','withheld']);
  const out={};
  if(!value||typeof value!=='object'||Array.isArray(value))return out;
  for(const [rawId,item] of Object.entries(value).slice(0,100)){
    const id=safeText(rawId).trim().slice(0,160);
    if(!id||!item||typeof item!=='object')continue;
    const decision=safeText(item.decision).trim().toLowerCase();
    if(!allowed.has(decision))continue;
    const note=safeText(item.note).trim().slice(0,2000);
    out[id]={
      decision,
      note,
      updatedAt:safeText(item.updatedAt).trim()||new Date().toISOString()
    };
  }
  return out;
}

function validateEvidenceResolutions(manifest,review={}){
  const contradictions=Array.isArray(manifest?.evidenceIntelligence?.contradictions)
    ? manifest.evidenceIntelligence.contradictions
    : [];
  const blocking=contradictions.filter(x=>x&&x.blocksPublication===true);
  const resolutions=normalizeEvidenceResolutions(review.evidenceResolutions||{});
  const unresolved=[];

  for(const conflict of blocking){
    const id=safeText(conflict.id).trim();
    const resolution=id?resolutions[id]:null;
    if(!resolution){
      unresolved.push({
        id:id||'unknown-conflict',
        title:safeText(conflict.title).trim()||'Blocking evidence contradiction',
        reason:'No reviewer resolution has been recorded.'
      });
      continue;
    }

    if(resolution.note.length<8){
      unresolved.push({
        id,
        title:safeText(conflict.title).trim()||id,
        decision:resolution.decision,
        reason:'Add a short reviewer note explaining why this contradiction is resolved, accepted, or withheld.'
      });
    }
  }

  return {
    ok:unresolved.length===0,
    blockingCount:blocking.length,
    resolvedCount:blocking.length-unresolved.length,
    unresolved,
    resolutions
  };
}

function normalizeReview(body={},template={}){
  const addFindings=Array.isArray(body.addFindings)?body.addFindings.map((x,i)=>({
    id:safeText(x.id).trim()||`manual-${Date.now()}-${i+1}`,
    include:x.include!==false,
    title:safeText(x.title).trim(),
    diagnosis:safeText(x.diagnosis).trim(),
    recommendedFix:safeText(x.recommendedFix).trim(),
    edenImplementation:safeText(x.edenImplementation).trim(),
    priority:safeText(x.priority).trim()||'secondary',
    confidence:safeText(x.confidence).trim()||'verified-by-reviewer'
  })).filter(x=>x.title||x.diagnosis||x.recommendedFix):[];
  return {
    schemaVersion:'2.3.0',
    note:'Human review saved from Eden Owner Review Studio.',
    visuals:{
      coverImage:safeText(body.visuals?.coverImage).trim()||null,
      fixImage:safeText(body.visuals?.fixImage).trim()||null,
      beforeImage:safeText(body.visuals?.beforeImage).trim()||null,
      afterImage:safeText(body.visuals?.afterImage).trim()||null
    },
    primaryOpportunityId:safeText(body.primaryOpportunityId).trim()||template.primaryOpportunityId||null,
    primaryOpportunity:{
      title:safeText(body.primaryOpportunity?.title).trim(),
      diagnosis:safeText(body.primaryOpportunity?.diagnosis).trim(),
      recommendedFix:safeText(body.primaryOpportunity?.recommendedFix).trim(),
      edenImplementation:safeText(body.primaryOpportunity?.edenImplementation).trim()
    },
    opportunityOrder:Array.isArray(body.opportunityOrder)?body.opportunityOrder.filter(Boolean):[],
    hideFindingIds:Array.isArray(body.hideFindingIds)?body.hideFindingIds.filter(Boolean):[],
    addFindings,
    reportCopy:normalizeReportCopy(body.reportCopy),
    actionPlan:normalizeActionPlanReview(body.actionPlan||{},template.actionPlan||{}),
    preview:{assistantName:safeText(body.preview?.assistantName).trim()||'Mia',greeting:safeText(body.preview?.greeting).trim(),verifiedFacts:(Array.isArray(body.preview?.verifiedFacts)?body.preview.verifiedFacts:safeText(body.preview?.verifiedFacts).split(/\r?\n/)).map(safeText).map(x=>x.trim()).filter(Boolean).slice(0,30),implementationUrl:safeText(body.preview?.implementationUrl).trim()},
    evidenceResolutions:normalizeEvidenceResolutions(body.evidenceResolutions||template.evidenceResolutions||{}),
    publishing:{humanApproved:body.publishing?.humanApproved===true,expiresInDays:Math.min(365,Math.max(1,Number(body.publishing?.expiresInDays)||30))},
    reviewerNote:safeText(body.reviewerNote).trim()
  };
}
function createReviewApp({snapshotPath,port=4242,openBrowser=true}={}){
  const snapshot=resolveSnapshot(snapshotPath);
  const manifest=readJson(snapshot);
  if(!manifest)throw new Error(`Could not parse snapshot: ${snapshot}`);
  // The snapshot's own directory is canonical. A copied snapshot may retain an
  // absolute outputDir from an older version; following it would silently edit
  // the wrong Audit tree (for example V2.2.44 while reviewing V2.3.1).
  const outDir=path.dirname(snapshot);
  const reportDir=path.join(outDir,'owner-report');
  fs.mkdirSync(reportDir,{recursive:true});
  const reviewPath=path.join(reportDir,'owner-review.json');
  const baseModel=buildOwnerReportModel(manifest,{});
  const template=buildOwnerReviewTemplate(baseModel);
  if(!fs.existsSync(reviewPath))writeJson(reviewPath,{...template,schemaVersion:'2.3.0',addFindings:[]});

  const routes={};
  function json(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj));}
  async function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',c=>{body+=c;if(body.length>2_000_000){reject(new Error('Request too large'));req.destroy();}});req.on('end',()=>{try{resolve(body?JSON.parse(body):{});}catch(e){reject(e);}});req.on('error',reject);});}
  routes['GET /']=async(_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(reviewHtml());};
  routes['GET /api/state']=async(_req,res)=>{
    const review=readJson(reviewPath,template);
    const reviewedModel=buildOwnerReportModel(manifest,{ownerReview:review});
    json(res,200,{version:'2.3.0',clinic:reviewedModel.clinic,economics:baseModel.economics,editableCopy:reviewedModel.copy,reviewPath,reportPath:path.join(reportDir,'index.html'),candidates:baseModel.topOpportunities||[],currentTop:reviewedModel.topOpportunities||[],review,actionPlan:reviewedModel.actionPlan||null,publishing:publishingState(reportDir),evidenceIntelligence:manifest.evidenceIntelligence||null});
  };
  routes['POST /api/save']=async(req,res)=>{
    try{const body=await readBody(req);const normalized=normalizeReview(body,template);writeJson(reviewPath,normalized);const result=writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath,coverImage:normalized.visuals.coverImage,fixImage:normalized.visuals.fixImage,beforeImage:normalized.visuals.beforeImage,afterImage:normalized.visuals.afterImage});json(res,200,{ok:true,reviewPath,reportPath:result.htmlPath});}
    catch(error){json(res,400,{ok:false,error:String(error.message||error)});}
  };
  routes['POST /api/reset']=async(_req,res)=>{writeJson(reviewPath,{...template,schemaVersion:'2.3.0',addFindings:[]});const result=writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath});json(res,200,{ok:true,reportPath:result.htmlPath});};
  routes['POST /api/open-report']=async(req,res)=>{const report=path.join(reportDir,'index.html');if(!fs.existsSync(report))writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath});const url=`http://${req.headers.host}/draft/`;if(process.platform==='darwin')exec(`open ${JSON.stringify(url)}`);json(res,200,{ok:true,reportPath:report,url});};
  routes['POST /api/revoke']=async(req,res)=>{const body=await readBody(req);const ok=revokePublication(reportDir,safeText(body.id));json(res,ok?200:404,{ok,error:ok?null:'Publication not found.'});};
  routes['POST /api/generate-visuals']=async(_req,res)=>{const review=readJson(reviewPath,template);const model=buildOwnerReportModel(manifest,{ownerReview:review});const made=generateAuditVisuals(model,path.join(reportDir,'generated-assets'));review.visuals={...(review.visuals||{}),coverImage:made.summary,fixImage:made.fix};writeJson(reviewPath,review);const result=writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath,coverImage:made.summary,fixImage:made.fix});json(res,200,{ok:true,visuals:made,reportPath:result.htmlPath});};
  
  routes['GET /api/evidence-files']=async(req,res)=>{
    try{
      const files=evidenceFilesForReview(outDir);
      json(res,200,{ok:true,files});
    }catch(error){
      json(res,400,{ok:false,error:String(error.message||error)});
    }
  };
routes['POST /api/publish']=async(req,res)=>{try{const body=await readBody(req);const review=readJson(reviewPath,template);if(body.humanApproved===true)review.publishing={...(review.publishing||{}),humanApproved:true,expiresInDays:Number(body.expiresInDays)||review.publishing?.expiresInDays||30};const resolutionValidation=validateEvidenceResolutions(manifest,review);if(!resolutionValidation.ok){const error=new Error('Resolve every blocking evidence contradiction before private publication.');error.validation=resolutionValidation;throw error;}if(!review.visuals?.coverImage&&!review.visuals?.fixImage){const draft=buildOwnerReportModel(manifest,{ownerReview:review});const made=generateAuditVisuals(draft,path.join(reportDir,'generated-assets'));review.visuals={...(review.visuals||{}),coverImage:made.summary,fixImage:made.fix};}writeJson(reviewPath,review);const result=writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath,coverImage:review.visuals?.coverImage,fixImage:review.visuals?.fixImage,beforeImage:review.visuals?.beforeImage,afterImage:review.visuals?.afterImage});const model=readJson(result.modelPath);const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0];const proto=forwarded||'http';const baseUrl=process.env.EDEN_PUBLIC_BASE_URL||`${proto}://${req.headers.host}`;const published=publishPrivateAudit({reportDir,model,review,baseUrl,expiresInDays:review.publishing.expiresInDays});const durableSync=await syncPublishedAuditJob({outDir,reportUrl:published.url,report:{publicationId:published.record.id,expiresAt:published.record.expiresAt,evidenceResolutionSummary:resolutionValidation,evidenceResolutions:review.evidenceResolutions||{}}});json(res,200,{ok:true,url:published.url,expiresAt:published.record.expiresAt,warnings:published.validation.warnings,durableSync});}catch(error){json(res,400,{ok:false,error:String(error.message||error),validation:error.validation||null});}};
  
function evidenceFilesForReview(root){
  const allowed=new Set(['.png','.jpg','.jpeg','.webp','.json','.html','.htm','.txt','.md','.pdf']);
  const skipNames=new Set(['node_modules','.git']);
  const out=[];
  function walk(dir){
    for(const name of fs.readdirSync(dir)){
      if(skipNames.has(name))continue;
      const full=path.join(dir,name);
      let stat;try{stat=fs.statSync(full);}catch{continue;}
      if(stat.isDirectory()){walk(full);continue;}
      if(!stat.isFile())continue;
      const ext=path.extname(name).toLowerCase();
      if(!allowed.has(ext))continue;
      const rel=path.relative(root,full).split(path.sep).join('/');
      if(rel.startsWith('../')||rel==='..')continue;
      out.push({
        path:rel,
        name:path.basename(rel),
        bytes:stat.size,
        contentType:contentType(full)
      });
    }
  }
  walk(root);
  return out.sort((a,b)=>a.path.localeCompare(b.path));
}

function evidenceKeywords(value){
  return String(value||'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .split(/\s+/)
    .filter(x=>x.length>=3&&!['the','and','for','with','from','public','evidence','scanner','direct','observed','profile','clinic'].includes(x));
}

function scoreEvidenceFile(file,query){
  const hay=(file.path+' '+file.name).toLowerCase();
  const words=evidenceKeywords(query);
  let score=0;
  for(const word of words){
    if(hay.includes(word))score+=3;
  }
  if(/google|maps/.test(query)&&/google|maps/.test(hay))score+=4;
  if(/facebook|messenger/.test(query)&&/facebook|messenger/.test(hay))score+=4;
  if(/website|homepage|phone|booking|mobile/.test(query)&&/website|home|phone|booking|mobile/.test(hay))score+=3;
  if(/\.(png|jpg|jpeg|webp)$/.test(file.name))score+=1;
  if(/snapshot\.json$/.test(file.path))score+=1;
  return score;
}

function contentType(file){return ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file).toLowerCase()]||'application/octet-stream');}
  const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);if(pathname.startsWith('/draft/')){if(!fs.existsSync(path.join(reportDir,'index.html')))writeOwnerReportFiles(outDir,manifest,{ownerReviewPath:reviewPath});const model=readJson(path.join(reportDir,'owner-report-model.json'),{});const suffix=pathname.slice('/draft'.length);if(req.method==='POST'&&suffix==='/preview/chat'){const body=await readBody(req);return json(res,200,{ok:true,...await aiReply(profileFromModel(model),body.message,body.history)});}if(suffix==='/preview/'||suffix==='/preview/index.html'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(renderPreviewPage(profileFromModel(model),{apiPath:'chat',implementationPath:'implementation'}));}if(suffix==='/preview/implementation'){const target=model.preview?.implementationUrl||process.env.EDEN_IMPLEMENTATION_URL;if(target){res.writeHead(302,{location:target});return res.end();}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<h1>Preview only</h1><p>Add an implementation URL in Review Studio before publication.</p>');}let relative=suffix.replace(/^\//,'');if(!relative||relative.endsWith('/'))relative+='index.html';const file=safePublicFile(reportDir,relative);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'content-type':contentType(file),'cache-control':'no-store','x-robots-tag':'noindex, nofollow, noarchive'});return res.end(fs.readFileSync(file));}const privateMatch=pathname.match(/^\/private\/([^/]+)(\/.*)?$/);if(privateMatch){const token=privateMatch[1],suffix=privateMatch[2]||'';const publication=findPublication(reportDir,token);if(!publication){res.writeHead(404,{'content-type':'text/html; charset=utf-8'});return res.end('<h1>Private Audit link unavailable</h1><p>This link is invalid, expired or revoked.</p>');}if(!suffix){res.writeHead(302,{location:`/private/${token}/`});return res.end();}const model=readJson(path.join(publication.dir,'owner-report-model.json'),{});if(req.method==='POST'&&suffix==='/preview/chat'){const body=await readBody(req);const reply=await aiReply(profileFromModel(model),body.message,body.history);return json(res,200,{ok:true,...reply});}if(suffix==='/preview/'||suffix==='/preview/index.html'){const cookie=recordActivity(reportDir,publication,'preview_started',req);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','set-cookie':`eden_audit_session=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`});return res.end(renderPreviewPage(profileFromModel(model),{apiPath:'chat',implementationPath:'implementation'}));}if(suffix==='/preview/implementation'){recordActivity(reportDir,publication,'implementation_requested',req);const target=model.preview?.implementationUrl||process.env.EDEN_IMPLEMENTATION_URL;if(target){res.writeHead(302,{location:target});return res.end();}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<meta name="viewport" content="width=device-width"><div style="font:18px Inter,Arial;padding:12vw;color:#11143f"><h1>Implementation interest recorded ✓</h1><p>Eden can now follow up with the clinic about a tailored setup.</p></div>');}let relative=suffix.replace(/^\//,'');if(!relative||relative.endsWith('/'))relative+='index.html';const file=safePublicFile(publication.dir,relative);if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}let event=null;if(relative==='index.html')event='audit_opened';else if(relative==='evidence/index.html')event='evidence_viewed';const cookie=event?recordActivity(reportDir,publication,event,req):null;const headers={'content-type':contentType(file),'cache-control':'private, no-store','x-robots-tag':'noindex, nofollow, noarchive'};if(cookie)headers['set-cookie']=`eden_audit_session=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;res.writeHead(200,headers);return res.end(fs.readFileSync(file));}
const evidenceMatch=pathname.match(/^\/review-evidence\/(.+)$/);
if(req.method==='GET'&&evidenceMatch){
  const relative=decodeURIComponent(evidenceMatch[1]).replace(/^\/+/,'');
  const file=safePublicFile(outDir,relative);
  if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404,{'content-type':'text/plain'});
    return res.end('Evidence file not found');
  }
  res.writeHead(200,{
    'content-type':contentType(file),
    'cache-control':'private, no-store',
    'x-robots-tag':'noindex, nofollow, noarchive'
  });
  return res.end(fs.readFileSync(file));
}
const key=`${req.method} ${pathname}`;const handler=routes[key];if(!handler){res.writeHead(404,{'content-type':'text/plain'});return res.end('Not found');}await handler(req,res);}catch(error){json(res,500,{ok:false,error:String(error.message||error)});}});
  server.listen(port,process.env.EDEN_REVIEW_HOST||'127.0.0.1',()=>{
    const actualPort=server.address()?.port||port;
    const url=`http://127.0.0.1:${actualPort}`;
    console.log(`Eden Owner Review Studio: ${url}`);
    console.log(`Review file: ${reviewPath}`);
    console.log('Keep this Terminal window open while reviewing. Press Ctrl+C when finished.');
    if(openBrowser&&process.platform==='darwin')exec(`open ${JSON.stringify(url)}`);
  });
  return {server,reviewPath,reportDir};
}

function reviewHtml(){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eden Owner Review Studio</title><style>
:root{--ink:#10241d;--muted:#64756d;--line:#dce6e1;--paper:#f6f8f6;--green:#173d31;--soft:#e9f1ed;--warm:#f6efe2;--gold:#b78b45;--red:#8c3e2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1180px;margin:auto;padding:28px}.top{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:22px}.brand{font-weight:900;letter-spacing:.18em;font-size:12px}.top-right{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.pill{border:1px solid var(--line);background:white;padding:8px 12px;border-radius:999px;font-size:12px}.connection{font-weight:800}.connection.ok{background:#e5f4eb;color:#17603b;border-color:#c9e6d5}.connection.bad{background:#f8e9e6;color:var(--red);border-color:#edcec7}.hero{background:var(--green);color:white;border-radius:24px;padding:28px 32px;margin-bottom:18px}.hero h1{font-family:Georgia,serif;font-size:38px;margin:6px 0}.hero p{margin:0;color:#cfddd6}.app-error{display:none;background:#fff1ee;color:#7b3025;border:1px solid #e8c2ba;border-radius:14px;padding:12px 14px;margin:0 0 16px;font-weight:700;white-space:pre-wrap}.app-error.show{display:block}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:16px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:16px}.card h2{font-family:Georgia,serif;font-size:25px;margin:0 0 14px}.card h3{font-family:Georgia,serif;font-size:20px;margin:8px 0}.label{display:block;text-transform:uppercase;letter-spacing:.12em;font-size:9px;font-weight:900;color:var(--muted);margin:14px 0 6px}input,textarea,select{width:100%;border:1px solid #cedbd5;border-radius:10px;background:#fbfcfb;color:var(--ink);font:inherit;padding:10px 11px}textarea{min-height:88px;resize:vertical}.primary{background:var(--warm);border:0}.candidate{border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0}.candidate.primary-candidate{background:var(--soft)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.row>*{flex:1}.btn{border:0;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer;background:var(--green);color:white}.btn.secondary{background:var(--gold)}.btn.light{background:#e7efeb;color:var(--ink)}.btn.danger{background:#f6e6e2;color:var(--red)}.btn.small{padding:7px 10px;font-size:12px}.sticky{position:sticky;bottom:12px;background:rgba(246,248,246,.94);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;gap:9px;box-shadow:0 8px 28px rgba(16,36,29,.09)}.status{font-size:12px;color:var(--muted);align-self:center;margin-left:auto}.money{display:grid;grid-template-columns:1fr 1fr;gap:10px}.money>div{background:var(--soft);border-radius:12px;padding:12px}.money strong{font-family:Georgia,serif;font-size:22px;display:block}.manual{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.hint{font-size:12px;color:var(--muted)}@media(max-width:850px){.grid{grid-template-columns:1fr}.wrap{padding:16px}.hero h1{font-size:32px}.sticky{flex-wrap:wrap}.money{grid-template-columns:1fr}}

.evidence-drawer{position:fixed;inset:0;background:#10151fcc;z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:5vh 3vw;overflow:auto}.evidence-drawer.show{display:flex}.evidence-shell{width:min(1100px,94vw);background:white;border-radius:18px;box-shadow:0 24px 80px #0005;padding:18px}.evidence-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;padding-bottom:10px;z-index:2}.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.evidence-file{border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0}.evidence-file img{width:100%;height:240px;object-fit:contain;background:#f5f6f5;border-radius:8px}.evidence-file iframe{width:100%;height:260px;border:0;background:#f5f6f5;border-radius:8px}.evidence-file a{word-break:break-all}.evidence-file .path{font-size:11px;color:var(--muted);word-break:break-all;margin-top:6px}.inspect-btn{margin-top:8px}@media(max-width:760px){.evidence-grid{grid-template-columns:1fr}.evidence-shell{width:96vw}}
.evidence-intel{border-color:#cadbd3}.intel-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0 16px}.intel-stat{background:#f3f7f5;border:1px solid var(--line);border-radius:12px;padding:10px}.intel-stat strong{display:block;font-family:Georgia,serif;font-size:22px}.intel-section{margin-top:16px}.intel-item{border:1px solid var(--line);border-radius:12px;padding:12px;margin:8px 0;background:#fbfcfb}.intel-item.blocking{border-color:#e2aaa0;background:#fff3f0}.intel-item.unknown{background:#f7f7f5}.intel-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.intel-badge{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.intel-badge.verified{background:#dff2e7;color:#17603b}.intel-badge.supported{background:#e6eef8;color:#294f78}.intel-badge.probable{background:#fff1cf;color:#765616}.intel-badge.unknown{background:#eceeed;color:#59635e}.intel-badge.block{background:#f6ded9;color:#8c3e2f}.intel-meta{font-size:11px;color:var(--muted);margin-top:5px;word-break:break-word}
.action-edit{border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0;background:#fbfcfb}.action-edit.off{opacity:.58}.action-edit-top{display:flex;gap:10px;align-items:center}.action-edit-top input[type="checkbox"]{width:auto}.action-edit-badges{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.action-edit-badges span{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;border-radius:999px;padding:4px 7px;background:var(--soft)}.action-edit textarea{min-height:68px}.action-source{font-size:10px;color:var(--muted);word-break:break-word;margin-top:8px}.resolution-box{margin-top:12px;padding:12px;border-radius:10px;background:#f7f9f8;border:1px dashed #cad7d1}.resolution-box.blocking{background:#fff8f6;border-color:#e0b5ac}.resolution-box select,.resolution-box textarea{margin-top:6px}.resolution-box textarea{min-height:68px}.resolution-status{font-size:11px;font-weight:800;margin-top:7px}.resolution-status.ok{color:#17603b}.resolution-status.pending{color:#8c3e2f}
.intel-reason{margin:7px 0 0}.intel-empty{font-size:12px;color:var(--muted);padding:10px 0}@media(max-width:700px){.intel-summary{grid-template-columns:1fr 1fr}}.publish{background:linear-gradient(145deg,#11143f,#342665);color:#fff}.publish .hint{color:#d9d5f3}.publish input{background:#fff}.signals{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.signals div{background:#ffffff14;border-radius:10px;padding:10px}.signals strong{display:block;font-size:22px}.private-link{word-break:break-all;background:#ffffff14;padding:10px;border-radius:10px;display:none;margin-top:10px}.check{display:flex;gap:9px;align-items:flex-start;margin:12px 0}.check input{width:auto;margin-top:4px}
</style><script>
window.__edenStudioVisibleError=function(message){var box=document.getElementById('appError');var conn=document.getElementById('connection');if(box){box.textContent='Review Studio error: '+String(message||'Unknown browser error');box.classList.add('show');}if(conn){conn.textContent='Studio disconnected';conn.className='pill connection bad';}};
window.addEventListener('error',function(event){window.__edenStudioVisibleError(event.message||event.error||'Browser script failed.');});
window.addEventListener('unhandledrejection',function(event){window.__edenStudioVisibleError(event.reason&&event.reason.message?event.reason.message:event.reason||'Unhandled browser error.');});
</script></head><body><div class="wrap"><div class="top"><div class="brand">EDEN CLINIC NETWORK</div><div class="top-right"><div class="pill connection bad" id="connection">Studio disconnected</div><div class="pill">Owner Review Studio · V2.2.50</div></div></div><div id="appError" class="app-error"></div><div class="hero"><div id="clinic">Loading clinic…</div><h1>Edit the lean owner Audit.</h1><p>Each report area is edited in one place: eyebrow, headline, body and visual stay together.</p></div><div class="grid"><div><div class="card"><h2>1. Audit headline</h2><p class="hint">Clinic identity, eyebrow, headline, body and optional hero image.</p><div id="heroFields"></div><label class="label">Hero image path (optional)</label><input id="cover" placeholder="/Users/.../hero.jpg"></div><div class="card primary"><h2>2. Loss, opportunity and fix</h2><div class="money"><div><span class="label">Calculated revenue at risk</span><strong id="risk">—</strong></div><div><span class="label">Calculated recoverable</span><strong id="recover">—</strong></div></div><p class="hint">Calculated values stay visible here. The displayed report values and all tile wording are editable below.</p><div id="coreFields"></div><label class="label">Primary opportunity</label><select id="primarySelect"></select><label class="label">Problem headline</label><textarea id="title"></textarea><label class="label">Problem body</label><textarea id="diagnosis"></textarea><label class="label">Fix headline</label><textarea id="fix"></textarea><label class="label">Fix body</label><textarea id="eden"></textarea></div></div><div><div class="card"><h2>3. Show the change</h2><p class="hint">Use one fix image, or separate before/after images. If all image paths are blank, the clean text comparison remains.</p><div id="visualFields"></div><label class="label">Single fix image (optional; replaces comparison)</label><input id="fixImage" placeholder="/Users/.../fix.jpg"><div class="row"><div><label class="label">Before image (optional)</label><input id="beforeImage" placeholder="/Users/.../before.jpg"></div><div><label class="label">After image (optional)</label><input id="afterImage" placeholder="/Users/.../after.jpg"></div></div></div><div class="card"><h2>4. Try the solution</h2><div id="solutionFields"></div></div><div class="card action-plan-review"><h2>Clinic action plan</h2><p class="hint">Edit the top evidence-backed actions before publication. You can change wording, owner and timing, or exclude an item. Source evidence stays attached and unsupported new actions cannot be created here.</p><div id="actionPlanEditor"></div></div><div class="card evidence-intel"><h2>Evidence confidence</h2><p class="hint">Reviewer-only confidence, provenance, contradictions and withheld evidence. This panel is not included in the clinic-facing Audit.</p><div id="evidenceSummary" class="intel-summary"></div><div id="evidenceIntel"></div></div><details class="card"><summary><strong>Optional review controls</strong></summary><p class="hint">Change the primary finding, hide a scanner finding, add a human finding, or leave an internal note.</p><div id="candidates"></div><div id="manuals"></div><button id="addFindingBtn" class="btn light" type="button">+ Add finding</button><label class="label">Reviewer note</label><textarea id="note" style="min-height:60px"></textarea></details></div></div><div id="copyFields" hidden></div><div class="sticky"><button id="saveBtn" class="btn" type="button">Save + Regenerate Audit</button><button id="openBtn" class="btn secondary" type="button">Open Audit</button><button id="reloadBtn" class="btn light" type="button">Reload</button><button id="resetBtn" class="btn danger" type="button">Reset review</button><div class="status" id="status"></div></div></div>
<div id="evidenceDrawer" class="evidence-drawer" aria-hidden="true">
  <div class="evidence-shell">
    <div class="evidence-toolbar">
      <div>
        <strong id="evidenceDrawerTitle">Evidence inspection</strong>
        <div class="hint" id="evidenceDrawerHint">Reviewer-only local evidence browser.</div>
      </div>
      <button id="closeEvidenceDrawer" class="btn light" type="button">Close</button>
    </div>
    <div id="evidenceDrawerGrid" class="evidence-grid"></div>
  </div>
</div>
<script>
let state=null;let hidden=new Set();let manuals=[];let copyDraft={};let evidenceResolutions={};let actionPlanDraft=[];
const q=id=>document.getElementById(id);
const COPY_GROUPS=[
  ['heroFields',[['clinic.name','Clinic name'],['clinic.location','Clinic location'],['hero.eyebrow','Eyebrow'],['hero.headline','Headline'],['hero.intro','Body text']]],
  ['coreFields',[['decision.riskLabel','Loss tile — eyebrow'],['decision.riskValue','Loss tile — displayed value'],['decision.riskSubtext','Loss tile — body text'],['decision.recoverLabel','Potential-win tile — eyebrow'],['decision.recoverValue','Potential-win tile — displayed value'],['decision.recoverSubtext','Potential-win tile — body text'],['decision.leakLabel','Problem tile — eyebrow'],['decision.fixLabel','Fix tile — eyebrow'],['decision.edenPrefix','Fix tile — body prefix']]],
  ['visualFields',[['fixVisual.eyebrow','Eyebrow'],['fixVisual.heading','Headline'],['fixVisual.body','Body text'],['fixVisual.beforeLabel','Before — eyebrow'],['fixVisual.beforeTitle','Before — headline'],['fixVisual.beforeDetail','Before — body text'],['fixVisual.afterLabel','After — eyebrow'],['fixVisual.afterTitle','After — headline'],['fixVisual.afterDetail','After — body text']]],
  ['solutionFields',[['trySolution.eyebrow','Eyebrow'],['trySolution.heading','Headline'],['trySolution.text','Body text'],['trySolution.button','AI receptionist button'],['trySolution.evidenceButton','Evidence link'],['trySolution.disclaimer','Disclaimer']]]
];
function setConnected(ok){const x=q('connection');if(!x)return;x.textContent=ok?'Studio connected ✓':'Studio disconnected';x.className='pill connection '+(ok?'ok':'bad');}
function showError(error){setConnected(false);const message=error&&error.message?error.message:String(error||'Unknown error');q('status').textContent='Error';window.__edenStudioVisibleError(message);}
function clearError(){const box=q('appError');if(box){box.textContent='';box.classList.remove('show');}}
function money(v,c='PHP'){if(v==null)return '—';try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:0}).format(v)}catch{return c+' '+Math.round(v).toLocaleString()}}
async function requestJson(url,options){const response=await fetch(url,options);let data=null;try{data=await response.json();}catch(error){throw new Error('Invalid response from Review Studio server.');}if(!response.ok||data&&data.ok===false)throw new Error(data&&data.error?data.error:'Review Studio request failed ('+response.status+').');return data;}
async function loadState(){try{q('status').textContent='Loading…';clearError();state=await requestJson('/api/state');evidenceResolutions=JSON.parse(JSON.stringify(state.review.evidenceResolutions||{}));hidden=new Set(state.review.hideFindingIds||[]);manuals=(state.review.addFindings||[]).filter(x=>x.id!=='manual-example');copyDraft=JSON.parse(JSON.stringify(state.editableCopy||{}));q('clinic').textContent=state.clinic.name+(state.clinic.location?' · '+state.clinic.location:'');const e=state.economics||{};q('risk').textContent=e.revenueExposed?money(e.revenueExposed.low,e.currency)+(e.revenueExposed.high!==e.revenueExposed.low?'–'+money(e.revenueExposed.high,e.currency):''):'—';q('recover').textContent=e.recoverableRevenue?money(e.recoverableRevenue.conservative,e.currency)+'–'+money(e.recoverableRevenue.upside,e.currency):'—';renderCandidates();renderManuals();renderCopyFields();actionPlanDraft=JSON.parse(JSON.stringify(state.actionPlan?.items||[]));renderActionPlan();renderEvidenceIntelligence();const p=state.currentTop?.[0]||state.candidates?.[0]||{};fillPrimary(p,state.review.primaryOpportunity);q('note').value=state.review.reviewerNote||'';q('cover').value=state.review.visuals?.coverImage||'';q('fixImage').value=state.review.visuals?.fixImage||'';q('beforeImage').value=state.review.visuals?.beforeImage||'';q('afterImage').value=state.review.visuals?.afterImage||'';setConnected(true);q('status').textContent='Ready';return state;}catch(error){showError(error);return null;}}
function getCopy(path){return path.split('.').reduce(function(value,key){return value==null?undefined:value[key];},copyDraft);}
function setCopy(path,value){const parts=path.split('.');let target=copyDraft;parts.forEach(function(key,i){if(i===parts.length-1)target[key]=value;else target=target[key]||(target[key]={});});}
function renderCopyFields(){COPY_GROUPS.forEach(function(group){const root=q(group[0]);root.replaceChildren();group[1].forEach(function(def){const wrap=make('div');wrap.appendChild(make('label','label',def[1]));const isLong=/intro|body|text|detail|disclaimer/.test(def[0]);const input=make(isLong?'textarea':'input');if(isLong)input.style.minHeight='64px';const value=getCopy(def[0]);input.value=value==null?'':String(value);input.dataset.copyPath=def[0];wrap.appendChild(input);root.appendChild(wrap);});});}


let reviewEvidenceFiles=null;

async function loadReviewEvidenceFiles(){
  if(reviewEvidenceFiles)return reviewEvidenceFiles;
  const result=await requestJson('/api/evidence-files');
  reviewEvidenceFiles=Array.isArray(result.files)?result.files:[];
  return reviewEvidenceFiles;
}

function inspectionQuery(item){
  return [
    item?.id||'',
    item?.claim||'',
    item?.title||'',
    ...(Array.isArray(item?.sources)?item.sources:[]),
    ...(Array.isArray(item?.positions)?item.positions:[])
  ].join(' ');
}

function evidenceFileScore(file,query){
  const hay=(file.path+' '+file.name).toLowerCase();
  const words=String(query||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>=3);
  let score=0;
  for(const word of words)if(hay.includes(word))score+=3;
  if(/google|maps/.test(query)&&/google|maps/.test(hay))score+=4;
  if(/facebook|messenger/.test(query)&&/facebook|messenger/.test(hay))score+=4;
  if(/website|homepage|phone|booking|mobile/.test(query)&&/website|home|phone|booking|mobile/.test(hay))score+=3;
  if(/\.(png|jpg|jpeg|webp)$/.test(file.name))score+=1;
  if(/snapshot\.json$/.test(file.path))score+=1;
  return score;
}

function filePreviewNode(file){
  const wrap=make('div','evidence-file');
  const url='/review-evidence/'+encodeURIComponent(file.path).replace(/%2F/g,'/');
  const type=file.contentType||'';

  if(String(type).startsWith('image/')){
    const img=document.createElement('img');
    img.src=url;img.alt=file.name||file.path;img.loading='lazy';
    wrap.appendChild(img);
  }else if(type==='application/pdf'||String(type).startsWith('text/')||type==='application/json'){
    const frame=document.createElement('iframe');
    frame.src=url;frame.title=file.name||file.path;
    wrap.appendChild(frame);
  }

  const link=document.createElement('a');
  link.href=url;link.target='_blank';link.rel='noopener';
  link.textContent='Open full evidence';
  wrap.appendChild(link);
  wrap.appendChild(make('div','path',file.path));
  return wrap;
}

async function openEvidenceInspection(item){
  try{
    const drawer=q('evidenceDrawer'),grid=q('evidenceDrawerGrid');
    const title=q('evidenceDrawerTitle'),hint=q('evidenceDrawerHint');
    if(!drawer||!grid)return;

    title.textContent=item?.claim||item?.title||item?.id||'Evidence inspection';
    hint.textContent='Reviewer-only evidence matched from this Audit workspace.';
    grid.replaceChildren();

    const files=await loadReviewEvidenceFiles();
    const query=inspectionQuery(item);
    const ranked=files
      .map(file=>({file,score:evidenceFileScore(file,query)}))
      .sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path));

    let chosen=ranked.filter(x=>x.score>0).slice(0,8);
    if(!chosen.length)chosen=ranked.slice(0,8);

    if(!chosen.length){
      grid.appendChild(make('div','intel-empty','No local evidence artifacts are available for this Audit.'));
    }else{
      chosen.forEach(x=>grid.appendChild(filePreviewNode(x.file)));
    }

    drawer.classList.add('show');
    drawer.setAttribute('aria-hidden','false');
  }catch(error){
    showError(error);
  }
}

function attachInspectButton(card,item){
  const button=make('button','btn light inspect-btn','Inspect evidence');
  button.type='button';
  button.addEventListener('click',function(){openEvidenceInspection(item);});
  card.appendChild(button);
}

function installEvidenceDrawer(){
  const close=q('closeEvidenceDrawer'),drawer=q('evidenceDrawer');
  if(close)close.addEventListener('click',function(){
    drawer?.classList.remove('show');
    drawer?.setAttribute('aria-hidden','true');
  });
  if(drawer)drawer.addEventListener('click',function(event){
    if(event.target===drawer){
      drawer.classList.remove('show');
      drawer.setAttribute('aria-hidden','true');
    }
  });
}


function resolutionFor(id){
  return evidenceResolutions[id]||{decision:'',note:'',updatedAt:null};
}

function appendResolutionControls(card,item){
  if(!item?.id)return;
  const current=resolutionFor(item.id);
  const box=make('div','resolution-box '+(item.blocksPublication?'blocking':''));
  box.appendChild(make('div','label',item.blocksPublication?'Required reviewer resolution':'Optional reviewer resolution'));

  const select=make('select');
  [
    ['', 'Unresolved'],
    ['resolved','Resolved — sources reconciled'],
    ['accepted','Accepted — reviewer accepts a supported position'],
    ['withheld','Withheld — disputed fact excluded from publication']
  ].forEach(function(def){
    const option=make('option','',def[1]);
    option.value=def[0];
    if(def[0]===current.decision)option.selected=true;
    select.appendChild(option);
  });

  const note=make('textarea');
  note.placeholder=item.blocksPublication
    ? 'Required: briefly explain what you verified, which position you accepted, or why the disputed fact is withheld.'
    : 'Optional reviewer note.';
  note.value=current.note||'';

  const status=make(
    'div',
    'resolution-status '+(current.decision&&String(current.note||'').trim().length>=8?'ok':'pending'),
    current.decision&&String(current.note||'').trim().length>=8
      ? 'Resolution recorded ✓'
      : (item.blocksPublication?'Publication remains blocked until resolved.':'No resolution recorded.')
  );

  function saveLocal(){
    const decision=select.value;
    const text=note.value.trim();
    if(!decision){
      delete evidenceResolutions[item.id];
    }else{
      evidenceResolutions[item.id]={
        decision,
        note:text,
        updatedAt:new Date().toISOString()
      };
    }
    const complete=Boolean(decision&&text.length>=8);
    status.textContent=complete?'Resolution recorded ✓':(item.blocksPublication?'Publication remains blocked until resolved.':'Resolution note incomplete.');
    status.className='resolution-status '+(complete?'ok':'pending');
  }

  select.addEventListener('change',saveLocal);
  note.addEventListener('input',saveLocal);
  box.append(select,note,status);
  card.appendChild(box);
}

function unresolvedBlockingContradictions(){
  const conflicts=Array.isArray(state?.evidenceIntelligence?.contradictions)
    ? state.evidenceIntelligence.contradictions.filter(x=>x?.blocksPublication===true)
    : [];
  return conflicts.filter(function(item){
    const r=evidenceResolutions[item.id];
    return !r||!['resolved','accepted','withheld'].includes(r.decision)||String(r.note||'').trim().length<8;
  });
}

function renderActionPlan(){
  const root=q('actionPlanEditor');
  if(!root)return;
  root.replaceChildren();
  const items=Array.isArray(actionPlanDraft)?actionPlanDraft:[];
  if(!items.length){
    root.appendChild(make('div','intel-empty','No publishable V2.4.9 opportunities are available for this Audit.'));
    return;
  }
  items.forEach(function(item,index){
    const card=make('div','action-edit '+(item.include===false?'off':''));
    const top=make('div','action-edit-top');
    const include=make('input');include.type='checkbox';include.checked=item.include!==false;include.dataset.actionIndex=String(index);include.dataset.actionField='include';
    top.appendChild(include);
    top.appendChild(make('strong','', 'Priority '+(item.rank||index+1)+' — '+(item.title||'Action')));
    card.appendChild(top);
    const badges=make('div','action-edit-badges');
    ['Impact: '+(item.impact||'unknown'),'Effort: '+(item.effort||'unknown'),'Confidence: '+(item.confidence||'unknown')].forEach(x=>badges.appendChild(make('span','',x)));
    card.appendChild(badges);
    card.appendChild(fieldAction('Clinic-facing title','input',item.title,index,'title'));
    card.appendChild(fieldAction('What the clinic should do','textarea',item.action,index,'action'));
    const row=make('div','row');
    row.appendChild(fieldAction('Owner','input',item.owner||'Clinic team',index,'owner'));
    row.appendChild(fieldAction('Suggested timing','input',item.timing||'',index,'timing'));
    card.appendChild(row);
    card.appendChild(make('div','action-source','Evidence source: '+(item.sourceId||'machine-ranked opportunity')+(item.sourcePillar?' · '+item.sourcePillar:'')));
    const inspect=make('button','btn light small','Inspect action evidence');
    inspect.type='button';
    inspect.addEventListener('click',function(){
      openEvidenceInspection({
        id:item.sourceId||item.id,
        title:item.title,
        claim:item.title,
        sources:[item.sourcePillar,item.sourceId].filter(Boolean)
      });
    });
    card.appendChild(inspect);
    root.appendChild(card);
  });
}
function fieldAction(label,tag,value,index,key){
  const wrap=make('div');
  wrap.appendChild(make('label','label',label));
  const input=make(tag||'input');
  input.value=value||'';
  input.dataset.actionIndex=String(index);
  input.dataset.actionField=key;
  wrap.appendChild(input);
  return wrap;
}
function renderEvidenceIntelligence(){
  const intel=state?.evidenceIntelligence||null;
  const summary=q('evidenceSummary'),root=q('evidenceIntel');
  if(!summary||!root)return;
  summary.replaceChildren();root.replaceChildren();

  if(!intel){
    root.appendChild(make('div','intel-empty','No V2.4.1 evidence intelligence is present in this snapshot. Older scans can still be reviewed normally.'));
    return;
  }

  const counts=intel.summary?.counts||{};
  [
    ['Verified',counts.verified||0],
    ['Supported',counts.supported||0],
    ['Unknown',counts.unknown||0],
    ['Contradictions',intel.summary?.contradictionCount||0]
  ].forEach(function(item){
    const box=make('div','intel-stat');
    box.appendChild(make('span','label',item[0]));
    box.appendChild(make('strong','',item[1]));
    summary.appendChild(box);
  });

  function section(title){
    const wrap=make('div','intel-section');
    wrap.appendChild(make('div','label',title));
    root.appendChild(wrap);
    return wrap;
  }

  const evidence=Array.isArray(intel.evidence)?intel.evidence:[];
  const evidenceWrap=section('Evidence claims');
  if(!evidence.length)evidenceWrap.appendChild(make('div','intel-empty','No scored evidence claims.'));
  evidence.forEach(function(item){
    const card=make('div','intel-item '+(item.tier==='unknown'?'unknown':''));
    const head=make('div','intel-head');
    head.appendChild(make('span','intel-badge '+(item.tier||'unknown'),item.tier||'unknown'));
    head.appendChild(make('strong','',item.claim||item.id||'Evidence'));
    if(item.publishable===false)head.appendChild(make('span','intel-badge block','withheld'));
    card.appendChild(head);

    if(item.value!==null&&item.value!==undefined){
      const value=typeof item.value==='object'?JSON.stringify(item.value):String(item.value);
      card.appendChild(make('div','intel-meta','Observed value: '+value));
    }
    if(item.reason)card.appendChild(make('p','intel-reason',item.reason));
    if(Array.isArray(item.sources)&&item.sources.length)card.appendChild(make('div','intel-meta','Sources: '+item.sources.join(' · ')));
    attachInspectButton(card,item);
    evidenceWrap.appendChild(card);
  });

  const contradictions=Array.isArray(intel.contradictions)?intel.contradictions:[];
  const conflictWrap=section('Contradictions + reconciliation');
  if(!contradictions.length)conflictWrap.appendChild(make('div','intel-empty','No contradictions detected.'));
  contradictions.forEach(function(item){
    const card=make('div','intel-item '+(item.blocksPublication?'blocking':''));
    const head=make('div','intel-head');
    head.appendChild(make('span','intel-badge block',item.blocksPublication?'reconcile before publish':'conflict'));
    head.appendChild(make('strong','',item.title||item.id||'Contradiction'));
    card.appendChild(head);
    if(item.reason)card.appendChild(make('p','intel-reason',item.reason));
    if(Array.isArray(item.positions)&&item.positions.length)card.appendChild(make('div','intel-meta','Positions: '+item.positions.join(' ↔ ')));
    if(Array.isArray(item.sources)&&item.sources.length)card.appendChild(make('div','intel-meta','Sources: '+item.sources.join(' · ')));
    attachInspectButton(card,item);
    appendResolutionControls(card,item);
    conflictWrap.appendChild(card);
  });

  const missing=Array.isArray(intel.missingEvidence)?intel.missingEvidence:[];
  const missingWrap=section('Missing / unverified evidence');
  if(!missing.length)missingWrap.appendChild(make('div','intel-empty','No material evidence gaps recorded.'));
  missing.forEach(function(item){
    const card=make('div','intel-item unknown');
    const head=make('div','intel-head');
    head.appendChild(make('span','intel-badge unknown','unknown'));
    head.appendChild(make('strong','',item.pillar||item.id||'Evidence gap'));
    card.appendChild(head);
    if(item.reason)card.appendChild(make('p','intel-reason',item.reason));
    missingWrap.appendChild(card);
  });

  if((intel.summary?.blockingContradictionCount||0)>0){
    const warning=make('div','intel-item blocking');
    warning.appendChild(make('strong','','Human reconciliation required before relying on the affected facts.'));
    warning.appendChild(make('p','intel-reason','The V2.4.1 intelligence layer has withheld contradicted evidence from publication-confidence status. Review the source evidence and resolve the discrepancy before treating those facts as verified.'));
    root.prepend(warning);
  }
}

function allCandidates(){return [...(state?.candidates||[]),...manuals.filter(x=>x.include!==false)];}
function make(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined&&text!==null)node.textContent=String(text);return node;}
function renderCandidates(){const selected=state.review.primaryOpportunityId||state.currentTop?.[0]?.id;const opts=allCandidates();const select=q('primarySelect');select.replaceChildren();opts.forEach(function(x){const option=make('option','',x.title||x.id);option.value=x.id;if(x.id===selected)option.selected=true;select.appendChild(option);});const root=q('candidates');root.replaceChildren();(state.candidates||[]).forEach(function(x,i){const card=make('div','candidate '+(x.id===selected?'primary-candidate':''));card.appendChild(make('div','label',i===0?'Current machine priority':'Opportunity'));card.appendChild(make('h3','',x.title));card.appendChild(make('p','',x.diagnosis||''));const row=make('div','row');const primary=make('button','btn small','Make primary');primary.type='button';primary.dataset.primaryId=x.id;const hide=make('button','btn small '+(hidden.has(x.id)?'light':'danger'),hidden.has(x.id)?'Show':'Hide');hide.type='button';hide.dataset.hideId=x.id;row.append(primary,hide);card.appendChild(row);root.appendChild(card);});}
function fillPrimary(base={},override=null){const o=override||{};q('title').value=o.title||base.title||'';q('diagnosis').value=o.diagnosis||base.diagnosis||'';q('fix').value=o.recommendedFix||base.recommendedFix||'';q('eden').value=o.edenImplementation||base.edenImplementation||'';}
function selectPrimary(id){if(!state)return;state.review.primaryOpportunityId=id;const base=allCandidates().find(x=>x.id===id)||{};fillPrimary(base,null);renderCandidates();q('primarySelect').value=id;}
function toggleHide(id){hidden.has(id)?hidden.delete(id):hidden.add(id);renderCandidates();}
function addManual(){manuals.push({id:'manual-'+Date.now(),include:true,title:'',diagnosis:'',recommendedFix:'',edenImplementation:'',priority:'secondary',confidence:'verified-by-reviewer'});renderManuals();}
function field(label,tag,value,index,key){const wrap=make('div');wrap.appendChild(make('label','label',label));const input=make(tag||'input');input.value=value||'';input.dataset.manualIndex=String(index);input.dataset.manualField=key;wrap.appendChild(input);return wrap;}
function selectField(label,value,index,key,values){const wrap=make('div');wrap.appendChild(make('label','label',label));const select=make('select');select.dataset.manualIndex=String(index);select.dataset.manualField=key;values.forEach(function(v){const option=make('option','',v);option.value=v;if(v===value)option.selected=true;select.appendChild(option);});wrap.appendChild(select);return wrap;}
function renderManuals(){const root=q('manuals');root.replaceChildren();manuals.forEach(function(m,i){const card=make('div','manual');const top=make('div','row');top.appendChild(make('strong','', 'Finding '+(i+1)));const remove=make('button','btn danger small','Remove');remove.type='button';remove.style.flex='0 0 auto';remove.dataset.removeManual=String(i);top.appendChild(remove);card.appendChild(top);card.appendChild(field('Finding','input',m.title,i,'title'));card.appendChild(field('Why it matters','textarea',m.diagnosis,i,'diagnosis'));card.appendChild(field('Recommended fix','textarea',m.recommendedFix,i,'recommendedFix'));card.appendChild(field('How Eden can help','textarea',m.edenImplementation,i,'edenImplementation'));const row=make('div','row');row.appendChild(selectField('Priority',m.priority||'secondary',i,'priority',['primary','secondary']));row.appendChild(selectField('Confidence',m.confidence||'verified-by-reviewer',i,'confidence',['verified-by-reviewer','strong','tentative']));card.appendChild(row);root.appendChild(card);});}
function removeManual(i){manuals.splice(i,1);renderManuals();}
function payload(){return {schemaVersion:'2.2.50',visuals:{coverImage:q('cover').value,fixImage:q('fixImage').value,beforeImage:q('beforeImage').value,afterImage:q('afterImage').value},primaryOpportunityId:q('primarySelect').value,primaryOpportunity:{title:q('title').value,diagnosis:q('diagnosis').value,recommendedFix:q('fix').value,edenImplementation:q('eden').value},opportunityOrder:[q('primarySelect').value,...allCandidates().map(x=>x.id).filter(id=>id!==q('primarySelect').value&&!hidden.has(id))],hideFindingIds:[...hidden],addFindings:manuals,reportCopy:copyDraft,reviewerNote:q('note').value};}
async function save(){try{q('status').textContent='Saving + regenerating…';clearError();const r=await requestJson('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())});setConnected(true);q('status').textContent='Audit regenerated ✓';await loadState();return r;}catch(error){showError(error);return null;}}
async function openReport(){try{clearError();const r=await requestJson('/api/open-report',{method:'POST'});setConnected(true);q('status').textContent='Audit opened';return r;}catch(error){showError(error);return null;}}
async function resetReview(){if(!confirm('Reset all human review edits?'))return null;try{clearError();const r=await requestJson('/api/reset',{method:'POST'});await loadState();q('status').textContent='Review reset';return r;}catch(error){showError(error);return null;}}
q('primarySelect').addEventListener('change',function(){selectPrimary(q('primarySelect').value);});
q('addFindingBtn').addEventListener('click',addManual);
q('saveBtn').addEventListener('click',save);
q('openBtn').addEventListener('click',openReport);
q('reloadBtn').addEventListener('click',loadState);
q('resetBtn').addEventListener('click',resetReview);
q('candidates').addEventListener('click',function(event){const primary=event.target.closest('[data-primary-id]');if(primary){selectPrimary(primary.dataset.primaryId);return;}const hide=event.target.closest('[data-hide-id]');if(hide)toggleHide(hide.dataset.hideId);});
q('manuals').addEventListener('click',function(event){const remove=event.target.closest('[data-remove-manual]');if(remove)removeManual(Number(remove.dataset.removeManual));});
q('manuals').addEventListener('input',function(event){const target=event.target;const i=Number(target.dataset.manualIndex);const key=target.dataset.manualField;if(Number.isInteger(i)&&manuals[i]&&key)manuals[i][key]=target.value;});
q('manuals').addEventListener('change',function(event){const target=event.target;const i=Number(target.dataset.manualIndex);const key=target.dataset.manualField;if(Number.isInteger(i)&&manuals[i]&&key)manuals[i][key]=target.value;});
q('actionPlanEditor').addEventListener('input',function(event){const target=event.target;const i=Number(target.dataset.actionIndex);const key=target.dataset.actionField;if(Number.isInteger(i)&&actionPlanDraft[i]&&key&&key!=='include')actionPlanDraft[i][key]=target.value;});
q('actionPlanEditor').addEventListener('change',function(event){const target=event.target;const i=Number(target.dataset.actionIndex);const key=target.dataset.actionField;if(Number.isInteger(i)&&actionPlanDraft[i]&&key==='include'){actionPlanDraft[i].include=target.checked;renderActionPlan();}});
function copyInput(event){const target=event.target;const path=target.dataset.copyPath;if(path)setCopy(path,target.value);}
['heroFields','coreFields','visualFields','solutionFields'].forEach(function(id){q(id).addEventListener('input',copyInput);});
let publishingUiInstalled=false;function installPublishingUI(){if(typeof document.querySelector!=='function'||typeof document.querySelectorAll!=='function')return;document.querySelector('.top-right .pill:last-child').textContent='Owner Review Studio · V2.5.0';const card=make('div','card publish');card.innerHTML='<h2>5. Approve + publish privately</h2><p class="hint">Generate exact-data visuals, approve the final Audit, then create an expiring magic link. The published copy is frozen.</p><label class="label">Receptionist name</label><input id="assistantName" value="Mia"><label class="label">Personalized greeting</label><textarea id="previewGreeting" style="min-height:64px"></textarea><label class="label">Implementation request URL (optional)</label><input id="implementationUrl" placeholder="https://clinicnet.live/contact"><button id="visualsBtn" class="btn light" type="button" style="margin-top:12px">Generate exact report visuals</button><div class="signals"><div><span class="label">Audit opened</span><strong id="sigOpen">0</strong></div><div><span class="label">Evidence viewed</span><strong id="sigEvidence">0</strong></div><div><span class="label">Preview started</span><strong id="sigPreview">0</strong></div><div><span class="label">Implementation asked</span><strong id="sigImplement">0</strong></div></div><label class="check"><input id="humanApproved" type="checkbox"><span>I reviewed the final Audit and approve this exact version for private publication.</span></label><label class="label">Link expires after</label><select id="expiresDays"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option></select><button id="publishBtn" class="btn" type="button" style="margin-top:12px">Approve + create private link</button><div class="private-link" id="privateLink"></div>';const right=document.querySelectorAll('.grid>div')[1];right.insertBefore(card,right.lastElementChild);publishingUiInstalled=true;q('visualsBtn').addEventListener('click',generateVisuals);q('publishBtn').addEventListener('click',publishAudit);}
function applyPublishingState(){if(!publishingUiInstalled)return;const review=state?.review||{},p=review.preview||{},pub=review.publishing||{},counts=state?.publishing?.counts||{};q('assistantName').value=p.assistantName||'Mia';q('previewGreeting').value=p.greeting||('Hi — I’m the AI receptionist preview for '+state.clinic.name+'. What can I help you with?');q('verifiedFacts').value=(p.verifiedFacts||[]).join('\\n');q('implementationUrl').value=p.implementationUrl||'';q('humanApproved').checked=pub.humanApproved===true;q('expiresDays').value=String(pub.expiresInDays||30);q('sigOpen').textContent=counts.audit_opened||0;q('sigEvidence').textContent=counts.evidence_viewed||0;q('sigPreview').textContent=counts.preview_started||0;q('sigImplement').textContent=counts.implementation_requested||0;}
const originalLoadState=loadState;loadState=async function(){const result=await originalLoadState();if(result)applyPublishingState();return result;};
const originalPayload=payload;payload=function(){const value=originalPayload();value.schemaVersion='2.3.0';value.evidenceResolutions=evidenceResolutions;value.actionPlan={items:actionPlanDraft};if(publishingUiInstalled){value.preview={assistantName:q('assistantName').value,greeting:q('previewGreeting').value,verifiedFacts:q('verifiedFacts').value.split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean),implementationUrl:q('implementationUrl').value};value.publishing={humanApproved:q('humanApproved').checked,expiresInDays:Number(q('expiresDays').value)};}return value;};
async function generateVisuals(){try{q('status').textContent='Generating exact visuals…';const r=await requestJson('/api/generate-visuals',{method:'POST'});q('cover').value=r.visuals.summary;q('fixImage').value=r.visuals.fix;q('status').textContent='Exact visuals generated ✓';await loadState();}catch(error){showError(error);}}
async function publishAudit(){if(!q('humanApproved').checked){showError(new Error('Tick human approval after reviewing the final Audit.'));return;}const unresolved=unresolvedBlockingContradictions();if(unresolved.length){showError(new Error('Resolve every blocking evidence contradiction and add a short reviewer note before publishing.'));return;}try{q('status').textContent='Freezing + publishing…';await save();const r=await requestJson('/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({humanApproved:true,expiresInDays:Number(q('expiresDays').value)})});const link=q('privateLink');link.style.display='block';link.innerHTML='<strong>Private link created</strong><br><a style="color:white" target="_blank" rel="noopener"></a><br><small>Expires '+new Date(r.expiresAt).toLocaleString()+'</small>';link.querySelector('a').href=r.url;link.querySelector('a').textContent=r.url;q('status').textContent='Private Audit published ✓';await navigator.clipboard?.writeText(r.url).catch(()=>{});}catch(error){showError(error);}}
async function revokeLatest(){const current=(state?.publishing?.publications||[]).find(x=>x.status==='active'&&!x.revokedAt);if(!current){showError(new Error('There is no active private link to revoke.'));return;}if(!confirm('Revoke the latest private Audit link?'))return;try{await requestJson('/api/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:current.id})});q('privateLink').style.display='none';await loadState();q('status').textContent='Private link revoked';}catch(error){showError(error);}}
installEvidenceDrawer();installPublishingUI();if(publishingUiInstalled){const implementation=q('implementationUrl');const factsLabel=make('label','label','Verified clinic facts — one per line');const facts=make('textarea');facts.id='verifiedFacts';facts.style.minHeight='88px';facts.placeholder='Offers dental implants\\nOpen Monday–Saturday\\nEnglish and Cebuano';implementation.parentNode.insertBefore(factsLabel,implementation.previousElementSibling);implementation.parentNode.insertBefore(facts,implementation.previousElementSibling);const revoke=make('button','btn danger','Revoke latest private link');revoke.type='button';revoke.style.marginTop='8px';revoke.addEventListener('click',revokeLatest);document.querySelector('.publish').appendChild(revoke);}loadState();
</script></body></html>`.replaceAll('2.2.50','2.3.0');}

if(require.main===module){
  const args=process.argv.slice(2);const valueAfter=f=>{const i=args.indexOf(f);return i>=0?args[i+1]||null:null;};
  const snapshot=args.find((a,i)=>!a.startsWith('--')&&(i===0||!['--port'].includes(args[i-1])))||valueAfter('--snapshot');
  const port=Number(valueAfter('--port')||4242);
  if(!snapshot){console.error('Usage: node scanners/review-owner-report.js audit-output/<clinic>/snapshot.json [--port 4242]');process.exit(1);}
  try{createReviewApp({snapshotPath:snapshot,port});}catch(error){console.error(`Owner Review Studio failed: ${error.message||error}`);process.exit(1);}
}
module.exports={createReviewApp,normalizeReview,resolveSnapshot,reviewHtml,validateEvidenceResolutions,normalizeEvidenceResolutions};
