const assert=require('assert');
const {VERSION,buildOwnerReportModel,buildOpportunityList,buildOwnerReviewTemplate}=require('./owner-report');
assert(['2.2.41','2.2.42'].includes(VERSION));
const manifest={
  reviewedUrl:'https://exampleclinic.test',
  clinicIdentity:{clinicName:'Example Dental',location:'Cebu City, Philippines'},
  assessmentProfile:{digitalExperience:92,patientConversionReadiness:86},
  postSubmissionResponseBenchmark:{status:'benchmarked',channel:'Messenger',firstMeaningfulResponse:{observed:true,type:'human',minutes:10},silentLeadFollowUp:{observed:true,delayMinutes:232}},
  crossChannelGrowth:{
    actions:{topActions:[
      {id:'google-conversion-destination',title:'Shorten the Google Maps path from intent to conversation',diagnosis:'Google sends patients to a clinic website scored 76/100 for destination quality.',action:'Test a more direct clinic-controlled destination.',revenueMechanism:'Reduce leakage.',confidence:'high',priorityIndex:51,pillar:'google',commercialRelevance:'unknown'},
      {id:'secondary',title:'Improve booking confirmation',diagnosis:'Booking confirmation is partly measured.',action:'Track booking confirmation.',revenueMechanism:'Protect booked demand.',confidence:'medium',priorityIndex:45,pillar:'booking',commercialRelevance:'medium'}
    ],patientRevenuePath:{stages:[{id:'discovery',status:'unknown'},{id:'websiteIntent',status:'unknown'},{id:'channelSelection',status:'unknown'},{id:'leadCapture',status:'unknown'},{id:'submission',status:'unknown'},{id:'acknowledgement',status:'observed'},{id:'firstMeaningfulResponse',status:'observed'},{id:'appointmentOffered',status:'observed'},{id:'appointmentConfirmed',status:'unknown'},{id:'silentLeadFollowUp',status:'observed'},{id:'attendance',status:'unknown'},{id:'revenue',status:'unknown'}]}},
    revenue:{status:'scenario-calculated',currency:'PHP',averageRevenuePerRecoveredPatient:3500,monthlyRevenueScenarios:{conservative:4712,base:7330,upside:10080},opportunities:[{id:'missed-calls',label:'Missed calls',basis:'reported-leakage',monthlyVolume:{low:8,base:8,high:8}},{id:'delayed-messages',label:'Missed messages',basis:'reported-leakage',monthlyVolume:{low:12,base:12,high:12}}],assumptions:{leadToBookingRate:{base:.55},attendanceRate:{base:.85}}}
  }
};
let m=buildOwnerReportModel(manifest,{});
assert(m.hero.headline.includes('32,725'));
assert(m.hero.intro.includes('4,712'));
assert.equal(m.topOpportunities[0].id,'reported-leakage-recovery');
assert(m.topOpportunities.length>=2);
const review={status:'loaded',reviewerNote:'Reviewed by Stefan',primaryOpportunityId:'manual-generic-fb',addFindings:[{id:'manual-generic-fb',include:true,title:'Send patients to the clinic, not a generic Facebook page',diagnosis:'Verified human observation.',recommendedFix:'Replace the link with the clinic booking page.',edenImplementation:'Eden can provide a tracked clinic-controlled destination.',confidence:'verified'}]};
m=buildOwnerReportModel(manifest,{ownerReview:review});
assert.equal(m.primaryOpportunity.id,'manual-generic-fb');
assert(m.recommendedFix.text.includes('booking page'));
assert(m.edenImplementation.text.includes('tracked'));
assert.equal(m.humanReview.reviewerNote,'Reviewed by Stefan');
const t=buildOwnerReviewTemplate(m);
assert(['2.2.41','2.2.42'].includes(t.schemaVersion));
assert(Array.isArray(t.addFindings));
console.log('V2.2.41 Owner Decision Layer + Human Review tests passed');
