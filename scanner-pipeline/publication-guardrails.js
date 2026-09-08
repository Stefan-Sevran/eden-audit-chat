const VERSION = '2.2.28';

const BLOCKING_CLAIMS = {
  'google-rating': { pillar:'google', field:'rating', label:'Google rating' },
  'google-review-count': { pillar:'google', field:'reviewCount', label:'Google review count' },
  'google-identity-mismatch': { pillar:'google', field:'identity', label:'Google profile identity' },
  'google-destination-classification': { pillar:'google', field:'destination', label:'Google destination identity/classification' },
  'facebook-destination-clinic-page': { pillar:'facebook', field:'destination', label:'Facebook destination accessibility/identity' }
};

function normalizeResolution(value){
  if(!value || typeof value!=='object') return null;
  const allowed=['verified-scanner','verified-visual','corrected','caveated','dismissed'];
  const status=allowed.includes(value.status)?value.status:null;
  if(!status) return null;
  return {status,publicValue:value.publicValue??null,note:value.note||null,reconciledAt:value.reconciledAt||null};
}

function buildPublicationGuardrails(manifest,{humanReview=null}={}){
  const conflicts=(manifest.aiAuditIntelligence?.conflicts||[]).filter(c=>c?.humanReviewRequired);
  const resolutions=humanReview?.claimResolutions||{};
  const verification=[];
  const blockedPillars=new Set();
  const blockedFields={};
  for(const conflict of conflicts){
    const resolution=normalizeResolution(resolutions[conflict.claimId]);
    const map=BLOCKING_CLAIMS[conflict.claimId]||null;
    const high=String(conflict.severity||'').toLowerCase()==='high';
    const resolved=!!resolution;
    const blocksPublication=!!(map && high && !resolved);
    if(blocksPublication){
      blockedPillars.add(map.pillar);
      blockedFields[`${map.pillar}.${map.field}`]={claimId:conflict.claimId,label:map.label};
    }
    verification.push({
      claimId:conflict.claimId,
      severity:conflict.severity||'medium',
      pillar:map?.pillar||'cross-channel',
      field:map?.field||null,
      scannerPosition:conflict.scannerPosition||null,
      visualPosition:conflict.visualPosition||null,
      resolution,
      resolved,
      blocksPublication
    });
  }
  return {
    schemaVersion:VERSION,
    status:verification.some(v=>v.blocksPublication)?'verification-required':'clear',
    blockedPillars:[...blockedPillars],
    blockedFields,
    verification,
    policy:'High-severity conflicts in score-driving facts or channel identity/accessibility withhold the affected public pillar/action until reconciled. Scanner scores remain available internally; human review can verify either source, correct the fact, or publish with an explicit caveat.'
  };
}

function resolvedPublicValue(guardrails,pillar,field,fallback=null){
  const item=(guardrails?.verification||[]).find(v=>v.pillar===pillar&&v.field===field);
  if(!item) return fallback;
  if(item.resolution && item.resolution.publicValue!==null && item.resolution.publicValue!==undefined) return item.resolution.publicValue;
  if(item.resolution?.status==='verified-scanner') return fallback;
  return item.resolved ? fallback : null;
}

module.exports={VERSION,BLOCKING_CLAIMS,buildPublicationGuardrails,resolvedPublicValue};
