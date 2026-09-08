const assert=require('assert');
const {runAuditIntelligence}=require('./openai-audit-intelligence');
(async()=>{
  const old=process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const manifest={findings:{findings:[]}};
  const off=await runAuditIntelligence(manifest,{},{});
  assert.equal(off.status,'not-run');
  assert.equal(off.apiKeyDetected,false);
  assert.ok(/OPENAI_API_KEY/.test(off.reason));
  let requested=null;
  const fakeFetch=async(_url,opts)=>{requested=JSON.parse(opts.body);return {ok:true,json:async()=>({id:'r1',model:'gpt-5.6-terra',output_text:JSON.stringify({validation:[],conflicts:[],visualAssessments:Object.fromEntries(['ctaProminence','firstImpressionTrust','mobileHierarchy','visualClutter','trustPresentation','perceivedFriction'].map(k=>[k,{assessment:'not_assessable',confidence:'low',rationale:'n/a',evidenceScreenshots:[]}])) ,googleBusinessVisualAssessments:Object.fromEntries(['profileIdentity','reputationPresentation','actionAccess','bookingPath','visualTrust'].map(k=>[k,{assessment:'not_assessable',confidence:'low',rationale:'n/a',evidenceScreenshots:[]}])) ,narrative:{executiveSummary:'x',costingPatients:'x',topPriorities:[{title:'x',why:'x',evidenceBasis:'x'}],quickWins:[{title:'x',action:'x',evidenceBasis:'x'}],pillarExplanations:{website:'x',googleBusiness:'x',facebook:'x'},caveats:[],edenIntervention:'x'}})})};};
  const on=await runAuditIntelligence(manifest,{}, {force:true,apiKey:'test-key',model:null,fetchImpl:fakeFetch});
  assert.equal(on.status,'completed');
  assert.equal(on.apiKeyDetected,true);
  assert.equal(requested.model,'gpt-5.6-terra','null model must fall back to default model');
  if(old!=null)process.env.OPENAI_API_KEY=old;
  console.log('openai-audit-v224 tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
