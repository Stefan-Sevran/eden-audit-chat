const fs=require('fs');

const VERSION='2.2.37';

function finite(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;}
function bool(v){return v===true?true:v===false?false:null;}
function isoMs(v){if(!v)return null;const n=Date.parse(v);return Number.isFinite(n)?n:null;}
function minutesBetween(a,b){const x=isoMs(a),y=isoMs(b);return x!==null&&y!==null&&y>=x?Math.round((y-x)/60000):null;}
function secondsBetween(a,b){const x=isoMs(a),y=isoMs(b);return x!==null&&y!==null&&y>=x?Math.round((y-x)/1000):null;}
function loadResponseBenchmark(filePath){
  if(!filePath)return null;
  try{return JSON.parse(fs.readFileSync(filePath,'utf8'));}
  catch(error){return {__error:String(error.message||error),__path:filePath};}
}
function speedBand(minutes,status){
  if(status==='no-response-observed')return 'no-response-observed';
  const m=finite(minutes); if(m===null)return 'unknown';
  if(m<=15)return 'exceptional';
  if(m<=60)return 'strong';
  if(m<=180)return 'moderate';
  if(m<=720)return 'delayed';
  if(m<=1440)return 'very-delayed';
  return 'no-response-within-24h';
}
function normalizeEvent(raw,name){
  if(!raw)return {name,status:'unknown',at:null,type:null,source:null};
  if(typeof raw==='boolean')return {name,status:raw?'observed':'not-observed',at:null,type:null,source:null};
  const status=raw.status||((raw.observed===true||raw.at)?'observed':raw.observed===false?'not-observed':'unknown');
  return {name,status,at:raw.at||null,type:raw.type||null,source:raw.source||null,evidence:raw.evidence||null};
}
function normalizeResponseBenchmark(raw){
  if(!raw)return null;
  if(raw.__error)return {schemaVersion:VERSION,status:'invalid-input',error:raw.__error,inputPath:raw.__path||null};
  const submittedAt=raw.submittedAt||raw.submission?.at||null;
  const ack=normalizeEvent(raw.acknowledgement,'acknowledgement');
  const meaningful=normalizeEvent(raw.firstMeaningfulResponse,'firstMeaningfulResponse');
  const bookingOffer=normalizeEvent(raw.bookingOffer||raw.appointmentOffered,'bookingOffer');
  const appointmentConfirmed=normalizeEvent(raw.appointmentConfirmed,'appointmentConfirmed');
  const followup=normalizeEvent(raw.proactiveFollowUp||raw.silentLeadFollowUp,'proactiveFollowUp');
  const noResponse=raw.noMeaningfulResponseWithin24h===true || meaningful.status==='not-observed' || meaningful.status==='no-response-observed';
  const responseMinutes=finite(raw.firstMeaningfulResponseMinutes) ?? finite(raw.firstMeaningfulResponse?.minutes) ?? minutesBetween(submittedAt,meaningful.at);
  const acknowledgementSeconds=finite(raw.acknowledgementSeconds) ?? finite(raw.acknowledgement?.seconds) ?? secondsBetween(submittedAt,ack.at);
  const followUpMinutes=finite(raw.proactiveFollowUpMinutes) ?? finite(raw.proactiveFollowUp?.delayMinutes) ?? finite(raw.silentLeadFollowUp?.delayMinutes) ?? minutesBetween(submittedAt,followup.at);
  const responseStatus=noResponse?'no-response-observed':meaningful.status;
  const band=speedBand(responseMinutes,responseStatus);
  const ackAutomated=['automated','auto-reply','system'].includes(String(ack.type||'').toLowerCase());
  const humanish = meaningful.status==='observed' && !['automated','auto-reply','system'].includes(String(meaningful.type||'').toLowerCase());
  const strongObserved = humanish && responseMinutes!==null && responseMinutes<=60;
  return {
    schemaVersion:VERSION,status:'normalized',channel:raw.channel||null,clinicName:raw.clinicName||null,submittedAt,
    observationWindowHours:finite(raw.observationWindowHours)??24,businessHoursAdjusted:bool(raw.businessHoursAdjusted),
    acknowledgement:{...ack,seconds:acknowledgementSeconds,isAutomated:ackAutomated},
    firstMeaningfulResponse:{...meaningful,status:responseStatus,minutes:responseMinutes,speedBand:band,humanOrHumanish:humanish},
    bookingOffer,appointmentConfirmed,proactiveFollowUp:{...followup,minutesFromSubmission:followUpMinutes},
    contactDetailsCaptured:raw.contactDetailsCaptured??null,
    ownerControl:raw.ownerControl||null,
    evidenceSource:raw.evidenceSource||'external-response-benchmark',
    interpretation:{
      strongObserved,
      autoReplyOnly:ack.status==='observed' && ackAutomated && meaningful.status!=='observed',
      silentLeadRecoveryObserved:followup.status==='observed',
      noMeaningfulResponseWithin24h:noResponse
    },
    caveat:'Automated acknowledgements are recorded separately and never count as a meaningful human/human-like response. Response bands are internal calibration labels, not universal industry standards.'
  };
}
function buildPostSubmissionPath(benchmark){
  const b=normalizeResponseBenchmark(benchmark);
  const stages=['Lead capture','Submission','Acknowledgement','First meaningful response','Appointment offered','Appointment confirmed','Silent-lead follow-up','Attendance','Revenue'];
  if(!b || b.status!=='normalized')return {schemaVersion:VERSION,status:b?.status||'not-measured',stages,benchmark:b||null};
  return {
    schemaVersion:VERSION,status:'benchmarked',stages,channel:b.channel,evidenceSource:b.evidenceSource,
    transitions:{
      submission:{status:b.submittedAt?'observed':'unknown',at:b.submittedAt},
      acknowledgement:b.acknowledgement,
      firstMeaningfulResponse:b.firstMeaningfulResponse,
      appointmentOffered:b.bookingOffer,
      appointmentConfirmed:b.appointmentConfirmed,
      silentLeadFollowUp:b.proactiveFollowUp,
      attendance:{status:'unknown'},revenue:{status:'unknown'}
    },
    interpretation:b.interpretation,caveat:b.caveat
  };
}

module.exports={VERSION,loadResponseBenchmark,normalizeResponseBenchmark,buildPostSubmissionPath,speedBand};
