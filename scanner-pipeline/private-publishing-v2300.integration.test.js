const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createReviewApp}=require('./review-owner-report');

async function main(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eden-publish-v2300-'));
  const manifest={outputDir:path.join(tmp,'stale-path-from-an-older-version'),reviewedUrl:'https://example.test',clinicIdentity:{clinicName:'Jorgio Dental Health Care Clinic',location:'Cebu City, Philippines'},crossChannelGrowth:{revenue:{currency:'PHP',averageNewPatientValue:3500,ownerInputs:{averageNewPatientValue:3500},assumptions:{leadToBookingRate:{base:.55},attendanceRate:{base:.85}},opportunities:[{basis:'reported-leakage',monthlyVolume:{base:20,low:20,high:20}}],monthlyRevenueScenarios:{conservative:4712,base:7350,upside:10080}},actions:{topActions:[]}}};
  const snapshot=path.join(tmp,'snapshot.json');fs.writeFileSync(snapshot,JSON.stringify(manifest));
  const {server,reviewPath}=createReviewApp({snapshotPath:snapshot,port:0,openBrowser:false});assert.equal(reviewPath,path.join(tmp,'owner-report','owner-review.json'));await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const state=await (await fetch(base+'/api/state')).json();
    const payload={...state.review,schemaVersion:'2.3.0',reportCopy:state.editableCopy,preview:{assistantName:'Lia',greeting:'Hi from Jorgio.',implementationUrl:''},publishing:{humanApproved:true,expiresInDays:7}};
    assert((await fetch(base+'/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).ok);
    const opened=await (await fetch(base+'/api/open-report',{method:'POST'})).json();assert.equal(opened.url,base+'/draft/');assert((await fetch(opened.url)).ok);assert((await fetch(base+'/draft/preview/')).ok);
    assert((await fetch(base+'/api/generate-visuals',{method:'POST'})).ok);
    const publishResponse=await fetch(base+'/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({humanApproved:true,expiresInDays:7})});assert(publishResponse.ok);const published=await publishResponse.json();
    assert(published.url.startsWith(base+'/private/'));const audit=await fetch(published.url,{redirect:'follow'});assert(audit.ok);assert((await audit.text()).includes('Meet Jorgio Dental Health Care Clinic'));
    assert((await fetch(published.url+'/evidence/')).ok);const preview=await fetch(published.url+'/preview/');assert(preview.ok);assert((await preview.text()).includes('Meet Lia'));
    const chat=await fetch(published.url+'/preview/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Can I book?',history:[]})});assert(chat.ok);assert((await chat.json()).text.includes('appointment'));
    assert((await fetch(published.url+'/preview/implementation')).ok);
    const finalState=await (await fetch(base+'/api/state')).json();assert(finalState.publishing.counts.audit_opened>=1);assert(finalState.publishing.counts.evidence_viewed>=1);assert(finalState.publishing.counts.preview_started>=1);assert(finalState.publishing.counts.implementation_requested>=1);
    console.log('V2.3.0 magic-link HTTP routes and activity signals integration tests passed.');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exit(1);});
