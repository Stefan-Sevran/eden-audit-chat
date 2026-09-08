const assert=require('assert');
const {buildReportModel,renderHtml,reviewTemplate}=require('./report-engine');
const manifest={
  version:'2.2.0',reviewedUrl:'https://clinic.example',clinicIdentity:{clinicName:'Example Dental',location:'Davao City, Philippines'},
  scoring:{overall:78,categories:{conversionCta:62,contactAccess:88},flags:[]},
  summary:{bookingCtaVisible:true,phoneActionable:true,mobileHeroClarity:74},
  googleBusiness:{assessment:{status:'scored',overall:86,band:'strong',confidence:'high',branchCount:1,branchSpread:0,interpretation:'Strong profile with a few conversion opportunities.'}},
  facebook:{assessment:{status:'scored',overall:92,band:'excellent',confidence:'high',responseMetrics:{observedIntentComments:20,scoringObservedIntentComments:13,scoringAnsweredIntentCount:12,scoringResponseCoveragePercent:92,generalInterestObservedCount:7,generalInterestUnansweredCount:7,medianResponseMinutes:null},demandLeakage:{unansweredHighIntentLeads:1},sampleStability:{responseCoverageInterpretation:'12 of 13 explicit/high-intent inquiries were answered (92%).',caveat:'Sampled public content.'}}}
};
const model=buildReportModel(manifest);
assert(/^2\.2\./.test(model.schemaVersion));
assert.equal(model.publication.status,'draft');
assert.equal(model.scorePolicy.blendedOverallPublished,false);
assert.equal(model.pillars.find(p=>p.id==='website').score,78);
assert.equal(model.pillars.find(p=>p.id==='google').score,86);
assert.equal(model.pillars.find(p=>p.id==='facebook').score,92);
assert(model.priorityFindings.some(f=>f.id==='fb-unanswered-high-intent'));
assert(model.priorityFindings.some(f=>f.id==='fb-timing-unknown'));
const html=renderHtml(model);
assert(html.includes('Example Dental'));
assert(html.includes('Pending human verification'));
assert(html.includes('No artificial blended score'));
const verified=buildReportModel(manifest,{humanReview:{status:'verified',reviewer:'Eden QA',reviewedAt:'2026-08-27'}});
assert.equal(verified.publication.status,'client-ready');
assert.equal(verified.publication.trustLabel,'Verified by Eden');
assert(reviewTemplate(model).findings['fb-unanswered-high-intent']);
console.log('report-engine-v220 ok');
