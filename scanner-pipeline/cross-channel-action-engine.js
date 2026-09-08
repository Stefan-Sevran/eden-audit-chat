const fs = require('fs');

const VERSION = '2.2.38';
const {normalizeResponseBenchmark,buildPostSubmissionPath}=require('./post-submission-response');

function finite(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
}
function clamp(v,min=0,max=100){ return Math.max(min,Math.min(max,v)); }
function confidenceValue(v){ return v==='high'?0.95:v==='medium'?0.78:v==='low'?0.6:0.72; }
function commercialRelevanceValue(v){ return v==='primary'?1:v==='supported'?0.9:v==='secondary'?0.72:v==='unknown'?0.58:1; }
function priorityIndex(impact, confidence, effort, commercialRelevance='supported'){
  const c = typeof confidence === 'number' ? confidence : confidenceValue(confidence);
  const e = clamp(Number(effort)||50,15,100);
  const effortFactor = 1.3 - (e/100)*0.6; // 1.21 at very easy → 0.70 at very hard
  return Math.round(clamp((Number(impact)||0) * c * effortFactor * commercialRelevanceValue(commercialRelevance),0,100));
}
function loadRevenueInputs(filePath){
  if(!filePath) return null;
  try { return JSON.parse(fs.readFileSync(filePath,'utf8')); }
  catch(error){ return {__error:String(error.message||error),__path:filePath}; }
}
function facebookDemandObserved(manifest,fbv={}){
  const r=manifest.facebook?.assessment?.responseMetrics||{};
  const explicit=finite(r.scoringObservedIntentComments);
  const probable=finite(r.observedIntentComments);
  const visual=fbv.demandVisibility?.assessment;
  return (explicit!==null&&explicit>0)||(probable!==null&&probable>0)||['strong','adequate'].includes(visual);
}
function addCandidate(list, x){
  if(!x || !x.id || list.some(y=>y.id===x.id)) return;
  const confidence=x.confidence||'medium';
  const impact=clamp(x.impact??60); const effort=clamp(x.effort??50,15,100);
  const commercialRelevance=x.commercialRelevance||'supported';
  list.push({...x,impact,effort,confidence,commercialRelevance,priorityIndex:priorityIndex(impact,confidence,effort,commercialRelevance)});
}
function buildActionEngine(manifest,{responseBenchmark=null}={}){
  const list=[];
  const response=normalizeResponseBenchmark(responseBenchmark||manifest.postSubmissionResponseBenchmark||null);
  const postSubmissionPath=buildPostSubmissionPath(responseBenchmark||manifest.postSubmissionResponseBenchmark||null);
  const conditional=[];
  const b=manifest.bookingFlow||{};
  const fbv=manifest.aiAuditIntelligence?.facebookVisualAssessments||{};
  const gb=manifest.googleBusiness?.evidence?.branches?.[0]||{};
  const gd=gb.conversionDestination||manifest.googleBusinessProbe?.conversionDestination||{};
  const gbd=gb.bookingDestination||manifest.googleBusinessProbe?.bookingDestination||{};
  const ai=manifest.aiAuditIntelligence||{};
  const summary=manifest.summary||{};
  const websiteMessenger=summary.messengerVisible===true || summary.messengerWhatsappVisible===true;
  const websitePhone=summary.phoneActionable===true;
  const websiteBooking=summary.onlineBookingVisible===true || summary.bookingCtaVisible===true;
  const humanResponseChannels=[websiteMessenger?'Messenger':null,websitePhone?'phone':null].filter(Boolean);
  const googleIdentityQualified = gb.discovery?.matched===true && ['medium','high'].includes(gb.discovery?.matchConfidence) && gb.identityIsolation?.status!=='quarantined';
  const unresolvedFacebookIdentityConflict = (ai.conflicts||[]).some(c=>c?.humanReviewRequired && c?.claimId==='facebook-destination-clinic-page' && String(c?.severity||'').toLowerCase()==='high');

  if(b.analyzed && (b.manualConfirmationDetected || finite(b.responseWithinDays)>=1)){
    addCandidate(list,{
      id:'booking-immediate-response',pillar:'website',title:'Turn booking requests into immediate conversations',
      diagnosis:`Online appointment requests rely on ${b.manualConfirmationDetected?'manual staff confirmation':'follow-up'}${finite(b.responseWithinDays)>=1?` and may take up to ${finite(b.responseWithinDays)} day(s) for a response`:''}.`,
      action:'Add immediate acknowledgement plus an Eden-assisted response/triage handoff so patients know what happens next without waiting for manual discovery.',
      impact:96,effort:42,confidence:'high',evidenceType:'deterministic-booking-flow',
      evidence:[b.manualConfirmationDetected?'manual confirmation verified':null,finite(b.responseWithinDays)>=1?`stated response window: ${finite(b.responseWithinDays)} day(s)`:null].filter(Boolean),
      revenueMechanism:'Recover appointment requests that cool off, duplicate-book elsewhere, or abandon while awaiting confirmation.'
    });
  }
  if(b.analyzed && finite(b.minimumAdvanceDays)>=2){
    addCandidate(list,{
      id:'near-term-demand-route',pillar:'website',title:'Create a fast path for near-term and urgent demand',
      diagnosis:`Website booking requires at least ${finite(b.minimumAdvanceDays)} days’ advance notice${b.urgentFallbackDetected?' and redirects urgent/same-day demand to phone':''}.`,
      action:'Place a prominent “Need something sooner?” route into phone/WhatsApp/LINE or Eden AI triage at the booking decision point.',
      impact:92,effort:34,confidence:'high',evidenceType:'deterministic-booking-flow',
      evidence:[`minimum advance notice: ${finite(b.minimumAdvanceDays)} days`,b.urgentFallbackDetected?'urgent/same-day phone fallback verified':null].filter(Boolean),
      revenueMechanism:'Recover high-intent patients whose preferred appointment horizon does not fit the standard web form.'
    });
  }
  const req=finite(b.totalLogicalRequiredFieldCount ?? b.totalRequiredFieldCount);
  if(b.analyzed && req!==null && req>=7){
    addCandidate(list,{
      id:'booking-field-friction',pillar:'website',title:'Collect less information before the booking is secured',
      diagnosis:`The scanner verified ${req} logical required patient questions across the safely reached booking states${b.measurementCompleteness?.unknownLaterStepBurden?' while later-step burden remains unknown':''}.`,
      action:'Keep only reservation/triage essentials before provisional booking; collect lower-priority intake details afterward.',
      impact:78,effort:46,confidence:b.measurementCompleteness?.fullyTraversed?'high':'medium',evidenceType:'deterministic-booking-flow',
      evidence:[`${req} logical required questions verified`,finite(b.rawRequiredFieldCount)!==null && finite(b.rawRequiredFieldCount)>req?`${finite(b.rawRequiredFieldCount)} raw required controls collapsed into logical questions`:null].filter(Boolean),revenueMechanism:'Reduce form abandonment before an appointment request reaches the clinic.'
    });
  }
  // V2.2.35: when a strong clinic website explicitly routes patients into human-response
  // channels, the commercially important unanswered question is response -> booking, not
  // necessarily another surface-level website tweak. This is a verification/recovery
  // transition, not a claim that the clinic is currently losing a specific amount.
  if(humanResponseChannels.length){
    const strongResponse=response?.status==='normalized' && response.interpretation?.strongObserved && response.bookingOffer?.status==='observed';
    const failedResponse=response?.status==='normalized' && response.interpretation?.noMeaningfulResponseWithin24h;
    if(!strongResponse){
      addCandidate(list,{
        id:'human-response-revenue-transition',pillar:'operations',title:failedResponse?'Recover submitted leads that receive no meaningful response':'Measure and recover the website-to-response handoff',
        diagnosis:failedResponse
          ? `A controlled response benchmark observed a submitted patient inquiry but no meaningful human/human-like response within the ${response.observationWindowHours||24}-hour observation window. Automated acknowledgements, if present, are not counted as meaningful responses.`
          : `The website clearly routes patient intent into ${humanResponseChannels.join(' and ')}${websiteBooking?' alongside online booking':''}, but first-response speed, missed/delayed inquiries and inquiry-to-booking conversion are not yet measured.`,
        action:'Instrument every submitted lead through acknowledgement, meaningful response, booking offer and confirmation. Connect supported entry points to Eden for instant acknowledgement, AI/human response, silent-lead follow-up and source-to-revenue attribution.',
        impact:failedResponse?98:94,effort:36,confidence:failedResponse?'high':'high',commercialRelevance:'primary',evidenceType:failedResponse?'external-response-benchmark':'website-patient-channel-routing',
        evidence:[failedResponse?`no meaningful response observed within ${response.observationWindowHours||24}h`:null,response?.interpretation?.autoReplyOnly?'automated acknowledgement observed, but it did not count as a meaningful response':null,websiteMessenger?'Messenger is visibly presented as a patient contact/booking route':null,websitePhone?'Phone is directly actionable from the website':null,websiteBooking?'Online booking is also visible':null].filter(Boolean),
        revenueMechanism:'Recover patients who already expressed intent but are lost or delayed between first contact and a booked appointment.',
        ownerInputs:['monthlyWebFormInquiries','monthlyMessengerTextInquiries','monthlyMissedDelayedInquiries','monthlyMissedCalls','leadToBookingRate','averageNewPatientValue']
      });
    }
  }

  if(googleIdentityQualified && gbd.status==='probed' && gbd.classification==='third-party-booking-marketplace'){
    addCandidate(list,{
      id:'google-booking-ownership',pillar:'google',title:'Own the Google booking relationship instead of handing it to a marketplace',
      diagnosis:`Google’s booking action routes the patient into a third-party booking marketplace${gbd.finalUrl?` (${gbd.finalUrl})`:''}.`,
      action:'Test a clinic-controlled booking/Eden receptionist destination so the clinic keeps the patient relationship, source attribution, follow-up and conversion data.',
      impact:90,effort:38,confidence:'high',commercialRelevance:'supported',evidenceType:'google-booking-destination-probe',
      evidence:[`booking destination: ${gbd.finalUrl||gbd.targetUrl||'observed'}`,`classification: ${gbd.classification}`],
      revenueMechanism:'Reduce marketplace leakage and keep high-intent Google patients inside a clinic-controlled conversion path.'
    });
  }
  if(googleIdentityQualified && gd.status==='probed' && finite(gd.qualityScore)!==null && finite(gd.qualityScore)<88 && gbd.classification!=='third-party-booking-marketplace'){
    const direct = ['eden-ai-receptionist','direct-clinic-booking'].includes(gd.classification);
    if(!direct) addCandidate(list,{
      id:'google-conversion-destination',pillar:'google',title:'Shorten the Google Maps path from intent to conversation',
      diagnosis:gd.classification==='social-profile'?`Google sends high-intent patients directly into the clinic's Facebook/social presence, scored ${Math.round(finite(gd.qualityScore))}/100 for handoff quality.`:`Google sends patients to a ${String(gd.classification||'general destination').replace(/-/g,' ')} scored ${Math.round(finite(gd.qualityScore))}/100 for destination quality.`,
      action:gd.classification==='social-profile'?'Make the social handoff immediately conversational—surface Message/Call clearly, connect Messenger to Eden 24/7 response, and preserve Google-to-conversation attribution.':'Test a more direct clinic-controlled destination—ideally booking or an Eden 24/7 receptionist—while preserving branch identity and tracking.',
      impact:82,effort:30,confidence:'high',commercialRelevance:(finite(gb.profile?.rating)!==null||finite(gb.profile?.reviewCount)!==null||finite(manifest.googleBusiness?.assessment?.branches?.[0]?.components?.reputationStrength)!==null)?'supported':'unknown',evidenceType:'google-outbound-destination-probe',
      evidence:[`destination: ${gd.finalUrl||gd.targetUrl||'observed'}`,`classification: ${gd.classification}`,`quality: ${Math.round(finite(gd.qualityScore))}/100`,(finite(gb.profile?.rating)==null&&finite(gb.profile?.reviewCount)==null)?'Google demand/reputation importance not established in current evidence':null].filter(Boolean),
      revenueMechanism:'Reduce leakage between Google discovery and the first actionable clinic conversation.',
      demandImportance:(finite(gb.profile?.rating)!==null||finite(gb.profile?.reviewCount)!==null)?'supported':'unproven'
    });
  }
  if(fbv.handoffQuality?.assessment==='weak' && !unresolvedFacebookIdentityConflict){
    const fbMode=ai.facebookSurfaceEvidence?.observationMode||'not_assessable';
    const publicMode=fbMode==='public'||fbMode==='mixed';
    addCandidate(list,{
      id:publicMode?'facebook-logged-out-handoff':'facebook-authenticated-handoff',pillar:'facebook',
      title:publicMode?'Reduce Facebook’s logged-out patient handoff friction':'Improve Facebook’s visible patient handoff',
      diagnosis:fbv.handoffQuality.rationale||'Sampled Facebook views showed substantial handoff friction.',
      action:publicMode?'Verify the live public controls, then make the fastest clinic-owned response path obvious from Facebook and campaign destinations; avoid relying on a login-gated page as the only next step.':'Make the fastest clinic-owned response path obvious in the currently evidenced Facebook surface and verify it across patient entry states.',
      impact:68,effort:48,confidence:fbv.handoffQuality.confidence||'medium',evidenceType:'facebook-visual-reconciliation',
      evidence:[publicMode?'sampled public Facebook screenshots':'sampled authenticated Facebook screenshots'],revenueMechanism:'Reduce loss of prospects who reach Facebook but cannot immediately access a clear patient-response path.'
    });
  }
  if((fbv.receptionistOpportunity?.opportunity==='high' || fbv.receptionistOpportunity?.opportunity==='medium') && !unresolvedFacebookIdentityConflict){
    const candidate={
      id:'facebook-ai-receptionist',pillar:'facebook',title:'Route Facebook patient inquiries into Eden 24/7 response',
      diagnosis:fbv.receptionistOpportunity.rationale,
      action:'Connect supported Messenger/Meta entry points to Eden Core for instant first response, qualification, logging, and clinic handoff.',
      impact:94,effort:58,confidence:fbv.receptionistOpportunity.confidence||'medium',evidenceType:'facebook-visual-reconciliation',
      evidence:['Facebook receptionist opportunity independently assessed'],revenueMechanism:'Recover high-intent social inquiries lost to delayed or inconsistent manual response.'
    };
    if(facebookDemandObserved(manifest,fbv)) addCandidate(list,candidate);
    else conditional.push({...candidate,status:'verify-demand-first',reason:'No defensible patient-inquiry volume or high-intent demand was observed in the sampled evidence.'});
  }
  const fbEng=manifest.facebook?.assessment?.engagementQuality||{};
  if(fbEng.status==='assessed' && ['very-low-visible-engagement','low-visible-engagement'].includes(fbEng.signal)){
    addCandidate(list,{
      id:'facebook-owned-content-engagement',pillar:'facebook',title:'Turn Facebook audience size into patient conversations',
      diagnosis:`Recent clinic-published Facebook content shows ${String(fbEng.signal).replace(/-/g,' ')} across ${fbEng.reliableEngagementSamples||0} reliable clinic-published samples${finite(fbEng.followerCount)!==null?` against a stated audience of ${Math.round(finite(fbEng.followerCount)).toLocaleString()} followers`:''}. Underlying source-page engagement is excluded; clinic-published share-wrapper engagement may count when visibly attributable to the clinic feed item.`,
      action:'Verify organic reach and audience quality in Meta Insights, then concentrate clinic-original and clinic-published treatment content around clear Message/Call patient actions and track inquiry-to-booking conversion.',
      impact:74,effort:44,confidence:'medium',evidenceType:'facebook-owned-content-engagement',
      evidence:[`clinic-published engagement samples: ${fbEng.reliableEngagementSamples||0}`,finite(fbEng.medianVisibleInteractions)!==null?`median visible interactions: ${finite(fbEng.medianVisibleInteractions)}`:null].filter(Boolean),
      revenueMechanism:'Convert more of the clinic’s existing Facebook attention into measurable patient conversations rather than relying on nominal follower count.'
    });
  }

  // Treat visual/scanner conflicts as verification tasks, not growth opportunities.
  const conflicts=(ai.conflicts||[]).filter(x=>x.humanReviewRequired);
  if(unresolvedFacebookIdentityConflict){
    conditional.push({id:'facebook-publication-withheld',pillar:'facebook',title:'Facebook recommendation withheld pending verification',status:'verification-required',confidence:'high',reason:'Authenticated browser and visual evidence conflict on whether the clinic page is actually accessible. No Facebook growth action is published until the conflict is resolved.'});
  }
  list.sort((a,b)=>b.priorityIndex-a.priorityIndex || b.impact-a.impact);
  return {
    schemaVersion:VERSION,
    methodology:{priorityIndex:'Impact × confidence × effort-adjustment × commercial relevance. It ranks actions; it is not a revenue forecast.',impactScale:'0–100 estimated conversion leverage from observed evidence',effortScale:'15–100 relative implementation effort; lower is easier',confidence:'Evidence confidence, not probability of revenue lift.'},
    actions:list.slice(0,8).map((x,i)=>({...x,rank:i+1})),
    topActions:list.slice(0,3).map((x,i)=>({...x,rank:i+1})),
    conditionalActions:conditional,
    patientRevenuePath:{
      stages:['Discovery','Website intent','Channel selection','Lead capture','Submission','Acknowledgement','First meaningful response','Appointment offered','Appointment confirmed','Silent-lead follow-up','Attendance','Revenue'],
      postSubmissionPath,
      primaryTransition:humanResponseChannels.length?(() => {
        const strong=response?.status==='normalized' && response.interpretation?.strongObserved && response.bookingOffer?.status==='observed';
        const failed=response?.status==='normalized' && response.interpretation?.noMeaningfulResponseWithin24h;
        if(strong) return {from:'Appointment offered',to:'Appointment confirmed → attendance → revenue',status:'unmeasured',control:'clinic-controlled',channels:[response.channel].filter(Boolean),reason:'Fast meaningful response and a booking offer were observed. Eden should preserve this strong response operation and measure the downstream appointment-to-revenue transitions instead of manufacturing a response problem.',recommendedIntervention:'Instrument confirmation, attendance and revenue attribution; retain the existing fast-response workflow and add silent-lead recovery only where it is not already operating.'};
        if(failed) return {from:'Submitted inquiry',to:'First meaningful response',status:'observed-leakage',control:response.ownerControl||'mixed-clinic-and-platform',channels:[response.channel].filter(Boolean),reason:`No meaningful response was observed within ${response.observationWindowHours||24} hours. Automated acknowledgements are tracked separately and do not count as a meaningful response.`,recommendedIntervention:'Add instant acknowledgement plus AI/human response and silent-lead recovery, then measure booking confirmation and revenue.'};
        return {from:'Patient inquiry',to:'Clinic response → booked appointment',status:'unmeasured',control:'mixed-clinic-and-platform',channels:humanResponseChannels,reason:'The website already creates and routes intent; the highest-value unanswered question is what happens after the patient chooses a human-response channel.',recommendedIntervention:'Instrument response and booking outcomes; add Eden instant response/missed-inquiry recovery; calculate revenue exposure from clinic operating inputs.'};
      })():null,
      ownerInputs:['monthlyWebFormInquiries','monthlyMessengerTextInquiries','monthlyMissedDelayedInquiries','monthlyMissedCalls','leadToBookingRate','averageNewPatientValue'],
      revenueExposureStatus:'inputs-required',
      responseBenchmarkPlan:humanResponseChannels.includes('Messenger')?{
        channel:'Messenger',status:'permission-required',permissionRequired:true,
        purpose:'Measure first-response time and booking handoff from a realistic patient inquiry.',
        safeguards:['Use an explicitly approved test identity','Do not occupy a real appointment slot','Timestamp inquiry, first response and booking handoff','Disclose/cancel test if a booking is created'],
        metrics:['firstResponseMinutes','answeredWithin5Minutes','qualificationQuality','bookingHandoffObserved']
      }:null,
      proofPeriodCta:'Start Free Proof Period'
    },
    verificationTasks:conflicts.map(c=>({claimId:c.claimId,severity:c.severity,scannerPosition:c.scannerPosition,visualPosition:c.visualPosition})),
    caveat:'Actions are ranked from observed audit evidence. Priority index is comparative and must not be presented as a percentage revenue increase.'
  };
}

function num(v){ const n=finite(v); return n===null?0:Math.max(0,n); }
function rate(v, fallback){ const n=finite(v); if(n===null)return fallback; return n>1?clamp(n,0,100)/100:clamp(n,0,1); }
function midpoint(a,b){ return (Number(a)+Number(b))/2; }
function metricRange(v){
  if(v===null||v===undefined||v==='') return null;
  if(typeof v==='object' && !Array.isArray(v)){
    const low=finite(v.low ?? v.min ?? v.from);
    const high=finite(v.high ?? v.max ?? v.to);
    if(low===null && high===null) return null;
    const lo=Math.max(0,low===null?high:low), hi=Math.max(0,high===null?low:high);
    return {low:Math.min(lo,hi),high:Math.max(lo,hi),base:midpoint(lo,hi),inputType:'reported-range'};
  }
  const n=finite(v); if(n===null)return null;
  const x=Math.max(0,n); return {low:x,base:x,high:x,inputType:'reported-point'};
}
function scenarioRates(i,prefix,defaults){
  const suppliedBase=finite(i[`${prefix}Base`]);
  const low=rate(i[`${prefix}Low`],defaults.low);
  const high=rate(i[`${prefix}High`],defaults.high);
  const base=rate(suppliedBase,defaults.base ?? midpoint(low,high));
  return {conservative:Math.min(low,base,high),base:clamp(base,0,1),upside:Math.max(low,base,high)};
}
function scenarioMoney(volume,rates,bookingRates,attendanceRates,avgValue){
  if(!volume||!avgValue)return null;
  const calc=(v,rr,br,ar)=>Math.round(v*rr*br*ar*avgValue);
  return {
    conservative:calc(volume.low,rates.conservative,bookingRates.conservative,attendanceRates.conservative),
    base:calc(volume.base,rates.base,bookingRates.base,attendanceRates.base),
    upside:calc(volume.high,rates.upside,bookingRates.upside,attendanceRates.upside)
  };
}
function mergeScenarioMoney(rows){
  const valid=rows.filter(Boolean); if(!valid.length)return null;
  return {
    conservative:valid.reduce((s,x)=>s+(x.conservative||0),0),
    base:valid.reduce((s,x)=>s+(x.base||0),0),
    upside:valid.reduce((s,x)=>s+(x.upside||0),0)
  };
}
function legacyRange(x){ return x?{low:x.conservative,high:x.upside}:null; }
function buildRevenueOpportunity(manifest, operationalInputs=null){
  const i=operationalInputs||{};
  if(i.__error) return {schemaVersion:VERSION,status:'invalid-inputs',error:i.__error,inputPath:i.__path||null};
  const inferredCurrency=/philippines|cebu|manila|davao/i.test(String(manifest.clinicIdentity?.location||''))?'PHP':'THB';
  const currency=i.currency||inferredCurrency;
  const avgPatientValue=finite(i.averageNewPatientValue ?? i.averageRevenuePerRecoveredPatient ?? i.averageRevenuePerBookedPatient ?? i.averageBookingValue);

  // Conversion assumptions are deliberately explicit. They can be clinic-reported or scenario assumptions.
  // A recovered lead is NOT treated as a recovered patient automatically.
  const ownerBookingRate=finite(i.leadToBookingRate ?? i.inquiryToBookingRate);
  const bookingRates=ownerBookingRate!==null
    ? {conservative:rate(ownerBookingRate,0),base:rate(ownerBookingRate,0),upside:rate(ownerBookingRate,0)}
    : scenarioRates(i,'leadToBookingRate',{low:.20,base:.30,high:.40});
  const ownerAttendanceRate=finite(i.attendanceRate);
  const attendanceRates=ownerAttendanceRate!==null
    ? {conservative:rate(ownerAttendanceRate,0),base:rate(ownerAttendanceRate,0),upside:rate(ownerAttendanceRate,0)}
    : scenarioRates(i,'attendanceRate',{low:.85,base:.90,high:.95});

  const explicitLeakage=[];
  const broadScenario=[];
  const addLeak=(id,label,value,recoveryPrefix,defaults,basis='reported-leakage')=>{
    const volume=metricRange(value); if(!volume||volume.high<=0)return;
    explicitLeakage.push({id,label,volume,recoveryRate:scenarioRates(i,recoveryPrefix,defaults),basis,formula:'leakage volume × recoverable share × lead→booking rate × attendance rate × average new-patient value'});
  };
  addLeak('missed-calls','Missed calls',i.monthlyMissedCalls,'missedCallRecoveryRate',{low:.18,base:.26,high:.35});
  addLeak('delayed-messages','Missed or delayed patient messages',i.monthlyMissedDelayedInquiries ?? i.monthlyDelayedMessages,'delayedMessageRecoveryRate',{low:.12,base:.20,high:.28});
  addLeak('web-form-unanswered','Unanswered website/form inquiries',i.monthlyWebFormUnansweredInquiries ?? i.monthlyUnansweredWebInquiries,'webFormRecoveryRate',{low:.15,base:.25,high:.40});
  addLeak('booking-abandonment','Booking abandonment',i.monthlyBookingAbandons,'bookingAbandonRecoveryRate',{low:.08,base:.14,high:.20});

  const bookingRequests=metricRange(i.monthlyWebBookingRequests ?? i.monthlyWebFormInquiries);
  if(!explicitLeakage.some(x=>x.id==='booking-abandonment') && bookingRequests && finite(i.bookingAbandonRate)!==null){
    const abandon=rate(i.bookingAbandonRate,0);
    const volume={low:bookingRequests.low*abandon,base:bookingRequests.base*abandon,high:bookingRequests.high*abandon,inputType:'calculated-from-reported-volume'};
    explicitLeakage.push({id:'booking-abandonment',label:'Booking abandonment',volume,recoveryRate:scenarioRates(i,'bookingAbandonRecoveryRate',{low:.08,base:.14,high:.20}),basis:'calculated-leakage',estimatedFrom:'monthlyWebBookingRequests × bookingAbandonRate',formula:'estimated abandoned attempts × recoverable share × lead→booking rate × attendance rate × average new-patient value'});
  }

  // Broad inquiry volumes are used only when there is no explicit overlapping leakage cohort.
  // This prevents a Messenger inquiry from being counted once as total demand and again as delayed demand.
  const messengerVolume=metricRange(i.monthlyMessengerTextInquiries ?? i.monthlyFacebookPatientInquiries);
  if(messengerVolume && !explicitLeakage.some(x=>x.id==='delayed-messages')) broadScenario.push({
    id:'messenger-response',label:'Messenger/text inquiry recovery',volume:messengerVolume,
    recoveryRate:scenarioRates(i,'messengerRecoveryRate',{low:.03,base:.07,high:.12}),basis:'scenario-on-reported-demand',
    formula:'reported inquiry volume × incremental recovery scenario × lead→booking rate × attendance rate × average new-patient value'
  });
  const webVolume=metricRange(i.monthlyWebFormInquiries);
  if(webVolume && !explicitLeakage.some(x=>x.id==='web-form-unanswered') && !explicitLeakage.some(x=>x.id==='booking-abandonment')) broadScenario.push({
    id:'web-form-response',label:'Website/form inquiry recovery',volume:webVolume,
    recoveryRate:scenarioRates(i,'webFormRecoveryRate',{low:.03,base:.08,high:.15}),basis:'scenario-on-reported-demand',
    formula:'reported web/form inquiries × incremental recovery scenario × lead→booking rate × attendance rate × average new-patient value'
  });

  const cohorts=[...explicitLeakage,...broadScenario];
  const calculated=cohorts.map(r=>{
    const opportunity=avgPatientValue?scenarioMoney(r.volume,r.recoveryRate,bookingRates,attendanceRates,avgPatientValue):null;
    return {
      ...r,
      monthlyVolume:{low:Math.round(r.volume.low),base:Math.round(r.volume.base),high:Math.round(r.volume.high)},
      monthlyRevenueOpportunity:legacyRange(opportunity),
      scenarioRevenueOpportunity:opportunity,
      evidenceLabels:{volume:'Reported by clinic',recoveryRate:r.basis==='scenario-on-reported-demand'?'Scenario assumption':'Scenario assumption',leadToBookingRate:ownerBookingRate!==null?'Reported by clinic':'Scenario assumption',attendanceRate:ownerAttendanceRate!==null?'Reported by clinic':'Scenario assumption',averageNewPatientValue:avgPatientValue!==null?'Reported by clinic':'Required input',result:'Calculated by Eden'}
    };
  });
  const scenarioTotal=mergeScenarioMoney(calculated.map(r=>r.scenarioRevenueOpportunity));
  const missing=[];
  if(avgPatientValue===null) missing.push('averageNewPatientValue');
  if(!cohorts.length) missing.push('at least one monthly leakage or inquiry volume (for example monthlyMissedCalls, monthlyMissedDelayedInquiries, monthlyWebFormUnansweredInquiries, monthlyWebFormInquiries, monthlyMessengerTextInquiries)');

  const response=normalizeResponseBenchmark(manifest.postSubmissionResponseBenchmark||null);
  const benchmarkContext=response?.status==='normalized'?{
    channel:response.channel||null,
    strongObserved:!!response.interpretation?.strongObserved,
    noMeaningfulResponseWithin24h:!!response.interpretation?.noMeaningfulResponseWithin24h,
    silentLeadRecoveryObserved:!!response.interpretation?.silentLeadRecoveryObserved,
    firstMeaningfulResponseMinutes:response.firstMeaningfulResponse?.minutes??null,
    policy:'A single controlled benchmark changes diagnostic context, not monthly demand volume. Revenue is never extrapolated from one benchmark without clinic-reported operating volumes.'
  }:null;

  const status=scenarioTotal&&avgPatientValue!==null?'scenario-calculated':'inputs-required';
  const auditSignals={
    bookingManualConfirmation:!!manifest.bookingFlow?.manualConfirmationDetected,
    bookingResponseWithinDays:finite(manifest.bookingFlow?.responseWithinDays),
    minimumAdvanceDays:finite(manifest.bookingFlow?.minimumAdvanceDays),
    googleDestinationQuality:finite(manifest.googleBusiness?.evidence?.branches?.[0]?.conversionDestination?.qualityScore),
    googleDestinationClassification:manifest.googleBusiness?.evidence?.branches?.[0]?.conversionDestination?.classification||null,
    facebookHandoffQuality:manifest.aiAuditIntelligence?.facebookVisualAssessments?.handoffQuality?.assessment||null,
    facebookResponsePerformance:manifest.facebook?.assessment?.responseMetrics?.responseCoveragePercent??null
  };
  return {
    schemaVersion:VERSION,
    status,
    currency,
    modelType:'owner-input-scenario-engine',
    averageNewPatientValue:avgPatientValue,
    averageRevenuePerRecoveredPatient:avgPatientValue, // backward-compatible alias
    monthlyRevenueOpportunity:legacyRange(scenarioTotal),
    monthlyRevenueScenarios:scenarioTotal,
    annualizedRevenueOpportunity:scenarioTotal?{conservative:scenarioTotal.conservative*12,base:scenarioTotal.base*12,upside:scenarioTotal.upside*12,low:scenarioTotal.conservative*12,high:scenarioTotal.upside*12}:null,
    opportunities:calculated,
    missingInputs:missing,
    assumptions:{
      leadToBookingRate:{...bookingRates,source:ownerBookingRate!==null?'reported-by-clinic':'scenario-assumption'},
      attendanceRate:{...attendanceRates,source:ownerAttendanceRate!==null?'reported-by-clinic':'scenario-assumption'},
      note:'Recovery, booking and attendance rates are separate. Eden does not assume every recovered inquiry becomes a paying patient.'
    },
    evidenceLedger:{
      reportedByClinic:['monthly inquiry/leakage volumes supplied in revenue inputs',avgPatientValue!==null?'averageNewPatientValue':null,ownerBookingRate!==null?'leadToBookingRate':null,ownerAttendanceRate!==null?'attendanceRate':null].filter(Boolean),
      observedByEden:[benchmarkContext?'controlled response benchmark':null,manifest.bookingFlow?.analyzed?'public booking journey evidence':null].filter(Boolean),
      scenarioAssumptions:[ownerBookingRate===null?'lead→booking rate range':null,ownerAttendanceRate===null?'attendance rate range':null,'cohort-specific incremental recovery rates'].filter(Boolean),
      calculatedByEden:scenarioTotal?['monthly conservative/base/upside recoverable revenue','annualized conservative/base/upside recoverable revenue']:[]
    },
    ownerInputBrief:{
      purpose:'Estimate recoverable monthly revenue without inventing clinic traffic or treating every rescued inquiry as a patient.',
      preferredInputs:['monthlyWebFormInquiries','monthlyMessengerTextInquiries','monthlyMissedDelayedInquiries','monthlyMissedCalls','leadToBookingRate','averageNewPatientValue'],
      minimumInputs:['averageNewPatientValue','one monthly leakage or inquiry volume'],
      labels:{monthlyWebFormInquiries:'Website/form inquiries per month',monthlyMessengerTextInquiries:'Messenger/text inquiries per month',monthlyMissedDelayedInquiries:'Missed or delayed inquiries per month',monthlyMissedCalls:'Missed calls per month',leadToBookingRate:'Approximate inquiry-to-booking rate',averageNewPatientValue:'Average new-patient revenue'},
      sourcePolicy:'Clinic-reported values may be points or {low, high} ranges. Reported values, scenario assumptions, observed evidence and Eden calculations remain separately labelled.'
    },
    doubleCountReview:{
      status:'guarded',
      rule:'Explicit leakage cohorts take precedence over broader channel-demand cohorts. Do not sum the same patient across missed-call, delayed-message, form, Messenger, Google or booking-abandonment cohorts.',
      suppressedBroadCohorts:[messengerVolume&&explicitLeakage.some(x=>x.id==='delayed-messages')?'messenger-response':null,webVolume&&(explicitLeakage.some(x=>x.id==='web-form-unanswered')||explicitLeakage.some(x=>x.id==='booking-abandonment'))?'web-form-response':null].filter(Boolean),
      productionRequirement:'Deduplicate by lead/conversation/booking ID before client publication when first-party event data is available.'
    },
    benchmarkContext,
    auditSignals,
    measurementPlan:[
      {metric:'Missed calls',source:'clinic telephony / Twilio / call logs',measure:'count calls not answered live; track recovery attempt → booking → attendance → revenue'},
      {metric:'Delayed messages',source:'Messenger / WhatsApp / LINE / website inbox',measure:'count patient-intent messages exceeding response SLA; track first meaningful response separately from auto acknowledgement'},
      {metric:'Website/form inquiries',source:'website forms / booking system',measure:'submission → acknowledgement → meaningful response → booking offer → confirmation'},
      {metric:'Silent-lead follow-up',source:'Eden conversation log',measure:'patient silence after meaningful response or offer → follow-up → booking recovery'},
      {metric:'Revenue attribution',source:'clinic dashboard / RRR',measure:'source → conversation → booking → attendance → confirmed revenue'}
    ],
    measurementReadiness:{
      status:cohorts.length&&avgPatientValue!==null?'scenario-ready':'instrumentation-required',
      objective:'Move from public evidence and owner-reported ranges to patient-level attribution: source → conversation → booking → attendance → confirmed revenue.',
      minimumData:['source/channel','lead or conversation ID','first-contact timestamp','acknowledgement timestamp/type','first meaningful response timestamp','booking status','attendance status','confirmed revenue']
    },
    instrumentationPlan:[
      {source:'Website / forms',capture:'Persist first-party lead ID and source into form/chat/booking events.',events:['lead_submitted','acknowledgement_sent','first_meaningful_response','booking_offered','booking_confirmed','appointment_attended','revenue_confirmed']},
      {source:'Facebook / Messenger',capture:'Meta webhook plus Eden conversation ID and referral/source metadata.',events:['message_received','acknowledgement_sent','first_meaningful_response','silent_lead_followup','booking_confirmed','appointment_attended','revenue_confirmed']},
      {source:'Phone',capture:'Twilio/call-tracking number or clinic call log mapped to Eden lead ID.',events:['call_received','call_missed','recovery_attempted','booking_confirmed','appointment_attended','revenue_confirmed']},
      {source:'LINE / WhatsApp / Viber',capture:'Channel webhook adapter mapped into the same Eden conversation schema.',events:['message_received','first_meaningful_response','booking_confirmed','appointment_attended','revenue_confirmed']}
    ],
    formulaPolicy:'Recoverable revenue = leakage/inquiry cohort × incremental recovery share × inquiry-to-booking rate × attendance rate × average new-patient value. Clinic-specific operating volumes are never invented; missing conversion rates use explicitly labelled conservative/base/upside scenario assumptions.',
    doubleCountGuardrail:'Do not sum the same patient across channels or leakage categories. Broad channel-demand scenarios are suppressed when an overlapping explicit leakage cohort is supplied.'
  };
}

function buildCrossChannelGrowthModel(manifest,{revenueInputs=null,responseBenchmark=null}={}){
  const actions=buildActionEngine(manifest,{responseBenchmark});
  const revenue=buildRevenueOpportunity(manifest,revenueInputs);
  if(actions?.patientRevenuePath){
    actions.patientRevenuePath.revenueExposureStatus=revenue.status;
    actions.patientRevenuePath.revenueModelVersion=VERSION;
    actions.patientRevenuePath.revenueScenario=revenue.monthlyRevenueScenarios||null;
  }
  return {schemaVersion:VERSION,generatedAt:new Date().toISOString(),actions,revenue};
}

module.exports={VERSION,priorityIndex,loadRevenueInputs,buildActionEngine,buildRevenueOpportunity,buildCrossChannelGrowthModel};
