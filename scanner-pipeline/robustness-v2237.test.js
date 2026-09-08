const assert=require('assert');
const {normalizeResponseBenchmark,buildPostSubmissionPath,speedBand}=require('./post-submission-response');
const {buildActionEngine}=require('./cross-channel-action-engine');

const baseManifest={
  summary:{messengerVisible:true,messengerWhatsappVisible:true,phoneActionable:true,onlineBookingVisible:true,bookingCtaVisible:true},
  bookingFlow:{},facebook:{assessment:{}},aiAuditIntelligence:{},googleBusiness:{evidence:{branches:[]}}
};

// Auto replies are evidence of acknowledgement only; they must never become meaningful response.
const autoOnly=normalizeResponseBenchmark({
  clinicName:'Example Clinic',channel:'Messenger',submittedAt:'2026-09-01T09:00:00+07:00',
  acknowledgement:{status:'observed',type:'automated',at:'2026-09-01T09:00:02+07:00'},
  firstMeaningfulResponse:{status:'not-observed'},observationWindowHours:24,noMeaningfulResponseWithin24h:true
});
assert.equal(autoOnly.acknowledgement.isAutomated,true);
assert.equal(autoOnly.firstMeaningfulResponse.humanOrHumanish,false);
assert.equal(autoOnly.interpretation.autoReplyOnly,true);
assert.equal(autoOnly.interpretation.noMeaningfulResponseWithin24h,true);
assert.equal(autoOnly.firstMeaningfulResponse.speedBand,'no-response-observed');

// Jorgio-like: fast human response + booking offer + proactive silent-lead follow-up.
const strong={
  clinicName:'Jorgio Dental Health Care Clinic',channel:'Messenger',submittedAt:'2026-08-31T11:38:00+08:00',
  acknowledgement:{status:'observed',type:'automated',at:'2026-08-31T11:38:02+08:00'},
  firstMeaningfulResponse:{status:'observed',type:'human',at:'2026-08-31T11:48:00+08:00'},
  bookingOffer:{status:'observed',at:'2026-08-31T11:48:00+08:00'},
  proactiveFollowUp:{status:'observed',type:'human',at:'2026-08-31T15:30:00+08:00'}
};
const strongNorm=normalizeResponseBenchmark(strong);
assert.equal(strongNorm.firstMeaningfulResponse.minutes,10);
assert.equal(strongNorm.firstMeaningfulResponse.speedBand,'exceptional');
assert.equal(strongNorm.interpretation.strongObserved,true);
assert.equal(strongNorm.interpretation.silentLeadRecoveryObserved,true);
const strongEngine=buildActionEngine(baseManifest,{responseBenchmark:strong});
assert(!strongEngine.actions.some(x=>x.id==='human-response-revenue-transition'),'Do not manufacture a response problem when a fast booking-oriented response is observed');
assert.equal(strongEngine.patientRevenuePath.primaryTransition.from,'Appointment offered');
assert.equal(strongEngine.patientRevenuePath.postSubmissionPath.transitions.silentLeadFollowUp.status,'observed');

// Millennium-like: polished capture, but no meaningful response within the observation window.
const noReply={
  clinicName:'Millennium Smiles',channel:'website-form',submittedAt:'2026-08-30T21:00:00+08:00',
  acknowledgement:{status:'observed',type:'system'},
  firstMeaningfulResponse:{status:'not-observed'},noMeaningfulResponseWithin24h:true,observationWindowHours:24
};
const weakEngine=buildActionEngine(baseManifest,{responseBenchmark:noReply});
const recovery=weakEngine.actions.find(x=>x.id==='human-response-revenue-transition');
assert(recovery);
assert.equal(recovery.title,'Recover submitted leads that receive no meaningful response');
assert.equal(weakEngine.patientRevenuePath.primaryTransition.from,'Submitted inquiry');
assert.equal(weakEngine.patientRevenuePath.primaryTransition.status,'observed-leakage');

assert.equal(speedBand(15,'observed'),'exceptional');
assert.equal(speedBand(40,'observed'),'strong');
assert.equal(speedBand(180,'observed'),'moderate');


const aliasNorm=normalizeResponseBenchmark({
  clinicName:'Jorgio Dental Health Care Clinic',channel:'Messenger',businessHoursAdjusted:true,
  acknowledgement:{observed:true,type:'automated',meaningfulResponse:false},
  firstMeaningfulResponse:{observed:true,type:'human',minutes:10},
  appointmentOffered:{observed:true},appointmentConfirmed:{observed:null},
  silentLeadFollowUp:{observed:true,delayMinutes:232}
});
assert.equal(aliasNorm.firstMeaningfulResponse.minutes,10);
assert.equal(aliasNorm.firstMeaningfulResponse.speedBand,'exceptional');
assert.equal(aliasNorm.bookingOffer.status,'observed');
assert.equal(aliasNorm.proactiveFollowUp.status,'observed');
assert.equal(aliasNorm.proactiveFollowUp.minutesFromSubmission,232);
assert.equal(aliasNorm.interpretation.strongObserved,true);
console.log('V2.2.37 Post-Submission Revenue Path tests passed');
