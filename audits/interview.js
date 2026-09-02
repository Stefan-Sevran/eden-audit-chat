const ISO_CURRENCY=/^[A-Z]{3}$/;

const QUESTIONS=[
  {id:'monthlyWebFormInquiries',label:'Website or booking-form inquiries per month',kind:'volume',prompt:'Roughly how many patient inquiries or booking requests arrive through your website each month? A range such as “20–30” is completely fine.'},
  {id:'monthlyMessengerTextInquiries',label:'Messenger or text inquiries per month',kind:'volume',prompt:'About how many patient inquiries arrive through Messenger, LINE, WhatsApp, SMS, or similar text channels each month?'},
  {id:'monthlyMissedDelayedInquiries',label:'Missed or delayed messages per month',kind:'volume',prompt:'Of those messages, roughly how many receive no useful reply—or wait longer than your clinic considers acceptable?'},
  {id:'monthlyMissedCalls',label:'Missed calls per month',kind:'volume',prompt:'About how many patient calls go unanswered each month? Include calls returned later if they were initially missed.'},
  {id:'leadToBookingRate',label:'Inquiry-to-booking rate',kind:'rate',prompt:'Of every 100 genuine patient inquiries, approximately how many become booked appointments?'},
  {id:'attendanceRate',label:'Attendance rate',kind:'rate',prompt:'Of every 100 booked new-patient appointments, approximately how many attend?'},
  {id:'averageNewPatientValue',label:'Average new-patient value',kind:'money',prompt:'Finally, what is the approximate average revenue from a new patient? A conservative estimate or range is best.'}
];

function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function roundUseful(value){return Math.round(value*10000)/10000;}
function cleanText(value){return String(value??'').trim();}
function skipped(value){const text=cleanText(value);return text===''||/^(?:skip|unknown|not sure|unsure|don'?t know|n\/a|na|—|-)$/i.test(text);}
function numericTokens(value){return cleanText(value).replace(/,/g,'').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite)||[];}
function parseRange(value){
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    const low=finite(value.low??value.min??value.from),high=finite(value.high??value.max??value.to);
    if(low===null&&high===null)return null;
    return normalizeRange(low===null?high:low,high===null?low:high);
  }
  if(typeof value==='number')return normalizeRange(value,value);
  const nums=numericTokens(value);if(!nums.length)return null;
  return normalizeRange(nums[0],nums.length>1?nums[1]:nums[0]);
}
function normalizeRange(a,b){const low=Math.max(0,Math.min(a,b)),high=Math.max(0,Math.max(a,b));return low===high?roundUseful(low):{low:roundUseful(low),high:roundUseful(high)};}
function bounds(value){if(value==null)return null;if(typeof value==='object')return {low:Number(value.low),high:Number(value.high)};return {low:Number(value),high:Number(value)};}
function parseAnswer(question,raw){
  const text=cleanText(raw);
  if(skipped(text))return {ok:true,skipped:true,value:null,raw:text};
  if(question.kind==='volume'||question.kind==='money'){
    const value=parseRange(raw);
    if(value===null)return {ok:false,error:'Please enter a number, a range such as 20–30, or “not sure”.'};
    const b=bounds(value),ceiling=question.kind==='money'?100000000:1000000;
    if(b.high>ceiling)return {ok:false,error:`That value looks unusually high. Please confirm it is below ${ceiling.toLocaleString()} or enter a more realistic range.`};
    return {ok:true,value,raw:text};
  }
  if(question.kind==='rate'){
    const value=parseRange(raw);if(value===null)return {ok:false,error:'Please enter a percentage such as 30%, a range such as 25–35%, or “not sure”.'};
    const b=bounds(value);if(b.high>100)return {ok:false,error:'A conversion or attendance rate cannot be above 100%.'};
    const normalized=typeof value==='object'?{low:roundUseful(value.low/100),high:roundUseful(value.high/100)}:roundUseful(value/100);
    return {ok:true,value:normalized,displayValue:value,raw:text};
  }
  return {ok:false,error:'Unsupported interview question.'};
}
function inferCurrency(location,currency){
  const explicit=cleanText(currency).toUpperCase();if(explicit)return ISO_CURRENCY.test(explicit)?explicit:null;
  const place=cleanText(location);if(/philippines|cebu|manila|davao|makati|quezon/i.test(place))return 'PHP';
  if(/thailand|pattaya|bangkok|phuket|chiang mai|chonburi|jomtien/i.test(place))return 'THB';
  return null;
}
function validateClinic(clinic={}){
  const errors=[];let websiteUrl=cleanText(clinic.websiteUrl||clinic.url);
  if(websiteUrl&&!/^https?:\/\//i.test(websiteUrl))websiteUrl=`https://${websiteUrl}`;
  try{if(!websiteUrl||!['http:','https:'].includes(new URL(websiteUrl).protocol))errors.push('A valid clinic website URL is required.');}catch{errors.push('A valid clinic website URL is required.');}
  const clinicName=cleanText(clinic.clinicName||clinic.name),clinicLocation=cleanText(clinic.clinicLocation||clinic.location);
  if(!clinicName)errors.push('Clinic name is required.');if(!clinicLocation)errors.push('Clinic location is required.');
  const currency=inferCurrency(clinicLocation,clinic.currency);if(!currency)errors.push('Enter a three-letter currency code such as THB or PHP.');
  return {ok:!errors.length,errors,clinic:{websiteUrl,clinicName,clinicLocation,currency}};
}
function buildInterview({clinic={},answers={},confirmed=false,mode='owner-interview'}={}){
  const clinicCheck=validateClinic(clinic),errors=[...clinicCheck.errors],warnings=[];const revenueInputs={};const provenance={};
  if(clinicCheck.clinic.currency)revenueInputs.currency=clinicCheck.clinic.currency;
  for(const q of QUESTIONS){
    const parsed=parseAnswer(q,answers[q.id]);
    if(!parsed.ok){errors.push(`${q.label}: ${parsed.error}`);continue;}
    provenance[q.id]={source:'reported-by-clinic',rawAnswer:parsed.raw||null,status:parsed.skipped?'not-provided':'provided'};
    if(!parsed.skipped)revenueInputs[q.id]=parsed.value;
  }
  const delayed=bounds(revenueInputs.monthlyMissedDelayedInquiries),messages=bounds(revenueInputs.monthlyMessengerTextInquiries);
  if(delayed&&messages&&delayed.high>messages.high)errors.push('Missed or delayed text inquiries cannot exceed total Messenger/text inquiries. Please correct one of those answers.');
  if(delayed&&messages&&messages.high===0&&delayed.high>0)errors.push('Delayed messages were reported even though total message inquiries were zero.');
  const avg=bounds(revenueInputs.averageNewPatientValue);if(avg&&avg.low===0)warnings.push('Average new-patient value includes zero; the revenue estimate may be understated.');
  const volumeKeys=['monthlyWebFormInquiries','monthlyMessengerTextInquiries','monthlyMissedDelayedInquiries','monthlyMissedCalls'];
  if(!volumeKeys.some(key=>bounds(revenueInputs[key])?.high>0))warnings.push('No positive monthly inquiry or leakage volume was supplied, so revenue opportunity will remain inputs-required.');
  if(!revenueInputs.averageNewPatientValue)warnings.push('Average new-patient value was not supplied, so revenue opportunity will remain inputs-required.');
  const assumptions=[];
  if(revenueInputs.leadToBookingRate==null)assumptions.push({field:'leadToBookingRate',source:'scenario-assumption',range:'20% / 30% / 40%',reason:'Owner did not provide an inquiry-to-booking rate.'});
  if(revenueInputs.attendanceRate==null)assumptions.push({field:'attendanceRate',source:'scenario-assumption',range:'85% / 90% / 95%',reason:'Owner did not provide an attendance rate.'});
  assumptions.push({field:'cohortRecoveryRates',source:'scenario-assumption',reason:'Eden applies conservative/base/upside recovery shares separately to each inquiry cohort.'});
  return {
    schemaVersion:'2.3.1',status:errors.length?'needs-correction':confirmed?'confirmed':'ready-for-confirmation',mode,
    clinic:clinicCheck.clinic,revenueInputs,provenance,assumptions,warnings,errors,
    integrity:{simulated:mode==='simulated-owner-test',label:mode==='simulated-owner-test'?'SIMULATED OWNER INPUTS — FOR WORKFLOW TESTING ONLY':null,confirmedByOwner:confirmed===true&&mode!=='simulated-owner-test',confirmedForWorkflowTest:confirmed===true&&mode==='simulated-owner-test'},
    confirmedAt:confirmed&&!errors.length?new Date().toISOString():null
  };
}
function displayValue(value,kind){
  if(value==null)return 'Not provided';const format=n=>kind==='rate'?`${Math.round(n*1000)/10}%`:Number(n).toLocaleString('en-US');
  return typeof value==='object'?`${format(value.low)}–${format(value.high)}`:format(value);
}
function confirmationRows(interview){return QUESTIONS.map(q=>({id:q.id,label:q.label,value:interview.revenueInputs[q.id]??null,display:displayValue(interview.revenueInputs[q.id],q.kind),source:interview.provenance[q.id]?.status==='provided'?'Reported by clinic':'Not provided — assumptions remain labelled'}));}

module.exports={QUESTIONS,parseAnswer,inferCurrency,validateClinic,buildInterview,confirmationRows,displayValue};
