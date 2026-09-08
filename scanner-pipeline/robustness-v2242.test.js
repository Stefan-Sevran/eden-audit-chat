const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {VERSION,buildOwnerReportModel,renderOwnerReport,writeOwnerReportFiles,buildOwnerReviewTemplate}=require('./owner-report');
assert.equal(VERSION,'2.2.42');
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
const m=buildOwnerReportModel(manifest,{});
assert(m.hero.headline.includes('32,725'));
assert(m.hero.headline.includes('slipping away'));
assert(m.hero.intro.includes('4,712'));
assert.equal(m.primaryOpportunity.id,'reported-leakage-recovery');
assert(m.strengths.some(x=>x.includes('Messenger reply in about 10 minutes')));
assert.equal(m.privacy.robots,'noindex,nofollow,noarchive');
const html=renderOwnerReport(m);
assert(html.includes('Estimated revenue at risk'));
assert(html.includes('Where patients are most likely being lost'));
assert(html.includes('Best fix to make first'));
assert(html.includes('noindex,nofollow,noarchive'));
assert(html.includes('WITH THE FIX'));
const review={status:'loaded',visuals:{coverImage:'https://example.com/cover.jpg',fixImage:'https://example.com/fix.jpg'},primaryOpportunityId:'manual-fix',addFindings:[{id:'manual-fix',include:true,title:'Send patients straight to booking',diagnosis:'The current link sends patients somewhere less useful.',recommendedFix:'Link directly to booking.',edenImplementation:'Eden can provide the tracked path.'}]};
const mr=buildOwnerReportModel(manifest,{ownerReview:review});
assert.equal(mr.visuals.coverImage,'https://example.com/cover.jpg');
assert.equal(mr.primaryOpportunity.id,'manual-fix');
const t=buildOwnerReviewTemplate(mr);
assert.equal(t.schemaVersion,'2.2.42');
assert(t.visuals && 'coverImage' in t.visuals);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v2242-'));
const img=path.join(tmp,'fix.png');fs.writeFileSync(img,Buffer.from([137,80,78,71,13,10,26,10]));
const result=writeOwnerReportFiles(tmp,manifest,{fixImage:img});
const model=JSON.parse(fs.readFileSync(result.modelPath,'utf8'));
assert.equal(model.visuals.fixImage,'assets/top-fix.png');
assert(fs.existsSync(path.join(result.reportDir,'assets','top-fix.png')));
console.log('V2.2.42 Human Language + Money-First + Visual Layer tests passed');
