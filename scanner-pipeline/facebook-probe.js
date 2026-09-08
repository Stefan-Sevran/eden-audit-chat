const path = require('path');
const { resilientGoto } = require('./navigation');

const fs = require('fs');
const SCHEMA_VERSION = '2.1.22';

function hostOf(value) { try { return new URL(value).hostname.replace(/^www\./,'').toLowerCase(); } catch { return ''; } }
function normText(v='') { return String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function normPhone(v='') { return String(v).replace(/\D/g,'').replace(/^63(?=9\d{9}$)/,'0'); }
function numericFacebookPageId(value='') {
  try {
    const u=new URL(value);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    if (!/^\/profile\.php$/i.test(u.pathname.replace(/\/+$/,''))) return null;
    const id=String(u.searchParams.get('id')||'').trim();
    return /^\d{5,}$/.test(id)?id:null;
  } catch { return null; }
}
function sameFacebookPage(a,b) {
  try {
    const A=new URL(a), B=new URL(b);
    const aid=numericFacebookPageId(A.href), bid=numericFacebookPageId(B.href);
    // profile.php is not an identity by itself. Numeric page IDs must match.
    if (aid || bid) return !!aid && !!bid && aid===bid;
    const pa=A.pathname.replace(/^\/|\/$/g,'').toLowerCase();
    const pb=B.pathname.replace(/^\/|\/$/g,'').toLowerCase();
    return !!pa && !!pb && pa===pb;
  } catch { return false; }
}
function looksGenericFacebook(url='') {
  try {
    const u=new URL(url); const p=u.pathname.replace(/\/+$/,'') || '/';
    return /(^|\.)facebook\.com$/i.test(u.hostname) && (p==='/' || /^\/(home\.php|login|login\.php)$/i.test(p));
  } catch { return false; }
}
function loginWallUrl(url='') { return /facebook\.com\/(login|login\.php)|\/checkpoint\//i.test(url); }
function expectedHandle(url='') {
  try {
    const id=numericFacebookPageId(url);
    if(id) return `profile.php?id=${id}`;
    return new URL(url).pathname.split('/').filter(Boolean)[0] || null;
  } catch { return null; }
}
function uniqBy(arr, keyFn) { const seen=new Set(); return arr.filter(x=>{const k=keyFn(x); if(seen.has(k))return false; seen.add(k); return true;}); }
function canonicalFacebookContentUrl(value='') {
  try {
    const u=new URL(value);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const p=u.pathname.replace(/\/+$/,'');
    // Reject generic tabs/navigation that look like content links but are not post permalinks.
    if (/^\/(reel|watch|videos|photos)\/?$/i.test(p) || /^\/reel\/$/i.test(u.pathname)) return null;
    const valid = [
      /^\/[^/]+\/posts\/[^/]+$/i,
      /^\/[^/]+\/photos\/[^/]+(?:\/[^/]+)?$/i,
      /^\/[^/]+\/videos\/[^/]+$/i,
      /^\/reel\/[^/]+$/i,
      /^\/permalink\.php$/i,
      /^\/story\.php$/i
    ].some(re=>re.test(p));
    if (!valid) return null;
    // Drop tracking noise while preserving ids needed by permalink/story URLs.
    const keep=new URLSearchParams();
    for (const k of ['story_fbid','id','fbid']) if (u.searchParams.get(k)) keep.set(k,u.searchParams.get(k));
    u.search=keep.toString(); u.hash='';
    return u.href;
  } catch { return null; }
}
function usefulPageName(...values) {
  const shellName = /^(?:\(\d+\+?\)\s*)?(?:facebook|notifications?|home|feed|meta ai)$/i;
  for (const raw of values) {
    const v=String(raw||'').replace(/\s*[-|]\s*Facebook.*$/i,'').trim();
    if (v && !shellName.test(v) && v.length>2) return v;
  }
  return null;
}

function bookingHrefEvidence(href='') {
  const raw=String(href||'').trim();
  if(!raw) return {qualified:false,basis:null,target:null};
  try {
    const u=new URL(raw,'https://www.facebook.com');
    const host=u.hostname.replace(/^www\./,'').toLowerCase();
    // Never let the word "book" inside facebook.com count as booking evidence.
    // Evaluate only the path/query for platform-native booking semantics.
    const route=`${u.pathname}${u.search}`.toLowerCase();
    const routeBooking=/(?:^|[\/?&=_-])(book(?:ing)?|appointment|appointments|schedule|reserve|reservation)(?:[\/?&=_-]|$)/i.test(route);
    const knownProviders=/(^|\.)(calendly\.com|setmore\.com|simplybook\.me|booksy\.com|acuityscheduling\.com|fresha\.com)$/i.test(host);
    if(routeBooking) return {qualified:true,basis:'booking-route-semantics',target:u.href};
    if(knownProviders) return {qualified:true,basis:'recognized-booking-provider',target:u.href};
    return {qualified:false,basis:null,target:u.href};
  } catch { return {qualified:false,basis:null,target:raw}; }
}
function bookingActionEvidence(signal={}) {
  const label=String([signal.label,signal.text].filter(Boolean).join(' ')).replace(/\s+/g,' ').trim();
  const explicitLabel=/\bbook(?:ing)?(?: now| appointment)?\b|\bappointment(?:s)?\b|นัด/i.test(label);
  const hrefEvidence=bookingHrefEvidence(signal.href||'');
  if(explicitLabel) return {qualified:true,basis:'explicit-booking-label',label:label||null,target:hrefEvidence.target||signal.href||null};
  if(hrefEvidence.qualified) return {qualified:true,basis:hrefEvidence.basis,label:label||null,target:hrefEvidence.target||signal.href||null};
  return {qualified:false,basis:null,label:label||null,target:hrefEvidence.target||signal.href||null};
}
function facebookActionKind(signal={}) {
  const label=String([signal.label,signal.text].filter(Boolean).join(' ')).toLowerCase();
  const href=String(signal.href||'').toLowerCase();
  if(/\bmessage\b|send message|ข้อความ/.test(label) || /(?:m\.me\/|messenger\.com|\/messages(?:\/t)?\/)/.test(href)) return 'message';
  if(/\bcall\b|call now|โทร/.test(label) || /^tel:/.test(href)) return 'call';
  if(bookingActionEvidence(signal).qualified) return 'book';
  if(/whatsapp/.test(label) || /wa\.me|whatsapp/.test(href)) return 'whatsapp';
  return null;
}

function pageBaseUrl(targetUrl='') {
  try {
    const u=new URL(targetUrl);
    const id=numericFacebookPageId(u.href);
    if(id) return `https://www.facebook.com/profile.php?id=${id}`;
    const handle=u.pathname.split('/').filter(Boolean)[0];
    return handle ? `https://www.facebook.com/${handle}` : targetUrl;
  } catch { return targetUrl; }
}
function facebookPageRoute(targetUrl='',kind='header') {
  const id=numericFacebookPageId(targetUrl);
  if(id){
    const u=new URL('https://www.facebook.com/profile.php');
    u.searchParams.set('id',id);
    if(kind && kind!=='header') u.searchParams.set('sk',kind);
    return u.href;
  }
  const base=pageBaseUrl(targetUrl).replace(/\/+$/,'');
  return kind==='header'?base:`${base}/${kind}`;
}
function contentRouteCandidates(targetUrl='') {
  return [
    {kind:'posts',url:facebookPageRoute(targetUrl,'posts')},
    {kind:'reels',url:facebookPageRoute(targetUrl,'reels')},
    {kind:'photos',url:facebookPageRoute(targetUrl,'photos')}
  ];
}
function facebookDateCandidate(text='') {
  const t=String(text||'').replace(/\s+/g,' ').trim();
  // Activity evidence must look like an actual Facebook timestamp, not merely a
  // year that happens to appear in an address, registration number, copyright,
  // or old profile text. Prefer relative labels because they are strongest for
  // recent-activity checks.
  const pats=[
    /\b(?:Today|Yesterday)(?:\s+at\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?\b/i,
    /\b\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\s+ago\b/i,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s+20\d{2})?(?:\s+at\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?\b/i,
    /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+20\d{2})?\b/i
  ];
  for(const re of pats){const m=t.match(re);if(m)return m[0];}
  return null;
}

async function inspectPage(page, stateName) {
  return page.evaluate(({stateName}) => {
    const txt = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g,' ').trim();
    const abs = (href) => { try { return new URL(href, location.href).href; } catch { return null; } };
    const visible = (el) => {
      if (!el || !el.getClientRects().length) return false;
      const s=getComputedStyle(el); return s.visibility!=='hidden' && s.display!=='none' && Number(s.opacity||1)>0;
    };
    const all=[...document.querySelectorAll('a,button,[role="button"]')].map((el,i)=>({
      i, tag:el.tagName.toLowerCase(), text:txt(el).slice(0,220), aria:el.getAttribute('aria-label')||'', title:el.getAttribute('title')||'',
      href: el.tagName==='A' ? abs(el.getAttribute('href')) : null,
      role:el.getAttribute('role')||null,
      visible:visible(el),
      rect: visible(el) ? (()=>{const r=el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})() : null
    })).filter(x=>x.visible);
    const label=x=>`${x.text} ${x.aria} ${x.title}`.replace(/\s+/g,' ').trim();
    const href=x=>x.href||'';
    const book=all.filter(x=>/\b(book now|book appointment|book an appointment|schedule|appointment|reserve)\b/i.test(label(x)) || /appointment|booking|book-now/i.test(href(x)));
    const message=all.filter(x=>/\b(message|send message|messenger|chat)\b/i.test(label(x)) || /messenger\.com|m\.me\//i.test(href(x)) || /\/messages\/t\//i.test(href(x)));
    const whatsapp=all.filter(x=>/whatsapp/i.test(label(x)) || /wa\.me|whatsapp\.com/i.test(href(x)));
    const call=all.filter(x=>/^tel:/i.test(href(x)) || /\b(call now|call us|call|phone)\b/i.test(label(x)));
    const more=all.filter(x=>/^more$/i.test(label(x).trim()) || /more actions|see more actions/i.test(label(x)));
    const links=[...document.querySelectorAll('a[href]')].filter(visible).map(a=>({text:txt(a).slice(0,180),aria:a.getAttribute('aria-label')||'',href:abs(a.getAttribute('href'))})).filter(x=>x.href);
    const websiteCandidate=links.find(x=>/website/i.test(`${x.text} ${x.aria}`) && !/facebook\.com/i.test(x.href)) || links.find(x=>!/(facebook\.com|fbcdn\.net|messenger\.com)/i.test(x.href) && /^https?:/i.test(x.href));
    const phoneText=(document.body?.innerText||'').match(/(?:\+?63|0)?\s*9\d{2}[\s-]?\d{3}[\s-]?\d{4}|\(0?\d{2,3}\)\s*\d{3}[\s-]?\d{4}/g)||[];
    // V2.2.26: capture feed-card provenance before opening a permalink. Facebook often
    // strips the clinic share wrapper after navigation, so the feed card is the strongest
    // evidence for whether a clinic published original content or amplified another source.
    const canonicalContent=(href)=>{try{const u=new URL(href,location.href);const p=u.pathname.replace(/\/+$/,'');const ok=[/^\/[^/]+\/posts\/[^/]+$/i,/^\/[^/]+\/photos\/[^/]+(?:\/[^/]+)?$/i,/^\/[^/]+\/videos\/[^/]+$/i,/^\/reel\/[^/]+$/i,/^\/permalink\.php$/i,/^\/story\.php$/i].some(re=>re.test(p));if(!ok)return null;const keep=new URLSearchParams();for(const k of ['story_fbid','id','fbid'])if(u.searchParams.get(k))keep.set(k,u.searchParams.get(k));u.search=keep.toString();u.hash='';return u.href}catch{return null}};
    const feedCardForAnchor=(a,i)=>{
      const sourceUrl=canonicalContent(a.getAttribute('href')); if(!sourceUrl)return null;
      let best=null,el=a;
      for(let depth=0;el&&depth<14;depth++,el=el.parentElement){
        if(!visible(el))continue; const r=el.getBoundingClientRect(); const text=txt(el);
        if(r.width<260||r.height<70||text.length<20||text.length>9000)continue;
        const contentUrls=[...new Set([...el.querySelectorAll('a[href]')].map(x=>canonicalContent(x.getAttribute('href'))).filter(Boolean))];
        if(!contentUrls.includes(sourceUrl))continue;
        const ariaLabels=[...el.querySelectorAll('[aria-label]')].map(x=>x.getAttribute('aria-label')).filter(Boolean).slice(0,80);
        // V2.2.30: interaction semantics must be collected inside the browser context.
        // Do not reference a Node-side helper/value from page.evaluate().
        const interactionSignals=[...el.querySelectorAll('[role=button],button,a,[aria-label]')].map(x=>({
          label:x.getAttribute?.('aria-label')||null,
          text:(x.innerText||x.textContent||'').replace(/\s+/g,' ').trim().slice(0,160),
          role:x.getAttribute?.('role')||x.tagName?.toLowerCase()||null
        })).filter(x=>/reaction|like|comment|share/i.test(`${x.label||''} ${x.text||''}`)).slice(0,40);
        // V2.2.28: a real card should represent one primary item (or at most one nested shared source).
        // Reject shelves/carousels/grids before they can become provenance evidence.
        if(contentUrls.length>2)continue;
        const labelsText=text+' '+ariaLabels.join(' ');
        const hasInteraction=/like|comment|share|follow|reaction/i.test(labelsText);
        const hasPublisherCue=/\bfollow\b|\bshared\b|(?:'s post)|view story/i.test(labelsText);
        const score=(contentUrls.length===1?8:4)+(r.width>=420?2:0)+(r.height>=140?2:0)+(r.height<=1400?3:0)+(hasInteraction?3:0)+(hasPublisherCue?3:0)-Math.max(0,Math.floor(r.height/900));
        if(!best||score>best.score||(score===best.score&&r.height<best.height))best={score,height:r.height,text,contentUrls,ariaLabels,interactionSignals};
      }
      if(!best)return null; return {index:i,text:best.text.slice(0,7000),sourceUrl,contentUrls:best.contentUrls.slice(0,8),ariaLabels:best.ariaLabels,interactionSignals:best.interactionSignals||[]};
    };
    const cardMap=new Map();
    [...document.querySelectorAll('a[href]')].filter(visible).forEach((a,i)=>{const c=feedCardForAnchor(a,i);if(!c)return;const key=c.sourceUrl;if(!cardMap.has(key)||String(c.text||'').length<String(cardMap.get(key).text||'').length)cardMap.set(key,c);});
    const feedCards=[...cardMap.values()].slice(0,20);
    const meta=sel=>document.querySelector(sel)?.getAttribute('content')||null;
    return {
      stateName, title:document.title||null, ogTitle:meta('meta[property="og:title"]'), ogUrl:meta('meta[property="og:url"]'),
      h1:txt(document.querySelector('h1'))||null,
      bodyTextSample:(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,14000),
      actions:{book,message,whatsapp,call,more}, websiteUrl:websiteCandidate?.href||null,
      postLinks:[...new Set(links.map(x=>x.href).map(h=>{ try { const u=new URL(h); const p=u.pathname.replace(/\/+$/,''); const valid=[/^\/[^/]+\/posts\/[^/]+$/i,/^\/[^/]+\/photos\/[^/]+(?:\/[^/]+)?$/i,/^\/[^/]+\/videos\/[^/]+$/i,/^\/reel\/[^/]+$/i,/^\/permalink\.php$/i,/^\/story\.php$/i].some(re=>re.test(p)); if(!valid)return null; const keep=new URLSearchParams(); for(const k of ['story_fbid','id','fbid'])if(u.searchParams.get(k))keep.set(k,u.searchParams.get(k)); u.search=keep.toString();u.hash='';return u.href;}catch{return null;} }).filter(Boolean))].slice(0,12),
      phoneCandidates:[...new Set(phoneText)].slice(0,12),
      feedCards,
      activityLabels:[...new Set((document.body?.innerText||'').split(/\n+/).map(x=>x.trim()).filter(x=>/^(?:Yesterday|Today|\d+\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)\b|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*20\d{2})?)$/i.test(x)))].slice(0,20),
      visibleInteractiveCount:all.length
    };
  }, {stateName});
}

async function expandMoreMenu(page) {
  const candidates=[
    page.getByRole('button',{name:/^more$/i}).first(),
    page.getByRole('button',{name:/more actions/i}).first(),
    page.locator('[role="button"][aria-label*="More" i]').first()
  ];
  for (const locator of candidates) {
    try {
      if (await locator.isVisible({timeout:1000})) { await locator.click({timeout:2500}); await page.waitForTimeout(700); return true; }
    } catch {}
  }
  return false;
}

async function collectPublicStates(context, targetUrl, options, variant) {
  const viewport=variant==='mobile'?{width:390,height:844}:{width:1440,height:1000};
  const page=await context.newPage();
  await page.setViewportSize(viewport);
  const nav=await resilientGoto(page,targetUrl,{timeoutMs:options.timeoutMs||20000,fallbackTimeoutMs:options.fallbackTimeoutMs||35000,slowThresholdMs:8000});
  await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(options.hydrationWaitMs||2600);
  const states=[];
  states.push(await inspectPage(page,`${variant}-initial`));
  await page.evaluate(()=>window.scrollTo(0,Math.min(900,Math.max(0,document.body.scrollHeight-window.innerHeight)))).catch(()=>{});
  await page.waitForTimeout(700);
  states.push(await inspectPage(page,`${variant}-scrolled`));
  const moreExpanded=await expandMoreMenu(page);
  if (moreExpanded) states.push(await inspectPage(page,`${variant}-more-menu`));
  const shot=options.outputDir ? path.join(options.outputDir,`facebook-probe-${variant}.png`) : null;
  if (shot) await page.screenshot({path:shot,fullPage:false}).catch(()=>{});
  const finalUrl=page.url();
  await page.close();
  return {variant,nav,states,moreExpanded,screenshot:shot,finalUrl};
}



async function collectTargetedAuthenticatedCaptures(context, targetUrl, options={}) {
  if (!options.outputDir) return {status:'not-run',captures:[],diagnostics:[]};
  const targets=[
    {kind:'header',url:facebookPageRoute(targetUrl,'header'),scrollY:0},
    {kind:'about',url:facebookPageRoute(targetUrl,'about'),scrollY:250},
    {kind:'reviews',url:facebookPageRoute(targetUrl,'reviews'),scrollY:250},
    {kind:'posts',url:facebookPageRoute(targetUrl,'posts'),scrollY:450}
  ];
  const captures=[]; const diagnostics=[];
  const acquisitionAttempts=Math.max(1,Math.min(Number(options.facebookEvidenceAcquisitionAttempts||2),3));
  const actionRegex=/\bmessage\b|send message|ข้อความ|\bcall\b|โทร|\bbook(?:ing| appointment)?\b|appointment|นัด|whatsapp/i;
  for (const target of targets) {
    const maxAttempts=(target.kind==='header'||target.kind==='posts')?acquisitionAttempts:1;
    let positiveActionSeen=false;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      const page=await context.newPage();
      await page.setViewportSize({width:1440,height:1200});
      try {
        const nav=await resilientGoto(page,target.url,{timeoutMs:options.timeoutMs||20000,fallbackTimeoutMs:options.fallbackTimeoutMs||35000,slowThresholdMs:8000});
        await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
        await page.waitForTimeout(Math.max(3500,options.hydrationWaitMs||2600)+(attempt-1)*900);
        const scrollPlan=target.kind==='header'?[0,180,0]:[target.scrollY||0,Math.max(target.scrollY||0,720)];
        const collected=[]; let bodyText='';
        for(const y of scrollPlan){
          await page.evaluate(y=>window.scrollTo(0,Math.min(y,Math.max(0,document.body.scrollHeight-window.innerHeight))),y).catch(()=>{});
          await page.waitForTimeout(650);
          bodyText += ' ' + (await page.locator('body').innerText({timeout:3000}).catch(()=>'' ));
          const signals=await page.evaluate(()=>{
            const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
            const visible=el=>{const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';};
            return [...document.querySelectorAll('button,a,[role="button"],[aria-label]')].filter(visible).map(el=>({label:norm(el.getAttribute('aria-label')),text:norm(el.innerText||el.textContent),href:el.href||el.closest?.('a[href]')?.href||null})).filter(x=>x.label||x.text).slice(0,700);
          }).catch(()=>[]);
          collected.push(...signals);
        }
        bodyText=bodyText.replace(/\s+/g,' ').trim().slice(0,22000);
        const seen=new Set();
        const interactionSignals=collected.filter(x=>{const k=`${x.label||''}|${x.text||''}|${x.href||''}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,900);
        positiveActionSeen=interactionSignals.some(x=>facebookActionKind(x)||actionRegex.test([x.label,x.text,x.href].filter(Boolean).join(' ')));
        const suffix=attempt===1?'':`-attempt${attempt}`;
        const shot=path.join(options.outputDir,`facebook-auth-${target.kind}${suffix}.png`);
        await page.screenshot({path:shot,fullPage:false}).catch(()=>{});
        captures.push({kind:target.kind,attempt,path:shot,url:page.url(),bodyTextSample:bodyText,interactionSignals});
        diagnostics.push({kind:target.kind,attempt,requestedUrl:target.url,finalUrl:page.url(),httpStatus:nav.response?.status?.()||null,textLength:bodyText.length,interactionSignalCount:interactionSignals.length,positiveActionSeen,screenshot:shot});
      } catch(error) {
        diagnostics.push({kind:target.kind,attempt,requestedUrl:target.url,error:String(error.message||error)});
      } finally { await page.close(); }
      if(positiveActionSeen) break;
    }
  }
  return {status:captures.length?'captured':'not-captured',captures,diagnostics,acquisitionPolicy:{boundedRetries:true,maxAttempts:acquisitionAttempts,stopOnPositiveAction:true}};
}

function mergeStateData(groups) {
  const states=groups.flatMap(g=>g.states||[]);
  const allActions={book:[],message:[],whatsapp:[],call:[]};
  for (const s of states) for (const k of Object.keys(allActions)) allActions[k].push(...(s.actions?.[k]||[]).map(x=>({...x,state:s.stateName})));
  for (const k of Object.keys(allActions)) allActions[k]=uniqBy(allActions[k],x=>`${x.href||''}|${x.text||''}|${x.aria||''}|${x.state||''}`);
  const first=states[0]||{};
  const websiteUrl=states.map(s=>s.websiteUrl).find(Boolean)||null;
  const phoneCandidates=[...new Set(states.flatMap(s=>s.phoneCandidates||[]))].slice(0,12);
  const postLinks=[...new Set(states.flatMap(s=>s.postLinks||[]))].slice(0,20);
  const feedCardMap=new Map();
  for(const card of states.flatMap(s=>s.feedCards||[])){const key=card.sourceUrl||card.text?.slice(0,240);if(key&&!feedCardMap.has(key))feedCardMap.set(key,card);}
  const feedCards=[...feedCardMap.values()].slice(0,20);
  const activityLabels=[...new Set(states.flatMap(s=>s.activityLabels||[]))].slice(0,30);
  const bodyTextSample=[...new Set(states.map(s=>s.bodyTextSample).filter(Boolean))].join(' | ').slice(0,42000);
  return {states,actions:allActions,websiteUrl,phoneCandidates,postLinks,feedCards,activityLabels,title:first.title||null,ogTitle:first.ogTitle||null,ogUrl:first.ogUrl||null,h1:first.h1||null,bodyTextSample};
}

async function probeAction(browser, href, options={}) {
  if (!href || !/^https?:/i.test(href)) return {tested:false,works:null,finalUrl:null,requiresLogin:null};
  const context=await browser.newContext({viewport:{width:1280,height:900},ignoreHTTPSErrors:true,locale:'en-US',...(options.storageStatePath && fs.existsSync(options.storageStatePath) ? {storageState:options.storageStatePath} : {})});
  const page=await context.newPage();
  try {
    const nav=await resilientGoto(page,href,{timeoutMs:options.actionTimeoutMs||15000,fallbackTimeoutMs:options.actionFallbackTimeoutMs||25000,slowThresholdMs:8000});
    const finalUrl=page.url();
    const requiresLogin=loginWallUrl(finalUrl) || /log in|login to continue/i.test((await page.locator('body').innerText({timeout:2500}).catch(()=>'' )).slice(0,2500));
    return {tested:true,works:!!nav.response || !!finalUrl,finalUrl,requiresLogin,httpStatus:nav.response?.status?.()||null};
  } catch(error) { return {tested:true,works:false,finalUrl:page.url()||null,requiresLogin:null,error:String(error.message||error)}; }
  finally { await context.close(); }
}

function actionStatus(observed, loginLimited) { if (observed) return 'observed'; if (loginLimited) return 'login-limited'; return 'not-observed'; }

function parseSurfaceEvidence(bodyText='') {
  const t=String(bodyText||'').replace(/\s+/g,' ').trim();
  const follower=t.match(/([0-9]+(?:[.,][0-9]+)?\s*[KMB]?)\s+(?:followers?|ผู้ติดตาม)\b/i);
  const parseCompact=(v)=>{ if(!v)return null; const x=String(v).replace(/\s+/g,'').replace(',','.'); const m=x.match(/^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i); if(!m)return null; const n=Number(m[1]); const mult=!m[2]?1:m[2].toUpperCase()==='K'?1e3:m[2].toUpperCase()==='M'?1e6:1e9; return Number.isFinite(n)?Math.round(n*mult):null; };
  const recommend=t.match(/(\d{1,3})%\s+(?:recommend|recommended|แนะนำ)\s*\(([^)]+?)\s+(?:reviews?|รีวิว)\)/i);
  const reviewsOnly=t.match(/\(([^)]+?)\s+(?:reviews?|รีวิว)\)/i);
  const recommendationPercent=recommend?Number(recommend[1]):null;
  const recommendationReviewCount=parseCompact(recommend?.[2]||reviewsOnly?.[1]||null);
  const followerCount=parseCompact(follower?.[1]||null);
  return { followerCount, recommendationPercent, recommendationReviewCount };
}


function classifyIntentText(text='') {
  const original=String(text||'').trim();
  const t=original.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();

  // PH dental intent lexicon: deterministic, transparent, and explainable.
  // The classifier deliberately exposes matched signals so later benchmark work
  // can measure precision/recall instead of treating patientIntent as a black box.
  const rules={
    bookingIntent:[
      ['book',/\b(book|booking|appointment|appoint|schedule|reserve|reservation|slot|pa\s*book|magpa[ -]?book|mag\s*book|pa\s*schedule|consult|consultation)\b/i]
    ],
    pricingIntent:[
      ['how much',/\bhow much(?: po)?\b/i],
      ['hm',/(?:^|\s)hm\s*\??(?:\s|$)/i],
      ['price',/\b(price|pricing|cost|rate|rates|magkano|fee|fees|tagpila|tag pila|pila ang|pila ka|pila po|pila pa|pila per|pila)\b/i]
    ],
    availabilityIntent:[
      ['availability',/\b(available|availability|open|opening|today|tomorrow|this week|weekend|what time|when|schedule|pwede|available pa|open pa)\b/i]
    ],
    urgentIntent:[
      ['urgent-care',/\b(urgent|emergency|pain|toothache|sakit|masakit|swollen|swelling|hubag|bleeding|asap|right now)\b/i]
    ],
    treatmentIntent:[
      ['treatment',/\b(braces?|implant|invisalign|cleaning|whitening|extraction|bunot|root canal|denture|dentures|postiso|pustiso|crown|crowns|zirconia|ceramage|bridge|fixed bridge|veneer|wisdom tooth|tooth|teeth|ngipon|dentist|upper|lower|up and down|up & down|taas ug ubos)\b/i]
    ],
    locationIntent:[
      ['location',/\b(location|where|where are you|address|near|nearest|asa|saan|doon|dito|brgy\.?|barangay|maa|davao|located)\b/i]
    ],
    generalInterestIntent:[
      ['interested',/\b(i['’]?m interested|im interested|interested po|interested|interesado|interesada|pa info|more info|details po|details please)\b/i]
    ]
  };

  const out={};
  const matchedSignals=[];
  const intentCategories=[];
  for (const [intent, entries] of Object.entries(rules)) {
    const matches=[];
    for (const [signal,re] of entries) if (re.test(t)) matches.push(signal);
    out[intent]=matches.length>0;
    if (matches.length) {
      intentCategories.push(intent.replace(/Intent$/,''));
      matchedSignals.push(...matches.map(signal=>({intent,signal})));
    }
  }

  out.patientIntent=intentCategories.length>0;

  let confidence='none';
  if (out.patientIntent) {
    const directCommercial = out.bookingIntent || out.pricingIntent || out.urgentIntent || out.locationIntent;
    if (intentCategories.length>=2 || directCommercial) confidence='high';
    else confidence='medium';
  }

  const normalizedMeanings=[];
  if (out.pricingIntent) normalizedMeanings.push('price/cost inquiry');
  if (out.bookingIntent) normalizedMeanings.push('booking/consultation inquiry');
  if (out.availabilityIntent) normalizedMeanings.push('availability/timing inquiry');
  if (out.urgentIntent) normalizedMeanings.push('urgent dental-care inquiry');
  if (out.treatmentIntent) normalizedMeanings.push('treatment/service inquiry');
  if (out.locationIntent) normalizedMeanings.push('location/access inquiry');
  if (out.generalInterestIntent) normalizedMeanings.push('general expressed treatment interest');

  const languageContext=[];
  if (/(?:^|\s)hm\s*\??(?:\s|$)/i.test(t)) languageContext.push('PH social shorthand: hm = how much');
  if (/\bpila\b|\btaas ug ubos\b/i.test(t)) languageContext.push('Cebuano/Bisaya pricing phrasing');
  if (/\bpo\b|\bmagkano\b|\bpustiso\b|\bbunot\b/i.test(t)) languageContext.push('Filipino/Tagalog clinic phrasing');

  out.classification={
    method:'deterministic-lexicon-v2.1.22',
    confidence,
    intentCategories,
    matchedSignals,
    normalizedMeanings,
    languageContext,
    rationale:out.patientIntent
      ? `Matched ${matchedSignals.length} explicit patient-intent signal${matchedSignals.length===1?'':'s'} across ${intentCategories.length} categor${intentCategories.length===1?'y':'ies'}.`
      : 'No configured patient-intent signal matched.'
  };
  return out;
}

async function expandClinicReplyThreads(page, pageName, handle) {
  const clinicTokens=[pageName,handle,String(pageName||'').replace(/\b(center|centre|clinic|dental center|dental centre)\b/ig,' ')].filter(Boolean).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
  let clicks=0, textIndicatorsLocated=0, containerIndicatorsLocated=0, coordinateClicks=0, ancestorClicks=0, secondaryClicks=0;
  const seenPoints=new Set();

  for(let pass=0;pass<4;pass++){
    // V2.1.22: Facebook sometimes exposes "Page replied · N replies" only as
    // composed rendered/accessibility text spread across descendants. A text-node
    // walk can therefore see zero exact nodes even though bodyText clearly contains
    // the phrase. Locate ANY visible element whose composed text contains the phrase,
    // then descend toward the smallest child region that still contains it.
    const candidates=await page.evaluate(({clinicTokens})=>{
      const compact=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
      const normalize=v=>String(v||'').replace(/\s+/g,' ').trim();
      const clinicMatch=(label)=>{
        if(!/replied\s*[·•-]?\s*\d*\s*repl(?:y|ies)/i.test(label||'')) return false;
        const low=String(label||'').toLowerCase();
        const before=String(label||'').replace(/replied.*$/i,'');
        return !clinicTokens.length || clinicTokens.some(t=>low.includes(t)||compact(before).includes(compact(t))||compact(t).includes(compact(before)));
      };
      const visible=(el)=>{if(!el||!el.getClientRects().length)return false;const st=getComputedStyle(el);return st.display!=='none'&&st.visibility!=='hidden'&&Number(st.opacity||1)>0;};
      const textOf=(el)=>normalize(el?.getAttribute?.('aria-label')||el?.innerText||el?.textContent||'');
      const interactiveAncestor=(el)=>{
        let cur=el;
        for(let i=0;i<10&&cur;i++,cur=cur.parentElement){
          const role=cur.getAttribute?.('role');
          if(cur.tagName==='BUTTON'||cur.tagName==='A'||role==='button'||role==='link'||cur.tabIndex>=0||typeof cur.onclick==='function') return cur;
        }
        return null;
      };
      const out=[];
      const all=[...document.querySelectorAll('body *')];
      const roots=all.filter(visible).filter(el=>clinicMatch(textOf(el)));
      const unique=new Set();
      for(const root of roots){
        let cur=root;
        // Descend to the smallest visible child whose composed text still contains
        // the clinic-reply phrase. This works even when the phrase is split across
        // multiple React descendants and no single text node contains the full label.
        for(let depth=0;depth<12;depth++){
          const kids=[...cur.children].filter(visible).filter(ch=>clinicMatch(textOf(ch)));
          if(!kids.length) break;
          kids.sort((a,b)=>{
            const ta=textOf(a).length,tb=textOf(b).length;
            if(ta!==tb) return ta-tb;
            const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
            return (ra.width*ra.height)-(rb.width*rb.height);
          });
          cur=kids[0];
        }
        const label=textOf(cur); if(!label||!clinicMatch(label)) continue;
        const r=cur.getBoundingClientRect(); if(!r.width||!r.height) continue;
        const anc=interactiveAncestor(cur); const ar=anc?.getBoundingClientRect?.();
        const key=[Math.round(r.left/4),Math.round(r.top/4),Math.round(r.width/4),Math.round(r.height/4)].join(':');
        if(unique.has(key)) continue; unique.add(key);
        const m=/[^\n]{0,120}?replied\s*[·•-]?\s*\d*\s*repl(?:y|ies)/i.exec(label);
        out.push({
          label:(m?m[0]:label).replace(/\s+/g,' ').trim(),
          x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,textLength:label.length,
          ancestor:anc&&ar?{x:ar.left+ar.width/2,y:ar.top+ar.height/2,tag:anc.tagName,role:anc.getAttribute?.('role')||null}:null
        });
      }
      out.sort((a,b)=>a.textLength-b.textLength || (a.w*a.h)-(b.w*b.h));
      return out.slice(0,40);
    },{clinicTokens}).catch(()=>[]);

    containerIndicatorsLocated=Math.max(containerIndicatorsLocated,candidates.length);
    textIndicatorsLocated=Math.max(textIndicatorsLocated,candidates.length);
    let clickedThisPass=0;
    for(const c of candidates){
      const points=[];
      if(c.ancestor) points.push({x:c.ancestor.x,y:c.ancestor.y,kind:'ancestor'});
      points.push({x:c.x,y:c.y,kind:'container'});
      for(const pt of points){
        const key=`${Math.round(pt.x/3)}:${Math.round(pt.y/3)}:${pt.kind}`;
        if(seenPoints.has(key)) continue;
        seenPoints.add(key);
        try{
          if(pt.x>1&&pt.y>1&&pt.x<1279&&pt.y<999){
            await page.mouse.click(pt.x,pt.y,{delay:35});
            clicks++; clickedThisPass++;
            if(pt.kind==='ancestor') ancestorClicks++; else coordinateClicks++;
            await page.waitForTimeout(350);
          }
        }catch{}
      }
    }

    const secondary=await page.evaluate(()=>{
      const visible=(el)=>{if(!el||!el.getClientRects().length)return false;const st=getComputedStyle(el);return st.display!=='none'&&st.visibility!=='hidden';};
      const text=(el)=>((el.getAttribute?.('aria-label')||el.innerText||el.textContent||'')).replace(/\s+/g,' ').trim();
      const controls=[...document.querySelectorAll('[role="button"],button,a,span,div')].filter(visible).filter(el=>/^(?:view|see)\s+(?:more\s+)?(?:\d+\s+)?repl(?:y|ies)$/i.test(text(el)));
      const pts=[];for(const el of controls.slice(0,32)){const r=el.getBoundingClientRect();pts.push({x:r.left+r.width/2,y:r.top+r.height/2});}return pts;
    }).catch(()=>[]);
    for(const pt of secondary){
      try{if(pt.x>1&&pt.y>1&&pt.x<1279&&pt.y<999){await page.mouse.click(pt.x,pt.y,{delay:35});clicks++;secondaryClicks++;clickedThisPass++;await page.waitForTimeout(250);}}catch{}
    }
    if(!clickedThisPass) break;
    await page.waitForTimeout(700);
  }
  return {clicks,textIndicatorsLocated,containerIndicatorsLocated,coordinateClicks,ancestorClicks,secondaryClicks};
}

async function extractVisibleComments(page, pageName, handle, sourceUrl) {
  return page.evaluate(({pageName,handle,sourceUrl}) => {
    const visible=(el)=>{if(!el||!el.getClientRects().length)return false;const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;};
    const txt=(el)=>(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
    const norm=(v)=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const clinicNames=[norm(pageName),norm(handle),norm(String(pageName||'').replace(/\b(center|centre|clinic|dental center|dental centre)\b/ig,' '))].filter(Boolean);
    const compact=(v)=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
    const clinicCompacts=[compact(pageName),compact(handle),compact(String(pageName||'').replace(/\b(center|centre|clinic|dental center|dental centre)\b/ig,' '))].filter(Boolean);
    const isClinic=(name)=>{const n=norm(name),c=compact(name);return !!n && (clinicNames.some(x=>x&&(n===x||n.includes(x)||x.includes(n)))||clinicCompacts.some(x=>x&&(c===x||c.includes(x)||x.includes(c))));};
    const isClinicReplyLabel=(v)=>{const n=norm(v),c=compact(String(v||'').replace(/replied.*$/i,''));return /replied\s*[·•-]?\s*\d*\s*repl(?:y|ies)/i.test(v||'') && (clinicNames.some(x=>x&&n.includes(x))||clinicCompacts.some(x=>x&&c&&(c.includes(x)||x.includes(c))));};
    const replyIndicatorFrom=(root)=>{
      let cur=root;
      for(let depth=0;depth<6 && cur;depth++,cur=cur.parentElement){
        const labels=[...cur.querySelectorAll('[aria-label],[role=\"button\"],button,span')].filter(visible).map(el=>(el.getAttribute('aria-label')||txt(el))).filter(Boolean);
        const hit=labels.find(v=>isClinicReplyLabel(v));
        if(hit){const m=hit.match(/(\d+)\s*repl(?:y|ies)/i);return {observed:true,label:hit,count:m?Number(m[1]):null};}
      }
      return {observed:false,label:null,count:null};
    };
    const allVisibleReplyIndicators=[...document.querySelectorAll('[aria-label],[role="button"],button,a,span')].filter(visible).map(el=>{
      const label=(el.getAttribute('aria-label')||txt(el)).replace(/\s+/g,' ').trim();
      const r=el.getBoundingClientRect();
      const clinic=isClinicReplyLabel(label);
      const match=/replied\s*[·•-]?\s*(\d*)\s*repl(?:y|ies)/i.exec(label);
      return match&&clinic?{el,label,count:match[1]?Number(match[1]):null,top:r.top,bottom:r.bottom}:null;
    }).filter(Boolean);
    const timestampInfo=(root)=>{
      const time=root.querySelector('time[datetime]');
      if(time?.getAttribute('datetime')) return {createdAt:time.getAttribute('datetime'),timestampLabel:txt(time)||time.getAttribute('datetime'),timestampPrecision:'exact',timestampSource:'time[datetime]'};
      const abbr=root.querySelector('abbr[data-utime]');
      if(abbr?.getAttribute('data-utime')) return {createdAt:new Date(Number(abbr.getAttribute('data-utime'))*1000).toISOString(),timestampLabel:txt(abbr)||null,timestampPrecision:'exact',timestampSource:'abbr[data-utime]'};
      const links=[...root.querySelectorAll('a[role="link"],a,span')].filter(visible);
      // Facebook often places an absolute timestamp in title/aria-label while showing only "25w".
      for(const el of links){
        const label=(el.getAttribute?.('aria-label')||'').trim();
        const title=(el.getAttribute?.('title')||'').trim();
        const raw=[label,title].find(v=>v&&/(?:\d{1,2}[:.]\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}.*\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*.*\d{4})/i.test(v));
        if(raw){const parsed=Date.parse(raw);if(Number.isFinite(parsed))return {createdAt:new Date(parsed).toISOString(),timestampLabel:txt(el)||raw,timestampPrecision:'exact',timestampSource:label===raw?'aria-label':'title'};}
      }
      const t=links.map(el=>txt(el)).find(v=>/^(?:\d+\s*(?:m|min|h|hr|d|w)|\d+[mhdw]|yesterday|today|just now|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)$/i.test(v));
      return {createdAt:null,timestampLabel:t||null,timestampPrecision:t?'relative':'unknown',timestampSource:t?'visible-label':null};
    };
    const authorFrom=(root)=>{
      const aria=root.getAttribute('aria-label')||'';const m=aria.match(/(?:comment|reply) by\s+(.+)/i);if(m)return m[1].trim();
      const candidates=[...root.querySelectorAll('a[role="link"],a')].filter(visible).map(a=>txt(a)).filter(v=>v&&v.length<90&&!/^(like|reply|share|follow|see translation)$/i.test(v));
      return candidates[0]||null;
    };
    const commentTextFrom=(root,author)=>{
      const full=txt(root); if(!full)return '';
      let out=full;
      if(author) out=out.replace(new RegExp('^'+author.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*','i'),'');
      out=out.replace(/\bLike\b\s*\bReply\b.*$/i,'').replace(/\bReply\b.*$/i,'').trim();
      return out.slice(0,1200);
    };
    const strong=[...document.querySelectorAll('[aria-label^="Comment by" i],[aria-label^="Reply by" i],[aria-label*=" comment by " i]')].filter(visible);
    let nodes=strong; let extractionMode='aria-comment';
    if(!nodes.length){
      const scopes=[...document.querySelectorAll('[role="dialog"],[role="main"],main')].filter(visible);
      const root=scopes.find(r=>/comment/i.test((r.getAttribute('aria-label')||'')+' '+txt(r).slice(0,500)))||document;
      nodes=[...root.querySelectorAll('[role="article"]')].filter(visible).filter(n=>{
        const t=txt(n);if(!t||t.length<3||t.length>1800)return false;
        if(/write a comment|create a post|what's on your mind/i.test(t))return false;
        return /\b(reply|like)\b/i.test(t) || !!n.querySelector('a[role="link"]');
      });
      extractionMode='role-article-fallback';
    }
    // Keep outermost comment article; nested replies are paired below.
    nodes=nodes.filter((n,i,a)=>!a.some((other,j)=>j!==i&&other.contains(n)&&other!==n));
    nodes=nodes.slice(0,100).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
    const rows=[];
    for(let nodeIndex=0;nodeIndex<nodes.length;nodeIndex++){
      const n=nodes[nodeIndex];
      const author=authorFrom(n); if(!author || isClinic(author)) continue;
      const text=commentTextFrom(n,author); if(!text||text.length<2)continue;
      const ti=timestampInfo(n);
      let clinicReplyAt=null,clinicReplyTimestampLabel=null,clinicReplyAuthor=null,clinicReplyText=null;
      let indicator=replyIndicatorFrom(n);
      if(!indicator.observed){
        const r=n.getBoundingClientRect();
        const nextTop=nodeIndex+1<nodes.length?nodes[nodeIndex+1].getBoundingClientRect().top:Infinity;
        const candidates=allVisibleReplyIndicators.filter(x=>x.top>=r.top-4 && x.top<nextTop-2).sort((a,b)=>a.top-b.top);
        if(candidates.length){const hit=candidates[0];indicator={observed:true,label:hit.label,count:hit.count};}
      }
      const replyNodes=[...n.querySelectorAll('[aria-label^="Reply by" i],[aria-label^="Comment by" i],[role="article"]')].filter(visible).filter(r=>r!==n);
      for(const r of replyNodes){
        const ra=authorFrom(r);
        if(isClinic(ra)){
          const rti=timestampInfo(r); clinicReplyAt=rti.createdAt; clinicReplyTimestampLabel=rti.timestampLabel; clinicReplyAuthor=ra; clinicReplyText=commentTextFrom(r,ra).slice(0,800); break;
        }
      }
      // Facebook sometimes renders replies as sibling articles rather than descendants.
      if(!clinicReplyAuthor){
        const all=[...document.querySelectorAll('[aria-label^="Reply by" i],[aria-label^="Comment by" i]')].filter(visible);
        const pos=all.indexOf(n);
        for(let j=pos+1;j>=1 && j<Math.min(all.length,pos+5);j++){
          const r=all[j], aria=r.getAttribute('aria-label')||'';
          if(/^Comment by/i.test(aria) && !isClinic(authorFrom(r))) break;
          const ra=authorFrom(r);
          if(isClinic(ra)) { const rti=timestampInfo(r); clinicReplyAt=rti.createdAt; clinicReplyTimestampLabel=rti.timestampLabel; clinicReplyAuthor=ra; clinicReplyText=commentTextFrom(r,ra).slice(0,800); break; }
        }
      }
      let replyAssociationMode=indicator.observed?'dom-geometry':(clinicReplyAuthor?'explicit-reply-article':null);
      // V2.1.12 rendered-order fallback: Facebook's accessibility text is often reliable
      // even when the reply control is mounted outside the comment article DOM subtree.
      if(!indicator.observed){
        const scope=n.closest('[role="dialog"]')||document.body;
        const stream=txt(scope);
        const current=txt(n);
        const nextNode=nodeIndex+1<nodes.length?nodes[nodeIndex+1]:null;
        const next=nextNode?txt(nextNode):'';
        const start=stream.indexOf(current);
        if(start>=0){
          const from=start+current.length;
          const nextPos=next?stream.indexOf(next,from):-1;
          const segment=stream.slice(from,nextPos>from?nextPos:Math.min(stream.length,from+700));
          const m=segment.match(/([^|]{0,120}?)\s+replied\s*[·•-]?\s*(\d+)\s*repl(?:y|ies)/i);
          if(m && isClinic(m[1])){
            indicator={observed:true,label:m[0].replace(/\s+/g,' ').trim(),count:Number(m[2])};
            replyAssociationMode='rendered-order-text';
          }
        }
      }
      rows.push({sourceUrl,author,text,createdAt:ti.createdAt,timestampLabel:ti.timestampLabel,timestampPrecision:ti.timestampPrecision||null,timestampSource:ti.timestampSource||null,clinicReplyObserved:!!(indicator.observed||clinicReplyAuthor),clinicReplyIndicatorLabel:indicator.label,clinicReplyCount:indicator.count,clinicReplyAt,clinicReplyTimestampLabel,clinicReplyTimestampPrecision:clinicReplyAt?'exact':(clinicReplyTimestampLabel?'relative':null),clinicReplyAuthor,clinicReplyText,replyAssociationMode,extractionMode});
    }
    return rows;
  }, {pageName,handle,sourceUrl});
}

async function captureCommentDiagnostics(page, sourceUrl) {
  return page.evaluate(({sourceUrl}) => {
    const visible=(el)=>{if(!el||!el.getClientRects().length)return false;const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden';};
    const txt=(el)=>(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible).map((el,i)=>({i,ariaLabel:el.getAttribute('aria-label')||null,text:txt(el).slice(0,4500)})).filter(x=>x.text);
    const articles=[...document.querySelectorAll('[role="article"]')].filter(visible).slice(0,50).map((el,i)=>({i,ariaLabel:el.getAttribute('aria-label')||null,text:txt(el).slice(0,1400)})).filter(x=>x.text);
    const commentish=[...document.querySelectorAll('button,[role="button"],a,span')].filter(visible).map(el=>({label:(el.getAttribute('aria-label')||txt(el)).slice(0,240),tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||null})).filter(x=>/comment|reply|most relevant|all comments|view more/i.test(x.label)).slice(0,80);
    return {sourceUrl,dialogs,articles,commentish,bodyText:(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,9000)};
  }, {sourceUrl});
}


async function openCommentSurface(page) {
  // Facebook often keeps Reel/post comments behind a drawer/button. Open only
  // comment/reply surfaces; never Like, Share, Message, or booking-submit controls.
  const candidates = [
    page.getByRole('button', { name: /^comments?$/i }).first(),
    page.getByRole('button', { name: /view comments?|see comments?|open comments?/i }).first(),
    page.locator('[role="button"][aria-label*="comment" i]').first(),
    page.locator('a[aria-label*="comment" i]').first()
  ];
  for (const locator of candidates) {
    try {
      if (await locator.isVisible({ timeout: 700 })) {
        const label = ((await locator.getAttribute('aria-label').catch(()=>'')) || (await locator.innerText().catch(()=>'')) || '').trim();
        // Avoid composer controls such as "Write a comment".
        if (/write|add|reply to|comment as/i.test(label)) continue;
        await locator.click({ timeout: 1800 });
        await page.waitForTimeout(700);
        return { opened: true, label: label || null };
      }
    } catch {}
  }
  // Sometimes the comment count itself is plain text in a clickable wrapper.
  try {
    const text = page.getByText(/^\s*\d+[\d,.]*\s+comments?\s*$/i, { exact: false }).first();
    if (await text.isVisible({ timeout: 500 })) {
      await text.click({ timeout: 1500 });
      await page.waitForTimeout(700);
      return { opened: true, label: (await text.innerText().catch(()=>'')) || null };
    }
  } catch {}
  return { opened: false, label: null };
}

async function expandCommentControls(page) {
  const patterns=[
    /view (?:more|previous|all) comments?/i,
    /see (?:more|all) comments?/i,
    /more comments?/i,
    /view replies?/i,
    /see replies?/i,
    /more replies?/i
  ];
  let clicks=0;
  for (let pass=0; pass<3; pass++) {
    let clickedThisPass=0;
    for (const re of patterns) {
      const loc=page.getByText(re,{exact:false});
      const count=Math.min(await loc.count().catch(()=>0),6);
      for(let i=0;i<count;i++){
        try{
          const el=loc.nth(i);
          if(await el.isVisible({timeout:400})){await el.click({timeout:1200});clickedThisPass++;clicks++;await page.waitForTimeout(250);}
        }catch{}
      }
    }
    // Prefer "All comments" when Facebook exposes the relevance menu.
    try{
      const rel=page.getByText(/most relevant/i,{exact:false}).first();
      if(await rel.isVisible({timeout:400})){await rel.click({timeout:1000});await page.waitForTimeout(300);const all=page.getByText(/^all comments$/i,{exact:false}).first();if(await all.isVisible({timeout:500})){await all.click({timeout:1000});clicks++;clickedThisPass++;await page.waitForTimeout(400);}}
    }catch{}
    if(!clickedThisPass) break;
  }
  return clicks;
}

async function discoverContentRoutes(context, targetUrl, options={}) {
  const routes=contentRouteCandidates(targetUrl);
  const discovered=[]; const diagnostics=[]; let newestActivityLabel=null;
  const scrollSteps=Math.max(2,Math.min(Number(options.contentScrollSteps||4),5));
  for(const route of routes){
    const page=await context.newPage(); await page.setViewportSize({width:1280,height:1000});
    let loginLimited=false; let links=[]; let activityLabels=[];
    try{
      const nav=await resilientGoto(page,route.url,{timeoutMs:options.contentTimeoutMs||16000,fallbackTimeoutMs:options.contentFallbackTimeoutMs||26000,slowThresholdMs:8000});
      await page.waitForTimeout(options.contentHydrationWaitMs||2400);
      const body=(await page.locator('body').innerText({timeout:2500}).catch(()=>'' )).slice(0,7000);
      loginLimited=loginWallUrl(page.url())||/log in to facebook|you must log in|log into facebook/i.test(body);
      const feedCards=[];
      if(!loginLimited){
        for(let step=0;step<scrollSteps;step++){
          const snap=await page.evaluate(({clinicName,clinicHandle})=>{
            const abs=h=>{try{return new URL(h,location.href).href}catch{return null}};
            const vis=el=>!!(el&&el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden');
            const hrefs=[...document.querySelectorAll('a[href]')].filter(vis).map(a=>abs(a.getAttribute('href'))).filter(Boolean);
            const labels=[...document.querySelectorAll('a,span,time,abbr')].filter(vis).map(el=>(el.innerText||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,800);
            const canonical=h=>{try{const u=new URL(h,location.href);const p=u.pathname.replace(/\/+$/,'');const ok=[/^\/[^/]+\/posts\/[^/]+$/i,/^\/[^/]+\/photos\/[^/]+(?:\/[^/]+)?$/i,/^\/[^/]+\/videos\/[^/]+$/i,/^\/reel\/[^/]+$/i,/^\/permalink\.php$/i,/^\/story\.php$/i].some(re=>re.test(p));if(!ok)return null;const keep=new URLSearchParams();for(const k of ['story_fbid','id','fbid'])if(u.searchParams.get(k))keep.set(k,u.searchParams.get(k));u.search=keep.toString();u.hash='';return u.href}catch{return null}};
            const textOf=el=>(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim();
            const cardMap=new Map();
            [...document.querySelectorAll('a[href]')].filter(vis).forEach((a,i)=>{const sourceUrl=canonical(a.getAttribute('href'));if(!sourceUrl)return;let el=a,best=null;for(let depth=0;el&&depth<14;depth++,el=el.parentElement){if(!vis(el))continue;const r=el.getBoundingClientRect();const text=textOf(el);if(r.width<260||r.height<70||text.length<20||text.length>9000)continue;const urls=[...new Set([...el.querySelectorAll('a[href]')].map(x=>canonical(x.getAttribute('href'))).filter(Boolean))];if(!urls.includes(sourceUrl))continue;if(urls.length>2)continue;const ariaLabels=[...el.querySelectorAll('[aria-label]')].map(x=>x.getAttribute('aria-label')).filter(Boolean).slice(0,80);const interactionSignals=[...el.querySelectorAll('[role=button],button,a,[aria-label]')].map(x=>({label:x.getAttribute?.('aria-label')||null,text:(x.innerText||x.textContent||'').replace(/\s+/g,' ').trim().slice(0,160),role:x.getAttribute?.('role')||x.tagName?.toLowerCase()||null,href:x.href||x.closest?.('a[href]')?.href||null})).filter(x=>/reaction|like|comment|share/i.test(`${x.label||''} ${x.text||''}`)).slice(0,40);const labelsText=text+' '+ariaLabels.join(' ')+' '+interactionSignals.map(x=>`${x.label||''} ${x.text||''}`).join(' ');const compact=v=>String(v||'').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g,'');const clinicNeedles=[compact(clinicName),compact(clinicHandle)].filter(x=>x.length>=5);const clinicCue=clinicNeedles.some(x=>compact(labelsText).includes(x));const hasInteraction=/like|comment|share|follow|reaction/i.test(labelsText);const hasPublisherCue=/\bfollow\b|\bshared\b|(?:'s post)|view story/i.test(labelsText);const score=(urls.length===1?8:4)+(r.width>=420?2:0)+(r.height>=140?2:0)+(r.height<=1400?3:0)+(hasInteraction?3:0)+(hasPublisherCue?3:0)+(clinicCue?8:0)-Math.max(0,Math.floor(r.height/900));if(!best||score>best.score||(score===best.score&&r.height<best.height))best={score,height:r.height,text,urls,ariaLabels,interactionSignals};}if(!best)return;const prev=cardMap.get(sourceUrl);const card={index:i,text:best.text.slice(0,7000),urls:best.urls.slice(0,30),ariaLabels:best.ariaLabels,interactionSignals:best.interactionSignals||[]};if(!prev||card.text.length<prev.text.length)cardMap.set(sourceUrl,card);});
            const cards=[...cardMap.values()].slice(0,20);
            return {hrefs,labels,cards};
          },{clinicName:options.clinicName||'',clinicHandle:expectedHandle(targetUrl)||''});
          links.push(...snap.hrefs); activityLabels.push(...snap.labels); feedCards.push(...(snap.cards||[]));
          await page.evaluate(()=>window.scrollBy(0,Math.max(650,Math.floor(window.innerHeight*.8)))).catch(()=>{});
          await page.waitForTimeout(650);
        }
      }
      const canon=[...new Set(links.map(canonicalFacebookContentUrl).filter(Boolean))];
      const dateLabels=[...new Set(activityLabels.map(facebookDateCandidate).filter(Boolean))];
      if(!newestActivityLabel&&dateLabels.length)newestActivityLabel=dateLabels[0];
      discovered.push(...canon.map(url=>({url,route:route.kind})));
      const normalizedCards=[]; const seenCards=new Set();
      for(const card of feedCards){const contentUrls=[...new Set((card.urls||[]).map(canonicalFacebookContentUrl).filter(Boolean))];if(!contentUrls.length||contentUrls.length>2)continue;const key=contentUrls[0]+'|'+String(card.text||'').slice(0,180);if(seenCards.has(key))continue;seenCards.add(key);normalizedCards.push({route:route.kind,sourceUrl:contentUrls[0],contentUrls,text:card.text,ariaLabels:Array.isArray(card.ariaLabels)?card.ariaLabels:[],interactionSignals:Array.isArray(card.interactionSignals)?card.interactionSignals:[]});}
      diagnostics.push({route:route.kind,requestedUrl:route.url,finalUrl:page.url(),httpStatus:nav?.response?.status?.()||null,loginLimited,linksObserved:links.length,canonicalContentLinks:canon.length,dateLabels:dateLabels.slice(0,8),feedCards:normalizedCards.slice(0,12)});
    }catch(error){diagnostics.push({route:route.kind,requestedUrl:route.url,error:String(error.message||error),loginLimited,linksObserved:0,canonicalContentLinks:0,dateLabels:[]});}
    finally{await page.close();}
  }
  const routeRank={posts:0,photos:1,reels:2};
  const unique=uniqBy(discovered,x=>x.url).sort((a,b)=>(routeRank[a.route]??9)-(routeRank[b.route]??9));
  const feedCardMap=new Map();
  const orderedDiagnostics=[...diagnostics].sort((a,b)=>(routeRank[a.route]??9)-(routeRank[b.route]??9));
  for(const d of orderedDiagnostics)for(const c of (d.feedCards||[])){const key=c.sourceUrl||c.text?.slice(0,180);if(key&&!feedCardMap.has(key))feedCardMap.set(key,c);}
  const orderedCards=[...feedCardMap.values()].sort((a,b)=>(routeRank[a.route]??9)-(routeRank[b.route]??9));
  return {postLinks:unique.map(x=>x.url),sources:unique,diagnostics,feedCards:orderedCards.slice(0,20),newestActivityLabel,commercialSamplingPriority:'posts-then-photos-then-reels'};
}



function associateRepliesFromRenderedText(rows=[], bodyText='', pageName='', handle='') {
  if (!Array.isArray(rows) || !rows.length || !bodyText) return rows;
  const stream=String(bodyText).replace(/\s+/g,' ').trim();
  const compact=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const cleanName=v=>String(v||'').replace(/\b(center|centre|clinic)\b/ig,' ').replace(/\s+/g,' ').trim();
  const handleHuman=String(handle||'')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/[_\-.]+/g,' ')
    .trim();
  const handleShort=handleHuman.replace(/\b(center|centre|clinic)\b/ig,' ').replace(/\s+/g,' ').trim();
  const aliases=[pageName,cleanName(pageName),handle,handleHuman,handleShort].filter(Boolean);
  // Facebook frequently shortens a formal clinic identity in reply labels (for example
  // "Yu Dental Center Davao" -> "Yu Dental Davao").  The page title itself can also
  // be polluted by notification text such as "(7) Facebook", so derive a compact alias
  // from the page handle as a fallback and remove generic clinic tokens from it.
  const rawHandleCompact=compact(handle);
  const shortenedHandleCompacts=[rawHandleCompact]
    .map(v=>v.replace(/center|centre|clinic/g,''))
    .filter(v=>v.length>=5);
  const aliasCompacts=[...new Set([...aliases.map(compact),...shortenedHandleCompacts].filter(v=>v.length>=5))];
  const escapeRe=v=>String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const aliasRegexes=[...new Set(aliases.map(v=>String(v).replace(/\s+/g,' ').trim()).filter(v=>v.length>=4))]
    .map(v=>new RegExp(`${escapeRe(v).replace(/\\ /g,'\\s+')}\\s+replied\\s*[·•-]?\\s*(\\d+)\\s*repl(?:y|ies)`, 'i'));
  let cursor=0;
  const locate=(row,from)=>{
    const candidates=[];
    if(row.text) candidates.push(String(row.text).replace(/\s+/g,' ').trim());
    const author=String(row.author||'').replace(/\s+\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i,'').trim();
    if(author){
      const body=String(row.text||'').replace(new RegExp('^'+escapeRe(author)+'\\s*','i'),'').trim();
      if(body) candidates.push(`${author} ${body}`.trim());
      candidates.push(author);
    }
    for(const c of candidates){
      if(!c) continue;
      const idx=stream.indexOf(c,from);
      if(idx>=0) return {idx,anchor:c};
    }
    return {idx:-1,anchor:''};
  };
  const positions=[];
  for(const row of rows){
    const hit=locate(row,cursor);
    positions.push(hit);
    if(hit.idx>=0) cursor=hit.idx+Math.max(1,hit.anchor.length);
  }
  return rows.map((row,i)=>{
    if(row.clinicReplyObserved) return row;
    const pos=positions[i];
    if(!pos || pos.idx<0) return row;
    const start=pos.idx+pos.anchor.length;
    let end=stream.length;
    for(let j=i+1;j<positions.length;j++){
      if(positions[j]?.idx>=start){end=positions[j].idx;break;}
    }
    const segment=stream.slice(start,Math.min(end,start+900));
    let label=null,count=null;
    for(const re of aliasRegexes){
      const m=segment.match(re);
      if(m){label=m[0].replace(/\s+/g,' ').trim();count=Number(m[1])||null;break;}
    }
    // Last-resort explicit-label fallback: accept a "... replied · N replies" label only
    // when the visible clinic name before "replied" normalizes to a known clinic alias.
    if(!label){
      const re=/([^\n|]{2,100}?)\s+replied\s*[·•-]?\s*(\d+)\s*repl(?:y|ies)/ig;
      let m;
      while((m=re.exec(segment))){
        const before=compact(m[1]);
        if(aliasCompacts.some(a=>before.endsWith(a)||a.endsWith(before))){label=m[0].replace(/\s+/g,' ').trim();count=Number(m[2])||null;break;}
      }
    }
    if(!label) return row;
    return {...row,clinicReplyObserved:true,clinicReplyIndicatorLabel:label,clinicReplyCount:count,replyAssociationMode:'raw-rendered-text'};
  });
}


function countExplicitReplyLabels(bodyText='', pageName='', handle='') {
  const text=String(bodyText||'').replace(/\s+/g,' ').trim();
  if(!text) return 0;
  const compact=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const clean=v=>String(v||'').replace(/\b(center|centre|clinic)\b/ig,' ').replace(/\s+/g,' ').trim();
  const handleHuman=String(handle||'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_\-.]+/g,' ').trim();
  const aliases=[pageName,clean(pageName),handle,handleHuman,clean(handleHuman)].map(compact).filter(v=>v.length>=5);
  const shortened=compact(handle).replace(/center|centre|clinic/g,'');
  if(shortened.length>=5) aliases.push(shortened);
  const known=[...new Set(aliases)];
  let n=0; const re=/([^|]{2,100}?)\s+replied\s*[·•-]?\s*(\d+)\s*repl(?:y|ies)/ig; let m;
  while((m=re.exec(text))){ const before=compact(m[1]); if(known.some(a=>before.endsWith(a)||a.endsWith(before))) n++; }
  return n;
}

function commentEvidenceScore(rows=[], diag=null) {
  const replyAssoc=(rows||[]).filter(x=>x?.clinicReplyObserved).length;
  const explicit=countExplicitReplyLabels(diag?.bodyText||'',diag?.pageName||'',diag?.handle||'');
  const articles=Array.isArray(diag?.articles)?diag.articles.length:0;
  return (rows?.length||0)*20 + replyAssoc*35 + explicit*18 + articles*2;
}

function mergeCommentEvidence(groups=[]) {
  const byKey=new Map();
  for(const rows of groups){
    for(const row of (rows||[])){
      const key=`${row.sourceUrl||''}|${row.author||''}|${row.createdAt||''}|${row.text||''}`;
      const prev=byKey.get(key);
      if(!prev){byKey.set(key,row);continue;}
      // Preserve the strongest observed evidence across Facebook's variable render states.
      const stronger=(!prev.clinicReplyObserved && row.clinicReplyObserved) ? row : prev;
      byKey.set(key,{...prev,...stronger,clinicReplyObserved:!!(prev.clinicReplyObserved||row.clinicReplyObserved),clinicReplyIndicatorLabel:stronger.clinicReplyIndicatorLabel||prev.clinicReplyIndicatorLabel||row.clinicReplyIndicatorLabel||null,clinicReplyCount:stronger.clinicReplyCount||prev.clinicReplyCount||row.clinicReplyCount||null,replyAssociationMode:stronger.replyAssociationMode||prev.replyAssociationMode||row.replyAssociationMode||null});
    }
  }
  return [...byKey.values()];
}

async function collectPublicCommentEvidence(context, postLinks, pageIdentity, options={}) {
  // V2.1.15: Facebook comment rendering is state-variable. Prefer canonical post permalinks
  // before reels, revisit each sampled post in multiple controlled states, and retain/merge
  // the richest observed evidence rather than treating a weak transient render as absence.
  const canonical=[...new Set((postLinks||[]).map(canonicalFacebookContentUrl).filter(Boolean))];
  const prioritized=canonical.sort((a,b)=>{
    const rank=u=>/\/posts\//i.test(u)?0:/\/permalink\.php|\/story\.php/i.test(u)?1:/\/photos\//i.test(u)?2:/\/reel\//i.test(u)?3:4;
    return rank(a)-rank(b);
  });
  const links=prioritized.slice(0,Math.max(1,Math.min(Number(options.commentPostLimit||5),10)));
  if(!links.length)return {status:'posts-not-observed',postsInspected:0,postUrls:[],comments:[],loginLimited:false,commentControlsExpanded:0,rejectedGenericCandidates:(postLinks||[]).length,perPostDiagnostics:[],commentScreenshots:[],evidenceAccumulation:{renderAttempts:0,statesRetained:0,variablePosts:0}};
  const comments=[];let loginLimited=false;const inspected=[];let controlsExpanded=0;let commentSurfacesOpened=0;const commentSurfaceLabels=[];const perPostDiagnostics=[];const commentScreenshots=[];
  let totalRenderAttempts=0, variablePosts=0;
  const attemptsPerPost=Math.max(2,Math.min(Number(options.commentStateAttempts||3),4));

  for(const url of links){
    const page=await context.newPage();await page.setViewportSize({width:1280,height:1000});
    const stateRows=[]; const stateDiags=[]; let richest=null; let postLoginLimited=false;
    try{
      for(let attempt=0;attempt<attemptsPerPost;attempt++){
        totalRenderAttempts++;
        if(attempt===0){
          await resilientGoto(page,url,{timeoutMs:options.commentTimeoutMs||16000,fallbackTimeoutMs:options.commentFallbackTimeoutMs||26000,slowThresholdMs:8000});
        } else if(attempt===2){
          // Reopen the permalink from scratch: this frequently yields a different Facebook state.
          await resilientGoto(page,url,{timeoutMs:options.commentTimeoutMs||16000,fallbackTimeoutMs:options.commentFallbackTimeoutMs||26000,slowThresholdMs:8000});
        }
        await page.waitForTimeout((options.commentHydrationWaitMs||2600) + attempt*450);
        const body=(await page.locator('body').innerText({timeout:2500}).catch(()=>'' )).slice(0,7000);
        if(loginWallUrl(page.url())||/log in to facebook|you must log in|log into facebook/i.test(body)){loginLimited=true;postLoginLimited=true;break;}

        // State 0 = initial hydrated permalink. State 1 = aggressively expanded comments.
        // State 2 = fresh reopen + expansion. We keep whichever state is richest.
        await page.evaluate(()=>window.scrollBy(0,Math.min(900,document.body.scrollHeight))).catch(()=>{});
        await page.waitForTimeout(450);
        const surface=await openCommentSurface(page);
        if(surface.opened){commentSurfacesOpened++; if(surface.label) commentSurfaceLabels.push(surface.label);}
        const expanded=await expandCommentControls(page); controlsExpanded+=expanded;
        const clinicReplyExpansion=await expandClinicReplyThreads(page,pageIdentity.pageName,pageIdentity.handle);
        const clinicReplyThreadsExpanded=clinicReplyExpansion?.clicks||0;
        if(attempt>0){
          // Give "All comments" / reply controls another chance after hydration.
          controlsExpanded+=await expandCommentControls(page);
          await page.waitForTimeout(650);
        }
        await page.evaluate(()=>window.scrollBy(0,Math.min(700,Math.floor(window.innerHeight*.7)))).catch(()=>{});
        await page.waitForTimeout(850+attempt*250);

        let extracted=await extractVisibleComments(page,pageIdentity.pageName,pageIdentity.handle,page.url());
        const diag=await captureCommentDiagnostics(page,page.url()).catch(()=>null);
        if(diag){diag.pageName=pageIdentity.pageName;diag.handle=pageIdentity.handle;}
        if(diag?.bodyText) extracted=associateRepliesFromRenderedText(extracted,diag.bodyText,pageIdentity.pageName,pageIdentity.handle);
        const explicitReplyLabels=countExplicitReplyLabels(diag?.bodyText||'',pageIdentity.pageName,pageIdentity.handle);
        const score=commentEvidenceScore(extracted,{...(diag||{}),pageName:pageIdentity.pageName,handle:pageIdentity.handle});
        const stateName=attempt===0?'initial':attempt===1?'expanded':'reopened-expanded';
        const stateDiag={...(diag||{}),state:stateName,attempt:attempt+1,score,extractedCount:extracted.length,explicitReplyLabels,rawRenderedReplyAssociations:extracted.filter(x=>x.replyAssociationMode==='raw-rendered-text').length,commentSurfaceOpened:surface.opened,commentSurfaceLabel:surface.label||null,clinicReplyThreadsExpanded,clinicReplyTextIndicatorsLocated:clinicReplyExpansion?.textIndicatorsLocated||0,clinicReplyContainerIndicatorsLocated:clinicReplyExpansion?.containerIndicatorsLocated||0,clinicReplyCoordinateClicks:clinicReplyExpansion?.coordinateClicks||0,clinicReplyAncestorClicks:clinicReplyExpansion?.ancestorClicks||0,clinicReplySecondaryClicks:clinicReplyExpansion?.secondaryClicks||0};
        stateRows.push(extracted); stateDiags.push(stateDiag);
        if(!richest || score>richest.score) richest={score,state:stateName,attempt:attempt+1,rows:extracted,diag:stateDiag};

        if(options.outputDir){
          const idx=commentScreenshots.length+1;
          const shot=path.join(options.outputDir,`facebook-comment-surface-${idx}.png`);
          await page.screenshot({path:shot,fullPage:false}).then(()=>commentScreenshots.push(shot)).catch(()=>{});
        }

        // If we already have a very rich state with both comments and reply evidence, avoid needless retries.
        if(extracted.length>=8 && (explicitReplyLabels>=3 || extracted.filter(x=>x.clinicReplyObserved).length>=3)) break;
      }

      const merged=mergeCommentEvidence(stateRows);
      comments.push(...merged);
      inspected.push(page.url());
      const signatures=new Set(stateDiags.map(d=>`${d.extractedCount}|${d.explicitReplyLabels}|${d.rawRenderedReplyAssociations}`));
      if(signatures.size>1) variablePosts++;
      perPostDiagnostics.push({sourceUrl:url,renderAttempts:stateDiags.length,bestEvidenceState:richest?.state||null,bestEvidenceScore:richest?.score||0,evidenceVariability:signatures.size>1?'high':'low',retainedComments:merged.length,retainedReplyAssociations:merged.filter(x=>x.clinicReplyObserved).length,states:stateDiags});
      if(postLoginLimited) loginLimited=true;
    }catch(error){
      perPostDiagnostics.push({sourceUrl:url,renderAttempts:stateDiags.length,bestEvidenceState:richest?.state||null,bestEvidenceScore:richest?.score||0,evidenceVariability:'unknown',error:String(error.message||error),states:stateDiags});
    }finally{await page.close();}
  }
  const uniqueInspected=[...new Set(inspected.map(canonicalFacebookContentUrl).filter(Boolean))];
  const uniqueComments=mergeCommentEvidence([comments]);
  return {status:uniqueComments.length?'observed':(loginLimited?'login-limited':'none-observed'),postsInspected:uniqueInspected.length,postUrls:uniqueInspected,comments:uniqueComments,loginLimited,commentControlsExpanded:controlsExpanded,commentSurfacesOpened,commentSurfaceLabels:[...new Set(commentSurfaceLabels)].slice(0,12),rejectedGenericCandidates:Math.max(0,(postLinks||[]).length-links.length),perPostDiagnostics,commentScreenshots,evidenceAccumulation:{renderAttempts:totalRenderAttempts,statesRetained:perPostDiagnostics.filter(x=>x.bestEvidenceState).length,variablePosts}};
}

async function probeFacebookCandidate(browser, targetUrl, options={}) {
  if (!targetUrl) return {status:'not-requested',targetUrl:null,score:0};
  const storageStateUsable=!!(options.storageStatePath && fs.existsSync(options.storageStatePath));
  const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'en-US',...(storageStateUsable?{storageState:options.storageStatePath}:{})});
  const page=await context.newPage();
  const started=Date.now();
  try {
    await page.setViewportSize({width:1280,height:900});
    const nav=await resilientGoto(page,targetUrl,{timeoutMs:options.timeoutMs||16000,fallbackTimeoutMs:options.fallbackTimeoutMs||26000,slowThresholdMs:8000});
    await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
    await page.waitForTimeout(options.hydrationWaitMs||2600);
    const state=await inspectPage(page,'candidate');
    const finalUrl=page.url();
    const body=String(state.bodyTextSample||'');
    const unavailable=/this content isn['’]t available|content isn['’]t available|page isn['’]t available|content unavailable/i.test(body);
    const loginWall=loginWallUrl(finalUrl)||/log in to facebook|you must log in/i.test(body);
    const name=usefulPageName(state.ogTitle,state.h1,state.title);
    const terms=normText(options.clinicName).split(' ').filter(x=>x.length>=4);
    const hay=normText(`${name||''} ${body.slice(0,2200)} ${expectedHandle(targetUrl)||''}`);
    const matchedTerms=terms.filter(t=>hay.includes(t)).length;
    const nameCoverage=terms.length?matchedTerms/terms.length:0;
    const expected=sameFacebookPage(finalUrl,targetUrl)||sameFacebookPage(state.ogUrl,targetUrl);
    const fbSurface=parseSurfaceEvidence(body);
    const websiteHost=hostOf(options.websiteUrl), candidateWebsiteHost=hostOf(state.websiteUrl);
    const websiteMatch=!!(websiteHost&&candidateWebsiteHost&&websiteHost===candidateWebsiteHost);
    const websitePhones=(options.websitePhoneNumbers||[]).map(normPhone).filter(Boolean);
    const candidatePhones=(state.phoneCandidates||[]).map(normPhone).filter(Boolean);
    const phoneMatch=websitePhones.length&&candidatePhones.length?candidatePhones.some(x=>websitePhones.includes(x)):false;
    const messageVisible=(state.actions?.message||[]).length>0;
    let score=0;
    if (!unavailable && !loginWall) score+=35;
    if (expected) score+=10;
    score+=Math.round(nameCoverage*25);
    if (websiteMatch) score+=15;
    if (phoneMatch) score+=10;
    if (messageVisible) score+=8;
    if (fbSurface.followerCount!=null||fbSurface.recommendationPercent!=null) score+=12;
    if (unavailable) score-=50;
    if (loginWall) score-=30;
    score=Math.max(0,Math.min(100,score));
    return {status:'probed',targetUrl,finalUrl,httpStatus:nav.response?.status?.()||null,durationMs:Date.now()-started,displayState:unavailable?'unavailable-content':loginWall?'login-wall':'clinic-surface',pageName:name,handle:expectedHandle(targetUrl),nameCoverage:Number(nameCoverage.toFixed(2)),websiteMatch,phoneMatch,messageVisible,surfaceEvidence:fbSurface,score,identityConfidence:score>=70?'high':score>=45?'medium':'low'};
  } catch(error) {
    return {status:'probe-failed',targetUrl,durationMs:Date.now()-started,error:String(error.message||error),score:0,identityConfidence:'low'};
  } finally { await context.close(); }
}

function rankFacebookCandidates(candidates=[]) {
  return [...candidates].sort((a,b)=>(b.score||0)-(a.score||0)||String(a.targetUrl).localeCompare(String(b.targetUrl)));
}

async function probeFacebookPage(browser, targetUrl, options={}) {
  if (!targetUrl) return {status:'not-requested',targetUrl:null};
  const storageStateUsable=!!(options.storageStatePath && fs.existsSync(options.storageStatePath));
  const context=await browser.newContext({ignoreHTTPSErrors:true,locale:'en-US',...(storageStateUsable ? {storageState:options.storageStatePath} : {})});
  const started=Date.now();
  try {
    const desktop=await collectPublicStates(context,targetUrl,options,'desktop');
    const mobile=await collectPublicStates(context,targetUrl,options,'mobile').catch(error=>({variant:'mobile',error:String(error.message||error),states:[],moreExpanded:false,screenshot:null,finalUrl:null,nav:null}));
    const data=mergeStateData([desktop,mobile]);
    const finalUrl=desktop.finalUrl||targetUrl;
    const body=data.bodyTextSample||'';
    const loginWallObserved=loginWallUrl(finalUrl) || /log in to facebook|you must log in|log into facebook/i.test(body);
    const generic=looksGenericFacebook(finalUrl) && !loginWallObserved;
    const sameExpected=sameFacebookPage(finalUrl,targetUrl) || sameFacebookPage(data.ogUrl,targetUrl);
    const expected=expectedHandle(targetUrl);
    const nameTerms=normText(options.clinicName).split(' ').filter(x=>x.length>=4);
    const inferredPageName=usefulPageName(data.ogTitle,data.h1,data.title);
    const titleText=normText(`${inferredPageName||''} ${data.bodyTextSample.slice(0,1000)} ${expected||''}`);
    const nameMatch=nameTerms.length ? nameTerms.filter(t=>titleText.includes(t)).length >= Math.min(2,nameTerms.length) : null;
    const landsOnClinicPage=loginWallObserved ? null : (sameExpected || nameMatch===true ? true : generic ? false : null);
    const wrongPage=loginWallObserved ? null : (generic ? false : (landsOnClinicPage===false ? true : false));

    const book=data.actions.book[0]||null;
    const bookProbe=book?.href ? await probeAction(browser,book.href,options) : {tested:false,works:null,finalUrl:null,requiresLogin:null};
    const websiteHost=hostOf(options.websiteUrl), fbWebsiteHost=hostOf(data.websiteUrl);
    let websiteLinkQuality=null;
    if (data.websiteUrl) websiteLinkQuality=websiteHost&&fbWebsiteHost===websiteHost?100:/facebook\.com|linktr\.ee|bio\.site/i.test(data.websiteUrl)?35:70;
    const websitePhones=(options.websitePhoneNumbers||[]).map(normPhone).filter(Boolean);
    const fbPhones=(data.phoneCandidates||[]).map(normPhone).filter(Boolean);
    const phoneMatchesWebsite=fbPhones.length&&websitePhones.length ? fbPhones.some(x=>websitePhones.includes(x)) : null;
    const pageName=usefulPageName(data.ogTitle,data.h1,data.title) || (((sameExpected||nameMatch===true)&&options.clinicName) ? options.clinicName : (sameExpected ? expected : null));
    const surfaceEvidence=parseSurfaceEvidence(data.bodyTextSample||'');
    const targetedCapture=storageStateUsable ? await collectTargetedAuthenticatedCaptures(context,targetUrl,options) : {status:'not-run',captures:[],diagnostics:[]};
    const targetedSignals=(targetedCapture.captures||[]).flatMap(c=>c.interactionSignals||[]);
    const targetedActionHit=(kind,re)=>targetedSignals.find(x=>facebookActionKind(x)===kind || re.test([x.label,x.text,x.href].filter(Boolean).join(' ')))||null;
    const targetedBookSignal=targetedSignals.find(x=>bookingActionEvidence(x).qualified)||null;
    const targetedBookEvidence=targetedBookSignal?bookingActionEvidence(targetedBookSignal):{qualified:false,basis:null,label:null,target:null};
    const targetedActions={
      message:targetedActionHit('message',/\bmessage\b|send message|ข้อความ/i),
      call:targetedActionHit('call',/\bcall\b|call now|โทร/i),
      book:targetedBookSignal,
      whatsapp:targetedActionHit('whatsapp',/whatsapp/i)
    };
    let routeDiscovery=storageStateUsable ? await discoverContentRoutes(context,targetUrl,options) : {postLinks:[],sources:[],diagnostics:[],feedCards:[],newestActivityLabel:null};
    if(storageStateUsable && options.facebookDeepSample && (routeDiscovery.feedCards||[]).length<3){
      const retry=await discoverContentRoutes(context,targetUrl,{...options,contentHydrationWaitMs:Math.max(Number(options.contentHydrationWaitMs||2400),3300),contentScrollSteps:Math.max(Number(options.contentScrollSteps||5),5)});
      const cardMap=new Map(); for(const c of [...(routeDiscovery.feedCards||[]),...(retry.feedCards||[])]){const k=c.sourceUrl||c.text?.slice(0,180);if(k&&!cardMap.has(k))cardMap.set(k,c);}
      const linkMap=new Map(); for(const x of [...(routeDiscovery.sources||[]),...(retry.sources||[])])if(x?.url&&!linkMap.has(x.url))linkMap.set(x.url,x);
      routeDiscovery={postLinks:[...new Set([...(routeDiscovery.postLinks||[]),...(retry.postLinks||[])])],sources:[...linkMap.values()],diagnostics:[...(routeDiscovery.diagnostics||[]),...(retry.diagnostics||[]).map(d=>({...d,acquisitionRetry:true}))],feedCards:[...cardMap.values()].sort((a,b)=>(({posts:0,photos:1,reels:2}[a.route]??9)-({posts:0,photos:1,reels:2}[b.route]??9))).slice(0,20),newestActivityLabel:routeDiscovery.newestActivityLabel||retry.newestActivityLabel||null,acquisitionRetryUsed:true,commercialSamplingPriority:'posts-then-photos-then-reels'};
    }
    const combinedPostLinks=[...new Set([...(routeDiscovery.postLinks||[]),...(data.postLinks||[])])];
    const commentEvidence=await collectPublicCommentEvidence(context,combinedPostLinks,{pageName,handle:expected},{...options,feedCards:routeDiscovery.feedCards||data.feedCards||[]});
    const classifiedComments=(commentEvidence.comments||[]).map(c=>({...c,...classifyIntentText(c.text)})).filter(c=>c.patientIntent);
    const dated=classifiedComments.map(c=>c.createdAt).filter(Boolean).map(v=>new Date(v)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>a-b);
    const anyAction=Object.values(data.actions).some(arr=>arr.length);
    const statesInspected=data.states.map(s=>s.stateName);
    const actionCoverage={statesInspected,desktopStates:desktop.states?.length||0,mobileStates:mobile.states?.length||0,moreMenuExpanded:!!(desktop.moreExpanded||mobile.moreExpanded),hydrationWaitMs:options.hydrationWaitMs||2600,publicSession:!storageStateUsable,authenticatedSession:storageStateUsable};
    const screenshotContradictionStatus=anyAction?'not-indicated':'visual-review-recommended';

    return {
      schemaVersion:SCHEMA_VERSION,status:'probed',targetUrl,testedAt:new Date().toISOString(),durationMs:Date.now()-started,
      authentication:{requested:!!options.authRequested,used:storageStateUsable,status:storageStateUsable?'authenticated-session':(options.authRequested?'session-missing-fell-back-public':'public-session'),storageStatePath:storageStateUsable?options.storageStatePath:null},
      screenshots:{desktop:desktop.screenshot||null,mobile:mobile.screenshot||null,targeted:Object.fromEntries((targetedCapture.captures||[]).map(x=>[x.kind,x.path]))},
      navigation:{finalUrl,httpStatus:desktop.nav?.response?.status?.()||null,fallbackUsed:!!desktop.nav?.fallbackUsed,attempts:desktop.nav?.attempts||[],mobileFinalUrl:mobile.finalUrl||null,mobileError:mobile.error||null},
      destination:{testedUrl:targetUrl,finalUrl,httpReachable:!!desktop.nav?.response||!!finalUrl,landsOnClinicPage,landsOnExpectedBranch:null,genericFacebookDestination:generic,wrongPage,loginWallObserved,redirectChain:(desktop.nav?.attempts||[]).map(a=>a.finalUrl).filter(Boolean),notes:loginWallObserved?(storageStateUsable?'Authenticated probe encountered a Facebook login/checkpoint wall; session may need refresh.':'Public probe encountered a Facebook login wall; hidden evidence remains unknown.'):(options.authRequested&&!storageStateUsable?'Authenticated mode requested but no saved session was found; public mode used instead.':'')},
      page:{pageName,handle:expected,category:null,address:null,phone:data.phoneCandidates?.[0]||null,websiteUrl:data.websiteUrl,lastActivityDate:routeDiscovery.newestActivityLabel||data.activityLabels?.[0]||null,followerCount:surfaceEvidence.followerCount,recommendationPercent:surfaceEvidence.recommendationPercent,recommendationReviewCount:surfaceEvidence.recommendationReviewCount},
      actions:{
        bookButtonPresent:(book||targetedActions.book)?true:null,bookButtonStatus:actionStatus(!!(book||targetedActions.book),loginWallObserved),bookButtonConfidence:(book||targetedActions.book)?'high':'medium',bookButtonLabel:book?`${book.text||book.aria}`.trim():(targetedBookEvidence.label||null),bookButtonTarget:book?.href||(targetedBookEvidence.target||null),bookButtonWorks:bookProbe.works,bookButtonFinalUrl:bookProbe.finalUrl,
        messageButtonPresent:(data.actions.message.length||targetedActions.message)?true:null,messageButtonStatus:actionStatus(!!(data.actions.message.length||targetedActions.message),loginWallObserved),messageButtonConfidence:(data.actions.message.length||targetedActions.message)?'high':'medium',
        whatsappButtonPresent:(data.actions.whatsapp.length||targetedActions.whatsapp)?true:null,whatsappButtonStatus:actionStatus(!!(data.actions.whatsapp.length||targetedActions.whatsapp),loginWallObserved),whatsappButtonConfidence:(data.actions.whatsapp.length||targetedActions.whatsapp)?'high':'medium',
        callButtonPresent:(data.actions.call.length||targetedActions.call)?true:null,callButtonStatus:actionStatus(!!(data.actions.call.length||targetedActions.call),loginWallObserved),callButtonConfidence:(data.actions.call.length||targetedActions.call)?'high':'medium',
        externalBookingPresent:book?.href?hostOf(book.href)!==hostOf(targetUrl):null,bookingRequiresLogin:bookProbe.requiresLogin,
        actionDiscovery:actionCoverage
      },
      consistency:{brandNameMatches:nameMatch,branchMatches:null,phoneMatchesWebsite,addressMatchesWebsite:null,hoursMatchWebsite:null,hoursMatchGoogleBusiness:null,websiteLinkQuality,bookingLinkQuality:bookProbe.works===true?(bookProbe.requiresLogin?60:100):bookProbe.works===false?0:null},
      demand:{sampleWindowStart:dated.length?dated[0].toISOString():null,sampleWindowEnd:dated.length?dated[dated.length-1].toISOString():null,patientIntentCommentCount:classifiedComments.length||null,generalInterestIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.generalInterestIntent).length:null,classificationConfidence:{high:classifiedComments.filter(c=>c.classification?.confidence==='high').length,medium:classifiedComments.filter(c=>c.classification?.confidence==='medium').length,low:classifiedComments.filter(c=>c.classification?.confidence==='low').length},bookingIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.bookingIntent).length:null,pricingIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.pricingIntent).length:null,availabilityIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.availabilityIntent).length:null,urgentIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.urgentIntent).length:null,locationIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.locationIntent).length:null,treatmentIntentCommentCount:classifiedComments.length?classifiedComments.filter(c=>c.treatmentIntent).length:null,comments:classifiedComments},
      response:{clinicRepliesObserved:classifiedComments.length?classifiedComments.filter(c=>c.clinicReplyObserved||c.clinicReplyAt||c.clinicReplyAuthor||c.clinicReplyText).length:null,answeredIntentCount:null,unansweredIntentCount:null,medianResponseMinutes:null,p75ResponseMinutes:null,answeredWithin5MinPercent:null,answeredWithin60MinPercent:null,unansweredAfter24hPercent:null},
      targetedEvidenceCapture:{status:targetedCapture.status,captures:(targetedCapture.captures||[]).map(x=>({kind:x.kind,path:x.path,url:x.url})),diagnostics:targetedCapture.diagnostics||[]},
      probeDiagnostics:{visibleActionCounts:{book:data.actions.book.length+(targetedActions.book?1:0),message:data.actions.message.length+(targetedActions.message?1:0),whatsapp:data.actions.whatsapp.length+(targetedActions.whatsapp?1:0),call:data.actions.call.length+(targetedActions.call?1:0)},sameScanEvidenceAccumulation:{positiveEvidenceMonotonic:true,evidenceAcquisition:{boundedRetries:true,targetedCapturePolicy:targetedCapture.acquisitionPolicy||null,contentRetryUsed:!!routeDiscovery.acquisitionRetryUsed,dedicatedActionHrefSemantics:true,commercialContentPriority:routeDiscovery.commercialSamplingPriority||'posts-then-photos-then-reels'},targetedActionEvidence:{message:!!targetedActions.message,call:!!targetedActions.call,book:!!targetedActions.book,whatsapp:!!targetedActions.whatsapp},bookingActionIntegrity:{qualified:!!targetedActions.book,basis:targetedBookEvidence.basis||((book&&`${book.text||book.aria||''}`.trim())?'visible-action-label':(book?.href?'visible-action-target':null)),label:book?`${book.text||book.aria||''}`.trim()||null:targetedBookEvidence.label||null,target:book?.href||targetedBookEvidence.target||null,rule:'Booking is positive only with an explicit booking label, recognized booking route/provider, or a concrete visible booking action.'},rule:'A positive action observed in any valid same-scan state is retained; later not-observed states cannot erase it.'},stateSummaries:data.states.map(s=>({state:s.stateName,interactiveCount:s.visibleInteractiveCount,book:s.actions?.book?.length||0,message:s.actions?.message?.length||0,whatsapp:s.actions?.whatsapp?.length||0,call:s.actions?.call?.length||0,more:s.actions?.more?.length||0})),commentExtractionStatus:commentEvidence.status,commentPostDiscovery:{postsFound:combinedPostLinks.length,postsInspected:commentEvidence.postsInspected,postUrls:commentEvidence.postUrls,loginLimited:commentEvidence.loginLimited,commentControlsExpanded:commentEvidence.commentControlsExpanded||0,commentSurfacesOpened:commentEvidence.commentSurfacesOpened||0,commentSurfaceLabels:commentEvidence.commentSurfaceLabels||[],commentScreenshots:commentEvidence.commentScreenshots||[],perPostDiagnostics:commentEvidence.perPostDiagnostics||[],evidenceAccumulation:commentEvidence.evidenceAccumulation||null,rejectedGenericCandidates:commentEvidence.rejectedGenericCandidates||0,authenticatedObservation:storageStateUsable,contentRouteDiscovery:routeDiscovery.diagnostics,contentSources:routeDiscovery.sources,feedCards:(routeDiscovery.feedCards||data.feedCards||[]).slice(0,20),samplingStrategy:{mode:options.facebookDeepSample?'adaptive-deep':'standard',feedCardCandidateCap:Number(options.feedCardCandidateCap||10),targetReliableEngagementSamples:Number(options.targetReliableEngagementSamples||5),deepCommentPostLimit:Number(options.commentPostLimit||5)},newestActivityLabel:routeDiscovery.newestActivityLabel},bookActionProbe:bookProbe,screenshotContradictionStatus,absencePolicy:'not-observed is not treated as verified absent or scored as zero.'}
    };
  } catch(error) {
    return {schemaVersion:SCHEMA_VERSION,status:'probe-failed',targetUrl,testedAt:new Date().toISOString(),durationMs:Date.now()-started,error:String(error.message||error),destination:{testedUrl:targetUrl,finalUrl:null,httpReachable:false,landsOnClinicPage:null,genericFacebookDestination:null,wrongPage:null,loginWallObserved:null}};
  } finally { await context.close(); }
}

function mergeFacebookEvidence(base, probe) {
  const out=JSON.parse(JSON.stringify(base||{}));
  if (!probe || probe.status==='not-requested') return out;
  out.schemaVersion=SCHEMA_VERSION; out.status='evidence-collected';
  for (const section of ['destination','page','actions','consistency','demand','response']) out[section]={...(out[section]||{}),...(probe[section]||{})};
  out.provenance={...(out.provenance||{}),source:probe.authentication?.used?'authenticated-browser-probe-plus-manual':'browser-probe-plus-manual',collectedAt:probe.testedAt||new Date().toISOString(),sourceRefs:[...(out.provenance?.sourceRefs||[]),probe.targetUrl].filter(Boolean),notes:[out.provenance?.notes,probe.destination?.notes].filter(Boolean).join(' ')};
  out.probe=probe;
  return out;
}
module.exports={probeFacebookPage,probeFacebookCandidate,rankFacebookCandidates,mergeFacebookEvidence,associateRepliesFromRenderedText,classifyIntentText,parseSurfaceEvidence,facebookDateCandidate,facebookActionKind,contentRouteCandidates,pageBaseUrl,facebookPageRoute,sameFacebookPage,numericFacebookPageId,expectedHandle};
