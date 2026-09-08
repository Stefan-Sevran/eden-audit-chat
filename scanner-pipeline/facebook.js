const fs = require('fs');
const path = require('path');
const { writeJson } = require('./utils');
const { classifyFacebookContentOwnership } = require('./facebook-content-quality');

const FACEBOOK_SCHEMA_VERSION = '2.1.22';
function clamp(n,min=0,max=100){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null;}
function band(s){if(s==null)return'unknown';if(s>=90)return'excellent';if(s>=80)return'strong';if(s>=70)return'good';if(s>=60)return'materially-improvable';if(s>=40)return'weak';return'critical';}
function finite(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function present(v){return v===true?100:v===false?0:null;}
function minutesBetween(a,b){const x=new Date(a),y=new Date(b);if(!Number.isFinite(+x)||!Number.isFinite(+y)||y<x)return null;return Math.round((y-x)/60000);}

function buildFacebookTemplate({identity={},channelPlan={},reviewedUrl=null}={}){
  const module=(channelPlan.modules||[]).find(m=>m.id==='facebook-page');
  const detected=(module?.urls||[])[0]||null;
  return {
    schemaVersion:FACEBOOK_SCHEMA_VERSION,status:'awaiting-evidence',reviewedUrl:reviewedUrl||detected,
    identity:{clinicName:identity.clinicName||null,location:identity.location||null,branchName:null},
    sourceLinks:{websiteFacebookUrls:module?.urls||[],googleBusinessFacebookUrl:null,expectedFacebookUrl:reviewedUrl||detected},
    destination:{testedUrl:null,finalUrl:null,httpReachable:null,landsOnClinicPage:null,landsOnExpectedBranch:null,genericFacebookDestination:null,wrongPage:null,loginWallObserved:null,redirectChain:[],notes:''},
    page:{pageName:null,handle:null,category:null,address:null,phone:null,websiteUrl:null,lastActivityDate:null,followerCount:null,recommendationPercent:null,recommendationReviewCount:null},
    actions:{bookButtonPresent:null,bookButtonLabel:null,bookButtonTarget:null,bookButtonWorks:null,bookButtonFinalUrl:null,messageButtonPresent:null,whatsappButtonPresent:null,callButtonPresent:null,externalBookingPresent:null,bookingRequiresLogin:null},
    consistency:{brandNameMatches:null,branchMatches:null,phoneMatchesWebsite:null,addressMatchesWebsite:null,hoursMatchWebsite:null,hoursMatchGoogleBusiness:null,websiteLinkQuality:null,bookingLinkQuality:null},
    demand:{sampleWindowStart:null,sampleWindowEnd:null,patientIntentCommentCount:null,bookingIntentCommentCount:null,pricingIntentCommentCount:null,availabilityIntentCommentCount:null,urgentIntentCommentCount:null,comments:[]},
    response:{clinicRepliesObserved:null,answeredIntentCount:null,unansweredIntentCount:null,medianResponseMinutes:null,p75ResponseMinutes:null,answeredWithin5MinPercent:null,answeredWithin60MinPercent:null,unansweredAfter24hPercent:null},
    revenueModel:{currency:'PHP',monthlyObservedHighIntentLeads:null,unansweredOrDelayedHighIntentLeads:null,contactToBookingRateLow:0.25,contactToBookingRateHigh:0.45,attendanceRate:0.80,treatmentAcceptanceRate:0.65,averageTreatmentValueLow:null,averageTreatmentValueHigh:null,delayThresholdMinutes:60,notes:'Revenue opportunity is an estimate, not observed lost revenue. Replace assumptions with clinic-specific values when available.'},
    provenance:{source:'manual-or-approved-provider',collectedAt:null,sourceRefs:[],notes:''},
    instructions:'Populate only directly observed/provider-supplied facts. Unknown remains null. Comments should include patientIntent, createdAt, clinicReplyAt, bookingIntent/pricingIntent/availabilityIntent/urgentIntent when observable. Do not infer zero from login walls or hidden comments.'
  };
}

function normalizeComments(evidence){
  const comments=Array.isArray(evidence?.demand?.comments)?evidence.demand.comments:[];
  return comments.map(c=>{const mins=c?.clinicReplyAt?minutesBetween(c.createdAt,c.clinicReplyAt):null;return {...c,responseMinutes:mins};});
}
function percentile(vals,p){if(!vals.length)return null;const a=[...vals].sort((x,y)=>x-y);const i=Math.ceil(p*a.length)-1;return a[Math.max(0,Math.min(a.length-1,i))];}
function median(vals){if(!vals.length)return null;const a=[...vals].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2);}
function ageHoursFromLabel(label){
  const s=String(label||'').trim().toLowerCase();
  let m=s.match(/^(\d+)\s*(m|min)$/);if(m)return Number(m[1])/60;
  m=s.match(/^(\d+)\s*(h|hr)$/);if(m)return Number(m[1]);
  m=s.match(/^(\d+)\s*d$/);if(m)return Number(m[1])*24;
  m=s.match(/^(\d+)\s*w$/);if(m)return Number(m[1])*24*7;
  if(s==='yesterday')return 24; if(s==='today'||s==='just now')return 0;
  return null;
}
function hasReplyEvidence(c){return !!(c?.clinicReplyObserved||c?.clinicReplyAt||c?.clinicReplyAuthor||c?.clinicReplyText||c?.clinicReplyTimestampLabel);}

function scoreFacebook(evidence){
  if(!evidence||evidence.status==='awaiting-evidence')return {status:'awaiting-evidence',overall:null,band:'unknown',components:{},confidence:'none',responseMetrics:{},revenueOpportunity:null};
  // V2.2.31: a technical probe failure is unknown evidence, never observed failure.
  if(evidence.status==='probe-failed')return {
    status:'insufficient-evidence',overall:null,provisionalOverall:null,band:'unknown',
    components:{destinationIntegrity:null,bookingButtonIntegrity:null,actionAccess:null,crossChannelConsistency:null,responsePerformance:null},
    confidence:'none',scoreScope:'surface-access-and-consistency',scoreScopeLabel:'Facebook Surface Access',
    evidenceCoverage:{knownComponents:0,totalComponents:5,coverageCeiling:null},
    responseMetrics:{},sampleStability:{scope:'sampled-public-content',evidenceVariability:'unknown',responseCoverageInterpretation:'unknown',caveat:'Facebook probe failed technically; no negative patient-journey conclusion is inferred.'},
    contentOwnership:classifyFacebookContentOwnership(evidence),engagementQuality:classifyFacebookContentOwnership(evidence).engagementQuality,
    patientConversionPath:{entryActions:{message:null,call:null,book:null},responseMeasurement:'not-measured',bookingMeasurement:'instrumentation-required',status:'entry-point-evidence-unknown',policy:'Technical probe failure is unknown evidence; it is never converted to a negative finding.'},
    demandLeakage:{observedHighIntentLeads:null,unansweredOrDelayedHighIntentLeads:null},revenueOpportunity:null,
    policy:'Technical Facebook probe failure is treated as unknown evidence, not zero performance.'
  };
  const d=evidence.destination||{},a=evidence.actions||{},c=evidence.consistency||{};
  const destinationSignals=[present(d.httpReachable),present(d.landsOnClinicPage),d.genericFacebookDestination===true?0:d.genericFacebookDestination===false?100:null,d.wrongPage===true?0:d.wrongPage===false?100:null].filter(v=>v!=null);
  const destinationIntegrity=destinationSignals.length?Math.round(destinationSignals.reduce((s,v)=>s+v,0)/destinationSignals.length):null;
  // Patient-action availability is not a checklist where every absent optional
  // channel is a failure. A clearly visible Message path is already a legitimate
  // conversion route. Score observed usable actions positively; reserve penalties
  // for actions that are actually present but broken or login-gated.
  const positiveActionSignals=[a.bookButtonPresent,a.messageButtonPresent,a.whatsappButtonPresent,a.callButtonPresent].filter(v=>v===true);
  let bookingButtonIntegrity=null;
  if(a.bookButtonPresent===true){const sig=[present(a.bookButtonWorks),a.bookingRequiresLogin===true?35:a.bookingRequiresLogin===false?100:null].filter(v=>v!=null);bookingButtonIntegrity=sig.length?Math.round(sig.reduce((s,v)=>s+v,0)/sig.length):65;}
  const actionAccess=positiveActionSignals.length?100:null;
  const consSignals=[c.brandNameMatches,c.branchMatches,c.phoneMatchesWebsite,c.addressMatchesWebsite,c.hoursMatchWebsite,c.hoursMatchGoogleBusiness].map(present).filter(v=>v!=null);
  if(finite(c.websiteLinkQuality))consSignals.push(clamp(c.websiteLinkQuality));if(finite(c.bookingLinkQuality))consSignals.push(clamp(c.bookingLinkQuality));
  const crossChannelConsistency=consSignals.length?Math.round(consSignals.reduce((s,v)=>s+v,0)/consSignals.length):null;

  const comments=normalizeComments(evidence).filter(c=>c.patientIntent!==false);
  const highIntentComments=comments.filter(c=>c.bookingIntent||c.pricingIntent||c.availabilityIntent||c.urgentIntent||c.treatmentIntent||c.locationIntent);
  const generalInterestOnlyComments=comments.filter(c=>c.generalInterestIntent&&!highIntentComments.includes(c));
  const responseMins=highIntentComments.map(c=>c.responseMinutes).filter(finite).map(Number);
  const now=evidence.provenance?.collectedAt?new Date(evidence.provenance.collectedAt):new Date();
  const answered=comments.filter(hasReplyEvidence).length;
  const unanswered=comments.filter(c=>!hasReplyEvidence(c)).length;
  const highIntentAnswered=highIntentComments.filter(hasReplyEvidence).length;
  const highIntentUnanswered=highIntentComments.filter(c=>!hasReplyEvidence(c)).length;
  const generalInterestAnswered=generalInterestOnlyComments.filter(hasReplyEvidence).length;
  const generalInterestUnanswered=generalInterestOnlyComments.filter(c=>!hasReplyEvidence(c)).length;
  const unanswered24=highIntentComments.filter(c=>{if(hasReplyEvidence(c))return false;if(c.createdAt)return ((now-new Date(c.createdAt))/3600000)>=24;const h=ageHoursFromLabel(c.timestampLabel);return finite(h)&&Number(h)>=24;}).length;
  const derived={
    observedIntentComments:comments.length||null,answeredIntentCount:comments.length?answered:null,unansweredIntentCount:comments.length?unanswered:null,
    responseCoveragePercent:comments.length?Math.round(answered/comments.length*100):null,
    scoringPopulation:'high-intent',
    scoringObservedIntentComments:highIntentComments.length||null,
    scoringAnsweredIntentCount:highIntentComments.length?highIntentAnswered:null,
    scoringUnansweredIntentCount:highIntentComments.length?highIntentUnanswered:null,
    scoringResponseCoveragePercent:highIntentComments.length?Math.round(highIntentAnswered/highIntentComments.length*100):null,
    generalInterestObservedCount:generalInterestOnlyComments.length||null,
    generalInterestAnsweredCount:generalInterestOnlyComments.length?generalInterestAnswered:null,
    generalInterestUnansweredCount:generalInterestOnlyComments.length?generalInterestUnanswered:null,
    generalInterestResponseCoveragePercent:generalInterestOnlyComments.length?Math.round(generalInterestAnswered/generalInterestOnlyComments.length*100):null,
    medianResponseMinutes:median(responseMins),p75ResponseMinutes:percentile(responseMins,.75),
    answeredWithin5MinPercent:responseMins.length?Math.round(responseMins.filter(v=>v<=5).length/responseMins.length*100):null,
    answeredWithin60MinPercent:responseMins.length?Math.round(responseMins.filter(v=>v<=60).length/responseMins.length*100):null,
    unansweredAfter24hPercent:highIntentComments.length?Math.round(unanswered24/highIntentComments.length*100):null
  };
  const supplied=evidence.response||{}; const metrics={...derived}; for(const k of Object.keys(metrics)){if(finite(supplied[k]))metrics[k]=Number(supplied[k]);}
  const contentOwnership=classifyFacebookContentOwnership(evidence);
  const postDiscovery=evidence?.probe?.probeDiagnostics?.commentPostDiscovery||{};
  const accumulation=postDiscovery?.evidenceAccumulation||{};
  const postsFound=finite(postDiscovery.postsFound)?Number(postDiscovery.postsFound):null;
  const postsInspected=finite(postDiscovery.postsInspected)?Number(postDiscovery.postsInspected):null;
  const variablePosts=finite(accumulation.variablePosts)?Number(accumulation.variablePosts):null;
  const variableShare=finite(variablePosts)&&finite(postsInspected)&&postsInspected>0?Math.round(variablePosts/postsInspected*100):null;
  const evidenceVariability=variableShare==null?'unknown':variableShare>=50?'high':variableShare>0?'present':'low';
  const sampleStability={
    scope:'sampled-public-content',
    postsFound,postsInspected,allDiscoveredPostsInspected:finite(postsFound)&&finite(postsInspected)?postsInspected>=postsFound:null,
    allPageHistoryScraped:false,
    renderAttempts:finite(accumulation.renderAttempts)?Number(accumulation.renderAttempts):null,
    statesRetained:finite(accumulation.statesRetained)?Number(accumulation.statesRetained):null,
    variablePosts,variablePostSharePercent:variableShare,evidenceVariability,
    responseCoverageInterpretation:metrics.responseCoveragePercent==null?'unknown':`${metrics.answeredIntentCount} of ${metrics.observedIntentComments} currently observed probable patient leads showed explicit clinic-response evidence (${metrics.responseCoveragePercent}% overall); ${metrics.scoringAnsweredIntentCount} of ${metrics.scoringObservedIntentComments} explicit/high-intent inquiries were answered (${metrics.scoringResponseCoveragePercent}%).`,
    caveat:evidenceVariability==='high'?'Facebook exposed materially variable evidence across sampled posts. Treat response coverage as a current sampled observation, not a permanent account-wide rate.':'Response coverage is based on sampled public content and should not be interpreted as exhaustive page history.'
  };
  const delayThresholdMinutes=finite(evidence.revenueModel?.delayThresholdMinutes)?Number(evidence.revenueModel.delayThresholdMinutes):60;
  const unansweredHighIntent=highIntentComments.filter(c=>!hasReplyEvidence(c));
  const delayedAnsweredHighIntent=highIntentComments.filter(c=>hasReplyEvidence(c)&&finite(c.responseMinutes)&&Number(c.responseMinutes)>delayThresholdMinutes);
  const answeredTimingUnknownHighIntent=highIntentComments.filter(c=>hasReplyEvidence(c)&&!finite(c.responseMinutes));
  const unansweredOrDelayedCount=unansweredHighIntent.length+delayedAnsweredHighIntent.length;
  const demandLeakage={observedHighIntentLeads:highIntentComments.length||null,unansweredOrDelayedHighIntentLeads:highIntentComments.length?unansweredOrDelayedCount:null,unansweredHighIntentLeads:highIntentComments.length?unansweredHighIntent.length:null,delayedAnsweredHighIntentLeads:highIntentComments.length?delayedAnsweredHighIntent.length:null,answeredTimingUnknownHighIntentLeads:highIntentComments.length?answeredTimingUnknownHighIntent.length:null,generalInterestLeadsObserved:generalInterestOnlyComments.length||null,generalInterestLeadsUnanswered:generalInterestOnlyComments.length?generalInterestUnanswered:null,delayThresholdMinutes,basis:'High-intent leakage uses explicit pricing/treatment/location/booking/availability/urgent inquiries. General-interest leads are tracked separately. Answered comments with unknown response timing remain timing-unknown and are not classified as delayed; hidden/login-limited demand is not inferred as zero.'};
  let responsePerformance=null;
  if(finite(metrics.scoringResponseCoveragePercent)){
    const cov=clamp(metrics.scoringResponseCoveragePercent), speed=finite(metrics.medianResponseMinutes)?(metrics.medianResponseMinutes<=5?100:metrics.medianResponseMinutes<=30?90:metrics.medianResponseMinutes<=60?80:metrics.medianResponseMinutes<=240?62:metrics.medianResponseMinutes<=1440?42:20):null;
    const late=finite(metrics.unansweredAfter24hPercent)?clamp(100-Number(metrics.unansweredAfter24hPercent)):null;
    const vals=[[cov,.50],[speed,.30],[late,.20]].filter(([v])=>v!=null);responsePerformance=Math.round(vals.reduce((s,[v,w])=>s+v*w,0)/vals.reduce((s,[,w])=>s+w,0));
  }
  // Calibration: unknown evidence is never scored as zero, but narrow evidence should not
  // masquerade as a universally proven 100. Apply explicit breadth ceilings only to
  // components whose raw score can be based on a small subset of possible signals.
  const actionEvidenceCount=[a.bookButtonPresent,a.messageButtonPresent,a.whatsappButtonPresent,a.callButtonPresent].filter(v=>v===true).length;
  const consistencyEvidenceCount=[c.brandNameMatches,c.branchMatches,c.phoneMatchesWebsite,c.addressMatchesWebsite,c.hoursMatchWebsite,c.hoursMatchGoogleBusiness,c.websiteLinkQuality,c.bookingLinkQuality].filter(v=>v!==null&&v!==undefined&&v!=='').length;
  const actionAccessCeiling=actionEvidenceCount>=3?100:actionEvidenceCount===2?90:actionEvidenceCount===1?82:null;
  const consistencyCeiling=consistencyEvidenceCount>=5?100:consistencyEvidenceCount>=3?95:consistencyEvidenceCount>=1?90:null;
  const calibratedActionAccess=actionAccess==null||actionAccessCeiling==null?actionAccess:Math.min(actionAccess,actionAccessCeiling);
  const calibratedCrossChannelConsistency=crossChannelConsistency==null||consistencyCeiling==null?crossChannelConsistency:Math.min(crossChannelConsistency,consistencyCeiling);
  const components={destinationIntegrity,bookingButtonIntegrity,actionAccess:calibratedActionAccess,crossChannelConsistency:calibratedCrossChannelConsistency,responsePerformance};
  const componentCalibration={actionAccess:{raw:actionAccess,evidenceCount:actionEvidenceCount,ceiling:actionAccessCeiling},crossChannelConsistency:{raw:crossChannelConsistency,evidenceCount:consistencyEvidenceCount,ceiling:consistencyCeiling}};
  const weights={destinationIntegrity:.24,bookingButtonIntegrity:.22,actionAccess:.14,crossChannelConsistency:.16,responsePerformance:.24};
  let sw=0,wt=0;for(const[k,w]of Object.entries(weights)){if(components[k]!=null){sw+=components[k]*w;wt+=w;}}const overall=wt?Math.round(sw/wt):null;
  const known=Object.values(components).filter(v=>v!=null).length;
  const provisionalOverall=overall;
  const coverageCeiling=known>=5?100:known===4?94:known===3?84:null;
  const publishOverall=known>=3 ? Math.min(overall,coverageCeiling) : null;
  const r=evidence.revenueModel||{};let revenueOpportunity=null;
  const revenueLeadCount=finite(r.unansweredOrDelayedHighIntentLeads)?Number(r.unansweredOrDelayedHighIntentLeads):(finite(demandLeakage.unansweredOrDelayedHighIntentLeads)?Number(demandLeakage.unansweredOrDelayedHighIntentLeads):null);
  if(finite(revenueLeadCount)&&finite(r.averageTreatmentValueLow)&&finite(r.averageTreatmentValueHigh)){
    const leads=Number(revenueLeadCount),att=finite(r.attendanceRate)?Number(r.attendanceRate):.8,accept=finite(r.treatmentAcceptanceRate)?Number(r.treatmentAcceptanceRate):.65;
    const low=leads*Number(r.contactToBookingRateLow||.25)*att*accept*Number(r.averageTreatmentValueLow);
    const high=leads*Number(r.contactToBookingRateHigh||.45)*att*accept*Number(r.averageTreatmentValueHigh);
    revenueOpportunity={currency:r.currency||'PHP',estimatedLow:Math.round(low),estimatedHigh:Math.round(high),basis:{unansweredOrDelayedHighIntentLeads:leads,contactToBookingRateLow:Number(r.contactToBookingRateLow||.25),contactToBookingRateHigh:Number(r.contactToBookingRateHigh||.45),attendanceRate:att,treatmentAcceptanceRate:accept,averageTreatmentValueLow:Number(r.averageTreatmentValueLow),averageTreatmentValueHigh:Number(r.averageTreatmentValueHigh)},confidence:'assumption-based'};
  }
  const scoreScope=responsePerformance==null ? 'surface-access-and-consistency' : 'surface-plus-sampled-response';
  const scoreScopeLabel=responsePerformance==null ? 'Facebook Surface Access' : 'Facebook Patient Demand';
  const actionState=(v)=>v===true?true:v===false?false:null;
  const entryActions={message:actionState(a.messageButtonPresent),call:actionState(a.callButtonPresent),book:actionState(a.bookButtonPresent)};
  const observedEntry=entryActions.message===true||entryActions.call===true||entryActions.book===true;
  const anyActionEvidence=Object.values(entryActions).some(v=>v!==null);
  const patientConversionPath={entryActions,responseMeasurement:responsePerformance==null?'not-measured':'sampled',bookingMeasurement:'instrumentation-required',status:observedEntry?(responsePerformance==null?'entry-points-observed-response-unmeasured':'response-evidence-observed'):anyActionEvidence?'entry-points-not-observed-in-current-evidence':'entry-point-evidence-unknown',policy:'Not-observed or obscured Facebook controls remain unknown unless a positive or negative state was directly evidenced; unknown is never converted to false.'};
  return {status:publishOverall==null?'insufficient-evidence':'scored',overall:publishOverall,provisionalOverall:publishOverall==null?provisionalOverall:null,band:band(publishOverall),components,componentCalibration,weights,confidence:known>=5?'high':known>=3?'medium':'low',scoreScope,scoreScopeLabel,evidenceCoverage:{knownComponents:known,totalComponents:5,coverageCeiling},responseMetrics:metrics,sampleStability,contentOwnership,engagementQuality:contentOwnership.engagementQuality,patientConversionPath,demandLeakage,revenueOpportunity,policy:'A Facebook overall is published only when at least 3 of 5 components are evidenced. When response performance is unknown, the score is explicitly scoped to surface access and cross-channel consistency rather than presented as a full Facebook demand-performance score. Coverage ceilings protect score meaning: 3/5 known caps at 84, 4/5 at 94, 5/5 can reach 100. Optional Call/Book/WhatsApp absence is not itself treated as conversion failure when a usable patient action such as Message is observed; broken or login-gated observed actions may still be penalized. Public-probe actions marked not-observed remain unknown, not zero. Narrow action-access and cross-channel evidence may be ceiling-calibrated rather than treated as universally proven 100. Facebook response coverage is explicitly a sampled public-content observation unless exhaustive history has been proven. Response scoring uses explicit/high-intent inquiries; softer general-interest leads remain visible as a separate opportunity layer.'};
}

function applyFacebookVisualSurfaceEvidence(evidence, aiResult){
  const surface=aiResult?.facebookSurfaceEvidence;
  if(!surface||aiResult?.status!=='completed') return {evidence, applied:false, fieldsApplied:[]};
  const confidence=surface.confidence;
  if(!['high','medium'].includes(confidence)) return {evidence, applied:false, fieldsApplied:[]};
  const out=JSON.parse(JSON.stringify(evidence||{})); out.page=out.page||{}; out.actions=out.actions||{}; out.provenance=out.provenance||{};
  const fields=[];
  const fill=(key,val)=>{ if((out.page[key]===null||out.page[key]===undefined||out.page[key]==='') && val!==null&&val!==undefined&&val!==''){out.page[key]=val;fields.push(`page.${key}`);} };
  const suspiciousActivity=(v)=>/^20\d{2}$/.test(String(v||'').trim());
  fill('pageName',surface.pageName); fill('followerCount',surface.followerCount); fill('recommendationPercent',surface.recommendationPercent); fill('recommendationReviewCount',surface.recommendationReviewCount); fill('phone',surface.phone); fill('address',surface.address);
  if(surface.latestVisibleActivityLabel!==null&&surface.latestVisibleActivityLabel!==undefined&&surface.latestVisibleActivityLabel!=='' && ((out.page.lastActivityDate===null||out.page.lastActivityDate===undefined||out.page.lastActivityDate==='') || suspiciousActivity(out.page.lastActivityDate))){out.page.lastActivityDate=surface.latestVisibleActivityLabel;fields.push('page.lastActivityDate');}
  const fillAction=(key,val)=>{if((out.actions[key]===null||out.actions[key]===undefined)&&typeof val==='boolean'){out.actions[key]=val;fields.push(`actions.${key}`);}};
  fillAction('messageButtonPresent',surface.messageActionVisible); fillAction('callButtonPresent',surface.callActionVisible); fillAction('bookButtonPresent',surface.bookingActionVisible);
  out.visualSurfaceEvidence={...surface,source:'openai-vision-authenticated-screenshot-reconciliation',appliedFields:fields};
  out.provenance.visualSurface={source:'openai-vision',observationMode:surface.observationMode,confidence:surface.confidence,evidenceScreenshots:surface.evidenceScreenshots||[]};
  return {evidence:out,applied:fields.length>0,fieldsApplied:fields};
}

function loadFacebookEvidence(filePath){if(!filePath||!fs.existsSync(filePath))return null;return JSON.parse(fs.readFileSync(filePath,'utf8'));}
function writeFacebookFiles(outDir,template,evidence,assessment){const t=path.join(outDir,'facebook-evidence-template.json');if(!fs.existsSync(t))writeJson(t,template);if(evidence)writeJson(path.join(outDir,'facebook-evidence.json'),evidence);writeJson(path.join(outDir,'facebook-assessment.json'),assessment);writeJson(path.join(outDir,'facebook-response-evidence.json'),{status:evidence?.probe?.probeDiagnostics?.commentExtractionStatus||'awaiting-evidence',demand:evidence?.demand||{},responseMetrics:assessment?.responseMetrics||{},sampleStability:assessment?.sampleStability||null,demandLeakage:assessment?.demandLeakage||null,provenance:evidence?.provenance||{}});writeJson(path.join(outDir,'facebook-revenue-opportunity.json'),assessment.revenueOpportunity||{status:'awaiting-treatment-value-assumptions',demandLeakage:assessment?.demandLeakage||null});}
function buildCrossChannelIntegrity({facebookAssessment,facebookEvidence,googleBusinessAssessment}={}){const d=facebookEvidence?.destination||{};return {facebookDestinationIntegrity:facebookAssessment?.components?.destinationIntegrity??null,facebookBookingButtonIntegrity:facebookAssessment?.components?.bookingButtonIntegrity??null,genericFacebookDestination:d.genericFacebookDestination??null,wrongFacebookPage:d.wrongPage??null,googleBusinessBranchCount:googleBusinessAssessment?.branchCount??null,priorityFinding:d.genericFacebookDestination===true||d.wrongPage===true?'Facebook destination integrity failure detected; verify/fix high-traffic source links immediately.':null};}
module.exports={buildFacebookTemplate,scoreFacebook,loadFacebookEvidence,writeFacebookFiles,buildCrossChannelIntegrity,applyFacebookVisualSurfaceEvidence};
