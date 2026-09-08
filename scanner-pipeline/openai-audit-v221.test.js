const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {deterministicClaims,selectedWebsiteScreenshots,callOpenAI,summarizeAgreement}=require('./openai-audit-intelligence');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eden-ai-'));
const d=path.join(dir,'desktop.png'),m=path.join(dir,'mobile.png');
fs.writeFileSync(d,Buffer.from('fakepng'));fs.writeFileSync(m,Buffer.from('fakepng'));
const manifest={summary:{bookingCtaVisible:true,phoneActionable:true,reviewsVisible:false},scoring:{categories:{conversionCta:82,heroClarity:71}},desktop:{screenshots:{hero:d}},mobile:{screenshots:{hero:m}}};
assert(deterministicClaims(manifest).some(x=>x.id==='website-booking-cta-visible'&&x.scannerValue===true));
assert.equal(selectedWebsiteScreenshots(manifest).length,2);
const result={validation:[{status:'confirmed'},{status:'contradicted'},{status:'not_visually_assessable'}],conflicts:[{humanReviewRequired:true}]};
const a=summarizeAgreement(result,3);assert.equal(a.confirmed,1);assert.equal(a.contradicted,1);assert.equal(a.humanReviewConflicts,1);assert.equal(a.status,'human-review-required');

const parsed={validation:[],conflicts:[],visualAssessments:{heroClarity:{assessment:'strong',confidence:'high',rationale:'Clear',evidenceScreenshots:['desktop-first-visit']},primaryActionQuality:{assessment:'strong',confidence:'high',rationale:'CTA',evidenceScreenshots:['desktop-first-visit']},mobileVisualQuality:{assessment:'adequate',confidence:'medium',rationale:'Mobile',evidenceScreenshots:['mobile-first-visit']},trustPresentation:{assessment:'weak',confidence:'medium',rationale:'Trust',evidenceScreenshots:['desktop-first-visit']},perceivedFriction:{assessment:'adequate',confidence:'medium',rationale:'Friction',evidenceScreenshots:['mobile-first-visit']}},narrative:{executiveSummary:'Evidence-backed summary.',costingPatients:'Weak trust presentation may add friction.',topPriorities:[{title:'Strengthen trust',why:'Trust is visually weak.',evidenceBasis:'desktop-first-visit'}],quickWins:[{title:'Add proof',action:'Surface verified patient proof.',evidenceBasis:'scanner + screenshot'}],pillarExplanations:{website:'Website explanation.',googleBusiness:'Awaiting evidence.',facebook:'Awaiting evidence.'},caveats:['Unknown remains unknown.'],edenIntervention:'Connect rapid response after verified gaps.'}};
const fetchImpl=async(url,opts)=>({ok:true,status:200,json:async()=>({id:'resp_test',model:'gpt-test',output_text:JSON.stringify(parsed),usage:{input_tokens:100,output_tokens:50}})});
callOpenAI({apiKey:'test',model:'gpt-test',packet:{claimsForVisualValidation:[]},screenshots:[],fetchImpl}).then(r=>{assert.equal(r.parsed.narrative.executiveSummary,'Evidence-backed summary.');assert.equal(r.responseId,'resp_test');console.log('openai-audit-v221 ok');}).catch(e=>{console.error(e);process.exit(1)});
