const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {selectedAuditScreenshots,deterministicClaims,responseSchema,runAuditIntelligence}=require('./openai-audit-intelligence');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v227-'));
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const shot=name=>{const p=path.join(dir,name);fs.writeFileSync(p,png);return p;};
  const manifest={
    findings:{findings:[]},
    facebook:{assessment:{status:'insufficient-evidence',overall:null,confidence:'low'}},
    facebookProbe:{
      status:'probed',
      screenshots:{desktop:shot('fb-desktop.png'),mobile:shot('fb-mobile.png')},
      destination:{landsOnClinicPage:true,wrongPage:false,genericFacebookDestination:false},
      page:{pageName:'Example Dental Facebook'},
      consistency:{brandNameMatches:true},
      actions:{bookButtonStatus:'not-observed',messageButtonStatus:'not-observed',whatsappButtonStatus:'not-observed',callButtonStatus:'not-observed'},
      probeDiagnostics:{commentPostDiscovery:{commentSurfacesOpened:2,commentScreenshots:[shot('fb-comment-1.png'),shot('fb-comment-2.png')]}}
    }
  };
  const labels=selectedAuditScreenshots(manifest).map(x=>x.label);
  assert(labels.includes('facebook-public-desktop'));
  assert(labels.includes('facebook-public-mobile'));
  assert(labels.includes('facebook-comment-surface-1'));
  assert(labels.includes('facebook-comment-surface-2'));

  const claims=deterministicClaims(manifest);
  assert(claims.some(x=>x.id==='facebook-profile-name'));
  assert(claims.some(x=>x.id==='facebook-message-action-observation'&&x.scannerValue==='not-observed'));
  assert(claims.some(x=>x.id==='facebook-comment-surfaces-opened'&&x.scannerValue===2));

  const schema=responseSchema();
  assert(schema.required.includes('facebookVisualAssessments'));
  assert(schema.properties.facebookVisualAssessments.properties.receptionistOpportunity);

  let requested=null;
  const notAssessable=k=>({assessment:'not_assessable',confidence:'low',rationale:`${k} unavailable`,evidenceScreenshots:[]});
  const fake={
    validation:claims.map(c=>({claimId:c.id,status:'not_visually_assessable',confidence:'low',rationale:'test',evidenceScreenshots:[]})),
    conflicts:[],
    visualAssessments:Object.fromEntries(['heroClarity','primaryActionQuality','mobileVisualQuality','trustPresentation','perceivedFriction'].map(k=>[k,notAssessable(k)])),
    googleBusinessVisualAssessments:Object.fromEntries(['profileIdentity','reputationPresentation','actionAccess','bookingPath','visualTrust'].map(k=>[k,notAssessable(k)])),
    facebookVisualAssessments:{
      profileIdentity:notAssessable('profileIdentity'),actionAccess:notAssessable('actionAccess'),demandVisibility:notAssessable('demandVisibility'),responseEvidence:notAssessable('responseEvidence'),handoffQuality:notAssessable('handoffQuality'),
      receptionistOpportunity:{opportunity:'not_assessable',confidence:'low',rationale:'test',evidenceScreenshots:[]}
    },
    facebookSurfaceEvidence:{observationMode:'public',pageName:null,followerCount:null,recommendationPercent:null,recommendationReviewCount:null,phone:null,address:null,messageActionVisible:null,callActionVisible:null,bookingActionVisible:null,latestVisibleActivityLabel:null,recentVisiblePostLabels:[],visiblePostCount:null,engagementSamples:[],contentPresentation:{assessment:'not_assessable',rationale:'test'},confidence:'low',evidenceScreenshots:[]},
    narrative:{executiveSummary:'x',costingPatients:'x',topPriorities:[{title:'x',why:'x',evidenceBasis:'x'}],quickWins:[{title:'x',action:'x',evidenceBasis:'x'}],pillarExplanations:{website:'x',googleBusiness:'x',facebook:'x'},caveats:[],edenIntervention:'x'}
  };
  const fetchImpl=async(_url,opts)=>{requested=JSON.parse(opts.body);return {ok:true,json:async()=>({id:'r227',model:'gpt-5.6-terra',output_text:JSON.stringify(fake)})};};
  const result=await runAuditIntelligence(manifest,{}, {force:true,apiKey:'test-key',fetchImpl});
  assert.equal(result.status,'completed');
  assert(result.facebookVisualAssessments);
  const inputText=requested.input[0].content[0].text;
  assert(/Facebook scanner statuses such as "not-observed"/.test(inputText));
  assert(/lifetime page history/.test(inputText));
  console.log('openai-audit-v227 tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
