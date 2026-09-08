const assert=require('assert');
const {scoreFacebook}=require('./facebook');

const evidence={
  status:'evidence-collected',
  destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},
  actions:{bookButtonPresent:true,bookButtonWorks:true,bookingRequiresLogin:false,messageButtonPresent:true,whatsappButtonPresent:null,callButtonPresent:null},
  consistency:{brandNameMatches:true,bookingLinkQuality:100},
  demand:{comments:[
    ...Array.from({length:12},(_,i)=>({patientIntent:true,pricingIntent:true,text:`answered ${i}`,clinicReplyObserved:true,timestampLabel:'2w'})),
    {patientIntent:true,treatmentIntent:true,text:'unanswered',clinicReplyObserved:false,timestampLabel:'2w'}
  ]},
  response:{},
  revenueModel:{delayThresholdMinutes:60},
  provenance:{collectedAt:'2026-08-27T00:00:00Z'},
  probe:{probeDiagnostics:{commentPostDiscovery:{postsFound:12,postsInspected:5,evidenceAccumulation:{renderAttempts:13,statesRetained:5,variablePosts:3}}}}
};
const scored=scoreFacebook(evidence);
assert.equal(scored.responseMetrics.observedIntentComments,13);
assert.equal(scored.responseMetrics.answeredIntentCount,12);
assert.equal(scored.responseMetrics.responseCoveragePercent,92);
assert.equal(scored.sampleStability.scope,'sampled-public-content');
assert.equal(scored.sampleStability.postsFound,12);
assert.equal(scored.sampleStability.postsInspected,5);
assert.equal(scored.sampleStability.allDiscoveredPostsInspected,false);
assert.equal(scored.sampleStability.allPageHistoryScraped,false);
assert.equal(scored.sampleStability.variablePosts,3);
assert.equal(scored.sampleStability.variablePostSharePercent,60);
assert.equal(scored.sampleStability.evidenceVariability,'high');
assert(scored.sampleStability.responseCoverageInterpretation.includes('12 of 13'));
assert(scored.sampleStability.caveat.includes('current sampled observation'));
assert(scored.policy.includes('sampled public-content observation'));
console.log('facebook-probe-v2117 ok');
