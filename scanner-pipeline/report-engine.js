const fs = require('fs');
const path = require('path');
const { writeJson } = require('./utils');
const { buildPublicationGuardrails, resolvedPublicValue } = require('./publication-guardrails');

const REPORT_VERSION = '2.2.28';

function finite(v){ return v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v)) ? Number(v) : null; }
function esc(v=''){ return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function clampText(v,n=180){ const s=String(v||'').replace(/\s+/g,' ').trim(); return s.length>n ? `${s.slice(0,n-1)}…` : s; }
function band(score){ if(score==null)return 'unknown'; if(score>=90)return 'excellent'; if(score>=80)return 'strong'; if(score>=70)return 'good'; if(score>=60)return 'mixed'; return 'priority'; }
function safeReadJson(file){ if(!file)return null; try{return JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));}catch{return null;} }

function normalizeReview(review){
  if(!review) return { supplied:false, status:'pending', reviewer:null, reviewedAt:null, note:'Automated findings require human verification before client publication.', findings:{}, claimResolutions:{} };
  const status=['verified','reviewed-with-corrections','reviewed-with-caveats','pending'].includes(review.status) ? review.status : 'pending';
  return { supplied:true, status, reviewer:review.reviewer||null, reviewedAt:review.reviewedAt||null, note:review.note||null, findings:review.findings||{}, claimResolutions:review.claimResolutions||{} };
}

function reviewTemplate(model){
  const findings={};
  for(const f of model.priorityFindings||[]) findings[f.id]={status:'pending',note:''};
  return {
    schemaVersion:REPORT_VERSION,
    clinic:model.clinic,
    status:'pending',
    reviewer:'',
    reviewedAt:null,
    note:'Review priority findings and evidence before client publication. Use verified, reviewed-with-corrections, or reviewed-with-caveats when complete.',
    findings,
    claimResolutions:Object.fromEntries((model.publicationGuardrails?.verification||[]).map(v=>[v.claimId,{status:'pending',publicValue:null,note:''}]))
  };
}

function websitePillar(manifest){
  const front=manifest.digitalFrontDoor;
  if(front && front.conventionalWebsite===false) return {id:'website',label:'Website Conversion',status:'not-applicable',score:null,band:'unknown',confidence:null,metrics:[{label:'Primary digital front door',value:front.label||front.type}],finding:`No independent clinic website is being scored; the primary digital front door is ${front.label||front.type}.`};
  const s=manifest.scoring;
  if(!s) return {id:'website',label:'Website Conversion',status:'not-run',score:null,band:'unknown',confidence:null,metrics:[],finding:null};
  const score=finite(s.overall);
  const flags=s.flags||[];
  const finding=(manifest.findings||[])[0];
  const metrics=[];
  if(manifest.summary){
    metrics.push({label:'Booking CTA visible',value:manifest.summary.bookingCtaVisible?'Yes':'No'});
    metrics.push({label:'Phone actionable',value:manifest.summary.phoneActionable?'Yes':'No'});
    metrics.push({label:'Mobile hero clarity',value:finite(manifest.summary.mobileHeroClarity)});
  }
  return {id:'website',label:'Website Conversion',status:'scored',score,band:band(score),confidence:'deterministic',metrics,flags:flags.slice(0,5),finding:finding?.title||finding?.finding||finding?.message||null};
}

function googlePillar(manifest,guardrails=null){
  const a=manifest.googleBusiness?.assessment;
  const e=manifest.googleBusiness?.evidence;
  const branch=e?.branches?.[0]||{};
  if(!a||a.status==='awaiting-evidence'||a.status==='not-run') return {id:'google',label:'Google Business / Maps',status:'awaiting-evidence',score:null,band:'unknown',confidence:a?.confidence||'none',metrics:[],finding:'Google Business evidence is not yet sufficient for a published score.'};
  const blocked=guardrails?.blockedPillars?.includes('google');
  const metrics=[];
  const ratingBlocked=!!guardrails?.blockedFields?.['google.rating'];
  const reviewBlocked=!!guardrails?.blockedFields?.['google.reviewCount'];
  const rating=resolvedPublicValue(guardrails,'google','rating',finite(branch.profile?.rating));
  const reviews=resolvedPublicValue(guardrails,'google','reviewCount',finite(branch.profile?.reviewCount));
  if(ratingBlocked)metrics.push({label:'Google rating',value:'Under verification'});
  else if(finite(rating)!=null)metrics.push({label:'Google rating',value:`${finite(rating).toFixed(1)}/5`});
  if(reviewBlocked)metrics.push({label:'Reviews observed',value:'Under verification'});
  else if(finite(reviews)!=null)metrics.push({label:'Reviews observed',value:Math.round(finite(reviews))});
  if(branch.actions?.directionsAvailable===true)metrics.push({label:'Directions action',value:'Yes'});
  if(branch.actions?.websiteAvailable===true)metrics.push({label:'Website action',value:'Yes'});
  if(branch.actions?.callAvailable===true)metrics.push({label:'Call action',value:'Yes'});
  if(branch.actions?.bookingAvailable===true)metrics.push({label:'Booking action',value:'Yes'});
  if(branch.conversionDestination?.classification)metrics.push({label:'Google link destination',value:String(branch.conversionDestination.classification).replace(/-/g,' ')});
  if(finite(branch.conversionDestination?.qualityScore)!=null)metrics.push({label:'Destination quality',value:`${Math.round(finite(branch.conversionDestination.qualityScore))}/100`});
  if(finite(a.patientConversionReadiness?.score)!=null)metrics.push({label:'Patient handoff readiness',value:`${Math.round(finite(a.patientConversionReadiness.score))}/100`});
  if(a.patientConversionReadiness?.actualConversionPerformance==='not-measured')metrics.push({label:'Observed inquiry → booking conversion',value:'Not measured'});
  if(a.branchCount!=null&&a.branchCount>1)metrics.push({label:'Branches assessed',value:a.branchCount});
  if(a.branchSpread!=null&&a.branchCount>1)metrics.push({label:'Branch score spread',value:a.branchSpread});
  const internalScore=a.status==='scored'?finite(a.overall):null;
  const score=blocked?null:internalScore;
  const finding=blocked?'A score-driving Google fact conflicts across captured evidence. The internal score is withheld from client publication until the conflict is reconciled.':a.status==='scored'?(a.interpretation||null):'Google Maps evidence was captured, but coverage is not yet sufficient for a defensible published score.';
  return {id:'google',label:a.scoreScopeLabel||'Google Business Profile Strength',status:blocked?'verification-required':(a.status||'insufficient-evidence'),score,internalScore,band:blocked?'unknown':(a.band||band(score)),confidence:a.confidence||null,metrics,finding,components:a.components||null,patientConversionReadiness:a.patientConversionReadiness||null,publicationBlocked:blocked};
}

function facebookPillar(manifest){
  const a=manifest.facebook?.assessment;
  if(!a||a.status==='awaiting-evidence'||a.status==='not-run') return {id:'facebook',label:'Facebook Patient Demand',status:'awaiting-evidence',score:null,band:'unknown',confidence:a?.confidence||'none',metrics:[],finding:'Facebook evidence is not yet sufficient for a published score.'};
  const r=a.responseMetrics||{};
  const metrics=[
    {label:'Probable patient leads observed',value:r.observedIntentComments ?? null},
    {label:'Explicit / high-intent inquiries',value:r.scoringObservedIntentComments ?? null},
    {label:'High-intent response coverage',value:r.scoringResponseCoveragePercent!=null?`${r.scoringResponseCoveragePercent}%`:null},
    {label:'General-interest leads',value:r.generalInterestObservedCount ?? null}
  ];
  const sample=a.sampleStability||{};
  const finding=sample.responseCoverageInterpretation || null;
  return {id:'facebook',label:a.scoreScopeLabel||'Facebook Patient Demand',status:a.status||'scored',score:finite(a.overall),band:a.band||band(a.overall),confidence:a.confidence||null,metrics,finding,caveat:sample.caveat||null,demandLeakage:a.demandLeakage||null};
}

function deriveFindings(manifest,pillars){
  const out=[];
  const fb=manifest.facebook?.assessment;
  const r=fb?.responseMetrics||{};
  const leak=fb?.demandLeakage||{};
  if((leak.unansweredHighIntentLeads||0)>0){
    out.push({id:'fb-unanswered-high-intent',severity:'high',pillar:'facebook',title:`${leak.unansweredHighIntentLeads} explicit patient ${leak.unansweredHighIntentLeads===1?'inquiry':'inquiries'} showed no public clinic reply`,detail:`Observed across sampled public Facebook content. ${r.scoringResponseCoveragePercent!=null?`High-intent response coverage was ${r.scoringResponseCoveragePercent}%.`:''}`,confidence:'high',evidenceType:'observed-public-content'});
  }
  if((r.generalInterestUnansweredCount||0)>0){
    out.push({id:'fb-general-interest-leakage',severity:'medium',pillar:'facebook',title:`${r.generalInterestUnansweredCount} additional general-interest leads showed no public reply`,detail:'Expressions such as “Interested” are tracked separately from explicit pricing, treatment, booking, location, availability, or urgent inquiries.',confidence:'medium',evidenceType:'sampled-public-content'});
  }
  if(r.scoringAnsweredIntentCount>0 && r.medianResponseMinutes==null){
    out.push({id:'fb-timing-unknown',severity:'info',pillar:'facebook',title:'Clinic reply evidence exists, but historic response speed remains unverified',detail:`${r.scoringAnsweredIntentCount} explicit/high-intent inquiries showed reply evidence, but Facebook did not expose timestamps precise enough for defensible minute-level latency.`,confidence:'high',evidenceType:'measurement-boundary'});
  }
  const ws=manifest.scoring;
  if(ws && manifest.digitalFrontDoor?.conventionalWebsite!==false){
    const cats=ws.categories||{};
    const candidates=Object.entries(cats).filter(([,v])=>Number.isFinite(Number(v))).sort((a,b)=>Number(a[1])-Number(b[1])).slice(0,2);
    for(const [k,v] of candidates){
      if(Number(v)<80) out.push({id:`website-${k}`,severity:Number(v)<65?'high':'medium',pillar:'website',title:`Website opportunity: ${k.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase())}`,detail:`Measured score: ${Math.round(Number(v))}/100.`,confidence:'high',evidenceType:'deterministic-website-scan'});
    }
  }
  const ga=manifest.googleBusiness?.assessment;
  const gd=manifest.googleBusiness?.evidence?.branches?.[0]?.conversionDestination || manifest.googleBusinessProbe?.conversionDestination;
  if(gd && finite(gd.qualityScore)!=null && finite(gd.qualityScore)<70){
    const cls=String(gd.classification||'weak destination').replace(/-/g,' ');
    out.push({id:'google-conversion-destination',severity:finite(gd.qualityScore)<45?'high':'medium',pillar:'google',title:'Google sends ready-to-act patients into a weak conversion destination',detail:`Observed destination: ${cls}; destination quality ${Math.round(finite(gd.qualityScore))}/100. ${gd.rationale||''}`,confidence:'high',evidenceType:'google-outbound-destination-probe'});
  }
  if(ga?.status==='scored' && finite(ga.overall)!=null && finite(ga.overall)<80){
    out.push({id:'google-business-opportunity',severity:ga.overall<65?'high':'medium',pillar:'google',title:'Google Business / Maps conversion opportunity',detail:ga.interpretation||`Measured score: ${ga.overall}/100.`,confidence:ga.confidence||'medium',evidenceType:'google-business-evidence'});
  }
  if(!out.length) out.push({id:'no-critical-gaps',severity:'info',pillar:'cross-channel',title:'No critical gap was proven in the currently available evidence',detail:'Continue human verification and expand evidence coverage before making stronger claims.',confidence:'medium',evidenceType:'current-evidence'});
  return out.slice(0,7);
}

function deriveQuickWins(findings){
  const wins=[];
  if(findings.some(f=>f.id==='fb-unanswered-high-intent')) wins.push({title:'Capture every high-intent social inquiry',detail:'Route qualifying Facebook inquiries into a rapid-response workflow instead of relying on manual discovery.'});
  if(findings.some(f=>f.id==='fb-general-interest-leakage')) wins.push({title:'Follow up softer expressions of interest',detail:'Treat “Interested” as a lead signal while keeping it separate from explicit commercial questions.'});
  if(findings.some(f=>f.pillar==='website'&&f.severity!=='info')) wins.push({title:'Fix the weakest website conversion step',detail:'Prioritize the lowest-scoring measured website category before cosmetic redesign work.'});
  if(findings.some(f=>f.id==='google-conversion-destination')) wins.push({title:'Upgrade the Google patient handoff',detail:'Send high-intent Maps traffic directly into a clinic-controlled booking or 24/7 receptionist path instead of a distracting intermediary.'});
  else if(findings.some(f=>f.pillar==='google')) wins.push({title:'Strengthen Google Business conversion paths',detail:'Improve the weakest evidenced profile/branch component and verify consistency with the website.'});
  if(!wins.length)wins.push({title:'Preserve strengths and expand evidence',detail:'Use human review to verify the strongest and weakest observations before publication.'});
  return wins.slice(0,4);
}

function buildReportModel(manifest,{humanReview=null}={}){
  const clinic=manifest.clinicIdentity||{clinicName:null,location:null};
  const review=normalizeReview(humanReview);
  const publicationGuardrails=buildPublicationGuardrails(manifest,{humanReview:review});
  const pillars=[websitePillar(manifest),googlePillar(manifest,publicationGuardrails),facebookPillar(manifest)];
  const scored=pillars.filter(p=>p.score!=null);
  const findings=deriveFindings(manifest,pillars);
  const reviewComplete=['verified','reviewed-with-corrections','reviewed-with-caveats'].includes(review.status);
  const ai=manifest.aiAuditIntelligence?.status==='completed' ? manifest.aiAuditIntelligence : null;
  const aiNarrative=ai?.narrative||null;
  const aiPriority=(aiNarrative?.topPriorities||[]).map((x,i)=>({id:`ai-priority-${i+1}`,severity:i===0?'high':'medium',pillar:'cross-channel',title:x.title,detail:x.why,confidence:'AI interpretation — human review required',evidenceType:x.evidenceBasis}));
  const growth=manifest.crossChannelGrowth||null;
  const growthPriority=(growth?.actions?.topActions||[]).map((x,i)=>({id:x.id,severity:i===0?'high':'medium',pillar:x.pillar||'cross-channel',title:x.title,detail:x.diagnosis,confidence:`${x.confidence} — ranked ${x.priorityIndex}/100`,evidenceType:x.evidenceType,recommendedAction:x.action,revenueMechanism:x.revenueMechanism,priorityIndex:x.priorityIndex,impact:x.impact,effort:x.effort}));
  const presentationFindings=growthPriority.length ? growthPriority : (aiPriority.length ? aiPriority : findings);
  const presentationWins=(aiNarrative?.quickWins||[]).map(x=>({title:x.title,detail:x.action,evidenceBasis:x.evidenceBasis}));
  return {
    schemaVersion:REPORT_VERSION,
    generatedAt:new Date().toISOString(),
    clinic:{name:clinic.clinicName||clinic.name||'Clinic',location:clinic.location||null,website:manifest.reviewedUrl||null},
    publication:{status:reviewComplete&&publicationGuardrails.status==='clear'?'client-ready':publicationGuardrails.status==='verification-required'?'verification-required':'draft',humanReview:review,trustLabel:reviewComplete&&publicationGuardrails.status==='clear'?(review.status==='verified'?'Verified by Eden':'Human reviewed'):publicationGuardrails.status==='verification-required'?'Verification required':'Pending human verification'},
    publicationGuardrails,
    scorePolicy:{blendedOverallPublished:false,reason:manifest.digitalFrontDoor?.conventionalWebsite===false?'The primary digital front door is not an independent clinic website; channel scores are kept separate and website scoring is marked not applicable.':'Website, Google Business, and Facebook scores remain separate until cross-channel calibration is validated.',scoredPillars:scored.length,totalPillars:3},
    headline:{title:'Clinic Growth Audit',subtitle:'Evidence-backed conversion, visibility, and patient-demand diagnosis',score:null,scoreLabel:'No artificial blended score'},
    pillars:pillars.map(p=>({...p,aiExplanation:aiNarrative?.pillarExplanations?.[p.id==='google'?'googleBusiness':p.id]||null})),
    priorityFindings:presentationFindings,
    deterministicFindings:findings,
    quickWins:presentationWins.length?presentationWins:deriveQuickWins(findings),
    aiIntelligence:ai?{status:ai.status,model:ai.model,agreement:ai.agreement,validation:ai.validation,conflicts:ai.conflicts,visualAssessments:ai.visualAssessments,googleBusinessVisualAssessments:ai.googleBusinessVisualAssessments,facebookVisualAssessments:ai.facebookVisualAssessments}: {status:manifest.aiAuditIntelligence?.status||'not-run'},
    narrative:aiNarrative||{executiveSummary:null,costingPatients:null,pillarExplanations:{website:null,googleBusiness:null,facebook:null},caveats:[],edenIntervention:null},
    crossChannelGrowth:growth,
    patientRevenuePath:growth?.actions?.patientRevenuePath||null,
    actionEngine:growth?.actions||null,
    revenueOpportunity:growth?.revenue||null,
    evidencePolicy:{facebook:'Sampled public-content evidence unless exhaustive history is explicitly proven.',unknowns:'Unknown evidence remains unknown rather than being inferred as zero.',timing:'Historic response-time metrics are published only when timestamp precision supports them.',humanReview:'Major findings should be reviewed before client publication.'},
    sourceVersion:manifest.version||null,
    mode:manifest.mode||'full-audit'
  };
}

function scoreCard(p){
  const score=p.score==null?'—':Math.round(p.score);
  const metrics=(p.metrics||[]).filter(m=>m.value!==null&&m.value!==undefined).map(m=>`<div class="metric"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong></div>`).join('');
  return `<section class="pillar-card"><div class="pillar-top"><div><div class="eyebrow">${esc(p.label)}</div><div class="status">${esc(p.status)}</div></div><div class="score ${esc(p.band)}">${score}<small>${p.score==null?'':'/100'}</small></div></div>${p.finding?`<p class="pillar-finding">${esc(p.finding)}</p>`:''}${p.aiExplanation?`<div class="ai-explain"><strong>Why this score</strong><p>${esc(p.aiExplanation)}</p></div>`:''}<div class="metrics">${metrics}</div>${p.caveat?`<p class="caveat">${esc(p.caveat)}</p>`:''}</section>`;
}

function money(v,currency='THB'){
  if(v===null||v===undefined||!Number.isFinite(Number(v)))return '—';
  try{return new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(Number(v));}catch{return `${currency} ${Math.round(Number(v)).toLocaleString('en-US')}`;}
}
function growthSections(model){
  const engine=model.actionEngine;
  const revenue=model.revenueOpportunity;
  if(!engine&&!revenue)return '';
  const actions=(engine?.topActions||[]).map((a,i)=>`<article class="growth-action"><div class="growth-rank">0${i+1}</div><div><div class="growth-meta"><span>${esc(a.pillar||'cross-channel')}</span><span>priority ${esc(a.priorityIndex)}/100</span><span>${esc(a.confidence)} confidence</span></div><h3>${esc(a.title)}</h3><p>${esc(a.diagnosis)}</p><div class="growth-do"><strong>Do this:</strong> ${esc(a.action)}</div><div class="growth-mech"><strong>Revenue mechanism:</strong> ${esc(a.revenueMechanism)}</div></div></article>`).join('');
  const conditional=(engine?.conditionalActions||[]).slice(0,2).map(a=>`<div class="conditional"><strong>${esc(a.title)}</strong><span>Verify first</span><p>${esc(a.reason||a.diagnosis)}</p></div>`).join('');
  const actionSection=actions?`<section class="section"><div class="section-head"><h2>Highest-value actions</h2><div class="section-note">Ranked by expected conversion leverage, evidence confidence, and implementation effort. Priority index is comparative—not a promised revenue lift.</div></div><div class="growth-actions">${actions}</div>${conditional?`<div class="conditional-wrap"><div class="kicker">Potential interventions — verify demand first</div>${conditional}</div>`:''}</section>`:'';
  if(!revenue)return actionSection;
  let revenueBody='';
  if(revenue.status==='scenario-calculated'&&revenue.monthlyRevenueOpportunity){
    const scenarios=revenue.monthlyRevenueScenarios||{conservative:revenue.monthlyRevenueOpportunity.low,base:Math.round((revenue.monthlyRevenueOpportunity.low+revenue.monthlyRevenueOpportunity.high)/2),upside:revenue.monthlyRevenueOpportunity.high};
    const sourceNote=revenue.assumptions?.leadToBookingRate?.source==='reported-by-clinic'?'Clinic-reported inquiry→booking rate used.':'Inquiry→booking rate is an explicit scenario assumption.';
    revenueBody=`<div class="revenue-hero"><div><div class="kicker">Estimated recoverable revenue / month</div><div class="revenue-number">${money(scenarios.base,revenue.currency)}</div><div class="scenario-grid"><div><small>Conservative</small><strong>${money(scenarios.conservative,revenue.currency)}</strong></div><div><small>Base</small><strong>${money(scenarios.base,revenue.currency)}</strong></div><div><small>Upside</small><strong>${money(scenarios.upside,revenue.currency)}</strong></div></div><p>Calculated from clinic-reported operating volumes and patient value, with separately labelled recovery/conversion assumptions. ${esc(sourceNote)} Eden does not assume every recovered inquiry becomes a paying patient.</p></div></div>`;
  } else {
    const missing=(revenue.missingInputs||[]).map(x=>`<li>${esc(x)}</li>`).join('');
    revenueBody=`<div class="revenue-hero"><div><div class="kicker">Revenue opportunity model</div><div class="revenue-number small">Scenario-ready — inputs required</div><p>Eden does not invent clinic traffic, missed-call volume, message volume, or patient value. Add operational inputs to calculate a defensible range.</p>${missing?`<ul>${missing}</ul>`:''}</div></div>`;
  }
  const plan=(revenue.measurementPlan||[]).slice(0,5).map(x=>`<div class="measure"><strong>${esc(x.metric)}</strong><span>${esc(x.measure)}</span><small>${esc(x.source)}</small></div>`).join('');
  const instrument=(revenue.instrumentationPlan||[]).map(x=>`<div class="instrument"><strong>${esc(x.source)}</strong><p>${esc(x.capture)}</p><small>${esc((x.events||[]).join(' → '))}</small></div>`).join('');
  const revenueSection=`<section class="section revenue"><div class="section-head"><h2>Revenue recovery model</h2><div class="section-note">Missed calls, delayed replies, booking abandonment and channel handoff leakage become measurable only when patient-level operational data is connected.</div></div>${revenueBody}<div class="measure-grid">${plan}</div>${instrument?`<div class="instrumentation"><div class="kicker">Attribution blueprint</div><h3>Source → conversation → booking → attendance → revenue</h3><div class="instrument-grid">${instrument}</div></div>`:''}<p class="caveat">${esc(revenue.formulaPolicy||'')} ${esc(revenue.doubleCountGuardrail||'')}</p></section>`;
  return actionSection+revenueSection;
}

function renderHtml(model){
  const sevLabel={high:'Priority',medium:'Opportunity',info:'Context'};
  const findings=(model.priorityFindings||[]).map((f,i)=>`<article class="finding"><div class="finding-num">0${i+1}</div><div><div class="finding-meta"><span class="tag ${esc(f.severity)}">${esc(sevLabel[f.severity]||f.severity)}</span><span>${esc(f.pillar)}</span><span>${esc(f.confidence)} confidence</span></div><h3>${esc(f.title)}</h3><p>${esc(f.detail)}</p></div></article>`).join('');
  const wins=(model.quickWins||[]).map((w,i)=>`<div class="win"><span>${i+1}</span><div><strong>${esc(w.title)}</strong><p>${esc(w.detail)}</p>${w.evidenceBasis?`<small>Evidence: ${esc(w.evidenceBasis)}</small>`:''}</div></div>`).join('');
  const review=model.publication.humanReview;
  const narrative=model.narrative||{};
  const ai=model.aiIntelligence||{};
  const validationSummary=ai.status==='completed'&&ai.agreement?`<div class="validation-strip"><strong>Independent AI evidence review</strong><span>${esc(ai.agreement.confirmed||0)} scanner claims visually supported</span><span>${esc(ai.agreement.humanReviewConflicts||0)} conflicts flagged for human review</span><span>${esc(ai.model||'')}</span></div>`:'';
  const costing=narrative.costingPatients?`<section class="section insight"><div class="kicker">Conversion diagnosis</div><h2>What may be costing you patients?</h2><p>${esc(narrative.costingPatients)}</p></section>`:'';
  const intervention=narrative.edenIntervention?`<section class="section intervention"><div class="kicker">Recommended Eden intervention</div><h2>From diagnosis to response</h2><p>${esc(narrative.edenIntervention)}</p></section>`:'';
  const reviewDetails=review.reviewer?`Reviewed by ${esc(review.reviewer)}${review.reviewedAt?` · ${esc(review.reviewedAt)}`:''}`:'Automated findings await final Eden review before publication.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eden Clinic Audit — ${esc(model.clinic.name)}</title><style>
:root{--ink:#13231d;--muted:#617069;--line:#dde5e0;--paper:#f6f8f6;--panel:#fff;--accent:#173d31;--soft:#e8f0ec;--warm:#f5efe3;--danger:#8c3e2f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}.page{max-width:1160px;margin:0 auto;padding:54px 34px 80px}.mast{display:flex;justify-content:space-between;align-items:center;margin-bottom:54px}.brand{font-weight:800;letter-spacing:.22em;font-size:14px}.review-badge{border:1px solid var(--line);background:var(--panel);padding:9px 13px;border-radius:999px;font-size:12px;font-weight:700}.hero{display:grid;grid-template-columns:1.45fr .7fr;gap:28px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:42px}.kicker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:800}.hero h1{font-family:Georgia,"Times New Roman",serif;font-size:58px;line-height:.98;letter-spacing:-.035em;margin:10px 0 18px}.lede{font-size:19px;max-width:700px;color:var(--muted)}.clinic-box{background:var(--accent);color:#fff;border-radius:18px;padding:26px}.clinic-box .name{font-family:Georgia,serif;font-size:28px;line-height:1.1}.clinic-box .loc{opacity:.72;margin-top:8px}.policy{font-size:12px;opacity:.72;margin-top:24px}.section{margin-top:50px}.section-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:18px}.section h2{font-family:Georgia,serif;font-size:35px;margin:0;letter-spacing:-.02em}.section-note{max-width:490px;color:var(--muted);font-size:13px}.pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.pillar-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px;min-height:300px}.pillar-top{display:flex;justify-content:space-between;gap:10px}.eyebrow{font-size:13px;font-weight:800}.status{text-transform:uppercase;font-size:10px;letter-spacing:.12em;color:var(--muted);margin-top:5px}.score{font-size:38px;font-family:Georgia,serif;white-space:nowrap}.score small{font-family:Inter,sans-serif;font-size:11px;color:var(--muted)}.pillar-finding{font-size:15px;margin:24px 0;color:#243a31}.ai-explain{background:#f2f6f3;border-radius:12px;padding:12px;margin:0 0 16px}.ai-explain strong{font-size:11px;text-transform:uppercase;letter-spacing:.08em}.ai-explain p{font-size:12px;color:var(--muted);margin:5px 0 0}.validation-strip{margin-top:18px;display:flex;flex-wrap:wrap;gap:9px}.validation-strip span,.validation-strip strong{background:#fff;border:1px solid var(--line);padding:7px 10px;border-radius:999px;font-size:11px}.insight{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px}.insight h2,.intervention h2{margin:6px 0 12px}.insight p,.intervention p{font-size:18px;max-width:850px;color:#33473f}.intervention{background:var(--warm);border-radius:18px;padding:28px}.win small{display:block;margin-top:8px;color:var(--muted);font-size:10px}.metrics{border-top:1px solid var(--line);padding-top:14px}.metric{display:flex;justify-content:space-between;gap:15px;font-size:12px;padding:7px 0}.metric span{color:var(--muted)}.metric strong{text-align:right}.caveat{font-size:11px;color:var(--muted);margin-top:14px}.findings{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}.finding{display:grid;grid-template-columns:56px 1fr;gap:18px;padding:24px;border-bottom:1px solid var(--line)}.finding:last-child{border-bottom:0}.finding-num{font-family:Georgia,serif;font-size:26px;color:#8b9992}.finding-meta{display:flex;gap:10px;align-items:center;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.tag{padding:4px 8px;border-radius:999px;background:var(--soft);color:var(--accent);font-weight:800}.tag.high{background:#f3e6e1;color:var(--danger)}.finding h3{font-size:19px;margin:8px 0 5px}.finding p{margin:0;color:var(--muted);font-size:14px}.wins{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.win{display:flex;gap:15px;background:var(--warm);border-radius:16px;padding:20px}.growth-actions{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden}.growth-action{display:grid;grid-template-columns:58px 1fr;gap:18px;padding:24px;border-bottom:1px solid var(--line)}.growth-action:last-child{border-bottom:0}.growth-rank{font-family:Georgia,serif;font-size:28px;color:#8b9992}.growth-meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:10px}.growth-action h3{margin:7px 0 6px;font-size:20px}.growth-action p{margin:0 0 12px;color:var(--muted)}.growth-do,.growth-mech{font-size:13px;margin-top:7px}.growth-mech{color:var(--muted)}.revenue{background:#edf4f0;border-radius:20px;padding:28px}.revenue-hero{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px}.revenue-number{font-family:Georgia,serif;font-size:42px;line-height:1.05;margin:8px 0}.revenue-number.small{font-size:30px}.revenue-hero p{color:var(--muted);max-width:820px}.scenario-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0 10px}.scenario-grid>div{background:var(--paper);border-radius:10px;padding:12px}.scenario-grid small{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.scenario-grid strong{font-family:Georgia,serif;font-size:20px}.measure-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:14px}.measure{background:#fff;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px}.measure strong{font-size:13px}.measure span{font-size:11px;color:#33473f}.measure small{font-size:9px;color:var(--muted)}.win>span{display:grid;place-items:center;width:28px;height:28px;min-width:28px;border-radius:50%;background:#fff;font-weight:800}.win p{margin:5px 0 0;color:var(--muted);font-size:13px}.verification{margin-top:50px;background:var(--accent);color:#fff;border-radius:20px;padding:28px;display:grid;grid-template-columns:1fr 1.2fr;gap:28px}.verification h2{font-family:Georgia,serif;font-size:30px;margin:0 0 8px}.verification p{opacity:.78;margin:0}.trust-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.trust-item{background:rgba(255,255,255,.08);padding:12px;border-radius:10px;font-size:12px}.footer{margin-top:28px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:20px}.conditional-wrap{margin-top:16px;background:#fff7e8;border:1px solid #ead8b6;border-radius:16px;padding:18px}.conditional{display:grid;grid-template-columns:1fr auto;gap:6px 14px;padding:12px 0;border-bottom:1px solid #ead8b6}.conditional:last-child{border-bottom:0}.conditional span{font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.conditional p{grid-column:1/-1;margin:0;color:var(--muted);font-size:12px}.instrumentation{margin-top:22px}.instrumentation h3{font-family:Georgia,serif;font-size:24px;margin:6px 0 14px}.instrument-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.instrument{background:#fff;border-radius:12px;padding:14px}.instrument p{font-size:11px;color:var(--muted);min-height:48px}.instrument small{font-size:9px;color:#33473f}.guardrail-alert{margin-top:28px;background:#fff3ed;border:1px solid #e8c6b7;border-radius:16px;padding:18px}.guardrail-alert strong{color:var(--danger)}.guardrail-alert p{margin:5px 0 0;color:var(--muted);font-size:13px}@media(max-width:780px){.scenario-grid{grid-template-columns:1fr}.page{padding:28px 18px 55px}.hero{grid-template-columns:1fr}.hero h1{font-size:42px}.pillars{grid-template-columns:1fr}.wins{grid-template-columns:1fr}.measure-grid{grid-template-columns:1fr}.instrument-grid{grid-template-columns:1fr}.growth-action{grid-template-columns:42px 1fr}.verification{grid-template-columns:1fr}.mast{margin-bottom:32px}}@media print{body{background:#fff}.page{max-width:none;padding:18mm}.review-badge{background:#fff}.pillar-card,.findings{break-inside:avoid}.verification{break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}.hero h1{font-size:42px}.section{margin-top:30px}}
</style></head><body><main class="page"><header class="mast"><div class="brand">EDEN CLINIC NETWORK</div><div class="review-badge">${esc(model.publication.trustLabel)}</div></header><section class="hero"><div><div class="kicker">${esc(model.headline.title)}</div><h1>${esc(model.clinic.name)}</h1><p class="lede">${esc(narrative.executiveSummary||model.headline.subtitle)}${!narrative.executiveSummary&&model.clinic.location?` for ${esc(model.clinic.location)}`:''}${!narrative.executiveSummary?'.':''}</p>${validationSummary}</div><aside class="clinic-box"><div class="kicker" style="color:#cbdad3">Audit scope</div><div class="name">Website · Maps · Facebook</div><div class="loc">${esc(model.clinic.location||'Location not supplied')}</div><div class="policy">${esc(model.scorePolicy.reason)}</div></aside></section>${costing}${model.publicationGuardrails?.status==='verification-required'?`<section class="guardrail-alert"><strong>Publication guardrail active</strong><p>${esc(model.publicationGuardrails.policy)}</p></section>`:''}<section class="section"><div class="section-head"><h2>The digital picture</h2><div class="section-note">Three channels, scored independently. Unknown evidence stays unknown. No artificial blended score is published until cross-channel calibration is validated.</div></div><div class="pillars">${model.pillars.map(scoreCard).join('')}</div></section>${growthSections(model)}<section class="section"><div class="section-head"><h2>What Eden found</h2><div class="section-note">Prioritized findings are generated from captured evidence, then designed to pass through human verification before client publication.</div></div><div class="findings">${findings}</div></section><section class="section"><div class="section-head"><h2>Fastest opportunities</h2><div class="section-note">The goal is not a longer checklist. It is a short path from observed friction to measurable patient conversion improvement.</div></div><div class="wins">${wins}</div></section>${intervention}<section class="verification"><div><div class="kicker" style="color:#cbdad3">Evidence standard</div><h2>${esc(model.publication.trustLabel)}</h2><p>${reviewDetails}</p></div><div class="trust-grid"><div class="trust-item"><strong>Unknown ≠ zero</strong><br>Missing evidence is not silently penalized.</div><div class="trust-item"><strong>Facebook is sampled</strong><br>Public response coverage is not presented as lifetime account performance.</div><div class="trust-item"><strong>Timing must be defensible</strong><br>No minute-level response claim without precise timestamps.</div><div class="trust-item"><strong>Human final layer</strong><br>Major findings can be verified, corrected, or caveated before delivery.</div></div></section><footer class="footer"><span>Eden Clinic Audit · Report Engine ${esc(model.schemaVersion)}</span><span>Generated ${esc(model.generatedAt)}</span></footer></main></body></html>`;
}

function writeReportFiles(outDir,manifest,{humanReviewPath=null}={}){
  const review=humanReviewPath?safeReadJson(humanReviewPath):null;
  const model=buildReportModel(manifest,{humanReview:review});
  const reportDir=path.join(outDir,'report');
  fs.mkdirSync(reportDir,{recursive:true});
  writeJson(path.join(reportDir,'report-model.json'),model);
  writeJson(path.join(reportDir,'human-review-template.json'),reviewTemplate(model));
  fs.writeFileSync(path.join(reportDir,'index.html'),renderHtml(model),'utf8');
  return {reportDir,modelPath:path.join(reportDir,'report-model.json'),htmlPath:path.join(reportDir,'index.html'),humanReviewTemplatePath:path.join(reportDir,'human-review-template.json'),publicationStatus:model.publication.status};
}

module.exports={REPORT_VERSION,buildReportModel,renderHtml,writeReportFiles,reviewTemplate};
