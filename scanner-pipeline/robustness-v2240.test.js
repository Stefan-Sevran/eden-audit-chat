const assert=require('assert');
const {VERSION,buildOwnerReportModel,economicImpact,selectCommercialOpportunity}=require('./owner-report');
assert(['2.2.40','2.2.41','2.2.42'].includes(VERSION));
const manifest={
  reviewedUrl:'https://exampleclinic.test',
  clinicIdentity:{clinicName:'Example Dental',location:'Cebu City, Philippines'},
  assessmentProfile:{digitalExperience:92,patientConversionReadiness:86,interpretation:'Strong website.'},
  postSubmissionResponseBenchmark:{status:'benchmarked',channel:'Messenger',firstMeaningfulResponse:{observed:true,type:'human',minutes:10},silentLeadFollowUp:{observed:true,delayMinutes:232}},
  crossChannelGrowth:{
    actions:{
      topActions:[{id:'google-conversion-destination',title:'Shorten the Google Maps path from intent to conversation',diagnosis:'Google sends patients to a clinic website scored 76/100 for destination quality.',action:'Test a more direct clinic-controlled destination—ideally booking or an Eden 24/7 receptionist—while preserving branch identity and tracking.',revenueMechanism:'Reduce leakage between Google discovery and the first actionable clinic conversation.',confidence:'high',priorityIndex:51,pillar:'google',commercialRelevance:'unknown'}],
      patientRevenuePath:{stages:[{id:'discovery',status:'unknown'},{id:'websiteIntent',status:'unknown'},{id:'channelSelection',status:'unknown'},{id:'leadCapture',status:'unknown'},{id:'submission',status:'unknown'},{id:'acknowledgement',status:'observed'},{id:'firstMeaningfulResponse',status:'observed'},{id:'appointmentOffered',status:'observed'},{id:'appointmentConfirmed',status:'unknown'},{id:'silentLeadFollowUp',status:'observed'},{id:'attendance',status:'unknown'},{id:'revenue',status:'unknown'}]}
    },
    revenue:{
      status:'scenario-calculated',currency:'PHP',averageRevenuePerRecoveredPatient:3500,
      monthlyRevenueScenarios:{conservative:4712,base:7330,upside:10080},
      opportunities:[
        {id:'missed-calls',label:'Missed calls',basis:'reported-leakage',monthlyVolume:{low:8,base:8,high:8}},
        {id:'delayed-messages',label:'Missed or delayed patient messages',basis:'reported-leakage',monthlyVolume:{low:12,base:12,high:12}}
      ],
      assumptions:{leadToBookingRate:{base:.55,source:'reported-by-clinic'},attendanceRate:{base:.85,source:'reported-by-clinic'}}
    }
  }
};
const action=selectCommercialOpportunity(manifest,manifest.crossChannelGrowth);
assert.equal(action.id,'reported-leakage-recovery');
assert.equal(action.commercialRelevance,'established');
assert(action.diagnosis.includes('10 minutes'));
assert(action.displacedAction.id==='google-conversion-destination');
const impact=economicImpact(manifest.crossChannelGrowth.revenue);
assert.equal(impact.bookingsAtRisk.low,9.4);
assert.equal(impact.revenueExposed.low,32725);
assert.equal(impact.recoverableBookings.base,2.1);
const m=buildOwnerReportModel(manifest,{demoUrl:'https://demo.example',proofUrl:'https://proof.example'});
assert.equal(m.primaryOpportunity.id,'reported-leakage-recovery');
assert.equal(m.patientRevenuePath.length,6);
assert(m.patientRevenuePath.find(x=>x.id==='response').status==='strong');
assert(m.patientRevenuePath.find(x=>x.id==='booking').status==='partial');
assert(m.strengths.some(x=>x.includes('92/100')));
assert(m.strengths.some(x=>x.includes('10 minutes')));
assert(m.quickSummary.potential.includes('additional bookings'));
assert(m.recommendedFix.text.includes('missed call'));
assert(m.edenImplementation.text.includes('track the result'));
console.log('V2.2.40 Commercial Alignment & 20-Second Summary tests passed');
