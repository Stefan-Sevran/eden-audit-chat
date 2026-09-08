const assert = require('node:assert/strict');
const { createAuditJobStore } = require('./audit-job-store-v240');
const { createConfirmedAuditJobHook } = require('./audit-job-hook-v240');
const { createAuditWorker } = require('./audit-worker-v240');

(async()=>{
  const calls=[];
  const fakeFetch=async(url,opts={})=>{
    calls.push({url,opts});
    if(url.includes('/rpc/claim_audit_job')) return new Response(JSON.stringify([{id:'j1',session_id:'s1',intake:{status:'confirmed'},delivery:null}]),{status:200});
    if(opts.method==='POST') return new Response(JSON.stringify([{id:'j1',public_token:'tok',status:'queued',stage:'evidence'}]),{status:201});
    if(opts.method==='PATCH') return new Response(JSON.stringify([{id:'j1',status:'review',stage:'review'}]),{status:200});
    return new Response(JSON.stringify([{public_token:'tok',status:'queued',stage:'evidence',report_url:null,updated_at:'now'}]),{status:200});
  };
  const store=createAuditJobStore({supabaseUrl:'https://x.supabase.co',serviceRoleKey:'secret',fetchImpl:fakeFetch});
  const hook=createConfirmedAuditJobHook({auditJobStore:store,logger:{error(){}}});
  const pub=await hook({sessionId:'s1',interview:{status:'confirmed'}});
  assert.equal(pub.publicToken,'tok');
  assert.equal(pub.status,'queued');
  const status=await store.getPublic('tok');
  assert.equal(status.status,'queued');
  const worker=createAuditWorker({auditJobStore:store,runEvidencePipeline:async()=>({evidencePacket:{ok:true}}),logger:{log(){},error(){}}});
  const ran=await worker.runOnce();
  assert.equal(ran.status,'review');
  assert(calls.some(c=>c.url.includes('/rpc/claim_audit_job')));
  console.log('PASS: V2.4.0 durable Audit job store, hook and worker contract.');
})().catch(e=>{console.error(e);process.exit(1)});
