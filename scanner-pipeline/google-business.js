const fs = require('fs');
const path = require('path');
const { writeJson } = require('./utils');

const GBP_SCHEMA_VERSION = '2.0';

function clamp(n,min=0,max=100){ n=Number(n); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null; }
function daysBetween(a,b){ const x=new Date(a),y=new Date(b); if(!Number.isFinite(+x)||!Number.isFinite(+y))return null; return Math.max(0,Math.round((y-x)/86400000)); }
function band(score){ if(score==null)return'unknown'; if(score>=90)return'excellent'; if(score>=80)return'strong'; if(score>=70)return'good'; if(score>=60)return'materially-improvable'; if(score>=40)return'weak'; return'critical'; }
function present(v){ return v===true?100:v===false?0:null; }
function finiteValue(v){ return v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v)); }
function validReviewCount(v){ const n=Number(v); return v!==null&&v!==undefined&&v!==''&&Number.isSafeInteger(n)&&n>=1&&n<1000000; }
function fieldPresence(v){ if(v===null||v===undefined)return null; if(typeof v==='string')return v.trim()?100:0; return v?100:0; }

function conversionReadiness(evidence,actionAccess,reputationStrength){
  const d=evidence?.conversionDestination||{};
  const destinationQuality=finiteValue(d.qualityScore)?clamp(d.qualityScore):null;
  if(destinationQuality==null)return {status:'insufficient-evidence',score:null,band:'unknown',confidence:'low',destinationQuality:null,actualConversionPerformance:'not-measured',reason:'Google outbound destination quality was not directly probed.'};
  // This is readiness, not observed conversion. Keep the destination as the dominant signal.
  const supporting=[actionAccess,reputationStrength].filter(v=>v!=null);
  const support=supporting.length?Math.round(supporting.reduce((a,b)=>a+b,0)/supporting.length):null;
  const score=Math.round(destinationQuality*.8+(support??destinationQuality)*.2);
  return {status:'scored',score,band:band(score),confidence:'medium',destinationQuality,classification:d.classification||null,ownerControl:d.ownerControl||null,bookingProximity:d.bookingProximity||null,responseCapability:d.responseCapability||null,actualConversionPerformance:'not-measured',reason:'Measures readiness of the Google-to-destination handoff; it does not claim observed inquiry-to-booking conversion.'};
}

function inferClinicIdentity({desktop={},mobile={},options={}}={}){
  const title=desktop.pageMetrics?.page?.title||desktop.pageMetrics?.title||mobile.pageMetrics?.page?.title||mobile.pageMetrics?.title||'';
  const description=desktop.pageMetrics?.page?.description||desktop.pageMetrics?.description||'';
  let clinicName=options.clinicName||'';
  if(!clinicName&&title){ clinicName=title.split(/\s+[|–—-]\s+/)[0].trim().replace(/\b(home|official site|website)\b/ig,'').trim(); }
  return {clinicName:clinicName||null,location:options.clinicLocation||null,sourceTitle:title||null,sourceDescription:description||null};
}

function emptyBranch(identity={}, reviewedUrl=null){
  return {
    branchId:null, branchName:null, status:'awaiting-evidence', reviewedUrl,
    identity:{ clinicName:identity.clinicName||null, location:identity.location||null },
    discovery:{ placeId:null, profileUrl:null, matched:null, matchConfidence:null },
    profile:{ primaryCategory:null,additionalCategories:[],rating:null,reviewCount:null,address:null,phone:null,website:null,appointmentUrl:null,hoursPresent:null,hoursComplete:null,descriptionPresent:null,servicesPresent:null,accessibilityInfoPresent:null },
    reputation:{ latestReviewDate:null,sampledReviewDates:[],ownerResponseCountSample:null,sampledReviewCount:null,recentNegativeThemes:[],recentPositiveThemes:[] },
    media:{ photoCountEstimate:null,recentPhotoEvidence:null,clinicInteriorVisible:null,teamOrDoctorVisible:null,patientRelevantMediaQuality:null },
    consistency:{ websiteMatches:null,phoneMatches:null,addressMatches:null,brandNameMatches:null },
    actions:{ callAvailable:null,directionsAvailable:null,websiteAvailable:null,bookingAvailable:null,messageAvailable:null },
    conversionDestination:null,
    bookingDestination:null,
    provenance:{ source:'manual-or-approved-provider',collectedAt:null,sourceRefs:[],notes:'' }
  };
}

function buildGoogleBusinessTemplate({identity={},channelPlan={},reviewedUrl=null}={}){
  const module=(channelPlan.modules||[]).find(m=>m.id==='google-business-profile');
  return {
    schemaVersion:GBP_SCHEMA_VERSION,
    status:'awaiting-evidence',
    reviewedUrl,
    identity:{clinicName:identity.clinicName||null,location:identity.location||null},
    discovery:{googleMapsUrls:module?.urls||[]},
    branches:[emptyBranch(identity,reviewedUrl)],
    instructions:'Populate only directly observed/provider-supplied facts. Unknown remains null. For multi-location clinics, add one branches[] item per matched Google Business Profile. Never infer rating, reviews, recency, hours, or response behavior from the clinic website.'
  };
}

function scoreBranch(evidence){
  if(!evidence||evidence.status==='awaiting-evidence') return {status:'awaiting-evidence',overall:null,band:'unknown',components:{},confidence:'none'};
  const p=evidence.profile||{},r=evidence.reputation||{},m=evidence.media||{},c=evidence.consistency||{},a=evidence.actions||{};
  const completion=[p.address,p.phone,p.website].map(fieldPresence);
  completion.push(present(p.hoursPresent),present(p.descriptionPresent),present(p.servicesPresent));
  const cv=completion.filter(v=>v!=null); const profileCompleteness=cv.length?Math.round(cv.reduce((s,v)=>s+v,0)/cv.length):null;
  let reputationStrength=null;
  if(finiteValue(p.rating)&&validReviewCount(p.reviewCount)){
    const ratingScore=clamp((Number(p.rating)-3.5)/1.5*100);
    const volumeScore=clamp(Math.log10(Math.max(1,Number(p.reviewCount)))/3*100);
    reputationStrength=Math.round(ratingScore*.62+volumeScore*.38);
  }
  let reviewRecency=null;
  if(r.latestReviewDate){ const d=daysBetween(r.latestReviewDate,new Date().toISOString()); if(d!=null) reviewRecency=d<=14?100:d<=30?92:d<=60?82:d<=120?68:d<=240?50:30; }
  let responseReadiness=null;
  if(finiteValue(r.ownerResponseCountSample)&&finiteValue(r.sampledReviewCount)&&Number(r.sampledReviewCount)>0) responseReadiness=Math.round(clamp(Number(r.ownerResponseCountSample)/Number(r.sampledReviewCount)*100));
  const av=[a.callAvailable,a.directionsAvailable,a.websiteAvailable,a.bookingAvailable,a.messageAvailable].map(present).filter(v=>v!=null); const actionAccess=av.length?Math.round(av.reduce((s,v)=>s+v,0)/av.length):null;
  const cons=[c.websiteMatches,c.phoneMatches,c.addressMatches,c.brandNameMatches].map(present).filter(v=>v!=null); const consistency=cons.length?Math.round(cons.reduce((s,v)=>s+v,0)/cons.length):null;
  const mv=[m.recentPhotoEvidence,m.clinicInteriorVisible,m.teamOrDoctorVisible].map(present).filter(v=>v!=null); if(finiteValue(m.patientRelevantMediaQuality))mv.push(clamp(m.patientRelevantMediaQuality)); const visualTrust=mv.length?Math.round(mv.reduce((s,v)=>s+v,0)/mv.length):null;
  const components={profileCompleteness,reputationStrength,reviewRecency,responseReadiness,actionAccess,consistency,visualTrust};
  const weights={profileCompleteness:.16,reputationStrength:.24,reviewRecency:.16,responseReadiness:.12,actionAccess:.14,consistency:.10,visualTrust:.08};
  let weighted=0,total=0; for(const[k,w]of Object.entries(weights)){if(components[k]!=null){weighted+=components[k]*w;total+=w;}}
  const provisionalOverall=total?Math.round(weighted/total):null; const known=Object.values(components).filter(v=>v!=null).length;
  const identityConfirmed=evidence.discovery?.matched===true && ['medium','high'].includes(evidence.discovery?.matchConfidence);
  const minimumCoverageMet=known>=4;
  const coverageCeiling=known>=7?100:known===6?98:known===5?94:known===4?88:null;
  const overall=identityConfirmed&&minimumCoverageMet&&provisionalOverall!=null?Math.min(provisionalOverall,coverageCeiling):null;
  let reason=null;
  if(!identityConfirmed) reason='Profile identity is not confirmed strongly enough to publish a Google Business score.';
  else if(!minimumCoverageMet) reason='Fewer than 4 of 7 Google Business scoring components are evidenced.';
  const evidenceIntegrity={
    reviewCountValid:p.reviewCount==null?null:validReviewCount(p.reviewCount),
    reviewCountObserved:p.reviewCount??null,
    ratingValid:p.rating==null?null:(finiteValue(p.rating)&&Number(p.rating)>=1&&Number(p.rating)<=5)
  };
  if(evidenceIntegrity.reviewCountValid===false && overall!=null){
    // Defensive publication backstop: an impossible review count must never be the
    // component that pushes a branch over the minimum evidence threshold.
    return {status:'insufficient-evidence',overall:null,provisionalOverall,band:'unknown',components:{...components,reputationStrength:null},weights,confidence:'low',evidenceCoverage:{knownComponents:Math.max(0,known-1),totalComponents:7,minimumRequired:4,minimumCoverageMet:false,coverageCeiling:null},identityValidation:{matched:evidence.discovery?.matched??null,matchConfidence:evidence.discovery?.matchConfidence??null,matchBasis:evidence.discovery?.matchBasis||[],confirmed:identityConfirmed},evidenceIntegrity,reason:'Google review count failed type/integrity validation; public score withheld.'};
  }
  const patientConversionReadiness=conversionReadiness(evidence,actionAccess,reputationStrength); const profileStrength={status:overall==null?'insufficient-evidence':'scored',score:overall,provisionalScore:provisionalOverall,band:band(overall),confidence:overall==null?'low':known>=6?'high':'medium',scopeLabel:'Google Business Profile Strength'}; return {status:overall==null?'insufficient-evidence':'scored',overall,provisionalOverall,band:band(overall),scoreScope:'profile-strength',scoreScopeLabel:'Google Business Profile Strength',profileStrength,patientConversionReadiness,components,weights,confidence:overall==null?'low':known>=6?'high':'medium',evidenceCoverage:{knownComponents:known,totalComponents:7,minimumRequired:4,minimumCoverageMet,coverageCeiling},identityValidation:{matched:evidence.discovery?.matched??null,matchConfidence:evidence.discovery?.matchConfidence??null,matchBasis:evidence.discovery?.matchBasis||[],confirmed:identityConfirmed},evidenceIntegrity,reason};
}

function normalizeEvidence(evidence){
  if(!evidence)return null;
  if(Array.isArray(evidence.branches))return evidence;
  // Backward compatibility with v1.9 single-profile evidence.
  return {schemaVersion:evidence.schemaVersion||'1.x',status:evidence.status,identity:evidence.identity||{},branches:[{...evidence,branchName:evidence.identity?.branchName||evidence.branchName||null}]};
}

function scoreGoogleBusiness(evidence){
  const normalized=normalizeEvidence(evidence);
  if(!normalized||normalized.status==='awaiting-evidence')return {status:'awaiting-evidence',overall:null,band:'unknown',components:{},confidence:'none',branches:[]};
  const branches=(normalized.branches||[]).map((branch,index)=>({branchId:branch.branchId||`branch-${index+1}`,branchName:branch.branchName||branch.identity?.location||null,placeId:branch.discovery?.placeId||null,...scoreBranch(branch)}));
  const scored=branches.filter(b=>b.overall!=null);
  if(!scored.length)return {status:'insufficient-evidence',overall:null,band:'unknown',components:{},confidence:'none',branches};
  const weighted=scored.map((b,i)=>{ const src=normalized.branches[i]||{}; const reviews=src.profile?.reviewCount; return {score:b.overall,w:validReviewCount(reviews)?Math.max(1,Math.log10(Number(reviews)+10)):1}; });
  const overall=Math.round(weighted.reduce((s,x)=>s+x.score*x.w,0)/weighted.reduce((s,x)=>s+x.w,0));
  const branchSpread=scored.length>1?Math.max(...scored.map(b=>b.overall))-Math.min(...scored.map(b=>b.overall)):0;
  const readinessRows=branches.map(b=>b.patientConversionReadiness).filter(x=>x?.score!=null); const patientConversionReadiness=readinessRows.length?{status:'scored',score:Math.round(readinessRows.reduce((s,x)=>s+x.score,0)/readinessRows.length),band:band(Math.round(readinessRows.reduce((s,x)=>s+x.score,0)/readinessRows.length)),confidence:'medium',actualConversionPerformance:'not-measured',scopeLabel:'Google Patient Handoff Readiness'}:{status:'insufficient-evidence',score:null,band:'unknown',confidence:'low',actualConversionPerformance:'not-measured',scopeLabel:'Google Patient Handoff Readiness'}; return {status:'scored',overall,band:band(overall),scoreScope:'profile-strength',scoreScopeLabel:'Google Business Profile Strength',profileStrength:{status:'scored',score:overall,band:band(overall),confidence:scored.every(b=>b.confidence==='high')?'high':scored.length>=2?'medium':scored[0].confidence},patientConversionReadiness,confidence:scored.every(b=>b.confidence==='high')?'high':scored.length>=2?'medium':scored[0].confidence,branchCount:branches.length,scoredBranchCount:scored.length,branchSpread,branches,interpretation:branchSpread>=15?'Material branch-to-branch profile variation detected; prioritize the weaker locations.':`Google profile strength is ${overall}/100; patient handoff readiness is ${patientConversionReadiness.score??'not scored'}/100 and actual inquiry-to-booking conversion is not measured.`};
}

function loadGoogleBusinessEvidence(filePath){ if(!filePath||!fs.existsSync(filePath))return null; return JSON.parse(fs.readFileSync(filePath,'utf8')); }
function buildUnifiedEvidenceSummary({scoring,visualReconciliation,googleBusinessAssessment,facebookAssessment,channelPlan}={}){ return {website:{deterministicOverall:scoring?.overall??null,digitalExperience:scoring?.pillars?.digitalExperience?.overall??null,patientConversionReadiness:scoring?.pillars?.patientConversionReadiness?.overall??null},visual:{status:visualReconciliation?.status||'not-run',reconciledOverall:visualReconciliation?.reconciledOverall??null,confidence:visualReconciliation?.confidence||null},googleBusiness:googleBusinessAssessment||{status:'not-run',overall:null},facebook:facebookAssessment||{status:'not-run',overall:null},channels:{recommendedNextModules:channelPlan?.recommendedNextModules||[]},policy:'Channel scores remain separate from the website overall until cross-channel calibration is validated.'}; }
function writeGoogleBusinessFiles(outDir,template,evidence,assessment,unified){ const templatePath=path.join(outDir,'google-business-evidence-template.json'); if(!fs.existsSync(templatePath))writeJson(templatePath,template); if(evidence)writeJson(path.join(outDir,'google-business-evidence.json'),evidence); writeJson(path.join(outDir,'google-business-assessment.json'),assessment); writeJson(path.join(outDir,'unified-evidence-summary.json'),unified); }
module.exports={inferClinicIdentity,buildGoogleBusinessTemplate,scoreGoogleBusiness,scoreBranch,validReviewCount,loadGoogleBusinessEvidence,buildUnifiedEvidenceSummary,writeGoogleBusinessFiles};
