const assert=require('assert');
const {VERSION,buildOwnerReportModel,economicImpact}=require('./owner-report');
assert(['2.2.39','2.2.40','2.2.41','2.2.42'].includes(VERSION));
const manifest={
  reviewedUrl:'https://exampleclinic.test',
  clinicIdentity:{clinicName:'Example Dental',location:'Cebu City, Philippines'},
  assessmentProfile:{interpretation:'The website is strong; the largest unanswered commercial question begins after the patient contacts the clinic.'},
  postSubmissionResponseBenchmark:{status:'benchmarked',channel:'Messenger',firstMeaningfulResponse:{observed:true,type:'human',minutes:10},silentLeadFollowUp:{observed:true,delayMinutes:232}},
  crossChannelGrowth:{
    actions:{
      topActions:[{id:'human-response-transition',title:'Protect the response → booking transition',diagnosis:'Some patient demand can be lost after contact if response ownership is inconsistent.',action:'Acknowledge every inquiry immediately, offer the next booking step, and follow up silent leads once.',revenueMechanism:'Turns more existing inquiries into attended appointments.',confidence:'high',priorityIndex:97,pillar:'cross-channel'}],
      patientRevenuePath:{stages:[{id:'discovery',status:'observed'},{id:'websiteIntent',status:'observed'},{id:'firstMeaningfulResponse',status:'observed'},{id:'appointmentConfirmed',status:'unknown'},{id:'attendance',status:'unknown'},{id:'revenue',status:'unknown'}]}
    },
    revenue:{
      status:'scenario-calculated',currency:'PHP',averageRevenuePerRecoveredPatient:3500,
      monthlyRevenueScenarios:{conservative:4712,base:7330,upside:10080},
      opportunities:[
        {id:'missed-calls',basis:'reported-leakage',monthlyVolume:{low:8,base:8,high:8}},
        {id:'delayed-messages',basis:'reported-leakage',monthlyVolume:{low:12,base:12,high:12}}
      ],
      assumptions:{leadToBookingRate:{base:.55,source:'reported-by-clinic'},attendanceRate:{base:.85,source:'reported-by-clinic'}}
    }
  }
};
const impact=economicImpact(manifest.crossChannelGrowth.revenue);
assert.equal(impact.status,'scenario-calculated');
assert.equal(impact.bookingsAtRisk.low,9.4); // 20 * .55 * .85 = 9.35
assert.equal(impact.revenueExposed.low,32725);
assert.equal(impact.recoverableBookings.base,2.1);
const m=buildOwnerReportModel(manifest,{demoUrl:'https://demo.example',proofUrl:'https://proof.example'});
assert.equal(m.clinic.name,'Example Dental');
assert.equal(m.recommendedFix.ownerCanDo,true);
assert(m.edenImplementation.text.includes('AI receptionist'));
assert.equal(m.economics.recoverableRevenue.base,7330);
assert.equal(m.trySolution.demoUrl,'https://demo.example');
assert((m.patientRevenuePathDetail||m.patientRevenuePath).some(s=>s.label==='Response'&&s.status==='strong'));
console.log('V2.2.39 Owner Report V1 tests passed');
