const VERSION='2.2.33';
function compact(v=''){return String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\u0E00-\u0E7F]+/g,'');}
function aliases(page={}){
  const vals=[page.pageName,page.handle,String(page.handle||'').replace(/([a-z])([A-Z])/g,'$1 $2')].map(compact).filter(x=>x.length>=5);
  return [...new Set(vals)];
}
function words(v=''){return String(v||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\u0E00-\u0E7F]+/g,' ').trim().split(/\s+/).filter(Boolean);}
function latinTokens(v=''){return words(v).filter(x=>/^[a-z0-9]+$/.test(x)&&x.length>=3);}
function identityTokenSets(page={}){
  const vals=[page.pageName,page.handle,String(page.handle||'').replace(/([a-z])([A-Z])/g,'$1 $2')].filter(Boolean);
  const stop=new Set(['dental','dentist','clinic','center','centre','hospital','medical','the','and','facebook','page']);
  return vals.map(v=>latinTokens(v).filter(t=>!stop.has(t))).filter(a=>a.length>=2);
}
function aliasMatch(v, known=[], tokenSets=[]){
  const c=compact(v);
  if(!!c&&known.some(a=>c===a||c.includes(a)||a.includes(c))) return true;
  const vt=new Set(latinTokens(v));
  return tokenSets.some(ts=>ts.length>=2&&ts.every(t=>vt.has(t)));
}
function visibleAuthors(text=''){
  const t=String(text||'').replace(/\s+/g,' ').trim(); const out=[];
  const patterns=[/([^·]{2,120}?)\s*·\s*Follow\b/ig,/([^·]{2,120}?)'s post\b/ig];
  for(const re of patterns){let m;while((m=re.exec(t))){let a=String(m[1]||'').replace(/^.*?(?:20\+|Facebook)\s+/,'').trim();a=a.split(/Facebook menu|Meta AI|Friends|Memories|Saved|Groups|See more/i).pop().trim();if(a&&a.length<=120)out.push(a);}}
  return [...new Set(out)].slice(0,8);
}
function labelledEngagement(input=''){
  const parts=Array.isArray(input)?input:[input];
  const t=parts.map(v=>String(v||'')).join(' | ').replace(/\s+/g,' ');
  const parseNum=(raw='')=>{raw=String(raw).replace(/,/g,'').toUpperCase();const mult=raw.endsWith('K')?1000:raw.endsWith('M')?1000000:1;const n=parseFloat(raw);return Number.isFinite(n)?Math.round(n*mult):null;};
  const read=(patterns)=>{for(const re of patterns){const m=t.match(re);if(m){const n=parseNum(m[1]);if(n!=null)return n;}}return null;};
  const reactionCount=read([
    /(?:All reactions:\s*)?([\d,.]+[KM]?)\s+(?:reactions?|likes?)\b/i,
    /([\d,.]+[KM]?)\s+people\s+(?:reacted|like this)\b/i,
    /(?:reactions?|likes?)\s*[:·-]?\s*([\d,.]+[KM]?)\b/i,
    /All reactions:\s*([\d,.]+[KM]?)/i
  ]);
  let commentCount=read([
    /([\d,.]+[KM]?)\s+comments?\b/i,
    /comments?\s*[:·-]?\s*([\d,.]+[KM]?)\b/i,
    /view\s+all\s+([\d,.]+[KM]?)\s+comments?\b/i
  ]);
  if(commentCount==null&&/no comments yet|be the first to comment/i.test(t))commentCount=0;
  let shareCount=read([
    /([\d,.]+[KM]?)\s+shares?\b/i,
    /shares?\s*[:·-]?\s*([\d,.]+[KM]?)\b/i
  ]);
  if(shareCount==null&&/no shares yet/i.test(t))shareCount=0;
  return {reactionCount,commentCount,shareCount,semanticBasis:(reactionCount!=null||commentCount!=null||shareCount!=null)?'explicit-labelled-facebook-semantics':null};
}
function median(xs=[]){const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function hasShareWrapper(text=''){
  const t=String(text||'');
  return /facebook\.com\/(?:share\/|share\/p\/|share\/r\/)/i.test(t) || /\bshared\s+(?:a\s+)?(?:post|reel|photo|video)\b/i.test(t);
}
function classifyFacebookContentOwnership(evidence={}){
  const page=evidence.page||{}; const known=aliases(page); const tokenSets=identityTokenSets(page);
  const discovery=evidence?.probe?.probeDiagnostics?.commentPostDiscovery||{};
  const feedCards=Array.isArray(discovery.feedCards)?discovery.feedCards:[];
  const diags=discovery.perPostDiagnostics||[];
  const cardRecords=feedCards.slice(0,10).map((card,i)=>{
    const semanticParts=[String(card.text||''),...(Array.isArray(card.ariaLabels)?card.ariaLabels:[]),...(Array.isArray(card.interactionSignals)?card.interactionSignals.map(x=>[x.label,x.text].filter(Boolean).join(' ')):[])]; const body=semanticParts.join(' ');
    const clinicVisible=aliasMatch(body,known,tokenSets) || (page.handle && String(card.sourceUrl||'').toLowerCase().includes('/'+String(page.handle).toLowerCase()+'/'));
    const authors=visibleAuthors(body); const first=authors[0]||null;
    const foreignAuthors=authors.filter(a=>!aliasMatch(a,known,tokenSets));
    const explicitShare=hasShareWrapper(body) || /facebook\.com\/share\//i.test(body);
    const clinicRouteShare=String(card.route||'').toLowerCase()==='posts' && explicitShare;
    const shareWrapper=(clinicVisible && (explicitShare || foreignAuthors.length>0)) || clinicRouteShare;
    let contentType='unresolved', reason='Feed-card provenance was not sufficient to classify the publisher.';
    if(clinicVisible&&shareWrapper){contentType='clinic-published-share';reason='Clinic publishing wrapper is visible on the feed card and the underlying content is shared/source material.';}
    else if(clinicRouteShare){contentType='clinic-published-share';reason='A Facebook share wrapper was captured directly on the clinic-specific Posts route; the underlying source engagement is not attributed to the clinic.';}
    else if(clinicVisible){contentType='clinic-original';reason='Clinic is visibly the feed-card publisher and no shared-source wrapper is observed.';}
    else if(first){contentType='external-only';reason='Visible feed-card author is another entity and no clinic publishing wrapper is evidenced.';}
    const clinicPublished=/^clinic-/.test(contentType);
    const engagement=clinicPublished?labelledEngagement(semanticParts):{reactionCount:null,commentCount:null,shareCount:null,semanticBasis:null};
    const legacyOwnership=clinicPublished?'clinic-authored':contentType==='external-only'?'clinic-shared-external':'unresolved';
    return {sample:i+1,sourceUrl:card.sourceUrl||null,contentUrls:card.contentUrls||[],contentType,ownership:legacyOwnership,visiblePrimaryAuthor:first,visibleAuthors:authors,shareWrapperObserved:shareWrapper,engagement,engagementEligible:clinicPublished,provenance:'clinic-feed-card',provenanceConfidence:clinicVisible?'high':clinicRouteShare?'medium':'low',reason};
  });
  const diagRecords=diags.map((p,i)=>{
    const states=Array.isArray(p.states)?p.states:[]; const state=[...states].sort((a,b)=>(b.score||0)-(a.score||0))[0]||states[0]||{};
    const body=state.bodyText||''; const authors=visibleAuthors(body); const first=authors[0]||null; const clinicFirst=first?aliasMatch(first,known,tokenSets):false; const foreign=authors.filter(a=>!aliasMatch(a,known,tokenSets));
    const shareWrapper=clinicFirst && (foreign.length>0 || hasShareWrapper(body));
    let contentType='unresolved'; let reason='No reliable visible author identity in sampled render.';
    if(clinicFirst && shareWrapper){contentType='clinic-published-share';reason='The clinic is the publishing wrapper, while the underlying item is shared/source content.';}
    else if(clinicFirst){contentType='clinic-original';reason='Visible primary author matches the canonical clinic page and no shared-source wrapper is observed.';}
    else if(first && !clinicFirst){contentType='external-only';reason='Opened content is authored by another entity without a reliable clinic publishing wrapper.';}
    const clinicPublished=contentType==='clinic-original'||contentType==='clinic-published-share';
    const engagement=clinicPublished?labelledEngagement(body):{reactionCount:null,commentCount:null,shareCount:null,semanticBasis:null};
    const legacyOwnership=clinicPublished?'clinic-authored':contentType==='external-only'?'clinic-shared-external':'unresolved';
    return {sample:i+1,sourceUrl:p.sourceUrl||null,contentType,ownership:legacyOwnership,visiblePrimaryAuthor:first,visibleAuthors:authors,shareWrapperObserved:shareWrapper,engagement,engagementEligible:clinicPublished,provenance:'opened-content',reason};
  });
  // Feed cards are primary because they preserve the clinic wrapper. Opened-content records
  // fill gaps only when the same source was not already represented by a feed card.
  const byUrl=new Map();
  const aliasesFor=r=>[r.sourceUrl,...(r.contentUrls||[])].filter(Boolean);
  for(const r of cardRecords){for(const key of aliasesFor(r)){if(!byUrl.has(key))byUrl.set(key,r);}}
  for(const r of diagRecords){
    if(!r.sourceUrl)continue;
    const existing=byUrl.get(r.sourceUrl);
    if(!existing){byUrl.set(r.sourceUrl,r);continue;}
    // V2.2.28 evidence fusion: a tight feed card remains primary when resolved. If the
    // card is unresolved but opened content positively identifies the clinic as author,
    // use that identity without pretending an external opened source disproves a share wrapper.
    if(existing.contentType==='unresolved' && (r.contentType==='clinic-original'||r.contentType==='clinic-published-share')){
      byUrl.set(r.sourceUrl,{...r,contentUrls:existing.contentUrls||[],provenance:'evidence-fused',feedCardProvenance:'unresolved',openedContentProvenance:r.contentType,provenanceConfidence:'medium',reason:`Feed-card boundary was unresolved; opened content positively identified ${r.contentType==='clinic-original'?'the clinic as author':'a clinic publishing wrapper'}.`});
    }
  }
  const records=[...new Map([...byUrl.values()].map(r=>[r.sourceUrl||JSON.stringify(r.contentUrls||[]),r])).values()].slice(0,10).map((r,i)=>({...r,sample:i+1}));
  const original=records.filter(r=>r.contentType==='clinic-original');
  const publishedShares=records.filter(r=>r.contentType==='clinic-published-share');
  const externalOnly=records.filter(r=>r.contentType==='external-only');
  const unresolved=records.filter(r=>r.contentType==='unresolved');
  const clinicPublished=[...original,...publishedShares];
  const interactions=clinicPublished.map(r=>{const e=r.engagement;if([e.reactionCount,e.commentCount,e.shareCount].every(v=>v==null))return null;return (e.reactionCount||0)+(e.commentCount||0)+(e.shareCount||0);}).filter(Number.isFinite);
  const followerCount=Number.isFinite(Number(page.followerCount))?Number(page.followerCount):null; const med=median(interactions);
  const ratio=followerCount&&med!=null?med/followerCount:null;
  let signal='not-assessable'; if(clinicPublished.length>=3&&interactions.length>=3&&ratio!=null) signal=ratio<0.0005?'very-low-visible-engagement':ratio<0.002?'low-visible-engagement':ratio<0.01?'moderate-visible-engagement':'strong-visible-engagement';
  const target=5; const cap=10; const enough=interactions.length>=target;
  return {
    schemaVersion:VERSION,
    sampleScope:'adaptive-facebook-feed-card-sample',sampledPosts:records.length,
    clinicOriginalPosts:original.length,clinicPublishedShares:publishedShares.length,externalOnlyPosts:externalOnly.length,unresolvedPosts:unresolved.length,
    clinicPublishedPosts:clinicPublished.length,clinicAuthoredPosts:clinicPublished.length,clinicSharedExternalPosts:externalOnly.length,
    clinicPublishedSharePercent:clinicPublished.length?Math.round(publishedShares.length/clinicPublished.length*100):null,
    sampling:{candidateCap:cap,targetReliableEngagementSamples:target,reliableEngagementSamples:interactions.length,stopCondition:enough?'target-met':records.length>=cap?'candidate-cap-reached':'evidence-exhausted',primaryEvidence:'clinic-feed-card'},
    records,
    engagementQuality:{status:signal==='not-assessable'?'insufficient-evidence':'assessed',signal,followerCount,eligibleClinicPublishedPosts:clinicPublished.length,eligibleOwnedPosts:clinicPublished.length,reliableEngagementSamples:interactions.length,medianVisibleInteractions:med,medianVisibleInteractionsPerFollower:ratio==null?null:Number(ratio.toFixed(6)),contentMix:{clinicOriginalPosts:original.length,clinicPublishedShares:publishedShares.length,externalOnlyPosts:externalOnly.length,unresolvedPosts:unresolved.length},policy:'Engagement may be attributed to the clinic audience only when it is visibly attached to a clinic-published feed item. Feed-card provenance is preferred because Facebook may strip the clinic share wrapper after permalink navigation. Clinic-published shares are measured at the clinic wrapper; underlying source-page engagement is never borrowed. A public engagement signal requires at least three reliable clinic-published samples.'}
  };
}
module.exports={VERSION,classifyFacebookContentOwnership,visibleAuthors,labelledEngagement,aliasMatch,identityTokenSets,hasShareWrapper};
