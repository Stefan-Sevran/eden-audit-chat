const assert=require('assert');
const {parseRatingAndReviews}=require('./google-business-probe');
const {buildPublicationGuardrails}=require('./publication-guardrails');
const {buildActionEngine,buildRevenueOpportunity}=require('./cross-channel-action-engine');
const {buildReportModel,renderHtml}=require('./report-engine');

// Google header evidence must beat unrelated review/body values.
const rr=parseRatingAndReviews({
  rows:[{text:'Digital Dental Center Pattaya'},{aria:'4.8 stars 243 reviews'},{text:'Dental clinic'}],
  bodyText:'Digital Dental Center Pattaya 5.0 (225) Some individual review text 5 stars 225 reviews elsewhere'
});
assert.equal(rr.rating,4.8);
assert.equal(rr.reviewCount,243);

const manifest={
  version:'2.2.10',reviewedUrl:'https://clinic.test',clinicIdentity:{clinicName:'Clinic Test',location:'Pattaya'},
  scoring:{overall:83,categories:{bookingJourney:56},flags:[]},summary:{bookingCtaVisible:true,phoneActionable:true,mobileHeroClarity:74},
  bookingFlow:{analyzed:true,manualConfirmationDetected:true,responseWithinDays:1,minimumAdvanceDays:3,urgentFallbackDetected:true,totalRequiredFieldCount:8,measurementCompleteness:{unknownLaterStepBurden:true}},
  googleBusiness:{assessment:{status:'scored',overall:88,band:'strong',confidence:'medium'},evidence:{branches:[{profile:{rating:5,reviewCount:225},actions:{websiteAvailable:true,callAvailable:true},conversionDestination:{status:'probed',classification:'clinic-website',qualityScore:76,finalUrl:'https://clinic.test'}}]}},
  facebook:{assessment:{status:'insufficient-evidence',overall:null,responseMetrics:{},sampleStability:{}}},
  aiAuditIntelligence:{status:'completed',model:'test',agreement:{confirmed:10,humanReviewConflicts:2},conflicts:[
    {claimId:'google-rating',severity:'high',humanReviewRequired:true,scannerPosition:'5.0',visualPosition:'4.8'},
    {claimId:'google-review-count',severity:'high',humanReviewRequired:true,scannerPosition:'225',visualPosition:'243'}
  ],facebookVisualAssessments:{handoffQuality:{assessment:'weak',confidence:'high',rationale:'Login friction'},demandVisibility:{assessment:'not_assessable',confidence:'high'},receptionistOpportunity:{opportunity:'medium',confidence:'medium',rationale:'Potential only'}},narrative:{executiveSummary:'Test',costingPatients:'Test risk',topPriorities:[],quickWins:[],pillarExplanations:{website:'w',googleBusiness:'g',facebook:'f'},caveats:[],edenIntervention:'x'}}
};
manifest.publicationGuardrails=buildPublicationGuardrails(manifest,{});
assert.equal(manifest.publicationGuardrails.status,'verification-required');
assert(manifest.publicationGuardrails.blockedPillars.includes('google'));

const actions=buildActionEngine(manifest);
assert(!actions.actions.some(a=>a.id==='facebook-ai-receptionist'),'Facebook receptionist must not rank without observed demand');
assert(actions.conditionalActions.some(a=>a.id==='facebook-ai-receptionist'));

manifest.crossChannelGrowth={schemaVersion:'2.2.10',actions,revenue:buildRevenueOpportunity(manifest,null)};
const model=buildReportModel(manifest,{});
const google=model.pillars.find(p=>p.id==='google');
assert.equal(google.score,null,'Conflicted Google score must be withheld');
assert.equal(google.internalScore,88);
assert.equal(model.publication.status,'verification-required');
const html=renderHtml(model);
assert(html.includes('Publication guardrail active'));
assert(html.includes('Attribution blueprint'));
assert(html.includes('Potential interventions — verify demand first'));

const reviewed=buildReportModel(manifest,{humanReview:{status:'verified',reviewer:'Eden QA',claimResolutions:{
  'google-rating':{status:'verified-visual',publicValue:4.8},
  'google-review-count':{status:'verified-visual',publicValue:243}
}}});
const reviewedGoogle=reviewed.pillars.find(p=>p.id==='google');
assert.equal(reviewedGoogle.score,88);
assert.equal(reviewed.publication.status,'client-ready');
assert(reviewedGoogle.metrics.some(m=>m.label==='Google rating'&&m.value==='4.8/5'));
assert(reviewedGoogle.metrics.some(m=>m.label==='Reviews observed'&&m.value===243));
console.log('commercial-v2210 ok');
