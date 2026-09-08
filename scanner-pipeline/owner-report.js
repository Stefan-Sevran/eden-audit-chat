const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {writeJson}=require('./utils');
const {selectedAuditScreenshots}=require('./openai-audit-intelligence');

const VERSION='2.3.0';

function clinicnetThemeCss(surface='owner'){
  const shared=`
<style id="clinicnet-continuity-v2300">
:root{--ink:#11143f!important;--muted:#6b6e8d!important;--line:#e4e1f2!important;--paper:#faf9ff!important;--soft:#f1efff!important;--gold:#7057ef!important}
body{background:linear-gradient(180deg,#fff 0%,#faf9ff 58%,#f6f3ff 100%)!important;color:var(--ink)!important;font-family:Georgia,"Times New Roman",serif!important}
.brand,.badge,.eyebrow,.clinic,.button,.evidence-link,.decision-money strong,.try-persona,.try-status{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
.brand{letter-spacing:.11em!important;background:linear-gradient(90deg,#171a49 0%,#7a2cf6 58%,#315ff7 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.badge{border-color:#ddd8f2!important;box-shadow:0 5px 18px rgba(49,31,112,.06)}
.hero{background:linear-gradient(135deg,#11143f 0%,#322461 57%,#465cf4 100%)!important;box-shadow:0 18px 42px rgba(37,28,91,.14)}
.hero h1,.hero h2,h2,.decision h2,.section h2,.try-card h3,.flow strong,.summary strong,.facts strong{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;font-weight:800!important;letter-spacing:-.035em}
.hero .eyebrow{color:#d6d0ff!important}.hero p{color:#e3e0fa!important}
.eyebrow{color:#706c8d!important;letter-spacing:.13em!important}
.decision>div,.try-card,.fix-visual,figure,.summary>div,.facts>div,table,.empty{border-color:#e4e1f2!important;box-shadow:0 10px 28px rgba(38,30,91,.045)}
.decision-money strong{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;font-weight:800!important;letter-spacing:-.045em}
.decision-money.recover{background:linear-gradient(135deg,#171a49 0%,#4932ad 100%)!important;border:0!important;border-top:4px solid #2b7a63!important;box-shadow:0 12px 30px rgba(49,31,112,.15)}
.decision-money.recover .eyebrow,.decision-money.recover span{color:#dedaff!important}
.decision-leak{background:#fbf3ee!important}.decision-fix{background:#f0edff!important}
.flow.after{background:#f0edff!important}.flow-arrow{color:#7057ef!important}
.button{background:linear-gradient(135deg,#7a2cf6 0%,#315ff7 100%)!important;border-radius:14px!important;box-shadow:0 10px 24px rgba(88,55,230,.22)}
.try-card{text-align:center!important;max-width:760px!important;margin:0 auto!important;padding:36px 28px!important;background:linear-gradient(180deg,#fff 0%,#f8f6ff 100%)!important}.try-card p{margin-left:auto!important;margin-right:auto!important}.try-avatar{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;margin:0 auto 12px;background:linear-gradient(135deg,#7a2cf6,#315ff7);color:#fff;font:800 25px/1 Inter,Arial,sans-serif;box-shadow:0 12px 30px rgba(88,55,230,.25);position:relative}.try-avatar:after{content:"";position:absolute;width:15px;height:15px;border-radius:50%;background:#28c787;border:3px solid #fff;right:1px;bottom:3px}.try-persona{font-size:12px;font-weight:800;color:#5c3fe6}.try-card .button{margin-top:5px;padding:14px 20px!important}.try-status{font-size:10px!important}
.evidence-link,.back{color:#5c3fe6!important;border-color:#b8aef4!important}
.formula{background:#f0edff!important}
@media print{body{background:#fff!important}.hero,.button,.decision-money.recover{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>`;
  if(surface==='evidence')return shared;
  return shared;
}
function applyClinicnetTheme(html,surface='owner'){
  return String(html).replace('</head>',`${clinicnetThemeCss(surface)}</head>`);
}

function finite(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;}
function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function money(v,currency='THB'){
  if(finite(v)==null)return '—';
  try{return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(Number(v));}
  catch{return `${currency} ${Math.round(Number(v)).toLocaleString('en-US')}`;}
}
function round1(v){return finite(v)==null?null:Math.round(Number(v)*10)/10;}
function mergeCopy(base,override){
  if(Array.isArray(base))return Array.isArray(override)?override:base;
  if(!base||typeof base!=='object')return override===undefined?base:override;
  const out={...base};
  if(!override||typeof override!=='object'||Array.isArray(override))return out;
  for(const [key,value] of Object.entries(override)){
    if(['__proto__','prototype','constructor'].includes(key))continue;
    out[key]=key in base?mergeCopy(base[key],value):value;
  }
  return out;
}
function humanStage(id){
  const map={discovery:'Discovery',websiteIntent:'Website intent',channelSelection:'Patient contact',leadCapture:'Lead capture',submission:'Submission',acknowledgement:'Acknowledgement',firstMeaningfulResponse:'Response',appointmentOffered:'Appointment offered',appointmentConfirmed:'Appointment confirmed',silentLeadFollowUp:'Follow-up',attendance:'Attendance',revenue:'Revenue attribution'};
  return map[id]||String(id||'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g,' ').replace(/^./,s=>s.toUpperCase());
}
function stageStatus(stage){
  const s=String(stage?.status||stage?.state||'unknown').toLowerCase();
  if(['observed','strong','complete','verified','available','passed'].some(x=>s.includes(x)))return 'strong';
  if(['weak','delayed','leak','failure','missing','problem'].some(x=>s.includes(x)))return 'risk';
  return 'unknown';
}
function stageIdFromLabel(label=''){
  const s=String(label).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const map={'discovery':'discovery','website intent':'websiteIntent','channel selection':'channelSelection','lead capture':'leadCapture','submission':'submission','acknowledgement':'acknowledgement','first meaningful response':'firstMeaningfulResponse','appointment offered':'appointmentOffered','appointment confirmed':'appointmentConfirmed','silent lead follow up':'silentLeadFollowUp','attendance':'attendance','revenue':'revenue'};
  return map[s]||s.replace(/ (.)/g,(_,c)=>c.toUpperCase())||'stage';
}
function normalizePath(raw){
  if(!raw)return [];
  if(Array.isArray(raw))return raw.map((x,i)=>{
    if(typeof x==='string'){const id=stageIdFromLabel(x);return {id,label:humanStage(id),status:'unknown',detail:null};}
    const id=x.id||x.stage||`stage-${i+1}`;
    return {id,label:x.label||humanStage(id),status:stageStatus(x),detail:x.detail||x.reason||null};
  });
  if(Array.isArray(raw.stages)){
    const stages=normalizePath(raw.stages);
    const transitions=raw.postSubmissionPath?.transitions||{};
    const byId=new Map(stages.map(x=>[x.id,x]));
    for(const [id,v] of Object.entries(transitions)){
      if(byId.has(id)){
        const item=byId.get(id); item.status=stageStatus(v); item.detail=v?.reason||v?.detail||null;
      }
    }
    const primary=raw.primaryTransition||null;
    if(primary?.status==='observed-leakage'){
      const target=String(primary.to||'').toLowerCase();
      for(const item of stages){if(target.includes(item.label.toLowerCase())){item.status='risk';item.detail=primary.reason||item.detail;}}
    }
    return stages;
  }
  if(typeof raw==='object')return Object.entries(raw).filter(([k])=>!['schemaVersion','status','policy','primaryOpportunity','weakestTransition'].includes(k)).map(([k,v])=>({id:k,label:humanStage(k),status:stageStatus(typeof v==='object'?v:{status:v}),detail:typeof v==='object'?(v.detail||v.reason||null):null}));
  return [];
}
function groupPath(stages=[]){
  const groups=[
    {id:'discovery',label:'Discovery',members:['discovery','websiteIntent']},
    {id:'contact',label:'Patient contact',members:['channelSelection','leadCapture','submission']},
    {id:'response',label:'First response',members:['acknowledgement','firstMeaningfulResponse']},
    {id:'booking',label:'Booking',members:['appointmentOffered','appointmentConfirmed']},
    {id:'followup',label:'Follow-up & attendance',members:['silentLeadFollowUp','attendance']},
    {id:'revenue',label:'Revenue',members:['revenue']}
  ];
  const byId=new Map(stages.map(s=>[s.id,s]));
  return groups.map(g=>{
    const seen=g.members.map(id=>byId.get(id)).filter(Boolean);
    const statuses=seen.map(s=>s.status);
    let status='unknown';
    if(statuses.includes('risk'))status='risk';
    else if(statuses.includes('strong')&&statuses.includes('unknown'))status='partial';
    else if(statuses.includes('strong'))status='strong';
    const detail=seen.map(s=>s.detail).find(Boolean)||null;
    return {...g,status,detail};
  });
}

function loadOwnerReview(reviewPath){
  if(!reviewPath)return null;
  try{
    const full=path.resolve(reviewPath);
    if(!fs.existsSync(full))return {status:'invalid',error:`Owner review file not found: ${full}`,sourcePath:full};
    const raw=JSON.parse(fs.readFileSync(full,'utf8'));
    return {...raw,status:'loaded',sourcePath:full};
  }catch(error){return {status:'invalid',error:String(error.message||error),sourcePath:path.resolve(reviewPath)};}
}
function normalizeManualFinding(x={},i=0){
  return {
    id:x.id||`manual-${i+1}`,
    title:x.title||x.finding||'Human-reviewed opportunity',
    diagnosis:x.diagnosis||x.whyItMatters||x.reason||null,
    recommendedFix:x.recommendedFix||x.fix||x.action||'Make this patient step direct, owned and measurable.',
    edenImplementation:x.edenImplementation||null,
    revenueMechanism:x.revenueMechanism||x.valueMechanism||null,
    confidence:x.confidence||'human-reviewed',
    priorityIndex:finite(x.priorityIndex)??95,
    pillar:x.pillar||'human-review',
    commercialRelevance:x.commercialRelevance||'human-reviewed',
    basis:'human-review',
    source:'Human review',
    priority:x.priority||null,
    include:x.include!==false
  };
}
function actionFromRaw(a={}){
  return {id:a.id||null,title:plainActionTitle(a.title||''),diagnosis:plainDiagnosis(a.diagnosis||''),recommendedFix:plainFix(a.action||a.recommendedFix||''),revenueMechanism:a.revenueMechanism||null,confidence:a.confidence||null,priorityIndex:a.priorityIndex??null,pillar:a.pillar||'cross-channel',commercialRelevance:a.commercialRelevance||null,basis:'ranked-audit-action'};
}
function buildOpportunityList(manifest,growth,review=null){
  const primary=selectCommercialOpportunity(manifest,growth);
  const ranked=(growth?.actions?.topActions||[]).map(actionFromRaw);
  const manual=(review?.addFindings||review?.manualFindings||[]).map(normalizeManualFinding).filter(x=>x.include);
  const hide=new Set([...(review?.hideFindingIds||[])]);
  const seen=new Set();
  let all=[...manual,primary,...ranked].filter(x=>x&&x.id&&!hide.has(x.id)).filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;});
  const order=review?.opportunityOrder||[];
  if(order.length){const pos=new Map(order.map((id,i)=>[id,i]));all.sort((a,b)=>(pos.has(a.id)?pos.get(a.id):999)-(pos.has(b.id)?pos.get(b.id):999));}
  const requested=review?.primaryOpportunityId||null;
  if(requested){const i=all.findIndex(x=>x.id===requested);if(i>0){const [x]=all.splice(i,1);all.unshift(x);}}
  const override=review?.primaryOpportunity||review?.primaryOverride||null;
  if(override){
    const base=all[0]||primary;
    const merged={...base,...override,id:override.id||base.id,basis:'human-review-override',source:'Human review'};
    if(override.recommendedFix)merged.recommendedFix=override.recommendedFix;
    if(override.edenImplementation)merged.edenImplementation=override.edenImplementation;
    all[0]=merged;
  }
  return all.slice(0,3);
}
function buildOwnerReviewTemplate(model){
  return {
    schemaVersion:VERSION,
    note:'Optional human review layer. Edit this file, then regenerate the owner report without rescanning.',
    visuals:{coverImage:null,fixImage:null,beforeImage:null,afterImage:null},
    primaryOpportunityId:model.primaryOpportunity?.id||null,
    primaryOpportunity:null,
    opportunityOrder:(model.topOpportunities||[]).map(x=>x.id),
    hideFindingIds:[],
    addFindings:[{
      id:'manual-example',
      include:false,
      title:'Example: send patients to the clinic booking page, not a generic social page',
      diagnosis:'A human reviewer observed that a high-intent clinic link sends patients to a generic destination rather than the clinic-controlled booking path.',
      recommendedFix:'Replace the generic destination with the clinic booking page or direct patient messaging route.',
      edenImplementation:'Eden can provide a tracked booking or receptionist destination and measure inquiry → booking → attendance → revenue.',
      priority:'primary',
      confidence:'verified-by-reviewer'
    }],
    preview:{assistantName:'Mia',greeting:`Hi — I’m the AI receptionist preview for ${model.clinic?.name||'the clinic'}. What can I help you with?`,verifiedFacts:[],implementationUrl:''},
    publishing:{humanApproved:false,expiresInDays:30},
    reviewerNote:''
  };
}
function bestAction(growth){
  const a=growth?.actions?.topActions?.[0]||null;
  if(a)return {id:a.id||null,title:a.title||'Improve the highest-value patient transition',diagnosis:a.diagnosis||null,recommendedFix:a.action||'Make the weak patient transition explicit, owned and measurable.',revenueMechanism:a.revenueMechanism||null,confidence:a.confidence||null,priorityIndex:a.priorityIndex??null,pillar:a.pillar||'cross-channel',commercialRelevance:a.commercialRelevance||null,basis:'ranked-audit-action'};
  return {id:'fallback',title:'Make the next patient step owned and measurable',diagnosis:'The audit did not identify a stronger evidence-backed intervention.',recommendedFix:'Choose one owner for every new inquiry, define a response target, and track each inquiry through booking and attendance.',revenueMechanism:'Fewer patient inquiries disappear between contact and appointment.',confidence:'guarded',priorityIndex:null,pillar:'cross-channel',commercialRelevance:'unknown',basis:'fallback'};
}
function explicitLeakageSummary(revenue){
  const explicit=(revenue?.opportunities||[]).filter(o=>o.basis==='reported-leakage');
  if(!explicit.length)return null;
  let low=0,high=0,usable=0;
  const labels=[];
  for(const o of explicit){
    const v=o.monthlyVolume||o.volume||{};
    const lo=finite(v.low??v.base),hi=finite(v.high??v.base);
    if(lo==null||hi==null)continue;
    low+=lo;high+=hi;usable++;
    if(o.label)labels.push(o.label.toLowerCase());
    else if(o.id)labels.push(String(o.id).replace(/-/g,' '));
  }
  if(!usable)return null;
  return {low,high,labels,cohorts:explicit};
}
function selectCommercialOpportunity(manifest,growth){
  const ranked=bestAction(growth);
  const leakage=explicitLeakageSummary(growth?.revenue);
  const benchmark=manifest.postSubmissionResponseBenchmark||{};
  const first=benchmark.firstMeaningfulResponse||{};
  const firstMinutes=finite(first.minutes??first.delayMinutes);
  const strongResponse=first.observed===true&&firstMinutes!=null&&firstMinutes<=60;
  const follow=benchmark.silentLeadFollowUp||{};
  const strongFollow=follow.observed===true;
  if(leakage){
    const count=leakage.low===leakage.high?`${leakage.low}`:`${leakage.low}–${leakage.high}`;
    let diagnosis=`The clinic reported about ${count} missed or delayed patient contacts per month. That is a more direct revenue opportunity than a general website or Google optimisation.`;
    if(strongResponse)diagnosis=`Your tested response was strong at about ${Math.round(firstMinutes)} minutes. The bigger opportunity is making that same reliability cover every missed call and delayed inquiry.`;
    if(strongResponse&&strongFollow)diagnosis=`Your tested response was strong at about ${Math.round(firstMinutes)} minutes, and proactive follow-up was observed. The bigger opportunity is making that same reliability cover every missed call and delayed inquiry.`;
    return {id:'reported-leakage-recovery',title:'Recover missed calls and delayed inquiries before they go cold',diagnosis,recommendedFix:'Give every missed call and delayed inquiry a clear response rule: respond or call back quickly, then follow up once if the patient does not reply.',revenueMechanism:'Recover more of the patient demand the clinic already has before it disappears.',confidence:'high',priorityIndex:100,pillar:'operations',commercialRelevance:'established',basis:'clinic-reported-leakage',alignedRevenue:true,displacedAction:ranked};
  }
  if(ranked.commercialRelevance==='unknown'){
    return {...ranked,title:plainActionTitle(ranked.title),diagnosis:plainDiagnosis(ranked.diagnosis),recommendedFix:plainFix(ranked.recommendedFix),alignedRevenue:false};
  }
  return {...ranked,title:plainActionTitle(ranked.title),diagnosis:plainDiagnosis(ranked.diagnosis),recommendedFix:plainFix(ranked.recommendedFix),alignedRevenue:true};
}
function plainActionTitle(text=''){
  const s=String(text);
  if(/google.*path|maps.*path|destination/i.test(s))return 'Make it easier for Google patients to reach booking';
  if(/response|reply/i.test(s))return 'Reply faster to every new patient inquiry';
  if(/follow/i.test(s))return 'Follow up before interested patients go cold';
  return s||'Make the next patient step easier';
}
function plainDiagnosis(text=''){
  const s=String(text||'');
  return s.replace(/destination quality/gi,'the patient path').replace(/conversion/gi,'booking');
}
function plainFix(text=''){
  const s=String(text||'');
  if(/direct clinic-controlled destination/i.test(s))return 'Give patients a direct, clinic-controlled next step from Google — ideally booking or an instant receptionist — and track what happens next.';
  return s||'Give every new patient inquiry one clear owner, a response target, and a follow-up rule.';
}
function edenImplementation(action){
  if(action.id==='reported-leakage-recovery')return "Eden's AI receptionist can watch the same channels the clinic already uses, respond or call back quickly, help the patient book, follow up once when they go silent, and track the result through attendance and revenue.";
  const hay=`${action.title||''} ${action.diagnosis||''} ${action.recommendedFix||''} ${action.revenueMechanism||''}`.toLowerCase();
  if(/message|messenger|reply|response|inquir|follow.?up|silent/.test(hay))return 'Eden can reply instantly, answer routine questions, help the patient book, alert staff when needed, and follow up once if the patient goes silent.';
  if(/call|phone/.test(hay))return 'Eden can turn missed calls into a quick recovery workflow: callback or message, booking help, staff escalation when needed, and outcome tracking.';
  if(/book|appointment|form|submit/.test(hay))return 'Eden can acknowledge every request, move it toward a confirmed appointment, follow up when the patient goes silent, and track attendance.';
  if(/google|maps|handoff|destination/.test(hay))return 'Eden can connect high-intent Google traffic to a direct response and booking path, then track what happens through appointment and revenue.';
  return 'Eden can connect this patient step to instant response, human escalation, follow-up and outcome tracking without changing the channels patients already use.';
}
function economicImpact(revenue){
  if(!revenue)return {status:'unavailable'};
  const currency=revenue.currency||'THB';
  const avg=finite(revenue.averageRevenuePerRecoveredPatient||revenue.ownerInputs?.averageNewPatientValue||revenue.averageNewPatientValue);
  const opportunities=(revenue.opportunities||[]);
  const explicit=opportunities.filter(o=>o.basis==='reported-leakage');
  const booking=revenue.assumptions?.leadToBookingRate||{};
  const attendance=revenue.assumptions?.attendanceRate||{};
  const bookingBase=finite(booking.base), attendanceBase=finite(attendance.base);
  let atRiskLow=null,atRiskHigh=null,exposedLow=null,exposedHigh=null;
  if(explicit.length&&avg!=null&&bookingBase!=null&&attendanceBase!=null){
    let lo=0,hi=0;
    for(const o of explicit){
      const v=o.monthlyVolume||o.volume||{};
      const vl=finite(v.low??v.base), vh=finite(v.high??v.base);
      if(vl==null||vh==null)continue;
      lo+=vl*bookingBase*attendanceBase;
      hi+=vh*bookingBase*attendanceBase;
    }
    atRiskLow=round1(lo);atRiskHigh=round1(hi);
    exposedLow=Math.round(lo*avg);exposedHigh=Math.round(hi*avg);
  }
  const s=revenue.monthlyRevenueScenarios||null;
  const recoverable=s?{conservative:finite(s.conservative),base:finite(s.base),upside:finite(s.upside)}:null;
  const recoverableBookings=recoverable&&avg?{conservative:round1(recoverable.conservative/avg),base:round1(recoverable.base/avg),upside:round1(recoverable.upside/avg)}:null;
  return {status:recoverable?'scenario-calculated':'inputs-required',currency,averageNewPatientValue:avg,bookingsAtRisk:atRiskLow==null?null:{low:atRiskLow,high:atRiskHigh},revenueExposed:exposedLow==null?null:{low:exposedLow,high:exposedHigh},recoverableRevenue:recoverable,recoverableBookings,provenance:{currentImpact:atRiskLow==null?'Not estimated without an explicit clinic-reported leakage cohort.':'Calculated from clinic-reported missed/delayed contacts, booking rate, attendance rate and patient value.',recovery:'Calculated from clinic-reported operating numbers plus clearly labelled recovery scenarios.'}};
}
function buildStrengths(manifest){
  const out=[];
  const a=manifest.assessmentProfile||manifest.summary?.assessmentProfile||{};
  const digital=finite(a.digitalExperience),conversion=finite(a.patientConversionReadiness);
  if(digital!=null&&digital>=80)out.push(`The website gives patients a strong first experience (${Math.round(digital)}/100).`);
  if(conversion!=null&&conversion>=80)out.push(`Patients can find a clear way to contact or book (${Math.round(conversion)}/100).`);
  const b=manifest.postSubmissionResponseBenchmark||{};
  const f=b.firstMeaningfulResponse||{};
  const mins=finite(f.minutes??f.delayMinutes);
  if(f.observed===true&&mins!=null){const channel=b.channel||'message';out.push(mins<=60?`Patients can get a ${channel} reply in about ${Math.round(mins)} minutes.`:`The clinic replied to our test patient inquiry.`);}
  if(b.silentLeadFollowUp?.observed===true)out.push('The team followed up again when the patient went quiet.');
  return out.slice(0,4);
}
function buildQuickSummary(model){
  const e=model.economics||{};
  const recovery=e.recoverableBookings&&e.recoverableRevenue?`${e.recoverableBookings.conservative}–${e.recoverableBookings.upside} additional bookings and ${money(e.recoverableRevenue.conservative,e.currency)}–${money(e.recoverableRevenue.upside,e.currency)} per month`:null;
  return {strength:model.strengths[0]||'The clinic already has patient demand and working contact paths.',nextMove:model.recommendedFix.text,potential:recovery||'Add a few clinic operating numbers to estimate the likely monthly upside.'};
}
function buildOwnerReportModel(manifest,{demoUrl=null,proofUrl=null,ownerReview=null,ownerReviewPath=null}={}){
  const clinic=manifest.clinicIdentity||{};
  const growth=manifest.crossChannelGrowth||{};
  const review=ownerReview||loadOwnerReview(ownerReviewPath);
  const economics=economicImpact(growth.revenue||null);
  const opportunities=buildOpportunityList(manifest,growth,review&&review.status!=='invalid'?review:null);
  const action=opportunities[0]||selectCommercialOpportunity(manifest,growth);
  const detailedPath=normalizePath(growth.actions?.patientRevenuePath||null);
  const pathStages=groupPath(detailedPath);
  const benchmark=manifest.postSubmissionResponseBenchmark||null;
  const strengths=buildStrengths(manifest);
  const model={
    schemaVersion:VERSION,
    generatedAt:new Date().toISOString(),
    clinic:{name:clinic.clinicName||clinic.name||'Clinic',location:clinic.location||null,website:manifest.reviewedUrl||null},
    hero:{eyebrow:'Eden Clinic Audit',headline:economics.status==='scenario-calculated'&&economics.revenueExposed?`About ${money(economics.revenueExposed.low,economics.currency)}${economics.revenueExposed.high!==economics.revenueExposed.low?`–${money(economics.revenueExposed.high,economics.currency)}`:''} / month may be slipping away after patients contact you`:'See where interested patients may be getting lost — and the easiest fix',intro:economics.status==='scenario-calculated'&&economics.recoverableRevenue?`This fix could realistically recover about ${money(economics.recoverableRevenue.conservative,economics.currency)}–${money(economics.recoverableRevenue.upside,economics.currency)} per month.`:'Add a few simple clinic numbers and we can estimate how much revenue is at risk and how much the fix could add.'},
    strengths,
    patientRevenuePath:pathStages,
    patientRevenuePathDetail:detailedPath,
    primaryOpportunity:action,
    topOpportunities:opportunities,
    recommendedFix:{title:'Recommended fix',text:action.recommendedFix,ownerCanDo:true},
    edenImplementation:{title:'Eden implementation',text:action.edenImplementation||edenImplementation(action)},
    economics,
    preview:{assistantName:review?.preview?.assistantName||'Mia',greeting:review?.preview?.greeting||`Hi — I’m the AI receptionist preview for ${clinic.clinicName||clinic.name||'the clinic'}. What can I help you with?`,verifiedFacts:Array.isArray(review?.preview?.verifiedFacts)?review.preview.verifiedFacts.filter(Boolean).slice(0,30):[],implementationUrl:review?.preview?.implementationUrl||''},
    trySolution:{demoUrl:demoUrl||null,label:demoUrl?'Test your AI receptionist':'AI receptionist demo can be linked before publication',disclaimer:'This is a private simulation based on public clinic information. No booking is submitted and nothing goes live without clinic approval.'},
    proofPeriod:{url:proofUrl||null,title:'Free Proof Period',text:'Measure inquiries → response → booking → attendance → confirmed revenue before making a long-term decision.'},
    supportingEvidence:{website:manifest.assessmentProfile||manifest.scoring||null,google:manifest.googleBusiness?.assessment||null,facebook:manifest.facebook?.assessment||null,responseBenchmark:benchmark?{status:benchmark.status||'benchmarked',channel:benchmark.channel||null,firstMeaningfulResponse:benchmark.firstMeaningfulResponse||null,silentLeadFollowUp:benchmark.silentLeadFollowUp||null}:null},
    humanReview:{status:review?.status||'not-applied',sourcePath:review?.sourcePath||null,reviewerNote:review?.reviewerNote||null,error:review?.error||null},
    visuals:{coverImage:review?.visuals?.coverImage||null,fixImage:review?.visuals?.fixImage||null,beforeImage:review?.visuals?.beforeImage||null,afterImage:review?.visuals?.afterImage||null},
    privacy:{robots:'noindex,nofollow,noarchive',note:'Owner reports are private-by-default. Noindex reduces accidental search exposure but does not replace access control.'},
    evidencePolicy:{unknown:'Unknown stays unknown.',money:'Revenue estimates use clinic numbers plus clearly labelled Eden scenarios.',sales:'The recommended fix is stated independently from Eden implementation.'}
  };
  const hasMoney=economics.status==='scenario-calculated'&&economics.recoverableRevenue;
  const exposure=economics.revenueExposed?`${money(economics.revenueExposed.low,economics.currency)}${economics.revenueExposed.high!==economics.revenueExposed.low?`–${money(economics.revenueExposed.high,economics.currency)}`:''}`:'Needs clinic inputs';
  const recovery=hasMoney?`${money(economics.recoverableRevenue.conservative,economics.currency)}–${money(economics.recoverableRevenue.upside,economics.currency)}`:'Needs clinic inputs';
  const bookings=hasMoney&&economics.recoverableBookings?`${economics.recoverableBookings.conservative}–${economics.recoverableBookings.upside}`:'—';
  const defaultCopy={
    clinic:{name:model.clinic.name,location:model.clinic.location||''},
    hero:{eyebrow:model.hero.eyebrow,headline:model.hero.headline,intro:model.hero.intro},
    decision:{
      riskLabel:'Estimated revenue at risk',riskValue:exposure,riskSubtext:'per month',
      recoverLabel:'Likely recoverable with the fix',recoverValue:recovery,recoverSubtext:hasMoney?`about ${bookings} additional bookings / month`:'Add a few operating numbers to calculate this.',
      leakLabel:'Where patients are most likely being lost',fixLabel:'Best fix to make first',edenPrefix:'If you want Eden to do it:'
    },
    fixVisual:{eyebrow:'What changes',heading:'From missed inquiry to booked patient.',body:'The fix gives every new inquiry a fast response, booking help and one follow-up if the patient goes quiet.',beforeLabel:'WITHOUT THE FIX',beforeTitle:'Patient contacts clinic',beforeDetail:'→ missed / delayed → patient may book elsewhere',afterLabel:'WITH THE FIX',afterTitle:'Fast reply + booking help',afterDetail:'→ follow-up → booked patient'},
    opportunities:{eyebrow:'Top opportunities',heading:'Fix the biggest leak first.',primaryLabel:'Core fix',secondaryLabel:'Quick / secondary win',tertiaryLabel:'Other opportunity'},
    strengths:{eyebrow:'What already works',heading:'Keep the strengths. Fix the leak.',items:model.strengths.length?model.strengths:['Patient demand and contact paths are already present. The audit focuses on the easiest next improvement.']},
    impact:{eyebrow:hasMoney?'What the leak may be worth':'Commercial impact',heading:hasMoney?'Lost opportunities → recovered patients.':'Put a number on the leakage.',intro:'Add a few clinic operating numbers and Eden can estimate bookings exposed, revenue tied to the leakage, and the portion a specific fix may realistically recover.'},
    path:{eyebrow:'Supporting patient path',heading:'See where the evidence sits.',empty:'Unknown stages stay unknown until they are measured.'},
    trySolution:{eyebrow:'Free 60-second sneak peek',heading:`Meet ${model.clinic.name}'s AI receptionist.`,text:'Ask one real patient question and see how it can reply, help book, and follow up.',button:'Try the receptionist →',evidenceButton:'View evidence behind this estimate →',disclaimer:model.trySolution.disclaimer},
    proof:{eyebrow:'Prove it',heading:model.proofPeriod.title,text:model.proofPeriod.text,button:model.proofPeriod.url?'Start Free Proof Period →':'Free Proof Period'}
  };
  model.copy=mergeCopy(defaultCopy,review?.reportCopy||null);
  model.clinic.name=model.copy.clinic.name;
  model.clinic.location=model.copy.clinic.location||null;
  model.hero={...model.hero,...model.copy.hero};
  model.strengths=Array.isArray(model.copy.strengths.items)?model.copy.strengths.items:model.strengths;
  model.quickSummary=buildQuickSummary(model);
  return model;
}
function statusText(status){return status==='strong'?'Strong':status==='risk'?'Needs attention':status==='partial'?'Partly measured':'Not yet measured';}
function pct(v){return finite(v)==null?'—':`${Math.round(Number(v)*100)}%`;}
function evidenceCaption(label=''){
  const captions={
    'desktop-first-visit':'What a patient first sees on the clinic website on desktop.',
    'mobile-first-visit':'What a patient first sees on the clinic website on mobile.',
    'desktop-post-consent':'The website patient path after consent or first-visit overlays are cleared.',
    'mobile-post-consent':'The mobile patient path after consent or first-visit overlays are cleared.',
    'google-business-profile':'The clinic’s observed Google Business / Maps profile surface.',
    'google-business-reviews':'The observed Google review surface used by the Audit.',
    'google-business-destination':'Where a patient lands after following the observed Google action path.',
    'facebook-authenticated-header':'The observed clinic Facebook header and visible patient actions.',
    'facebook-authenticated-about':'The observed Facebook contact and clinic-information surface.',
    'facebook-authenticated-posts':'A sampled view of recent Facebook activity.',
    'facebook-authenticated-reviews':'The observed Facebook review surface.',
    'facebook-comment-surface-1':'A sampled patient-comment surface inspected by the Audit.',
    'facebook-comment-surface-2':'A second sampled patient-comment surface inspected by the Audit.',
    'facebook-public-desktop':'The public Facebook destination exactly as observed on desktop; login or access friction is shown without inferring hidden page content.',
    'facebook-public-mobile':'The public Facebook destination exactly as observed on mobile; login or access friction is shown without inferring hidden page content.'
  };
  return captions[label]||'A timestamped public surface inspected during this Audit.';
}
function chooseEvidenceScreenshots(manifest){
  const shots=(selectedAuditScreenshots(manifest)||[]).filter(x=>!/^facebook-comment-surface-/.test(x.label));
  const preferred=['desktop-first-visit','mobile-first-visit','google-business-destination','facebook-authenticated-header','facebook-public-desktop','google-business-profile','google-business-reviews','facebook-authenticated-about','facebook-authenticated-posts','desktop-post-consent','mobile-post-consent'];
  const position=new Map(preferred.map((label,i)=>[label,i]));
  const seenHashes=new Set();
  const channelCount=new Map();
  const caps={website:2,googleBusiness:2,facebook:1};
  const out=[];
  for(const shot of [...shots].sort((a,b)=>(position.get(a.label)??999)-(position.get(b.label)??999))){
    if(out.length>=5)break;
    const cap=caps[shot.channel]??1;
    if((channelCount.get(shot.channel)||0)>=cap)continue;
    let hash=null;
    try{hash=crypto.createHash('sha256').update(fs.readFileSync(shot.path)).digest('hex');}catch{continue;}
    if(seenHashes.has(hash))continue;
    seenHashes.add(hash);
    channelCount.set(shot.channel,(channelCount.get(shot.channel)||0)+1);
    out.push(shot);
  }
  return out;
}
function buildEvidenceAppendixModel(manifest,model){
  const revenue=manifest.crossChannelGrowth?.revenue||{};
  const e=model.economics||{};
  const rows=[];
  for(const o of revenue.opportunities||[]){
    const v=o.monthlyVolume||{};
    const value=finite(v.low)==null?'—':finite(v.low)===finite(v.high)?`${Math.round(v.low)} / month`:`${Math.round(v.low)}–${Math.round(v.high)} / month`;
    rows.push({label:o.label||o.id,value,source:'Reported clinic volume'});
  }
  if(finite(e.averageNewPatientValue)!=null)rows.push({label:'Average new-patient value',value:money(e.averageNewPatientValue,e.currency),source:'Clinic input'});
  const booking=revenue.assumptions?.leadToBookingRate||{};
  const attendance=revenue.assumptions?.attendanceRate||{};
  if(finite(booking.base)!=null)rows.push({label:'Inquiry → booking rate',value:pct(booking.base),source:booking.source==='reported-by-clinic'?'Clinic input':'Scenario assumption'});
  if(finite(attendance.base)!=null)rows.push({label:'Booking → attendance rate',value:pct(attendance.base),source:attendance.source==='reported-by-clinic'?'Clinic input':'Scenario assumption'});
  const benchmark=manifest.postSubmissionResponseBenchmark||{};
  const first=benchmark.firstMeaningfulResponse||{};
  return {
    clinic:model.clinic,
    generatedAt:manifest.generatedAt||manifest.scannedAt||manifest.createdAt||model.generatedAt,
    formula:revenue.formulaPolicy||'Recoverable revenue = leakage volume × recoverable share × inquiry-to-booking rate × attendance rate × average new-patient value.',
    inputRows:rows,
    economics:{currency:e.currency,risk:e.revenueExposed?`${money(e.revenueExposed.low,e.currency)}${e.revenueExposed.high!==e.revenueExposed.low?`–${money(e.revenueExposed.high,e.currency)}`:''}`:'Not calculated',conservative:e.recoverableRevenue?money(e.recoverableRevenue.conservative,e.currency):'—',base:e.recoverableRevenue?money(e.recoverableRevenue.base,e.currency):'—',upside:e.recoverableRevenue?money(e.recoverableRevenue.upside,e.currency):'—'},
    benchmark:benchmark.status?{channel:benchmark.channel||'Test channel',firstResponse:first.observed===true&&finite(first.minutes??first.delayMinutes)!=null?`${Math.round(finite(first.minutes??first.delayMinutes))} minutes`:'Not observed',followUp:benchmark.silentLeadFollowUp?.observed===true?'Observed':'Not observed in the controlled test'}:null,
    screenshots:chooseEvidenceScreenshots(manifest),
    caveats:['Clinic operating volumes and patient value are reported inputs; public snapshots cannot independently verify them.','Recovery rates are labelled scenarios, not guaranteed results.','Screenshots show sampled public or authenticated surfaces at scan time, not every patient interaction.','The strongest proof is patient-level tracking from inquiry → booking → attendance → confirmed revenue.']
  };
}
function renderEvidenceAppendix(data){
  const rows=data.inputRows.length?data.inputRows.map(x=>`<tr><td>${esc(x.label)}</td><td><strong>${esc(x.value)}</strong></td><td>${esc(x.source)}</td></tr>`).join(''):`<tr><td colspan="3">No clinic operating inputs were available for this estimate.</td></tr>`;
  const shots=data.screenshots.length?data.screenshots.map(x=>`<figure><img src="${esc(x.href)}" alt="${esc(x.label)}"><figcaption><strong>${esc(x.label.replace(/-/g,' '))}</strong><span>${esc(evidenceCaption(x.label))}</span></figcaption></figure>`).join(''):`<p class="empty">No publishable snapshots were available in this scan. The calculation and response evidence remain shown below.</p>`;
  const benchmark=data.benchmark?`<section><div class="eyebrow">Controlled response check</div><h2>What the controlled test recorded</h2><div class="facts"><div><span>Channel</span><strong>${esc(data.benchmark.channel)}</strong></div><div><span>First meaningful response</span><strong>${esc(data.benchmark.firstResponse)}</strong></div><div><span>Silent-lead follow-up</span><strong>${esc(data.benchmark.followUp)}</strong></div></div></section>`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Evidence — ${esc(data.clinic.name)}</title><style>:root{--ink:#10241d;--muted:#65756e;--line:#dce6e1;--paper:#f6f8f6;--green:#173d31;--soft:#e9f1ed;--gold:#b78b45}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:1080px;margin:auto;padding:34px 28px 70px}.top{display:flex;justify-content:space-between;gap:20px;align-items:center}.brand{font-size:12px;font-weight:900;letter-spacing:.18em}.back{color:var(--green);font-weight:800;text-decoration:none}.hero{background:var(--green);color:white;border-radius:24px;padding:34px 38px;margin-top:24px}.hero h1,h2{font-family:Georgia,serif}.hero h1{font-size:42px;line-height:1.05;margin:8px 0}.hero p{color:#d5e1dc;max-width:760px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:900;color:var(--muted)}section{margin-top:30px}h2{font-size:32px;margin:7px 0 16px}.summary,.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.summary>div,.facts>div{background:white;border:1px solid var(--line);border-radius:15px;padding:16px}.summary span,.facts span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}.summary strong,.facts strong{display:block;font-family:Georgia,serif;font-size:23px;margin-top:7px}.shots{display:grid;grid-template-columns:1fr 1fr;gap:14px}figure{margin:0;background:white;border:1px solid var(--line);border-radius:17px;overflow:hidden}figure img{display:block;width:100%;height:340px;object-fit:contain;background:#edf2ef}figcaption{padding:14px}figcaption strong{display:block;text-transform:capitalize}figcaption span{display:block;color:var(--muted);font-size:12px;margin-top:4px}table{width:100%;border-collapse:collapse;background:white;border:1px solid var(--line);border-radius:16px;overflow:hidden}th,td{text-align:left;padding:13px;border-bottom:1px solid var(--line)}th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.formula{background:var(--soft);border-radius:16px;padding:18px;margin-top:12px}.formula strong{display:block;margin-bottom:5px}.caveats{color:var(--muted)}.caveats li{margin:7px 0}.empty{background:white;border:1px solid var(--line);padding:20px;border-radius:16px}@media(max-width:760px){.page{padding:22px 15px 50px}.summary,.facts,.shots{grid-template-columns:1fr}.hero{padding:28px 22px}.hero h1{font-size:35px}figure img{height:auto;max-height:420px}}</style></head><body><main class="page"><div class="top"><div class="brand">EDEN CLINIC NETWORK</div><a class="back" href="../index.html">← Back to Audit</a></div><section class="hero"><div class="eyebrow">Supporting evidence</div><h1>Evidence behind the estimate</h1><p>${esc(data.clinic.name)}${data.clinic.location?` · ${esc(data.clinic.location)}`:''}. This appendix shows the inputs, calculation logic and strongest available snapshots without adding noise to the main Audit.</p></section><section><div class="eyebrow">Estimate summary</div><h2>Loss and realistic recovery range</h2><div class="summary"><div><span>Estimated revenue at risk</span><strong>${esc(data.economics.risk)}</strong></div><div><span>Conservative recovery</span><strong>${esc(data.economics.conservative)}</strong></div><div><span>Base scenario</span><strong>${esc(data.economics.base)}</strong></div><div><span>Upside scenario</span><strong>${esc(data.economics.upside)}</strong></div></div></section><section><div class="eyebrow">Key snapshots</div><h2>What the Audit inspected</h2><div class="shots">${shots}</div></section>${benchmark}<section><div class="eyebrow">Clinic inputs + assumptions</div><h2>How the estimate was built</h2><table><thead><tr><th>Input</th><th>Value</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table><div class="formula"><strong>Calculation</strong>${esc(data.formula)}</div></section><section class="caveats"><div class="eyebrow">Limits</div><h2>What this evidence does—and does not—prove</h2><ul>${data.caveats.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>Audit generated ${esc(new Date(data.generatedAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}))}.</p></section></main></body></html>`;
}
function writeEvidenceAppendix(ownerDir,manifest,model){
  const data=buildEvidenceAppendixModel(manifest,model);
  const evidenceDir=path.join(ownerDir,'evidence');
  const assetsDir=path.join(evidenceDir,'assets');
  fs.mkdirSync(assetsDir,{recursive:true});
  data.screenshots=data.screenshots.map((shot,i)=>{
    const ext=path.extname(shot.path)||'.png';
    const dest=path.join(assetsDir,`evidence-${i+1}${ext}`);
    fs.copyFileSync(shot.path,dest);
    return {...shot,href:`assets/${path.basename(dest)}`};
  });
  const htmlPath=path.join(evidenceDir,'index.html');
  fs.writeFileSync(htmlPath,applyClinicnetTheme(renderEvidenceAppendix(data),'evidence'),'utf8');
  writeJson(path.join(evidenceDir,'evidence-model.json'),data);
  return {htmlPath,href:'evidence/index.html',screenshotCount:data.screenshots.length};
}
function renderOwnerReport(model){
  const e=model.economics||{};
  const c=model.copy||{};
  const hasMoney=e.status==='scenario-calculated'&&e.recoverableRevenue;
  const exposure=e.revenueExposed?`${money(e.revenueExposed.low,e.currency)}${e.revenueExposed.high!==e.revenueExposed.low?`–${money(e.revenueExposed.high,e.currency)}`:''}`:'Needs clinic inputs';
  const decisionHero=`<section class="decision"><div class="decision-money"><div class="eyebrow">${esc(c.decision.riskLabel)}</div><strong>${esc(c.decision.riskValue)}</strong><span>${esc(c.decision.riskSubtext)}</span></div><div class="decision-money recover"><div class="eyebrow">${esc(c.decision.recoverLabel)}</div><strong>${esc(c.decision.recoverValue)}</strong><span>${esc(c.decision.recoverSubtext)}</span></div><div class="decision-leak"><div class="eyebrow">${esc(c.decision.leakLabel)}</div><h2>${esc(model.primaryOpportunity.title)}</h2><p>${esc(model.primaryOpportunity.diagnosis||model.primaryOpportunity.revenueMechanism||'This is the most commercially supported patient step identified by the audit.')}</p></div><div class="decision-fix"><div class="eyebrow">${esc(c.decision.fixLabel)}</div><h2>${esc(model.recommendedFix.text)}</h2><p><strong>${esc(c.decision.edenPrefix)}</strong> ${esc(model.edenImplementation.text)}</p></div></section>`;
  const previewUrl=model.trySolution.demoUrl||'preview/';
  const demo=`<a class="button" href="${esc(previewUrl)}">${esc(c.trySolution.button)}</a>`;
  const evidenceLink=model.evidenceAppendix?.href?`<div class="evidence-row"><a class="evidence-link" href="${esc(model.evidenceAppendix.href)}">${esc(c.trySolution.evidenceButton)}</a><span>Supporting snapshots, inputs and calculation details</span></div>`:'';
  const reviewNote=model.humanReview?.reviewerNote?`<div class="review-note"><strong>Reviewer note:</strong> ${esc(model.humanReview.reviewerNote)}</div>`:'';
  const coverVisual=model.visuals?.coverImage?`<div class="cover-visual"><img src="${esc(model.visuals.coverImage)}" alt="Clinic audit cover visual"></div>`:'';
  const beforeImage=model.visuals?.beforeImage?`<img src="${esc(model.visuals.beforeImage)}" alt="Before the recommended fix">`:'';
  const afterImage=model.visuals?.afterImage?`<img src="${esc(model.visuals.afterImage)}" alt="After the recommended fix">`:'';
  const fixVisual=model.visuals?.fixImage?`<div class="fix-visual image"><img src="${esc(model.visuals.fixImage)}" alt="Recommended fix visual"></div>`:`<div class="fix-visual"><div class="flow before">${beforeImage}<small>${esc(c.fixVisual.beforeLabel)}</small><strong>${esc(c.fixVisual.beforeTitle)}</strong><span>${esc(c.fixVisual.beforeDetail)}</span></div><div class="flow-arrow">→</div><div class="flow after">${afterImage}<small>${esc(c.fixVisual.afterLabel)}</small><strong>${esc(c.fixVisual.afterTitle)}</strong><span>${esc(c.fixVisual.afterDetail)}</span></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${esc(model.clinic.name)} — Eden Clinic Audit</title><style>
:root{--ink:#10241d;--muted:#64756d;--line:#dce6e1;--paper:#f6f8f6;--green:#173d31;--soft:#e9f1ed;--warm:#f6efe2;--gold:#b78b45;--risk:#8c3e2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}.page{max-width:1120px;margin:auto;padding:34px 28px 70px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}.brand{font-size:13px;font-weight:900;letter-spacing:.2em}.badge{font-size:11px;padding:8px 11px;border:1px solid var(--line);border-radius:999px;background:white}.hero{background:var(--green);color:white;padding:36px 42px;border-radius:26px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;font-size:10px;font-weight:900;color:var(--muted)}.hero .eyebrow{color:#bcd0c7}.hero h1{font-family:Georgia,serif;font-size:46px;line-height:1.02;letter-spacing:-.04em;margin:10px 0 12px;max-width:930px}.clinic{font-size:16px;font-weight:800}.hero p{max-width:850px;color:#d7e3dd;font-size:17px;margin-bottom:0}.cover-visual{margin-top:16px;border-radius:22px;overflow:hidden;max-height:360px;background:#dde8e2}.cover-visual img{display:block;width:100%;height:100%;max-height:360px;object-fit:cover}.decision{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.decision>div{border-radius:20px;padding:24px;background:white;border:1px solid var(--line)}.decision-money{background:#fff!important}.decision-money.recover{background:var(--green)!important;color:white;border:0}.decision-money.recover .eyebrow,.decision-money.recover span{color:#c9d9d2}.decision-money strong{font-family:Georgia,serif;font-size:38px;display:block;margin:5px 0}.decision-money span{font-size:13px;color:var(--muted)}.decision-leak{background:var(--warm)!important;border:0!important}.decision-fix{background:var(--soft)!important;border:0!important}.decision h2{font-family:Georgia,serif;font-size:29px;line-height:1.08;margin:7px 0 10px}.decision p{margin:0;color:#43564e}.section{margin-top:30px}.section h2{font-family:Georgia,serif;font-size:36px;letter-spacing:-.025em;margin:6px 0 8px}.section-intro{color:var(--muted);max-width:820px;font-size:16px;margin:0 0 18px}.fix-visual{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:stretch;background:white;border:1px solid var(--line);border-radius:20px;padding:22px}.fix-visual.image{display:block;padding:0;overflow:hidden}.fix-visual.image img{display:block;width:100%;max-height:440px;object-fit:cover}.flow{padding:20px;border-radius:16px;overflow:hidden}.flow.before{background:#fff4ef}.flow.after{background:#e8f3ed}.flow img{display:block;width:calc(100% + 40px);height:210px;object-fit:cover;margin:-20px -20px 18px}.flow small{display:block;font-size:9px;letter-spacing:.12em;font-weight:900;color:var(--muted);margin-bottom:6px}.flow strong{font-family:Georgia,serif;font-size:22px;display:block}.flow span{display:block;color:var(--muted);margin-top:6px}.flow-arrow{font-size:30px;color:var(--gold);font-weight:900;align-self:center}.try-card{background:white;border:1px solid var(--line);border-radius:20px;padding:28px}.try-card h3{font-family:Georgia,serif;font-size:30px;margin:7px 0}.try-card p{color:var(--muted);max-width:820px}.button{display:inline-block;background:var(--green);color:white;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:800;font-size:13px}.button.ghost{opacity:.5;cursor:default}.evidence-row{display:flex;gap:14px;align-items:center;margin:10px 4px 0;padding:14px 4px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}.evidence-link{display:inline-block;color:var(--green);font-weight:800;font-size:12px;text-decoration:none;border-bottom:1px solid #9fb5ab;padding:11px 2px 5px}.review-note{margin-top:18px;background:#fff8e8;border:1px solid #ead9b6;border-radius:14px;padding:14px;color:#5c523d;font-size:13px}.evidence{border-top:1px solid var(--line);padding-top:20px;color:var(--muted);font-size:11px}.evidence strong{color:var(--ink)}@media(max-width:760px){.fix-visual{grid-template-columns:1fr}.flow-arrow{transform:rotate(90deg);text-align:center}.page{padding:22px 15px 50px}.hero{padding:28px 22px}.hero h1{font-size:38px}.decision{grid-template-columns:1fr}.section h2{font-size:32px}.decision-money strong{font-size:34px}.evidence-row{display:block}.evidence-row span{display:block;margin-top:7px}.evidence-link{display:inline-block}}@media print{body{background:white}.page{max-width:none}.hero,.decision-money.recover,.decision-leak,.decision-fix{ -webkit-print-color-adjust:exact;print-color-adjust:exact}.try-card{break-inside:avoid}}
</style></head><body><main class="page"><div class="top"><div class="brand">EDEN CLINIC NETWORK</div><div class="badge">Owner Report · V${esc(VERSION)}</div></div><section class="hero"><div class="eyebrow">${esc(c.hero.eyebrow)}</div><h1>${esc(c.hero.headline)}</h1><div class="clinic">${esc(c.clinic.name)}${c.clinic.location?` · ${esc(c.clinic.location)}`:''}</div><p>${esc(c.hero.intro)}</p></section>${coverVisual}${decisionHero}<section class="section fix-picture"><div class="eyebrow">${esc(c.fixVisual.eyebrow)}</div><h2>${esc(c.fixVisual.heading)}</h2>${c.fixVisual.body?`<p class="section-intro">${esc(c.fixVisual.body)}</p>`:''}${fixVisual}</section><section class="section">${evidenceLink}<article class="try-card"><div class="try-avatar">${esc((model.preview?.assistantName||'M').slice(0,1))}</div><div class="try-persona">${esc(model.preview?.assistantName||'Mia')} · ${esc(model.clinic.name)}</div><div class="eyebrow">${esc(c.trySolution.eyebrow)}</div><h3>${esc(c.trySolution.heading)}</h3><p>${esc(c.trySolution.text)}</p>${demo}<p class="try-status">${esc(c.trySolution.disclaimer)}</p></article></section>${reviewNote}<section class="section evidence"><strong>Evidence standard:</strong> ${esc(model.evidencePolicy.unknown)} ${esc(model.evidencePolicy.money)} ${esc(model.evidencePolicy.sales)}</section></main></body></html>`;
}

function writeOwnerReportFiles(outDir,manifest,options={}){
  const model=buildOwnerReportModel(manifest,options);
  const dir=path.join(outDir,'owner-report');
  fs.mkdirSync(dir,{recursive:true});
  const assetsDir=path.join(dir,'assets');
  function prepareVisual(value,label){
    if(!value)return null;
    if(/^https?:\/\//i.test(value)||/^data:/i.test(value))return value;
    const full=path.resolve(value);
    if(!fs.existsSync(full))return null;
    fs.mkdirSync(assetsDir,{recursive:true});
    const ext=path.extname(full)||'.png';
    const dest=path.join(assetsDir,`${label}${ext}`);
    fs.copyFileSync(full,dest);
    return `assets/${path.basename(dest)}`;
  }
  model.visuals.coverImage=prepareVisual(options.coverImage||model.visuals.coverImage,'cover');
  model.visuals.fixImage=prepareVisual(options.fixImage||model.visuals.fixImage,'top-fix');
  model.visuals.beforeImage=prepareVisual(options.beforeImage||model.visuals.beforeImage,'before-fix');
  model.visuals.afterImage=prepareVisual(options.afterImage||model.visuals.afterImage,'after-fix');
  model.evidenceAppendix=writeEvidenceAppendix(dir,manifest,model);
  const modelPath=path.join(dir,'owner-report-model.json');
  const htmlPath=path.join(dir,'index.html');
  const reviewTemplatePath=path.join(dir,'owner-review.template.json');
  writeJson(modelPath,model);
  if(!fs.existsSync(reviewTemplatePath))writeJson(reviewTemplatePath,buildOwnerReviewTemplate(model));
  fs.writeFileSync(htmlPath,applyClinicnetTheme(renderOwnerReport(model),'owner'),'utf8');
  const {profileFromModel,renderPreviewPage}=require('./receptionist-preview');
  const previewDir=path.join(dir,'preview');fs.mkdirSync(previewDir,{recursive:true});
  fs.writeFileSync(path.join(previewDir,'index.html'),renderPreviewPage(profileFromModel(model),{apiPath:'chat',implementationPath:'implementation'}),'utf8');
  return {schemaVersion:VERSION,reportDir:dir,modelPath,htmlPath,reviewTemplatePath};
}
module.exports={VERSION,buildOwnerReportModel,renderOwnerReport,writeOwnerReportFiles,economicImpact,normalizePath,groupPath,selectCommercialOpportunity,buildStrengths,loadOwnerReview,buildOpportunityList,buildOwnerReviewTemplate,chooseEvidenceScreenshots,buildEvidenceAppendixModel,renderEvidenceAppendix,writeEvidenceAppendix,applyClinicnetTheme,clinicnetThemeCss};
