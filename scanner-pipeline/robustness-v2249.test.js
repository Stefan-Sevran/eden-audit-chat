const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {VERSION,buildOwnerReportModel,writeOwnerReportFiles}=require('./owner-report');

const manifest={
  reviewedUrl:'https://cebudentistry.com',
  generatedAt:'2026-09-01T00:00:00.000Z',
  clinicIdentity:{clinicName:'Jorgio Dental Health Care Clinic',location:'Cebu City, Philippines'},
  summary:{messengerVisible:true,phoneActionable:true,onlineBookingVisible:true,bookingCtaVisible:true},
  crossChannelGrowth:{
    status:'complete',
    revenue:{
      status:'scenario-calculated',currency:'PHP',averageNewPatientValue:3500,
      revenueExposed:{low:32725,high:32725},
      recoverableRevenue:{conservative:4712,base:7060,upside:10080},
      recoverableBookings:{conservative:1.3,base:2,upside:2.9},
      opportunities:[],assumptions:{leadToBookingRate:{base:.55},attendanceRate:{base:.85}}
    },
    rankedActions:[{id:'missed-response',title:'Missed calls and delayed replies',diagnosis:'Patients may wait after contacting the clinic.',action:'Reply or call back quickly, then follow up once.',priorityIndex:100}]
  }
};

assert.equal(VERSION,'2.3.0');
const model=buildOwnerReportModel(manifest,{});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v2249-'));
const result=writeOwnerReportFiles(tmp,manifest,{});
const ownerHtml=fs.readFileSync(result.htmlPath,'utf8');
const evidenceHtml=fs.readFileSync(path.join(result.reportDir,'evidence','index.html'),'utf8');

for(const html of [ownerHtml,evidenceHtml]){
  assert(html.includes('clinicnet-continuity-v2300'),'Generated page must include the clinicnet.live continuity theme');
  assert(html.includes('#11143f'),'Generated page must include clinicnet midnight navy');
  assert(html.includes('#7a2cf6'),'Generated page must include clinicnet violet');
  assert(html.includes('#315ff7'),'Generated page must include clinicnet blue');
  assert(html.includes('font-family:Inter'),'Generated page must use the modern sans-serif family');
}
assert(ownerHtml.includes('linear-gradient(135deg,#11143f'),'Owner hero must use the restrained clinicnet gradient');
assert(ownerHtml.includes('linear-gradient(135deg,#7a2cf6'),'Owner CTA must use the clinicnet violet-blue gradient');
assert(ownerHtml.includes('#2b7a63'),'Positive recovery colour must remain as a restrained accent');
assert(ownerHtml.includes('Owner Report · V2.3.0'));
assert(!ownerHtml.includes('font-family:Georgia,serif!important'));

console.log('V2.3.0 clinicnet.live visual continuity regression tests passed.');
