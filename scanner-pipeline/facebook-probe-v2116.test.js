const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const {scoreFacebook}=require('./facebook');

// 1) Unknown response timing must not be classified as delayed when a reply is observed.
const evidence={
  status:'evidence-collected',
  destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},
  actions:{bookButtonPresent:true,bookButtonWorks:true,bookingRequiresLogin:false,messageButtonPresent:true,whatsappButtonPresent:null,callButtonPresent:null},
  consistency:{brandNameMatches:true,bookingLinkQuality:100},
  demand:{comments:[
    ...Array.from({length:12},(_,i)=>({patientIntent:true,pricingIntent:true,text:`answered ${i}`,clinicReplyObserved:true,createdAt:null,timestampLabel:'2w'})),
    ...Array.from({length:2},(_,i)=>({patientIntent:true,treatmentIntent:true,text:`unanswered ${i}`,clinicReplyObserved:false,createdAt:null,timestampLabel:'2w'}))
  ]},
  response:{},
  revenueModel:{delayThresholdMinutes:60},
  provenance:{collectedAt:'2026-08-27T00:00:00Z'}
};
const scored=scoreFacebook(evidence);
assert.equal(scored.responseMetrics.observedIntentComments,14);
assert.equal(scored.responseMetrics.answeredIntentCount,12);
assert.equal(scored.responseMetrics.unansweredIntentCount,2);
assert.equal(scored.responseMetrics.responseCoveragePercent,86);
assert.equal(scored.demandLeakage.unansweredOrDelayedHighIntentLeads,2);
assert.equal(scored.demandLeakage.unansweredHighIntentLeads,2);
assert.equal(scored.demandLeakage.delayedAnsweredHighIntentLeads,0);
assert.equal(scored.demandLeakage.answeredTimingUnknownHighIntentLeads,12);
assert.equal(scored.components.actionAccess,90);
assert.equal(scored.components.crossChannelConsistency,90);
assert.equal(scored.overall,94);

// 2) Facebook shell titles must never become published page names.
const probeSrc=fs.readFileSync(__dirname+'/facebook-probe.js','utf8');
const start=probeSrc.indexOf('function usefulPageName');
const end=probeSrc.indexOf('\nfunction pageBaseUrl',start);
const sandbox={module:{exports:{}},exports:{},require,console};
vm.runInNewContext(probeSrc.slice(start,end)+'\nmodule.exports={usefulPageName};',sandbox);
const {usefulPageName}=sandbox.module.exports;
assert.equal(usefulPageName('Notifications','(8) Facebook','Facebook'),null);
assert.equal(usefulPageName('Yu Dental Davao | Facebook','Notifications'),'Yu Dental Davao');

// 3) Snapshot boundary must canonicalize probe response from assessment metrics.
const snapSrc=fs.readFileSync(__dirname+'/snapshot.js','utf8');
assert(snapSrc.includes('applyCanonicalFacebookResponse(facebookProbe,assessment)'));
assert(snapSrc.includes('applyCanonicalFacebookResponse(facebookProbe,facebookAssessment)'));
assert(/version:'2\.[12]\.\d+'/.test(snapSrc));
console.log('facebook-probe-v2116 ok');
