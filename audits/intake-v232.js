const {QUESTIONS,buildInterview,confirmationRows,inferCurrency}=require('./interview');

const VERSION='2.3.2e';
const ANSWER_IDS=QUESTIONS.map(x=>x.id);
const BASIC_IDS=['clinicType','clinicName','clinicLocation','websiteUrl'];
const CONTACT_IDS=['contactName','email','whatsapp'];
const UPDATE_IDS=[...BASIC_IDS,'currency',...ANSWER_IDS,...CONTACT_IDS];
const QUESTION_BY_ID=Object.fromEntries(QUESTIONS.map(x=>[x.id,x]));

function text(value){return String(value??'').trim();}
function safeSessionId(value){const id=text(value);return /^[a-zA-Z0-9_-]{12,160}$/.test(id)?id:null;}
function yesLike(value){return /^(?:yes|yep|yeah|ok|okay|correct|confirmed|confirm|that'?s right|looks right|accurate|โอเค|ใช่|ถูกต้อง|oo|opo|tama(?: po)?|sakto|mao na|husto)(?:[,.! ]|$)/i.test(text(value));}
function clone(value){return JSON.parse(JSON.stringify(value));}
function display(value){return value==null||value===''?'Not provided':typeof value==='object'?`${value.low}–${value.high}`:String(value);}
function normalizeUrl(value){let v=text(value);if(!v)return '';if(/^(?:none|no website|n\/a)$/i.test(v))return 'No website supplied';if(!/^https?:\/\//i.test(v)&&/\./.test(v))v=`https://${v}`;try{const url=new URL(v);return ['http:','https:'].includes(url.protocol)?url.toString():v;}catch{return v;}}
function auditReference(sessionId){const day=new Date().toISOString().slice(0,10).replace(/-/g,'');const tail=sessionId.replace(/[^a-z0-9]/gi,'').slice(-8).toUpperCase();return `AUD-${day}-${tail}`;}
function createState(sessionId){return {schemaVersion:VERSION,sessionId,auditReference:auditReference(sessionId),fields:{},inferredFields:{},answers:{},answered:{},ownerConfirmed:false,awaitingConfirmation:false,delivered:false,notified:false,delivery:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
function cleanUpdates(updates={}){const out={};for(const id of UPDATE_IDS){if(updates[id]===undefined||updates[id]===null)continue;const value=text(updates[id]);if(value!=='')out[id]=id==='websiteUrl'?normalizeUrl(value):value;}return out;}
function applyUpdates(state,payload={}){
  const updates=cleanUpdates(payload.updates||payload);
  for(const id of Array.isArray(payload.clearFields)?payload.clearFields:[]){
    if(!UPDATE_IDS.includes(id))continue;
    if(ANSWER_IDS.includes(id)){delete state.answers[id];state.answered[id]=false;}
    else {delete state.fields[id];delete state.inferredFields?.[id];}
  }
  for(const [id,value] of Object.entries(updates)){
    if(ANSWER_IDS.includes(id)){state.answers[id]=value;state.answered[id]=true;}
    else {state.fields[id]=value;delete state.inferredFields?.[id];}
  }
  for(const id of Array.isArray(payload.answeredFields)?payload.answeredFields:[]){if(ANSWER_IDS.includes(id))state.answered[id]=true;}
  state.updatedAt=new Date().toISOString();return state;
}
function deriveObviousBasics(state,user=''){
  if(!state.inferredFields)state.inferredFields={};
  const source=[user,state.fields.clinicName,state.fields.websiteUrl].map(text).filter(Boolean).join(' ');
  const inferred=[];
  const set=(id,value,reason)=>{if(text(state.fields[id]))return;state.fields[id]=value;state.inferredFields[id]={value,reason};inferred.push(id);};
  if(/\b(?:dental|dentist|dentistry|orthodont(?:ic|ics|ist|istry)?)\b/i.test(source))set('clinicType','Dental clinic','Strong wording in the clinic name or public page');
  else if(/\b(?:aesthetic|aesthetics|dermatology|dermatologist|skin clinic)\b/i.test(source))set('clinicType','Aesthetic clinic','Strong wording in the clinic name or public page');
  else if(/\b(?:medical centre|medical center|medical clinic|hospital)\b/i.test(source))set('clinicType','Medical clinic','Strong wording in the clinic name or public page');
  if(/\bpattaya\b/i.test(source))set('clinicLocation','Pattaya, Thailand','Pattaya appears in the clinic name or public page');
  else if(/\bbangkok\b/i.test(source))set('clinicLocation','Bangkok, Thailand','Bangkok appears in the clinic name or public page');
  else if(/\bcebu\b/i.test(source))set('clinicLocation','Cebu, Philippines','Cebu appears in the clinic name or public page');
  else if(/\bmanila\b/i.test(source))set('clinicLocation','Metro Manila, Philippines','Manila appears in the clinic name or public page');
  else if(/\bdavao\b/i.test(source))set('clinicLocation','Davao, Philippines','Davao appears in the clinic name or public page');
  if(inferred.length)state.updatedAt=new Date().toISOString();
  return inferred;
}
function missingFields(state){
  const missing=BASIC_IDS.filter(id=>!text(state.fields[id]));
  for(const id of ANSWER_IDS)if(!state.answered[id])missing.push(id);
  return missing;
}
function nextQuestion(id){
  const map={clinicType:'What type of clinic do you run?',clinicName:'What is the clinic’s name?',clinicLocation:'Which city and country is the clinic in?',websiteUrl:'Does the clinic have a website or main public page I should use? If not, just say no website.',monthlyWebFormInquiries:QUESTION_BY_ID.monthlyWebFormInquiries.prompt,monthlyMessengerTextInquiries:QUESTION_BY_ID.monthlyMessengerTextInquiries.prompt,monthlyMissedDelayedInquiries:QUESTION_BY_ID.monthlyMissedDelayedInquiries.prompt,monthlyMissedCalls:QUESTION_BY_ID.monthlyMissedCalls.prompt,leadToBookingRate:QUESTION_BY_ID.leadToBookingRate.prompt,attendanceRate:QUESTION_BY_ID.attendanceRate.prompt,averageNewPatientValue:QUESTION_BY_ID.averageNewPatientValue.prompt,contact:'Where should Eden send the private Audit—email or WhatsApp?'};
  return map[id]||'Could you tell me a little more about the clinic?';
}
function buildSnapshot(state){
  const currency=text(state.fields.currency)||inferCurrency(state.fields.clinicLocation,'')||'';
  const interview=buildInterview({clinic:{websiteUrl:state.fields.websiteUrl,clinicName:state.fields.clinicName,clinicLocation:state.fields.clinicLocation,currency},answers:state.answers,confirmed:state.ownerConfirmed,mode:'owner-interview'});
  const missing=missingFields(state);const structurallyComplete=missing.length===0;const ready=structurallyComplete&&interview.errors.length===0;
  const contactAvailable=!!(text(state.fields.email)||text(state.fields.whatsapp));
  return {schemaVersion:VERSION,sessionId:state.sessionId,auditReference:state.auditReference,status:state.delivered?'intake-complete':state.ownerConfirmed&&!contactAvailable?'awaiting-delivery-contact':state.ownerConfirmed?'confirmed':ready?'ready-for-confirmation':'collecting',fields:clone(state.fields),inferredFields:clone(state.inferredFields||{}),answers:clone(state.answers),answered:clone(state.answered),ownerConfirmed:state.ownerConfirmed,missingFields:missing,validationErrors:clone(interview.errors),nextQuestion:missing.length?nextQuestion(missing[0]):interview.errors.length?`I noticed one conflict: ${interview.errors[0]} Which figure should I correct?`:state.ownerConfirmed&&!contactAvailable?nextQuestion('contact'):null,readyForConfirmation:ready,contactAvailable,delivery:clone(state.delivery),interview,rows:confirmationRows(interview)};
}
function confirmationText(snapshot){
  const f=snapshot.fields,i=snapshot.interview;const lines=[`Clinic: ${f.clinicName||'Not provided'} · ${f.clinicType||'Clinic'} · ${f.clinicLocation||'Location not provided'}`,`Public page: ${f.websiteUrl||'Not provided'}`];
  for(const row of snapshot.rows)lines.push(`${row.label}: ${row.display}`);
  if(i.assumptions.length)lines.push('Any missing rates remain clearly labelled as Eden scenario assumptions.');
  return `Before I prepare the Audit, please confirm these working estimates:\n\n${lines.join('\n')}\n\nAre these fair estimates for the Audit?`;
}
function modelPrompt(state){const snapshot=buildSnapshot(state);return `You are Mia, Eden Clinic Network's warm, socially intelligent Clinic Revenue Audit Specialist speaking with a clinic owner. Behave like a sharp senior receptionist who takes responsibility for moving the conversation forward.\n\nHold a responsive, natural conversation—not a rigid questionnaire. On every non-final turn: (1) respond briefly to what the owner actually said, (2) answer or clarify their question first, and (3) ask exactly ONE useful next question that advances the Audit. Never end with only a thank-you, acknowledgement, status statement, or “just gathering details” while information is missing. If the owner sounds impatient (for example “Okay, so?”, “What next?”, or repeated prompts), skip pleasantries, briefly explain what is needed, and ask the next question directly. Lightly mirror a playful, direct, or formal tone without becoming unprofessional. Avoid canned praise such as saying clinics play an important role in community health. Explain why a metric matters only when that helps the owner answer.\n\nAcknowledge corrections without defensiveness and continue from the exact point reached. If the owner supplies a different useful field than the one requested, save it and then ask for the still-missing field. Do not ask again for information already stored. Ask at most ONE question per reply. Only stop asking questions when the owner explicitly asks to pause/end, the state is ready for confirmation, delivery contact is required, or intake is complete. Never invent a number or clinic fact. Accept approximate values, ranges, percentages, and “not sure”. Monthly figures must be monthly; clarify if the owner gives an unclear period. Reply in the language of the owner's latest message. English, Thai, Tagalog, and Cebuano are supported. If the owner switches language, switch on that turn; do not mix languages unless the owner does. Never say that the Audit is being prepared, ready, or sent until the structured state says intake-complete.\n\nReturn ONLY JSON with this exact shape:\n{"reply":"short natural reply","updates":{},"clearFields":[],"answeredFields":[],"ownerConfirmed":false}\n\nAllowed update keys: ${UPDATE_IDS.join(', ')}. All update values must be strings. clearFields may contain only allowed update keys and must be used when the owner asks to revise or withdraw a value without supplying its replacement. answeredFields may contain only: ${ANSWER_IDS.join(', ')}. Add a field to answeredFields when the owner gave a value OR explicitly said they do not know. ownerConfirmed may be true only if the owner explicitly confirms a summary that Mia previously presented.\n\nCurrent structured state:\n${JSON.stringify(snapshot)}\n\nPreferred next question if still missing information:\n${snapshot.nextQuestion||'Summarize and ask for confirmation.'}`;}
function socialInferencePrompt(state){return `${modelPrompt(state)}\n\nAdditional intelligence rules: The person may be the owner or an authorized clinic team member; respond naturally to either. Extract every useful fact in a message even when it answers a different question or supplies several fields. Make reasonable high-confidence inferences from explicit clinic names and domains. For example, “Digital Dental Pattaya” strongly implies clinicName “Digital Dental Pattaya”, clinicType “Dental clinic”, and clinicLocation “Pattaya, Thailand”. Save those obvious details, briefly frame them as correctable inferences, and continue to the next genuinely missing field. Never refuse to infer an obvious name clue, demand an exact address, or repeat a question already answered or reliably inferred. Do not infer uncertain operating numbers, revenue, conversion, attendance, or patient behavior. The website is optional: accept “no website” and never claim a valid link is required to proceed. If one message both provides an Audit field and asks a conversational question—such as “digitaldentalpattaya.com; by the way, do you speak Thai?”—save the field, answer the conversational question first, and then ask the next Audit question. Never replace that answer with “I already have that detail noted.”`;}
async function defaultModelTurn({apiKey,history,state,fetchImpl}){
  if(!apiKey)throw new Error('OPENAI_API_KEY is not configured');
  const response=await fetchImpl('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.EDEN_AUDIT_INTAKE_MODEL||'gpt-4.1-mini',temperature:.1,response_format:{type:'json_object'},messages:[{role:'system',content:socialInferencePrompt(state)},...history.slice(-24)]})});
  const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||'Audit intake model request failed');return JSON.parse(data.choices?.[0]?.message?.content||'{}');
}
function realtimeTool(){return {type:'function',name:'save_clinic_audit_progress',description:'Save every clinic fact or operating estimate the owner supplies. Call this after each material answer and again when the owner explicitly confirms the final summary.',parameters:{type:'object',properties:{clinicType:{type:'string'},clinicName:{type:'string'},clinicLocation:{type:'string'},websiteUrl:{type:'string'},currency:{type:'string'},monthlyWebFormInquiries:{type:'string'},monthlyMessengerTextInquiries:{type:'string'},monthlyMissedDelayedInquiries:{type:'string'},monthlyMissedCalls:{type:'string'},leadToBookingRate:{type:'string'},attendanceRate:{type:'string'},averageNewPatientValue:{type:'string'},contactName:{type:'string'},email:{type:'string'},whatsapp:{type:'string'},clearFields:{type:'array',items:{type:'string',enum:UPDATE_IDS},description:'Fields the owner wants to revise or withdraw before giving a replacement.'},answeredFields:{type:'array',items:{type:'string',enum:ANSWER_IDS}},ownerConfirmed:{type:'boolean'},confirmationEvidence:{type:'string',description:'The owner’s exact spoken confirmation words. Required when ownerConfirmed is true.'}},additionalProperties:false}};}
function realtimeInstructions(snapshot){return `You are Mia, Eden Clinic Network's Clinic Revenue Audit Specialist speaking aloud with a clinic owner. Behave like a warm, socially intelligent senior receptionist who takes responsibility for moving the Audit forward. Answer questions first, explain unfamiliar terms plainly, acknowledge corrections naturally, then continue from the exact point reached. Briefly react to what the owner said and ask exactly one useful next question on every non-final turn. If the owner sounds impatient, skip pleasantries and ask directly for the next needed detail. Never end with only a thank-you, acknowledgement, or status statement while required information remains. Avoid generic praise and “just gathering details.” Never invent clinic facts, traffic, conversion, revenue, hours, prices, or availability. Accept ranges and “not sure”. Speak in the language of the owner's latest turn. English, Thai, Tagalog, and Cebuano are supported. If the owner switches language, switch immediately; do not mix languages unless the owner does.\n\nUse save_clinic_audit_progress after every material owner answer. If the owner wants to change a figure but has not supplied the replacement, clear that field and ask for the new estimate. The tool output tells you what is still missing. Follow it, and always ask the next question supplied by the tool before ending your response. When all questions are answered, read a concise summary and ask whether it is fair. Set ownerConfirmed true only after explicit confirmation. Then request an email or WhatsApp destination if still missing. Do not claim the Audit is being prepared, ready, or sent until the tool reports intake-complete.\n\nCurrent state:\n${JSON.stringify(snapshot)}`;}

function claimsPrematureCompletion(value){return /(?:prepare|preparing|prepared|generate|generating|ready|send|sent|deliver).{0,28}(?:audit|report)|(?:audit|report).{0,28}(?:prepare|preparing|prepared|generate|generating|ready|send|sent|deliver)/i.test(text(value));}
function questionLike(value){const valueText=text(value);return /\?|^(?:what|why|how|when|where|who|which|can|could|would|should|does|do|is|are|explain|tell me|หมายถึง|คืออะไร|อะไร|ทำไม|อย่างไร|ano|bakit|paano|unsa|ngano|giunsa)\b/i.test(valueText)||/(?:what.+mean|หมายความว่า|ibig sabihin|pasabot)/i.test(valueText);}
function hasMaterialUpdates(turn={}){return Object.keys(cleanUpdates(turn.updates||turn)).length>0||(Array.isArray(turn.clearFields)&&turn.clearFields.some(id=>UPDATE_IDS.includes(id)));}
function explicitPauseLike(value){return /(?:let'?s?\s+(?:pause|stop|continue(?:\s+this)?\s+later)|continue(?:\s+this)?\s+later|pause(?:\s+this)?\s+for now|stop\s+for now|not\s+now|ไว้ทีหลัง|หยุดก่อน|พักก่อน|mamaya na|itigil muna|pause muna|unya na|hunong sa|padayon ta unya)/i.test(text(value));}
function replyHasQuestion(value){return /[?？]/.test(text(value));}
function ensureForwardMotion(reply,snapshot,user){
  const current=text(reply);
  if(snapshot.status!=='collecting'||!snapshot.nextQuestion||explicitPauseLike(user)||replyHasQuestion(current))return current;
  return current?`${current}\n\n${snapshot.nextQuestion}`:snapshot.nextQuestion;
}
function asksKnownBasic(value,state){
  const reply=text(value);
  const patterns={
    clinicType:/(?:what|which).{0,30}(?:type|kind).{0,20}clinic|what type of clinic/i,
    clinicName:/(?:what|which).{0,25}(?:clinic(?:'s|’s)? name|name of (?:the|your) clinic)/i,
    clinicLocation:/(?:where.{0,25}(?:clinic|located)|clinic.{0,25}(?:located|location)|(?:city|country|full address).{0,30}(?:clinic|operate))/i,
    websiteUrl:/(?:what|which|share|provide|give).{0,35}(?:website (?:url|address)|url|public page|link)|does (?:the|your) clinic have (?:a )?(?:website|public page)|(?:website|url|link).{0,25}(?:should|can) (?:I|we) use/i
  };
  return BASIC_IDS.some(id=>text(state.fields[id])&&patterns[id].test(reply));
}
function languageCapabilityLike(value){return /(?:do|can) you (?:also )?(?:speak|understand)|พูดภาษา|marunong ka|nakakapagsalita ka|makasulti ka|kabalo ka/i.test(text(value));}
function inferredAcknowledgement(state,inferred=[]){
  if(!inferred.length)return 'I already have that detail noted.';
  const details=[];
  if(inferred.includes('clinicType'))details.push(text(state.fields.clinicType).toLowerCase());
  if(inferred.includes('clinicLocation'))details.push(state.fields.clinicLocation);
  const name=text(state.fields.clinicName);
  if(name&&details.length)return `${name} clearly suggests ${details.join(' in ')}, so I’ve noted that—please correct me if needed.`;
  return `I’ve noted ${details.join(' and ')} from the clinic name—please correct me if needed.`;
}
function alignReplyWithState(reply,snapshot,state,inferred=[],user=''){
  if(languageCapabilityLike(user)||snapshot.status!=='collecting'||!snapshot.nextQuestion||!asksKnownBasic(reply,state))return text(reply);
  return `${inferredAcknowledgement(state,inferred)}\n\n${snapshot.nextQuestion}`;
}

function createAuditIntake({openaiApiKey='',fetchImpl=global.fetch,modelTurn=null,onConfirmed=async()=>({ok:true})}={}){
  const states={},histories={};
  const ensure=id=>{if(!states[id])states[id]=createState(id);if(!histories[id])histories[id]=[];return states[id];};
  async function maybeComplete(state){const snapshot=buildSnapshot(state);if(!state.ownerConfirmed||!snapshot.contactAvailable||state.notified)return snapshot;state.notified=true;try{const result=await onConfirmed({sessionId:state.sessionId,snapshot,history:clone(histories[state.sessionId]||[])});if(!result||result.ok!==true)throw new Error('Audit intake could not be delivered');state.delivery=clone(result);state.delivered=true;}catch(error){state.notified=false;throw error;}return buildSnapshot(state);}
  async function handleText({sessionId,message}){const id=safeSessionId(sessionId);if(!id)throw new Error('A valid Audit session ID is required.');const user=text(message);if(!user)throw new Error('A message is required.');const state=ensure(id);const wasAwaitingConfirmation=state.awaitingConfirmation;const history=histories[id];history.push({role:'user',content:user});
    if(wasAwaitingConfirmation&&yesLike(user)){state.ownerConfirmed=true;let confirmedSnapshot=buildSnapshot(state);let confirmedReply='Perfect—I have the confirmed Audit inputs. Where should Eden send the private report: email or WhatsApp?';if(confirmedSnapshot.contactAvailable){confirmedSnapshot=await maybeComplete(state);confirmedReply=`Thank you—your Audit intake has been received. Reference: ${confirmedSnapshot.auditReference}. Eden will now scan the clinic, review the evidence, and prepare your private Clinic Revenue Audit Report.`;}history.push({role:'assistant',content:confirmedReply});histories[id]=history.slice(-50);return {reply:confirmedReply,snapshot:confirmedSnapshot};}
    const turn=await (modelTurn?modelTurn({history:clone(history),state:clone(state)}):defaultModelTurn({apiKey:openaiApiKey,history,state,fetchImpl}));applyUpdates(state,turn);const inferred=deriveObviousBasics(state,user);let snapshot=buildSnapshot(state);if(turn.ownerConfirmed===true&&snapshot.readyForConfirmation&&yesLike(user))state.ownerConfirmed=true;snapshot=buildSnapshot(state);
    let reply=text(turn.reply)||snapshot.nextQuestion||'Thank you. Let me confirm what I have.';
    if(!state.ownerConfirmed&&!snapshot.readyForConfirmation&&claimsPrematureCompletion(reply))reply=snapshot.nextQuestion||'I still need one detail before I can submit the Audit intake.';
    reply=alignReplyWithState(reply,snapshot,state,inferred,user);
    reply=ensureForwardMotion(reply,snapshot,user);
    if(snapshot.readyForConfirmation&&!state.ownerConfirmed){state.awaitingConfirmation=true;if(!wasAwaitingConfirmation||hasMaterialUpdates(turn))reply=confirmationText(snapshot);else if(questionLike(user))reply=text(turn.reply)||'Of course—what would you like me to clarify before you confirm?';}else if(state.ownerConfirmed&&!snapshot.contactAvailable){reply='Perfect—I have the confirmed Audit inputs. Where should Eden send the private report: email or WhatsApp?';}else if(state.ownerConfirmed&&snapshot.contactAvailable){snapshot=await maybeComplete(state);reply=`Thank you—your Audit intake has been received. Reference: ${snapshot.auditReference}. Eden will now scan the clinic, review the evidence, and prepare your private Clinic Revenue Audit Report.`;}
    history.push({role:'assistant',content:reply});histories[id]=history.slice(-50);return {reply,snapshot};}
  async function handleVoice({sessionId,payload}){const id=safeSessionId(sessionId);if(!id)throw new Error('A valid Audit session ID is required.');const state=ensure(id);applyUpdates(state,{updates:payload,clearFields:payload.clearFields,answeredFields:payload.answeredFields});deriveObviousBasics(state,Object.values(payload||{}).filter(value=>typeof value==='string').join(' '));let snapshot=buildSnapshot(state);if(payload.ownerConfirmed===true&&snapshot.readyForConfirmation&&yesLike(payload.confirmationEvidence))state.ownerConfirmed=true;snapshot=buildSnapshot(state);if(state.ownerConfirmed&&snapshot.contactAvailable)snapshot=await maybeComplete(state);return {success:true,snapshot,summary:snapshot.readyForConfirmation?confirmationText(snapshot):null,instruction:snapshot.status==='intake-complete'?`Tell the owner the intake was received and give this reference: ${snapshot.auditReference}. Explain that Eden will now scan and review it.`:snapshot.ownerConfirmed?'Ask where to send the private Audit: email or WhatsApp.':snapshot.readyForConfirmation?'Read the concise summary, then ask the owner to confirm it.':snapshot.nextQuestion};}
  function install(app,expressLib){
    app.post('/audit-chat',async(req,res)=>{try{const result=await handleText(req.body||{});res.json({reply:result.reply,sessionId:result.snapshot.sessionId,intakeStatus:result.snapshot.status,nextField:result.snapshot.missingFields[0]||null,readyForConfirmation:result.snapshot.readyForConfirmation,confirmed:result.snapshot.ownerConfirmed});}catch(error){const clientError=/required/i.test(String(error.message||error));if(!clientError)console.error('Audit intake chat error:',error);res.status(clientError?400:500).json({reply:clientError?'Please refresh the Audit page and try again.':'Small connection issue. Please try again in a moment.',error:clientError?'invalid_audit_request':'audit_intake_unavailable'});}});
    app.post('/audit-voice-intake',async(req,res)=>{try{const result=await handleVoice({sessionId:req.body?.sessionId,payload:req.body||{}});res.json(result);}catch(error){console.error('Audit voice intake error:',error);res.status(400).json({success:false,error:String(error.message||error)});}});
    app.post('/audit-realtime-call',expressLib.text({type:'application/sdp'}),async(req,res)=>{try{if(!openaiApiKey)return res.status(500).send('OPENAI_API_KEY is not configured');const id=safeSessionId(req.query.sessionId);if(!id)return res.status(400).send('A valid sessionId is required');const snapshot=buildSnapshot(ensure(id));const form=new FormData();form.append('sdp',req.body);form.append('session',JSON.stringify({type:'realtime',model:'gpt-realtime',output_modalities:['audio'],tools:[realtimeTool()],tool_choice:'auto',audio:{input:{turn_detection:{type:'semantic_vad',eagerness:'medium',create_response:true,interrupt_response:true}},output:{voice:process.env.EDEN_AUDIT_VOICE||'marin'}},instructions:realtimeInstructions(snapshot)}));const upstream=await fetchImpl('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${openaiApiKey}`},body:form});const body=await upstream.text();if(!upstream.ok)return res.status(upstream.status).send(body);res.status(201).type('application/sdp').send(body);}catch(error){console.error('Audit realtime call error:',error);res.status(500).send('Could not start Audit voice call');}});
  }
  return {install,handleText,handleVoice,getSnapshot:id=>states[id]?buildSnapshot(states[id]):null,_states:states};
}

module.exports={VERSION,ANSWER_IDS,UPDATE_IDS,safeSessionId,yesLike,applyUpdates,deriveObviousBasics,buildSnapshot,confirmationText,realtimeTool,realtimeInstructions,claimsPrematureCompletion,questionLike,hasMaterialUpdates,explicitPauseLike,replyHasQuestion,ensureForwardMotion,asksKnownBasic,languageCapabilityLike,alignReplyWithState,createAuditIntake};
