const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const vm=require('vm');
const {VERSION,buildOwnerReportModel,chooseEvidenceScreenshots}=require('./owner-report');
const {loadRevenueInputs,buildCrossChannelGrowthModel}=require('./cross-channel-action-engine');
const {createReviewApp,normalizeReview,reviewHtml}=require('./review-owner-report');

function waitListening(server){return server.listening?Promise.resolve():new Promise(resolve=>server.once('listening',resolve));}
class FakeClassList{constructor(el){this.el=el;}add(name){const s=new Set(String(this.el.className||'').split(/\s+/).filter(Boolean));s.add(name);this.el.className=[...s].join(' ');}remove(name){this.el.className=String(this.el.className||'').split(/\s+/).filter(x=>x&&x!==name).join(' ');}}
class FakeElement{
  constructor(tag='div',id=''){this.tagName=String(tag).toUpperCase();this.id=id;this.className='';this.textContent='';this.value='';this.selected=false;this.dataset={};this.style={};this.children=[];this.listeners={};this.classList=new FakeClassList(this);}
  appendChild(node){this.children.push(node);if(node.selected||(!this.value&&node.tagName==='OPTION'))this.value=node.value||'';return node;}
  append(...nodes){nodes.forEach(n=>this.appendChild(n));}
  replaceChildren(...nodes){this.children=[];this.value='';nodes.forEach(n=>this.appendChild(n));}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  closest(){return null;}
}

(async()=>{
  assert.equal(VERSION,'2.3.0');
  const root=path.resolve(__dirname,'..');
  const fixturePath=path.join(root,'revenue-inputs-jorgio-test.json');
  assert(fs.existsSync(fixturePath),'Jorgio revenue fixture must ship in V2.3.0');
  const inputs=loadRevenueInputs(fixturePath);
  assert.equal(inputs.currency,'PHP');
  assert.equal(inputs.monthlyWebsiteFormInquiries,20);
  assert.equal(inputs.monthlyMessengerTextInquiries,80);
  assert.equal(inputs.monthlyMissedDelayedInquiries,12);
  assert.equal(inputs.monthlyMissedCalls,8);
  assert.equal(inputs.inquiryToBookingRate,.55);
  assert.equal(inputs.attendanceRate,.85);
  assert.equal(inputs.averageNewPatientValue,3500);

  const manifest={
    reviewedUrl:'https://cebudentistry.com',
    clinicIdentity:{clinicName:'Jorgio Dental Health Care Clinic',location:'Cebu City, Philippines'},
    summary:{messengerVisible:true,messengerWhatsappVisible:true,phoneActionable:true,onlineBookingVisible:true,bookingCtaVisible:true},
    bookingFlow:{analyzed:true,manualConfirmationDetected:false},
    googleBusiness:{evidence:{branches:[{conversionDestination:{qualityScore:76,classification:'clinic-website'}}]}},
    facebook:{assessment:{responseMetrics:{responseCoveragePercent:null}}},
    postSubmissionResponseBenchmark:{
      schemaVersion:'2.2.37',clinicName:'Jorgio Dental Health Care Clinic',channel:'Messenger',businessHoursAdjusted:true,status:'benchmarked',
      acknowledgement:{observed:true,type:'automated'},
      firstMeaningfulResponse:{observed:true,type:'human',minutes:10},
      appointmentOffered:{observed:true},silentLeadFollowUp:{observed:true,delayMinutes:232}
    }
  };
  manifest.crossChannelGrowth=buildCrossChannelGrowthModel(manifest,{revenueInputs:inputs,responseBenchmark:manifest.postSubmissionResponseBenchmark});
  const ownerModel=buildOwnerReportModel(manifest,{});
  assert.equal(ownerModel.economics.status,'scenario-calculated');
  assert.equal(ownerModel.economics.currency,'PHP');
  assert(ownerModel.economics.revenueExposed&&ownerModel.economics.revenueExposed.low>0);
  assert(ownerModel.economics.recoverableRevenue&&ownerModel.economics.recoverableRevenue.conservative>0);

  const normalized=normalizeReview({primaryOpportunityId:'manual-1',primaryOpportunity:{title:'Plain owner language'},hideFindingIds:['weak-1'],addFindings:[{id:'manual-1',title:'Manual finding',diagnosis:'Human observed.',recommendedFix:'Fix it.'}],reportCopy:{hero:{headline:'Manual hero'},fixVisual:{body:'Concrete fix explanation.'}},visuals:{beforeImage:'/tmp/before.png',afterImage:'/tmp/after.png'}},{primaryOpportunityId:'fallback'});
  assert.equal(normalized.schemaVersion,'2.3.0');
  assert.equal(normalized.primaryOpportunityId,'manual-1');
  assert.equal(normalized.reportCopy.hero.headline,'Manual hero');
  assert.equal(normalized.reportCopy.fixVisual.body,'Concrete fix explanation.');
  assert.equal(normalized.visuals.beforeImage,'/tmp/before.png');
  assert.equal(normalized.visuals.afterImage,'/tmp/after.png');

  const html=reviewHtml();
  assert(html.includes('Studio disconnected'));
  assert(html.includes('Studio connected ✓'));
  assert(html.includes('Each report area is edited in one place'));
  assert(!html.includes('onclick="selectPrimary'));
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.equal(scripts.length,2,'Expected bootstrap + main browser scripts');
  scripts.forEach((script,i)=>assert.doesNotThrow(()=>new vm.Script(script,{filename:'owner-review-browser-'+i+'.js'}),'Emitted browser JS must parse'));

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eden-v2244-'));
  const beforeImage=path.join(tmp,'before.png');
  const afterImage=path.join(tmp,'after.png');
  const facebookImage=path.join(tmp,'facebook.png');
  const commentImage=path.join(tmp,'comment.png');
  fs.writeFileSync(beforeImage,Buffer.from('89504e470d0a1a0a','hex'));
  fs.writeFileSync(afterImage,Buffer.from('89504e470d0a1a0b','hex'));
  fs.writeFileSync(facebookImage,Buffer.from('89504e470d0a1a0c','hex'));
  fs.writeFileSync(commentImage,Buffer.from('89504e470d0a1a0d','hex'));
  manifest.desktop={screenshots:{hero:beforeImage}};
  manifest.mobile={screenshots:{hero:afterImage}};
  manifest.googleBusinessProbe={conversionDestination:{screenshot:beforeImage}};
  manifest.facebookProbe={screenshots:{desktop:facebookImage},probeDiagnostics:{commentPostDiscovery:{commentScreenshots:[commentImage,commentImage]}}};
  const evidenceShots=chooseEvidenceScreenshots(manifest);
  assert.deepEqual(evidenceShots.map(x=>x.label),['desktop-first-visit','mobile-first-visit','facebook-public-desktop']);
  assert(!evidenceShots.some(x=>x.label.startsWith('facebook-comment-surface-')));
  manifest.outputDir=tmp;
  const snapshot=path.join(tmp,'snapshot.json');
  fs.writeFileSync(snapshot,JSON.stringify(manifest,null,2));
  const {server,reviewPath}=createReviewApp({snapshotPath:snapshot,port:0,openBrowser:false});
  await waitListening(server);
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const stateResponse=await fetch(base+'/api/state');
    assert.equal(stateResponse.status,200);
    const apiState=await stateResponse.json();
    assert.equal(apiState.version,'2.3.0');
    assert.equal(apiState.clinic.name,'Jorgio Dental Health Care Clinic');
    assert.equal(apiState.economics.currency,'PHP');
    assert.equal(apiState.economics.status,'scenario-calculated');

    const ids=['appError','connection','status','clinic','risk','recover','candidates','primarySelect','title','diagnosis','fix','eden','note','cover','fixImage','beforeImage','afterImage','manuals','copyFields','heroFields','coreFields','visualFields','solutionFields','addFindingBtn','saveBtn','openBtn','reloadBtn','resetBtn'];
    const elements=new Map(ids.map(id=>[id,new FakeElement('div',id)]));
    elements.get('primarySelect').tagName='SELECT';
    ['title','diagnosis','fix','eden','note'].forEach(id=>elements.get(id).tagName='TEXTAREA');
    ['cover','fixImage','beforeImage','afterImage'].forEach(id=>elements.get(id).tagName='INPUT');
    const windowListeners={};
    const sandbox={
      console,Intl,Math,Date,JSON,Set,Promise,Number,String,Error,
      confirm:()=>true,
      fetch:(url,options)=>fetch(base+url,options),
      document:{
        getElementById:id=>elements.get(id)||null,
        createElement:tag=>new FakeElement(tag),
      },
      window:{
        addEventListener:(type,fn)=>{(windowListeners[type]||(windowListeners[type]=[])).push(fn);}
      }
    };
    sandbox.window.window=sandbox.window;
    sandbox.window.document=sandbox.document;
    const context=vm.createContext(sandbox);
    new vm.Script(scripts[0],{filename:'owner-review-bootstrap.js'}).runInContext(context);
    new vm.Script(scripts[1],{filename:'owner-review-app.js'}).runInContext(context);
    await vm.runInContext('loadState()',context);
    assert.equal(elements.get('connection').textContent,'Studio connected ✓');
    assert(elements.get('clinic').textContent.includes('Jorgio Dental Health Care Clinic'));
    assert(elements.get('risk').textContent.includes('₱'));
    assert(elements.get('recover').textContent.includes('₱'));

    const candidateId=apiState.candidates[0].id;
    vm.runInContext('selectPrimary('+JSON.stringify(candidateId)+')',context);
    assert.equal(vm.runInContext('state.review.primaryOpportunityId',context),candidateId);
    vm.runInContext('toggleHide('+JSON.stringify(candidateId)+')',context);
    assert.equal(vm.runInContext('hidden.has('+JSON.stringify(candidateId)+')',context),true);
    const beforeManual=vm.runInContext('manuals.length',context);
    vm.runInContext('addManual()',context);
    assert.equal(vm.runInContext('manuals.length',context),beforeManual+1);
    vm.runInContext("manuals[manuals.length-1].title='Human-added finding'",context);

    elements.get('primarySelect').value=candidateId;
    elements.get('title').value='Reviewed primary opportunity';
    elements.get('diagnosis').value='Reviewer-confirmed diagnosis.';
    elements.get('fix').value='Reviewer-confirmed fix.';
    elements.get('eden').value='Eden implementation wording.';
    elements.get('beforeImage').value=beforeImage;
    elements.get('afterImage').value=afterImage;
    vm.runInContext("setCopy('hero.headline','Reviewer-written hero')",context);
    vm.runInContext("setCopy('decision.riskValue','₱31,000')",context);
    vm.runInContext("setCopy('fixVisual.heading','How Jorgio recovers missed inquiries')",context);
    vm.runInContext("setCopy('fixVisual.body','Every missed inquiry gets an immediate response and booking help.')",context);
    vm.runInContext("setCopy('trySolution.evidenceButton','See Jorgio evidence →')",context);
    await vm.runInContext('save()',context);
    const saved=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
    assert.equal(saved.schemaVersion,'2.3.0');
    assert.equal(saved.primaryOpportunity.title,'Reviewed primary opportunity');
    assert.equal(saved.reportCopy.hero.headline,'Reviewer-written hero');
    assert.equal(saved.reportCopy.decision.riskValue,'₱31,000');
    assert.equal(saved.reportCopy.fixVisual.heading,'How Jorgio recovers missed inquiries');
    assert.equal(saved.visuals.beforeImage,beforeImage);
    assert.equal(saved.visuals.afterImage,afterImage);
    assert(saved.addFindings.length>=1);
    assert(saved.hideFindingIds.includes(candidateId));
    assert(fs.existsSync(path.join(tmp,'owner-report','index.html')));
    const generatedHtml=fs.readFileSync(path.join(tmp,'owner-report','index.html'),'utf8');
    assert(generatedHtml.includes('Reviewer-written hero'));
    assert(generatedHtml.includes('₱31,000'));
    assert(generatedHtml.includes('How Jorgio recovers missed inquiries'));
    assert(generatedHtml.includes('See Jorgio evidence →'));
    assert(generatedHtml.includes('evidence/index.html'));
    assert(generatedHtml.indexOf('class="evidence-row"')<generatedHtml.indexOf('class="try-card"'),'Evidence link should sit immediately above the receptionist CTA.');
    assert(generatedHtml.includes('assets/before-fix.png'));
    assert(generatedHtml.includes('assets/after-fix.png'));
    assert(!generatedHtml.includes('What already works'));
    assert(!generatedHtml.includes('Free Proof Period'));
    assert(!generatedHtml.includes('Supporting patient path'));
    const evidenceHtmlPath=path.join(tmp,'owner-report','evidence','index.html');
    assert(fs.existsSync(evidenceHtmlPath));
    const evidenceHtml=fs.readFileSync(evidenceHtmlPath,'utf8');
    assert(evidenceHtml.includes('Evidence behind the estimate'));
    assert(evidenceHtml.includes('How the estimate was built'));
    assert(evidenceHtml.includes('What this evidence does—and does not—prove'));
    assert(evidenceHtml.includes('assets/evidence-1.png'));
    assert(evidenceHtml.includes('What the controlled test recorded'));
    assert(!evidenceHtml.includes('Facebook Comment Surface'));
    assert(fs.existsSync(path.join(tmp,'owner-report','evidence','assets','evidence-1.png')));

    await vm.runInContext('openReport()',context);
    assert.equal(elements.get('status').textContent,'Audit opened');
    await vm.runInContext('resetReview()',context);
    assert.equal(elements.get('status').textContent,'Review reset');
    const reset=JSON.parse(fs.readFileSync(reviewPath,'utf8'));
    assert.equal(reset.schemaVersion,'2.3.0');
    assert.deepEqual(reset.addFindings,[]);

    // Visible failure state: sever fetch and verify load failure is surfaced instead of hanging on Loading clinic…
    context.fetch=async()=>{throw new Error('simulated disconnect');};
    await vm.runInContext('loadState()',context);
    assert.equal(elements.get('connection').textContent,'Studio disconnected');
    assert(elements.get('appError').textContent.includes('simulated disconnect'));
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
  console.log('V2.3.0 cumulative Owner Review Studio regression tests passed.');
})().catch(error=>{console.error(error);process.exit(1);});
