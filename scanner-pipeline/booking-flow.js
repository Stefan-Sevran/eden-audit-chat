const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const { ledger, band } = require('./score-ledger');

function chooseBookingTarget(manifest) {
  const candidates = [manifest?.desktop?.ctaMetrics?.primaryCta, manifest?.mobile?.ctaMetrics?.primaryCta,
    ...(manifest?.desktop?.ctaMetrics?.candidates || []), ...(manifest?.mobile?.ctaMetrics?.candidates || [])]
    .filter(Boolean).filter(c => ['booking','consultation'].includes(c.intent) && /^https?:/i.test(c.href || '') && !/(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)/i.test(c.href || ''));
  return candidates[0]?.href || '';
}

function fieldKey(field = {}) {
  return [field.type || '', field.name || '', field.label || '', field.required ? 'required' : 'optional'].join('|').toLowerCase();
}

function normalizeFieldToken(v='') {
  return String(v||'').toLowerCase().replace(/\s+/g,' ').trim();
}

function logicalQuestionKey(field = {}) {
  const type=normalizeFieldToken(field.type);
  const name=normalizeFieldToken(field.name);
  const label=normalizeFieldToken(field.groupLabel || field.label);
  // Checkbox/radio option lists represent one logical patient question, not one
  // question per option. Plugins often mark every option `required`, which is
  // semantically "choose at least one" rather than "choose every option".
  if(['checkbox','radio'].includes(type)) {
    const stableName=name.replace(/\[\]$/,'');
    return `choice-group|${stableName || label || 'unnamed-choice'}`;
  }
  return `field|${type}|${name}|${label}`;
}

function summarizeLogicalQuestions(fields = []) {
  const groups=new Map();
  for(const field of fields||[]) {
    const key=logicalQuestionKey(field);
    if(!groups.has(key)) groups.set(key,{key,type:field.type||'',name:field.name||'',label:field.groupLabel||field.label||'',required:false,optionCount:0,rawFields:0});
    const g=groups.get(key);
    g.required = g.required || !!field.required;
    g.rawFields += 1;
    if(['checkbox','radio'].includes(String(field.type||'').toLowerCase())) g.optionCount += 1;
  }
  const questions=[...groups.values()];
  return {
    questions,
    logicalFieldCount:questions.length,
    logicalRequiredFieldCount:questions.filter(q=>q.required).length,
    groupedChoiceQuestionCount:questions.filter(q=>q.optionCount>1).length
  };
}

function fingerprintInspection(inspected = {}, url = '') {
  const normalized = {
    url: String(url || '').replace(/#.*$/, ''),
    fields: (inspected.fields || []).map(fieldKey).sort(),
    progress: (inspected.progress || []).map(p => `${p.text || ''}|${p.cls || ''}`).sort(),
    headings: (inspected.headings || []).map(x => String(x || '').toLowerCase()).sort(),
    nextButtons: (inspected.nextButtons || []).map(x => String(x.text || '').toLowerCase()).sort(),
    finalButtons: (inspected.finalButtons || []).map(x => String(x || '').toLowerCase()).sort(),
    structuralStepCount: inspected.structuralStepCount || 1,
    activeStep: inspected.activeStep || null,
    calendarVisible: !!inspected.calendarVisible,
    timePickerVisible: !!inspected.timePickerVisible,
    captchaVisible: !!inspected.captchaVisible,
    thirdPartyAdVisible: !!inspected.thirdPartyAdVisible
  };
  return crypto.createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
}

async function inspectCurrentStep(page) {
  return page.evaluate(() => {
    const vis = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0; };
    const body = (document.body?.innerText || '').replace(/\s+/g,' ').trim();
    const visibleForms = Array.from(document.querySelectorAll('form')).filter(vis);
    const scoreForm = form => {
      const fs = Array.from(form.querySelectorAll('input,select,textarea')).filter(vis).filter(el => !['hidden','submit','button'].includes((el.type||'').toLowerCase()));
      const txt = (form.innerText || '').replace(/\s+/g,' ').toLowerCase();
      const bookingTerms = (txt.match(/book|appointment|schedule|preferred date|preferred time|branch|concern|patient|นัด|จอง/g)||[]).length;
      const final = Array.from(form.querySelectorAll('button,input[type="submit"],[role="button"]')).filter(vis).some(el => /(book|appointment|submit|confirm|reserve|send)/i.test((el.innerText||el.value||'').trim()));
      return fs.length * 3 + Math.min(20, bookingTerms * 3) + (final ? 18 : 0);
    };
    const primaryForm = visibleForms.sort((a,b)=>scoreForm(b)-scoreForm(a))[0] || document;
    const fields = Array.from(primaryForm.querySelectorAll('input,select,textarea')).filter(vis).filter(el => !['hidden','submit','button'].includes((el.type||'').toLowerCase()));
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]')).filter(vis).map(el => (el.innerText || '').replace(/\s+/g,' ').trim().slice(0,140)).filter(Boolean).slice(0,12);
    const progressEls = Array.from(document.querySelectorAll('[class*="step" i],[class*="progress" i],[aria-current="step"],[data-step]')).filter(vis);
    const progress = progressEls.map(el=>({text:(el.innerText||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,120), cls:String(el.className||'').slice(0,160)}));
    let activeStep = null;
    for (const el of progressEls) {
      const current = el.getAttribute('aria-current');
      const cls = String(el.className || '');
      const text = (el.innerText || el.getAttribute('data-step') || '').trim();
      if (current === 'step' || /active|current|selected/i.test(cls)) {
        const m = text.match(/\b([1-9])\b/); if (m) { activeStep = Number(m[1]); break; }
      }
    }
    const numericNodes = Array.from(document.querySelectorAll('button,span,div,li')).filter(vis).map(el=>({text:(el.innerText||'').trim(),r:el.getBoundingClientRect(),cls:String(el.className||'')})).filter(x=>/^\d+$/.test(x.text)&&Number(x.text)>=1&&Number(x.text)<=8);
    let structuralStepCount = 1;
    const bands = [];
    for (const n of numericNodes) {
      if (n.r.width > 90 || n.r.height > 90) continue;
      let band=bands.find(b=>Math.abs(b.y-n.r.y)<24); if(!band){band={y:n.r.y,nums:[]};bands.push(band);} band.nums.push(Number(n.text));
    }
    for (const b of bands) {
      const uniq=[...new Set(b.nums)].sort((a,b)=>a-b);
      if (uniq.length>=2 && uniq[0]===1 && uniq.every((n,i)=>i===0||n>=uniq[i-1])) structuralStepCount=Math.max(structuralStepCount, Math.max(...uniq));
    }
    const explicit = body.match(/step\s*(\d+)\s*(?:of|\/)\s*(\d+)/i);
    if (explicit) structuralStepCount=Math.max(structuralStepCount,Number(explicit[2])||1);

    const labels = fields.slice(0,60).map(f => {
      const id=f.id; let label='';
      if(id) label=(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText||'').trim();
      if(!label && f.getAttribute('aria-labelledby')) {
        label = f.getAttribute('aria-labelledby').split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim();
      }
      if(!label) {
        const group = f.closest('.elementor-field-group,.form-group,.field-group,.form-field,.field,[class*="field-group" i]');
        if (group) label = (group.querySelector('label')?.innerText || '').trim();
      }
      if(!label) {
        let prev=f.previousElementSibling;
        for(let i=0;prev&&i<3;i++,prev=prev.previousElementSibling){ if(prev.tagName==='LABEL'||/label/i.test(String(prev.className||''))){label=(prev.innerText||'').trim();break;} }
      }
      if(!label) label=(f.getAttribute('placeholder')||f.getAttribute('aria-label')||'').trim();
      // Avoid a common bad association where a text input inherits the preceding select's label.
      const name=(f.name||'').toLowerCase();
      if ((f.type||'').toLowerCase()==='text' && /prefix|title|mr\.?|mrs\.?|ms\.?/i.test(label) && /name/.test(name)) label='Name';
      const type=(f.type||f.tagName).toLowerCase();
      let groupLabel='';
      if(type==='checkbox'||type==='radio') {
        const group=f.closest('fieldset,.elementor-field-group,.form-group,.field-group,.form-field,.field,[class*=\"field-group\" i]');
        groupLabel=(group?.querySelector('legend')?.innerText || group?.querySelector(':scope > label')?.innerText || group?.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim().slice(0,120);
      }
      return {type,name:f.name||'',label:label.replace(/\s+/g,' ').slice(0,120),groupLabel,choiceValue:(f.value||'').slice(0,120),autocomplete:f.autocomplete||'',required:!!f.required||f.getAttribute('aria-required')==='true'};
    });
    const nextButtons = Array.from(primaryForm.querySelectorAll('button,input[type="button"],a,[role="button"]')).filter(vis).map(el=>({
      text:(el.innerText||el.value||el.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,100),
      tag:el.tagName.toLowerCase(), type:(el.type||'').toLowerCase()
    })).filter(x=>/^(next|continue|proceed|ต่อไป|ถัดไป)$/i.test(x.text));
    const finalButtons = Array.from(primaryForm.querySelectorAll('button,input[type="submit"],[role="button"]')).filter(vis).map(el=>(el.innerText||el.value||'').replace(/\s+/g,' ').trim()).filter(t=>/(confirm|submit|book appointment|complete|finish|reserve)/i.test(t));
    const calendar = !!Array.from(primaryForm.querySelectorAll('[class*="calendar" i],[id*="calendar" i],[class*="datepicker" i],[aria-label*="calendar" i],[role="grid"]')).find(vis);
    const timePicker = /(select\s+(a\s+)?time|appointment time|available times?|time slot)/i.test(body);
    const captchaVisible = !!Array.from(primaryForm.querySelectorAll('[class*=\"captcha\" i],[id*=\"captcha\" i],iframe[src*=\"captcha\" i],iframe[src*=\"hcaptcha\" i],iframe[src*=\"recaptcha\" i]')).find(vis) || /captcha|i am human|i'm human|jag är människa/i.test((primaryForm.innerText||''));
    const visibleAds = Array.from(document.querySelectorAll('iframe,ins,aside,[class*=\"ad-\" i],[id*=\"ad-\" i]')).filter(vis).filter(el => /doubleclick|googlesyndication|googleadservices|adsbygoogle|fiverr|adservice|advert/i.test(`${el.getAttribute('src')||''} ${el.className||''} ${el.id||''} ${el.innerText||''}`));
    const logicalMap=new Map();
    for(const f of labels){
      const type=(f.type||'').toLowerCase();
      const stableName=String(f.name||'').toLowerCase().replace(/\[\]$/,'');
      const groupName=(f.groupLabel||f.label||'').toLowerCase();
      const key=(type==='checkbox'||type==='radio') ? `choice-group|${stableName||groupName}` : `field|${type}|${stableName}|${groupName}`;
      const prior=logicalMap.get(key)||{required:false,optionCount:0};
      prior.required=prior.required||!!f.required;
      prior.optionCount += (type==='checkbox'||type==='radio')?1:0;
      logicalMap.set(key,prior);
    }
    const logicalQuestions=[...logicalMap.values()];
    return { body, headings, fields:labels, fieldCount:fields.length, requiredFieldCount:labels.filter(f=>f.required).length, logicalFieldCount:logicalQuestions.length, logicalRequiredFieldCount:logicalQuestions.filter(f=>f.required).length, groupedChoiceQuestionCount:logicalQuestions.filter(f=>f.optionCount>1).length, structuralStepCount, activeStep, progress:progress.slice(0,20), nextButtons, finalButtons:finalButtons.slice(0,10), calendarVisible:calendar,timePickerVisible:timePicker,captchaVisible,thirdPartyAdVisible:visibleAds.length>0,thirdPartyAdCount:visibleAds.length };
  });
}

async function fillSyntheticStep(page) {
  return page.evaluate(() => {
    const vis = el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'; };
    const fields=Array.from(document.querySelectorAll('input,select,textarea')).filter(vis).filter(el=>!['hidden','submit','button','file'].includes((el.type||'').toLowerCase()));
    let filled=0;
    const setVal=(el,val)=>{ const proto=Object.getPrototypeOf(el); const d=Object.getOwnPropertyDescriptor(proto,'value'); if(d?.set)d.set.call(el,val); else el.value=val; el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));filled++; };
    for(const el of fields){
      if(el.disabled||el.readOnly)continue;
      const label=((el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('placeholder')||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();
      if(el.tagName==='SELECT'){
        const opt=Array.from(el.options).find(o=>o.value && !o.disabled); if(opt)setVal(el,opt.value); continue;
      }
      const type=(el.type||'text').toLowerCase();
      if(type==='checkbox'||type==='radio'){ if(el.required&&!el.checked){el.click();filled++;} continue; }
      if(type==='email') setVal(el,'audit.test@example.com');
      else if(type==='tel') setVal(el,'0946792939');
      else if(type==='date' || /birthday|birth|dob/.test(label)) setVal(el,'1990-01-01');
      else if(type==='number') setVal(el,'1');
      else if(type==='text' || !type) setVal(el,/surname|last/.test(label)?'Patient':/name/.test(label)?'Audit':'Test');
      else if(el.tagName==='TEXTAREA') setVal(el,'Audit test');
    }
    return filled;
  });
}

async function clickSafeNext(page) {
  const locator = page.locator('button,input[type="button"],a,[role="button"]').filter({hasText:/^(Next|Continue|Proceed|ต่อไป|ถัดไป)$/i}).first();
  if (await locator.count().catch(()=>0)) { const ok=await locator.click({timeout:4000}).then(()=>true).catch(()=>false); return ok; }
  const inputs=page.locator('input[type="button"]');
  for(let i=0;i<await inputs.count();i++){ const v=await inputs.nth(i).inputValue().catch(()=> ''); if(/^(Next|Continue|Proceed)$/i.test(v)){return inputs.nth(i).click().then(()=>true).catch(()=>false);} }
  return false;
}

async function waitForMeaningfulStateChange(page, previousFingerprint, options = {}) {
  const timeoutMs = options.stateChangeTimeoutMs || 5000;
  const pollMs = 250;
  const started = Date.now();
  let lastInspection = null;
  let lastFingerprint = previousFingerprint;
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(pollMs);
    lastInspection = await inspectCurrentStep(page).catch(()=>null);
    if (!lastInspection) continue;
    lastFingerprint = fingerprintInspection(lastInspection, page.url());
    if (lastFingerprint !== previousFingerprint) return { changed:true, inspection:lastInspection, fingerprint:lastFingerprint, waitedMs:Date.now()-started };
  }
  return { changed:false, inspection:lastInspection, fingerprint:lastFingerprint, waitedMs:Date.now()-started };
}

function dedupeObservedFields(steps = []) {
  const rawUnique = new Map();
  const logicalUnique = new Map();
  for (const step of steps) {
    for (const field of step.fields || []) {
      // Raw controls are deduped across render states; step fingerprints must not
      // turn the same DOM question into a brand-new patient burden.
      const rawKey = fieldKey(field);
      if (!rawUnique.has(rawKey)) rawUnique.set(rawKey, field);
      const qKey=logicalQuestionKey(field);
      if(!logicalUnique.has(qKey)) logicalUnique.set(qKey,{...field,required:!!field.required,optionCount:0});
      const q=logicalUnique.get(qKey);
      q.required=q.required||!!field.required;
      if(['checkbox','radio'].includes(String(field.type||'').toLowerCase())) q.optionCount=(q.optionCount||0)+1;
    }
  }
  const rawFields=[...rawUnique.values()];
  const logicalFields=[...logicalUnique.values()];
  return {
    rawFieldCount:rawFields.length,
    rawRequiredFieldCount:rawFields.filter(f=>f.required).length,
    totalFieldCount:logicalFields.length,
    totalRequiredFieldCount:logicalFields.filter(f=>f.required).length,
    totalLogicalFieldCount:logicalFields.length,
    totalLogicalRequiredFieldCount:logicalFields.filter(f=>f.required).length,
    groupedChoiceQuestionCount:logicalFields.filter(f=>(f.optionCount||0)>1).length
  };
}

async function analyzeBookingFlow(browser, manifest, options = {}) {
  const targetUrl = chooseBookingTarget(manifest);
  if (!targetUrl) return { analyzed:false, reason:'No navigable booking/consultation URL detected.' };
  const start = manifest.reviewedUrl;
  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, ignoreHTTPSErrors:true });
  const page = await context.newPage();
  const blockedWriteRequests = [];
  await page.route('**/*', async route => {
    const method = route.request().method().toUpperCase();
    if (['POST','PUT','PATCH','DELETE'].includes(method)) {
      blockedWriteRequests.push({ method, url: route.request().url().slice(0,1000) });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  try {
    let response=null,lastErr=null;
    for(let i=0;i<3;i++){try{response=await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:options.timeoutMs||30000});lastErr=null;break;}catch(e){lastErr=e;await page.waitForTimeout(700*(i+1));}}
    if(lastErr)return{analyzed:false,targetUrl,error:lastErr.message};
    await page.waitForLoadState('networkidle',{timeout:7000}).catch(()=>{}); await page.waitForTimeout(650);

    const steps=[]; const transitions=[]; const seenFingerprints=new Set();
    const evidenceDir = manifest?.outputDir ? path.join(manifest.outputDir,'booking-evidence') : null;
    if(evidenceDir) fs.mkdirSync(evidenceDir,{recursive:true});
    let stoppedBeforeSubmission=false, traversalBlocked=false;
    const maxStates=Math.min(6,options.maxBookingStates||5);
    let inspected=await inspectCurrentStep(page);
    for(let stateNo=1;stateNo<=maxStates;stateNo++){
      const fingerprint=fingerprintInspection(inspected,page.url());
      if(seenFingerprints.has(fingerprint)){ traversalBlocked=true; transitions.push({fromState:Math.max(1,stateNo-1),toState:null,status:'duplicate-state',confidence:'verified'}); break; }
      seenFingerprints.add(fingerprint);
      let evidenceScreenshot=null;
      if(evidenceDir){evidenceScreenshot=path.join(evidenceDir,`state-${steps.length+1}-mobile.png`);await page.screenshot({path:evidenceScreenshot,fullPage:false}).catch(()=>{});}
      steps.push({step:steps.length+1,stateStatus:'verified',fingerprint,url:page.url(),evidenceScreenshot,fieldCount:inspected.fieldCount,requiredFieldCount:inspected.requiredFieldCount,logicalFieldCount:inspected.logicalFieldCount,logicalRequiredFieldCount:inspected.logicalRequiredFieldCount,groupedChoiceQuestionCount:inspected.groupedChoiceQuestionCount,fields:inspected.fields,calendarVisible:inspected.calendarVisible,timePickerVisible:inspected.timePickerVisible,captchaVisible:inspected.captchaVisible,thirdPartyAdVisible:inspected.thirdPartyAdVisible,thirdPartyAdCount:inspected.thirdPartyAdCount||0,progress:inspected.progress,headings:inspected.headings,activeStep:inspected.activeStep,structuralStepCount:inspected.structuralStepCount,finalActionVisible:inspected.finalButtons.length>0});
      if(inspected.finalButtons.length>0 && inspected.nextButtons.length===0){stoppedBeforeSubmission=true;break;}
      if(inspected.nextButtons.length===0)break;
      await fillSyntheticStep(page);
      const clicked=await clickSafeNext(page); if(!clicked){traversalBlocked=true;transitions.push({fromState:steps.length,toState:null,status:'next-click-failed',confidence:'verified'});break;}
      const change=await waitForMeaningfulStateChange(page,fingerprint,options);
      if(!change.changed){traversalBlocked=true;transitions.push({fromState:steps.length,toState:null,status:'no-meaningful-change',waitedMs:change.waitedMs,confidence:'verified'});break;}
      transitions.push({fromState:steps.length,toState:steps.length+1,status:'meaningful-change',waitedMs:change.waitedMs,confidence:'verified'});
      inspected=change.inspection;
      await page.waitForLoadState('networkidle',{timeout:3000}).catch(()=>{});
    }

    // Re-open initial page text for explicit operational conditions.
    await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{}); await page.waitForTimeout(300);
    const initialText=(await page.locator('body').innerText().catch(()=>'' )).replace(/\s+/g,' ').trim();
    const manualConfirmation=/(schedule still needs to be reviewed|staff.*confirm|call center.*confirm|appointment.*confirmed by|will contact you to confirm)/i.test(initialText);
    const advanceMatch=initialText.match(/(?:at least|minimum)\s+(\d+)\s+days?\s+in advance/i);
    const responseMatch=initialText.match(/(?:within|in)\s+(one|\d+)\s+days?/i);
    const urgentFallback=/(urgent|same-day|same day).{0,180}(call|contact|phone)/i.test(initialText);
    const loginRequired=/(log\s*in|sign\s*in|create\s+(an\s+)?account|register to book)/i.test(initialText);
    const bookingStateText = steps.map(s => [s.headings||[], (s.fields||[]).map(f=>`${f.label||''} ${f.name||''}`)].flat(3).join(' ')).join(' ');
    const paymentDetected=/(?:deposit|payment)\s+(?:is\s+)?required|(?:required|mandatory)\s+(?:deposit|payment)|pay\s+now|card\s+number|cvv|cvc|billing\s+address|payment\s+method\s*\*/i.test(bookingStateText);
    const captchaDetected=steps.some(s=>s.captchaVisible);
    const thirdPartyAdsDetected=steps.some(s=>s.thirdPartyAdVisible);
    const startHost=new URL(start).hostname.replace(/^www\./,''); const finalUrl=page.url(); const finalHost=new URL(finalUrl).hostname.replace(/^www\./,'');
    const externalProvider=finalHost!==startHost&&!finalHost.endsWith('.'+startHost)&&!startHost.endsWith('.'+finalHost);

    const advertisedVisibleStepCount=Math.max(1,...steps.map(s=>s.structuralStepCount||1));
    const distinctStateCount=steps.length;
    const verifiedFormStepCount=Math.min(advertisedVisibleStepCount, distinctStateCount);
    const reviewOrConfirmationStageCount=Math.max(0,distinctStateCount-advertisedVisibleStepCount);
    const totalInteractionStageCount=distinctStateCount;
    const detectedStepCount=advertisedVisibleStepCount;
    const {rawFieldCount,rawRequiredFieldCount,totalFieldCount,totalRequiredFieldCount,totalLogicalFieldCount,totalLogicalRequiredFieldCount,groupedChoiceQuestionCount}=dedupeObservedFields(steps);
    const fullyTraversed = stoppedBeforeSubmission || (verifiedFormStepCount >= advertisedVisibleStepCount && !traversalBlocked);
    const unknownLaterStepBurden = verifiedFormStepCount < advertisedVisibleStepCount || traversalBlocked;

    const informationBurden = fullyTraversed
      ? Math.max(35, 96 - Math.max(0, totalRequiredFieldCount - 4) * 3 - Math.max(0, totalFieldCount - 10) * 1.5)
      : Math.max(55, 94 - Math.max(0, totalRequiredFieldCount - 4) * 2);
    const hasVisibleProgress=steps.some(s=>s.structuralStepCount>1 || (s.progress||[]).length>0);
    const subScores={
      entryAccessibility:95,
      progressVisibility: advertisedVisibleStepCount>1 ? (hasVisibleProgress?92:65) : 86,
      informationBurden: Math.round(informationBurden),
      stepBurden: Math.max(45,96-Math.max(0,advertisedVisibleStepCount-1)*8-Math.max(0,reviewOrConfirmationStageCount)*5),
      dateTimeAccess: steps.some(s=>s.calendarVisible||s.timePickerVisible)?84:60,
      confirmationImmediacy: manualConfirmation?42:88,
      nearTermAvailability: (advanceMatch&&Number(advanceMatch[1])>=3)?48:(advanceMatch?62:84),
      responseImmediacy: responseMatch?52:86,
      accountPaymentFriction: Math.max(45,96-(loginRequired?32:0)-(paymentDetected?14:0)-(captchaDetected?4:0))
    };
    const weights={entryAccessibility:.08,progressVisibility:.09,informationBurden:.14,stepBurden:.10,dateTimeAccess:.10,confirmationImmediacy:.18,nearTermAvailability:.11,responseImmediacy:.12,accountPaymentFriction:.08};
    const weightedScore=Math.round(Object.entries(weights).reduce((s,[k,w])=>s+subScores[k]*w,0));

    const bookingDeductions=[];
    if(advertisedVisibleStepCount>1){
      const baseMultiStep=Math.min(10,(advertisedVisibleStepCount-1)*4);
      const mitigated=Math.max(0,baseMultiStep-(hasVisibleProgress?2:0));
      if(mitigated>0) bookingDeductions.push({points:mitigated,code:'multi_step',reason:`${advertisedVisibleStepCount} advertised form steps add completion effort${hasVisibleProgress?' (reduced because progress is clearly shown)':''}.`,confidence:'verified'});
    }
    if(reviewOrConfirmationStageCount>0) bookingDeductions.push({points:Math.min(6,reviewOrConfirmationStageCount*4),code:'review_stage',reason:`${reviewOrConfirmationStageCount} additional distinct review/confirmation stage${reviewOrConfirmationStageCount>1?'s':''} were verified beyond the ${advertisedVisibleStepCount} advertised form steps.`,confidence:'verified'});
    if(fullyTraversed){
      if(totalRequiredFieldCount>6) bookingDeductions.push({points:Math.min(12,Math.round((totalRequiredFieldCount-6)*1.3)),code:'required_fields',reason:`${totalRequiredFieldCount} logical required patient questions were verified across the traversed journey.`,confidence:'verified'});
    } else if(totalRequiredFieldCount>4){
      bookingDeductions.push({points:Math.min(6,Math.max(1,(totalRequiredFieldCount-4)*2)),code:'observed_required_fields',reason:`${totalRequiredFieldCount} logical required patient questions were verified in the states safely reached; later-step burden remains unscored.`,confidence:'verified'});
    }
    if(advanceMatch) bookingDeductions.push({points:Number(advanceMatch[1])>=3?9:5,code:'advance_notice',reason:`Website booking requires at least ${Number(advanceMatch[1])} day(s) advance notice.`,confidence:'verified'});
    if(manualConfirmation) bookingDeductions.push({points:11,code:'manual_confirmation',reason:'Staff review/manual confirmation is required before the appointment is confirmed.',confidence:'verified'});
    if(responseMatch) bookingDeductions.push({points:7,code:'response_delay',reason:`The clinic states that a response may take up to ${({'one':1}[String(responseMatch[1]).toLowerCase()]||Number(responseMatch[1])||1)} day(s).`,confidence:'verified'});
    if(urgentFallback) bookingDeductions.push({points:5,code:'same_day_fallback',reason:'Urgent or same-day patients are redirected away from the web flow to phone contact.',confidence:'verified'});
    if(loginRequired) bookingDeductions.push({points:9,code:'login_required',reason:'The patient appears to need an account/login before completing booking.',confidence:'verified'});
    if(paymentDetected) bookingDeductions.push({points:5,code:'payment_required',reason:'A required payment/deposit step was detected in the booking interaction.',confidence:'verified'});
    if(captchaDetected) bookingDeductions.push({points:3,code:'captcha',reason:'A CAPTCHA/human-verification step adds booking effort.',confidence:'verified'});
    if(thirdPartyAdsDetected) bookingDeductions.push({points:5,code:'booking_page_ads',reason:'Visible third-party advertising was detected on the booking surface, competing with the patient task.',confidence:'verified'});

    const avoidedPenalties=[];
    if(!loginRequired) avoidedPenalties.push({code:'no_login',reason:'No account/login requirement was detected, so no account-friction deduction was applied.',confidence:'verified'});
    if(!paymentDetected) avoidedPenalties.push({code:'no_payment',reason:'No payment/deposit requirement was detected before submission, so no payment-friction deduction was applied.',confidence:'verified'});
    const scoreLedger=ledger({baseline:100,deductions:bookingDeductions,credits:[],ceiling:98});
    const observedBookingMechanics = steps.some(s=>s.calendarVisible||s.timePickerVisible||s.finalActionVisible||Number(s.logicalFieldCount||0)>0||Number(s.fieldCount||0)>0) || transitions.length>0;
    const bookingEntryScore=scoreLedger.score;
    // V2.2.35: a visible booking entry point is not the same as a verified end-to-end
    // booking journey. When the scanner never observes fields, date/time controls,
    // a final action or a state transition, publish the strong entry experience but
    // withhold the end-to-end booking score rather than awarding synthetic 80s/90s.
    const bookingJourneyScore=observedBookingMechanics ? bookingEntryScore : null;
    const bookingJourneyBand=bookingJourneyScore==null?'unknown':band(bookingJourneyScore);

    const fieldsByStage=steps.map((s,i)=>({
      stage:i+1,
      stageType:i<advertisedVisibleStepCount?'form-step':'review-or-confirmation',
      verification:'verified', fingerprint:s.fingerprint,
      fieldCount:s.fieldCount, requiredFieldCount:s.requiredFieldCount, logicalFieldCount:s.logicalFieldCount, logicalRequiredFieldCount:s.logicalRequiredFieldCount, groupedChoiceQuestionCount:s.groupedChoiceQuestionCount, fields:s.fields,
      calendarVisible:s.calendarVisible,timePickerVisible:s.timePickerVisible,captchaVisible:!!s.captchaVisible,thirdPartyAdVisible:!!s.thirdPartyAdVisible,thirdPartyAdCount:s.thirdPartyAdCount||0,finalActionVisible:s.finalActionVisible,evidenceScreenshot:s.evidenceScreenshot||null
    }));
    const unvisitedStages=[];
    for(let i=verifiedFormStepCount+1;i<=advertisedVisibleStepCount;i++) unvisitedStages.push({stage:i,stageType:'form-step',verification:'unvisited'});

    return {
      analyzed:true,targetUrl,finalUrl,httpStatus:response?.status()||null,externalProvider,estimatedClickDepth:targetUrl===start?0:1,
      bookingJourneyScore,bookingJourneyBand,bookingEntryScore,bookingEntryBand:band(bookingEntryScore),bookingCompletionVerified:observedBookingMechanics,frictionScore:bookingJourneyScore==null?null:100-bookingJourneyScore,subScores,scoreWeights:weights,scoreLedger,
      scoreReconciliation:{canonicalScore:bookingJourneyScore,entryScore:bookingEntryScore,ledgerScore:scoreLedger.score,weightedDiagnosticScore:weightedScore,reconciled:bookingJourneyScore==null?null:bookingJourneyScore===scoreLedger.score},
      measurementCompleteness:{fullyTraversed,advertisedVisibleStepCount,verifiedFormStepCount,distinctStateCount,reviewOrConfirmationStageCount,totalInteractionStageCount,unknownLaterStepBurden,traversalBlocked},
      visibleFormStepCount:advertisedVisibleStepCount,advertisedVisibleStepCount,verifiedFormStepCount,distinctStateCount,reviewOrConfirmationStageCount,totalInteractionStageCount,
      traversedStageCount:distinctStateCount,traversedStepCount:verifiedFormStepCount,detectedStepCount,totalFieldCount,totalRequiredFieldCount,totalLogicalFieldCount,totalLogicalRequiredFieldCount,rawFieldCount,rawRequiredFieldCount,groupedChoiceQuestionCount,fieldsByStage,unvisitedStages,steps,transitions,stoppedBeforeSubmission,traversalBlocked,avoidedPenalties,
      title:await page.title().catch(()=>''),fieldCount:steps[0]?.fieldCount||0,requiredFieldCount:steps[0]?.requiredFieldCount||0,fieldTypes:steps[0]?.fields||[],
      calendarVisible:steps.some(s=>s.calendarVisible),timePickerVisible:steps.some(s=>s.timePickerVisible),captchaDetected,thirdPartyAdsDetected,loginRequired,paymentDetected,
      manualConfirmationDetected:manualConfirmation,minimumAdvanceDays:advanceMatch?Number(advanceMatch[1]):null,responseWithinDays:responseMatch?({'one':1}[String(responseMatch[1]).toLowerCase()]||Number(responseMatch[1])||null):null,urgentFallbackDetected:urgentFallback,
      writeRequestsBlocked:true, blockedWriteRequests:blockedWriteRequests.slice(0,30),
      textSample:initialText.slice(0,1800)
    };
  } finally { await context.close(); }
}
module.exports={analyzeBookingFlow,chooseBookingTarget,inspectCurrentStep,fingerprintInspection,fieldKey,logicalQuestionKey,summarizeLogicalQuestions,dedupeObservedFields,waitForMeaningfulStateChange};
