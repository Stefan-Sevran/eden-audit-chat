const assert=require('assert');
const {canonicalFacebookPageUrl}=require('./digital-front-door');
const {buildActionEngine,buildRevenueOpportunity}=require('./cross-channel-action-engine');
const {scoreSnapshot}=require('./scoring');

assert.equal(canonicalFacebookPageUrl('https://www.facebook.com/profile.php?id=61591642749531'),'https://www.facebook.com/profile.php?id=61591642749531');

const jorgio={
  clinicIdentity:{clinicName:'Jorgio Dental Health Care Clinic',location:'Cebu City, Philippines'},
  summary:{messengerVisible:true,messengerWhatsappVisible:true,phoneActionable:true,onlineBookingVisible:true,bookingCtaVisible:true},
  bookingFlow:{analyzed:true,bookingJourneyScore:null,bookingEntryScore:95,bookingCompletionVerified:false},
  googleBusiness:{evidence:{branches:[{discovery:{matched:true,matchConfidence:'high'},identityIsolation:{status:'confirmed'},profile:{rating:null,reviewCount:null},conversionDestination:{status:'probed',classification:'clinic-website',qualityScore:76,finalUrl:'https://cebudentistry.com/'},bookingDestination:{classification:'missing'}}]},assessment:{branches:[{components:{reputationStrength:null}}]}},
  facebook:{assessment:{responseMetrics:{}}},aiAuditIntelligence:{conflicts:[],facebookVisualAssessments:{}}
};
const actions=buildActionEngine(jorgio);
assert.equal(actions.topActions[0].id,'human-response-revenue-transition');
const google=actions.actions.find(x=>x.id==='google-conversion-destination');
assert(google);
assert.equal(google.commercialRelevance,'unknown');
assert(actions.patientRevenuePath.primaryTransition);
assert(actions.patientRevenuePath.ownerInputs.includes('averageNewPatientValue'));

const revenue=buildRevenueOpportunity(jorgio,{monthlyMessengerTextInquiries:120,monthlyMissedDelayedInquiries:15,monthlyMissedCalls:8,averageNewPatientValue:5000});
assert.equal(revenue.currency,'PHP');
assert.equal(revenue.status,'scenario-calculated');
assert(revenue.monthlyRevenueOpportunity.low>0);
assert(revenue.ownerInputBrief.preferredInputs.includes('monthlyMissedDelayedInquiries'));
// Delayed inquiries are already a leakage cohort, so total Messenger volume must not be double-counted.
assert(!revenue.opportunities.some(x=>x.id==='facebook-response'));

// Scoring must not publish an end-to-end booking score when only entry experience was verified.
const viewport={funnelMetrics:{},pageMetrics:{},ctaMetrics:{},imageMetrics:{},heroMetrics:{},overlayMetrics:{},channelMetrics:{},ctaCompetition:{},trustMetrics:{},mobileMetrics:{}};
const bookingFlow={analyzed:true,bookingJourneyScore:null,bookingEntryScore:95,bookingCompletionVerified:false,subScores:{entryAccessibility:95},scoreWeights:{entryAccessibility:1},scoreReconciliation:{weightedDiagnosticScore:95},scoreLedger:{score:95},advertisedVisibleStepCount:1,verifiedFormStepCount:1,distinctStateCount:1,fieldsByStage:[],transitions:[]};
const scored=scoreSnapshot({desktop:viewport,mobile:viewport,bookingFlow});
assert.equal(scored.categories.bookingJourney,null);
assert.equal(scored.categories.bookingEntryExperience,95);
assert.equal(scored.explainability.booking.scoreStatus,'entry-only');
console.log('V2.2.35 robustness tests passed');
