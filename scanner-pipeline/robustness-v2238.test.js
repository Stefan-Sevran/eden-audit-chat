const assert=require('assert');
const {buildRevenueOpportunity,buildCrossChannelGrowthModel,VERSION}=require('./cross-channel-action-engine');

const manifest={
  clinicIdentity:{name:'Test Dental',location:'Cebu City, Philippines'},
  summary:{messengerVisible:true,messengerWhatsappVisible:true,phoneActionable:true,onlineBookingVisible:true,bookingCtaVisible:true},
  bookingFlow:{analyzed:true,manualConfirmationDetected:false},
  googleBusiness:{evidence:{branches:[{conversionDestination:{qualityScore:76,classification:'clinic-website'}}]}},
  facebook:{assessment:{responseMetrics:{responseCoveragePercent:null}}},
  postSubmissionResponseBenchmark:{
    schemaVersion:'2.2.37',clinicName:'Test Dental',channel:'Messenger',businessHoursAdjusted:true,
    acknowledgement:{observed:true,type:'automated'},
    firstMeaningfulResponse:{observed:true,type:'human',minutes:10},
    appointmentOffered:{observed:true},silentLeadFollowUp:{observed:true,delayMinutes:232}
  }
};

assert.equal(VERSION,'2.2.38');

// Minimal owner-input model: reported leakage + patient value, scenario conversion rates.
const a=buildRevenueOpportunity(manifest,{currency:'PHP',monthlyMissedCalls:10,averageNewPatientValue:5000});
assert.equal(a.status,'scenario-calculated');
assert(a.monthlyRevenueScenarios.conservative>0);
assert(a.monthlyRevenueScenarios.base>a.monthlyRevenueScenarios.conservative);
assert(a.monthlyRevenueScenarios.upside>a.monthlyRevenueScenarios.base);
assert.equal(a.assumptions.leadToBookingRate.source,'scenario-assumption');
assert.equal(a.evidenceLedger.calculatedByEden.length>0,true);
assert.equal(a.benchmarkContext.strongObserved,true);
assert.equal(a.benchmarkContext.silentLeadRecoveryObserved,true);

// Clinic-reported booking rate must replace scenario booking-rate assumptions.
const b=buildRevenueOpportunity(manifest,{currency:'PHP',monthlyMissedCalls:10,leadToBookingRate:.25,attendanceRate:.9,averageNewPatientValue:5000});
assert.equal(b.assumptions.leadToBookingRate.source,'reported-by-clinic');
assert.equal(b.assumptions.leadToBookingRate.base,.25);
assert.equal(b.assumptions.attendanceRate.source,'reported-by-clinic');

// Owner ranges are supported.
const c=buildRevenueOpportunity(manifest,{currency:'PHP',monthlyMissedCalls:{low:8,high:12},leadToBookingRate:.3,averageNewPatientValue:5000});
assert.equal(c.opportunities[0].monthlyVolume.low,8);
assert.equal(c.opportunities[0].monthlyVolume.high,12);

// Explicit delayed-message leakage suppresses overlapping broad Messenger demand.
const d=buildRevenueOpportunity(manifest,{currency:'PHP',monthlyMessengerTextInquiries:100,monthlyMissedDelayedInquiries:15,averageNewPatientValue:5000});
assert(d.opportunities.some(x=>x.id==='delayed-messages'));
assert(!d.opportunities.some(x=>x.id==='messenger-response'));
assert(d.doubleCountReview.suppressedBroadCohorts.includes('messenger-response'));

// Broad Messenger volume is allowed as a clearly labelled incremental scenario when no leakage count exists.
const e=buildRevenueOpportunity(manifest,{currency:'PHP',monthlyMessengerTextInquiries:100,averageNewPatientValue:5000});
const mr=e.opportunities.find(x=>x.id==='messenger-response');
assert(mr);
assert.equal(mr.basis,'scenario-on-reported-demand');
assert.equal(mr.evidenceLabels.volume,'Reported by clinic');
assert.equal(mr.evidenceLabels.result,'Calculated by Eden');

// Critical integrity: a rescued inquiry is not automatically treated as a patient.
// 10 missed calls * 26% base recovery * 30% booking * 90% attendance * PHP 5000 = PHP 3510.
assert.equal(a.monthlyRevenueScenarios.base,3510);

const growth=buildCrossChannelGrowthModel(manifest,{revenueInputs:{monthlyMissedCalls:10,averageNewPatientValue:5000}});
assert.equal(growth.schemaVersion,'2.2.38');
assert.equal(growth.revenue.schemaVersion,'2.2.38');
console.log('V2.2.38 Revenue Exposure Engine tests passed');
