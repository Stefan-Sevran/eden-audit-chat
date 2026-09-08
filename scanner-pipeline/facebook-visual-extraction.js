const fs = require('fs');
const path = require('path');
const VERSION = '2.2.28';
const DEFAULT_MODEL = process.env.EDEN_OPENAI_MODEL || 'gpt-5.6-terra';

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] != null) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
loadLocalEnv();

function imageDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function targetedShots(manifest) {
  const t = manifest.facebookProbe?.screenshots?.targeted || {};
  const rows = [
    ['facebook-authenticated-header', t.header],
    ['facebook-authenticated-about', t.about],
    ['facebook-authenticated-reviews', t.reviews],
    ['facebook-authenticated-posts', t.posts]
  ];
  return rows.filter(([,p]) => p && fs.existsSync(p)).map(([label,p]) => ({label,path:p}));
}

function schema() {
  const nullableString = { anyOf:[{type:'string'},{type:'null'}] };
  const nullableInteger = { anyOf:[{type:'integer'},{type:'null'}] };
  const nullableNumber = { anyOf:[{type:'number'},{type:'null'}] };
  const nullableBoolean = { anyOf:[{type:'boolean'},{type:'null'}] };
  return {
    type:'object', additionalProperties:false,
    required:['observationMode','displayState','pageName','followerCount','recommendationPercent','recommendationReviewCount','phone','address','messageActionVisible','callActionVisible','bookingActionVisible','latestVisibleActivityLabel','recentVisiblePostLabels','visiblePostCount','engagementSamples','contentPresentation','confidence','evidenceScreenshots','notes'],
    properties:{
      observationMode:{type:'string',enum:['authenticated','not_assessable']},
      displayState:{type:'string',enum:['clinic_surface','unavailable_content','login_wall','mixed','not_assessable']},
      pageName:nullableString,
      followerCount:nullableInteger,
      recommendationPercent:nullableNumber,
      recommendationReviewCount:nullableInteger,
      phone:nullableString,address:nullableString,
      messageActionVisible:nullableBoolean,callActionVisible:nullableBoolean,bookingActionVisible:nullableBoolean,
      latestVisibleActivityLabel:nullableString,
      recentVisiblePostLabels:{type:'array',items:{type:'string'},maxItems:8},
      visiblePostCount:nullableInteger,
      engagementSamples:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['label','reactionCount','commentCount','shareCount'],properties:{label:{type:'string'},reactionCount:nullableInteger,commentCount:nullableInteger,shareCount:nullableInteger}}},
      contentPresentation:{type:'object',additionalProperties:false,required:['assessment','rationale'],properties:{assessment:{type:'string',enum:['clear','mixed','cluttered','not_assessable']},rationale:{type:'string'}}},
      confidence:{type:'string',enum:['high','medium','low']},
      evidenceScreenshots:{type:'array',items:{type:'string'}},
      notes:{type:'array',items:{type:'string'},maxItems:8}
    }
  };
}

function prompt(manifest, shots) {
  const probe = manifest.facebookProbe || {};
  return `You are Eden Clinic Audit's dedicated Facebook visual extraction pass.\n\nYou are looking ONLY at authenticated Facebook screenshots captured by a browser session. Your job is to extract visible evidence, not to infer hidden data.\n\nRules:\n- Inspect the screenshot pixels directly. Do not rely on route names alone.\n- If the screenshot says content is unavailable, set displayState=unavailable_content and leave metrics null unless visibly present.\n- If a real clinic surface is visible, set displayState=clinic_surface.\n- Extract follower count, recommendation percentage/count, phone, address, visible Message/Call/Book actions, recent activity labels, visible post counts and clearly visible engagement counts only.\n- Convert abbreviations conservatively: 4.3K followers -> 4300.\n- Never invent engagement rate, response rate, patient demand, or business performance.\n- Evidence screenshot labels must be selected from: ${shots.map(s=>s.label).join(', ')}.\n- observationMode must be authenticated unless screenshots are unusable.\n\nBrowser probe context (for identity only, not as visual truth): ${JSON.stringify({targetUrl:probe.targetUrl,pageName:probe.page?.pageName,handle:probe.page?.handle,destination:probe.destination,authentication:probe.authentication})}\n\nReturn exactly the structured JSON requested.`;
}

function extractText(data){
  if(typeof data?.output_text==='string' && data.output_text.trim()) return data.output_text.trim();
  for(const item of data?.output||[]) for(const c of item?.content||[]) if(c?.type==='output_text'&&typeof c.text==='string') return c.text.trim();
  return '';
}

async function runFacebookVisualExtraction(manifest, options={}) {
  const shots = targetedShots(manifest);
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || null;
  const model = options.model || DEFAULT_MODEL;
  const requested = !!manifest.facebookProbe && manifest.facebookProbe?.authentication?.used===true;
  const base = {schemaVersion:VERSION,requested,screenshotsFound:shots.length,screenshots:shots.map(s=>({label:s.label,path:s.path})),model};
  if(!requested) return {...base,status:'not-run',reason:'authenticated Facebook probe not available'};
  if(!shots.length) return {...base,status:'not-run',reason:'no targeted authenticated Facebook screenshots found'};
  if(!apiKey) return {...base,status:'not-run',reason:'OPENAI_API_KEY not configured'};
  try {
    const content=[{type:'input_text',text:prompt(manifest,shots)}];
    for(const shot of shots){
      const data=imageDataUrl(shot.path); if(!data) continue;
      content.push({type:'input_text',text:`Screenshot evidence label: ${shot.label}`});
      content.push({type:'input_image',image_url:data});
    }
    const body={model,reasoning:{effort:'medium'},input:[{role:'user',content}],text:{format:{type:'json_schema',name:'eden_facebook_visual_extraction',strict:true,schema:schema()}}};
    const response=await (options.fetchImpl||global.fetch)('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(`OpenAI API ${response.status}: ${data?.error?.message||'request failed'}`);
    const text=extractText(data); if(!text) throw new Error('OpenAI API returned no output_text');
    const evidence=JSON.parse(text);
    const parsedFields=['pageName','followerCount','recommendationPercent','recommendationReviewCount','phone','address','messageActionVisible','callActionVisible','bookingActionVisible','latestVisibleActivityLabel','visiblePostCount'].filter(k=>evidence[k]!==null&&evidence[k]!==undefined);
    if(Array.isArray(evidence.recentVisiblePostLabels)&&evidence.recentVisiblePostLabels.length) parsedFields.push('recentVisiblePostLabels');
    if(Array.isArray(evidence.engagementSamples)&&evidence.engagementSamples.length) parsedFields.push('engagementSamples');
    return {...base,status:'completed',responseId:data.id||null,usage:data.usage||null,displayState:evidence.displayState,confidence:evidence.confidence,parsedFields,evidence};
  } catch(error){
    return {...base,status:'failed',error:String(error.message||error)};
  }
}

function writeFacebookVisualExtraction(outDir,result){
  const file=path.join(outDir,'facebook-visual-extraction.json');
  fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
  return file;
}

module.exports={VERSION,targetedShots,runFacebookVisualExtraction,writeFacebookVisualExtraction};
