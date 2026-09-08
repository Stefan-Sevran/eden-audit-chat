const assert=require('assert');
const fs=require('fs');
const {scoreFacebook}=require('./facebook');

const comments=[
  {patientIntent:true,pricingIntent:true,clinicReplyObserved:true,createdAt:'2026-08-27T06:00:00.000Z',clinicReplyAt:'2026-08-27T06:07:00.000Z',timestampLabel:'1h',clinicReplyTimestampLabel:'53m'},
  {patientIntent:true,locationIntent:true,clinicReplyObserved:true,createdAt:'2026-08-27T06:10:00.000Z',clinicReplyAt:'2026-08-27T06:12:00.000Z',timestampLabel:'50m',clinicReplyTimestampLabel:'48m'},
  {patientIntent:true,treatmentIntent:true,clinicReplyObserved:false,createdAt:'2026-08-26T00:00:00.000Z',timestampLabel:'1d'}
];
const evidence={status:'probed',destination:{httpReachable:true,landsOnClinicPage:true,genericFacebookDestination:false,wrongPage:false},actions:{bookButtonPresent:true,bookButtonWorks:true,bookingRequiresLogin:false,messageButtonPresent:true},consistency:{brandNameMatches:true,bookingLinkQuality:100},demand:{comments},probe:{probeDiagnostics:{commentPostDiscovery:{postsFound:12,postsInspected:5,evidenceAccumulation:{renderAttempts:13,statesRetained:5,variablePosts:2}}}},provenance:{collectedAt:'2026-08-27T06:20:00.000Z'},revenueModel:{delayThresholdMinutes:60}};
const s=scoreFacebook(evidence);
assert.equal(s.responseMetrics.scoringObservedIntentComments,3);
assert.equal(s.responseMetrics.scoringAnsweredIntentCount,2);
assert.equal(s.responseMetrics.medianResponseMinutes,5); // median of 2 and 7 rounds to 5
assert.equal(s.responseMetrics.p75ResponseMinutes,7);
assert.equal(s.responseMetrics.answeredWithin5MinPercent,50);
assert.equal(s.responseMetrics.answeredWithin60MinPercent,100);
assert.equal(s.demandLeakage.delayedAnsweredHighIntentLeads,0);
assert.equal(s.demandLeakage.answeredTimingUnknownHighIntentLeads,0);
const probeSrc=fs.readFileSync(require.resolve('./facebook-probe'),'utf8');
assert(probeSrc.includes('timestampPrecision'));
assert(probeSrc.includes('View more replies') || probeSrc.includes('view|see'));
console.log('facebook-probe-v2120.test.js passed');
