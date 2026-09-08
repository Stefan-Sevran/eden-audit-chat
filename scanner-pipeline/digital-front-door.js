const AGGREGATOR_HOSTS = /(dentaldepartures|whatclinic|bookimed|doctoralia|practo|healthgrades|zocdoc|fresha|booksy)/i;
const SOCIAL_HOSTS = /^(?:m\.)?(facebook\.com|fb\.com|instagram\.com|tiktok\.com)$/i;

function safeUrl(value){ try{return new URL(value);}catch{return null;} }
function hostOf(value){ const u=safeUrl(value); return u?u.hostname.toLowerCase().replace(/^www\./,''):''; }

function classifyDigitalFrontDoor(url){
  const u=safeUrl(url);
  if(!u) return {type:'unknown',platform:null,conventionalWebsite:false,label:'Unknown digital front door',reason:'Input URL is invalid or unavailable.'};
  const host=hostOf(url);
  if(/^(?:m\.)?(facebook\.com|fb\.com)$/i.test(host)) return {type:'facebook-primary',platform:'facebook',conventionalWebsite:false,label:'Facebook Page',reason:'The supplied clinic front door is a Facebook property rather than an independent clinic website.'};
  if(/instagram\.com$/i.test(host)) return {type:'social-primary',platform:'instagram',conventionalWebsite:false,label:'Instagram profile',reason:'The supplied clinic front door is a social profile rather than an independent clinic website.'};
  if(AGGREGATOR_HOSTS.test(host)) return {type:'aggregator-primary',platform:host,conventionalWebsite:false,label:'Aggregator / marketplace profile',reason:'The supplied clinic front door is hosted by a third-party directory, marketplace, or booking platform.'};
  return {type:'clinic-website',platform:null,conventionalWebsite:true,label:'Clinic website',reason:'The supplied clinic front door is an independent web domain.'};
}

function canonicalFacebookPageUrl(value){
  const u=safeUrl(value); if(!u) return null;
  const host=hostOf(value); if(!/^(?:m\.)?(facebook\.com|fb\.com)$/i.test(host)) return null;
  // Resolve Facebook login wrappers back to their intended page when possible.
  const next=u.searchParams.get('next');
  if(next){ const nested=canonicalFacebookPageUrl(next); if(nested) return nested; }
  const parts=u.pathname.split('/').filter(Boolean);
  if(!parts.length) return null;
  const first=(parts[0]||'').toLowerCase();
  if(['login','recover','photo','watch','reel','reels','stories','groups','events','marketplace','share','sharer'].includes(first)) return null;
  const handle=parts[0];
  if(!handle) return null;
  // V2.2.35: some clinic websites link Messenger/Facebook through a stable
  // profile.php?id=... route. Preserve that explicit clinic-supplied identity
  // candidate instead of discarding it merely because it is not a vanity handle.
  if(/^profile\.php$/i.test(handle)){
    const id=u.searchParams.get('id');
    return id&&/^\d{5,}$/.test(id)?`https://www.facebook.com/profile.php?id=${id}`:null;
  }
  return `https://www.facebook.com/${handle.replace(/\/$/,'')}/`;
}

function normalizeFacebookCandidates(items=[]){
  const out=[]; const seen=new Set();
  for(const item of items){ const c=canonicalFacebookPageUrl(item); if(c&&!seen.has(c)){seen.add(c);out.push(c);} }
  return out;
}

module.exports={classifyDigitalFrontDoor,canonicalFacebookPageUrl,normalizeFacebookCandidates,hostOf,SOCIAL_HOSTS};
