const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {runFacebookVisualExtraction}=require('./facebook-visual-extraction');
const {buildCrossChannelGrowthModel}=require('./cross-channel-action-engine');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v2219-'));
  const shots={};
  for(const kind of ['header','about','reviews','posts']){const p=path.join(dir,`${kind}.png`);fs.writeFileSync(p,Buffer.from('89504e470d0a1a0a','hex'));shots[kind]=p;}
  const manifest={facebookProbe:{authentication:{used:true,status:'authenticated-session'},screenshots:{targeted:shots},targetUrl:'https://facebook.com/TestClinic',page:{pageName:'Test Clinic'}}};
  const fake={
    observationMode:'authenticated',displayState:'clinic_surface',pageName:'Test Clinic',followerCount:4300,recommendationPercent:98,recommendationReviewCount:297,phone:'086 334 2004',address:'Pattaya',messageActionVisible:true,callActionVisible:null,bookingActionVisible:null,latestVisibleActivityLabel:'Aug 28',recentVisiblePostLabels:['Aug 28','Aug 25'],visiblePostCount:2,engagementSamples:[{label:'Aug 28',reactionCount:1,commentCount:0,shareCount:null}],contentPresentation:{assessment:'mixed',rationale:'Promotional visual contains dense text.'},confidence:'high',evidenceScreenshots:['facebook-authenticated-header','facebook-authenticated-reviews','facebook-authenticated-posts'],notes:[]
  };
  const fetchImpl=async()=>({ok:true,json:async()=>({id:'resp_test',model:'test-model',output_text:JSON.stringify(fake),usage:{}})});
  const r=await runFacebookVisualExtraction(manifest,{apiKey:'test',model:'test-model',fetchImpl});
  assert.equal(r.status,'completed'); assert.equal(r.evidence.followerCount,4300); assert(r.parsedFields.includes('recommendationReviewCount'));

  const growth=buildCrossChannelGrowthModel({
    bookingFlow:{},googleBusiness:{evidence:{branches:[]}},aiAuditIntelligence:{facebookVisualAssessments:{handoffQuality:{assessment:'weak',confidence:'high',rationale:'Unavailable'},receptionistOpportunity:{opportunity:'high',confidence:'medium',rationale:'Potential'}},conflicts:[{claimId:'facebook-destination-clinic-page',severity:'high',humanReviewRequired:true,scannerPosition:'page',visualPosition:'unavailable'}]},facebook:{assessment:{responseMetrics:{}}}
  },{});
  assert(!growth.actions.actions.some(x=>x.pillar==='facebook'));
  assert(growth.actions.conditionalActions.some(x=>x.id==='facebook-publication-withheld'));
  console.log('V2.2.19 Facebook visual extraction bridge regression: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
