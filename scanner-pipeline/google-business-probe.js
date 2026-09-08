const fs = require('fs');
const path = require('path');

const VERSION = '2.2.33';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const uniq = a => [...new Set((a || []).filter(Boolean))];

function accumulateObserved(values=[], {prefer='first'}={}) {
  const observed=values.filter(v=>v!==null&&v!==undefined&&v!=='');
  const normalized=[...new Set(observed.map(v=>typeof v==='number'?v:String(v)))];
  if(!observed.length) return {value:null,status:'not-observed',observations:0,conflict:false,values:[]};
  const conflict=normalized.length>1;
  return {value:prefer==='last'?observed[observed.length-1]:observed[0],status:conflict?'conflict':'observed',observations:observed.length,conflict,values:normalized};
}
function mergeObservedAction(states=[], re) {
  const hits=states.map(raw=>observedAction(raw?.rows||[],re)).filter(x=>x?.observed===true);
  if(!hits.length) return {observed:null,label:null,href:null,evidenceCount:0};
  const hrefs=[...new Set(hits.map(x=>x.href).filter(Boolean))];
  const labels=[...new Set(hits.map(x=>x.label).filter(Boolean))];
  return {observed:true,label:labels[0]||null,href:hrefs[0]||null,evidenceCount:hits.length,conflict:hrefs.length>1||labels.length>1,labels,hrefs};
}

function searchUrl(identity = {}) {
  const q = clean([identity.clinicName, identity.location].filter(Boolean).join(' '));
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

function firstCandidate(template = {}) {
  const urls = template?.discovery?.googleMapsUrls || [];
  return urls.find(u => /^https?:\/\/(?:www\.)?(?:google\.[^/]+\/maps|maps\.google\.|maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(String(u))) || searchUrl(template.identity || {});
}

function normalizeIdentityText(value='') {
  return clean(value).toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F]+/g,' ')
    .replace(/\b(center|centre|clinic|dental|dentistry|the|co|ltd|company)\b/g,' ')
    .replace(/\s+/g,' ').trim();
}
function identityTokenScore(expectedName='', candidateText='') {
  const exp=normalizeIdentityText(expectedName), got=normalizeIdentityText(candidateText);
  const tokens=exp.split(' ').filter(Boolean);
  if(!tokens.length || !got) return 0;
  const shared=tokens.filter(t=>got.includes(t)).length;
  return shared/tokens.length;
}
function genericMapsShellName(name='') {
  return /^(?:results?|google maps|maps|ผลลัพธ์)$/i.test(clean(name));
}
async function selectBestGoogleResult(page, expectedName='') {
  const candidates=await page.evaluate(()=>{
    const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
    const visible=el=>{const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none';};
    return [...document.querySelectorAll('a[href*="/maps/place/"]')].filter(visible).map(a=>({
      text:norm(a.innerText||a.textContent||a.getAttribute('aria-label')), href:a.href
    })).filter(x=>x.text&&x.href).slice(0,80);
  }).catch(()=>[]);
  const ranked=candidates.map(c=>({...c,score:identityTokenScore(expectedName,c.text)})).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(!best || best.score<0.6) return {selected:false,candidate:null,score:best?.score||0};
  await page.goto(best.href,{waitUntil:'domcontentloaded',timeout:18000}).catch(()=>null);
  await sleep(1800);
  return {selected:true,candidate:best.href,label:best.text,score:best.score};
}

async function dismissConsent(page) {
  const labels = [/accept all/i,/reject all/i,/agree/i,/i agree/i,/accept/i];
  for (const re of labels) {
    const loc = page.getByRole('button', { name: re }).first();
    if (await loc.count().catch(() => 0)) {
      try { if (await loc.isVisible()) { await loc.click({timeout:1500}); await sleep(900); return true; } } catch {}
    }
  }
  return false;
}

async function extractVisibleEvidence(page) {
  return page.evaluate(() => {
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const rows = Array.from(document.querySelectorAll('button,a,[role="button"],[aria-label],h1,h2,[role="tab"]')).filter(visible).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      text: norm(el.innerText || el.textContent),
      aria: norm(el.getAttribute('aria-label')),
      title: norm(el.getAttribute('title')),
      href: el.href || el.closest?.('a[href]')?.href || el.querySelector?.('a[href]')?.href || null,
      dataValue: norm(el.getAttribute('data-value')),
      jsaction: norm(el.getAttribute('jsaction'))
    })).filter(x => x.text || x.aria || x.title || x.href).slice(0, 700);
    const bodyText = norm(document.body?.innerText || '').slice(0, 32000);
    const h1 = Array.from(document.querySelectorAll('h1')).find(visible);
    const largeImages = Array.from(document.images).filter(img => visible(img)).map(img => {
      const r = img.getBoundingClientRect();
      return { width:Math.round(r.width), height:Math.round(r.height), alt:norm(img.alt), src:String(img.currentSrc || img.src || '').slice(0,500) };
    }).filter(x => x.width >= 80 && x.height >= 60).slice(0,30);
    // Small visible text boxes let us reconstruct compact Maps header pairs even when
    // Google renders rating and total review count in separate sibling nodes.
    const textBoxes = Array.from(document.querySelectorAll('span,div,button,a')).filter(visible).map(el => {
      const text=norm(el.innerText || el.textContent);
      const r=el.getBoundingClientRect();
      return {text,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
    }).filter(x=>x.text && x.text.length<=90 && x.width>0 && x.height>0 && x.y>=0 && x.y<=700).slice(0,1200);
    return { title: document.title, pageName: norm(h1?.innerText || ''), rows, bodyText, url: location.href, largeImages, textBoxes };
  });
}

function parseRatingAndReviews(raw = {}) {
  // Prefer compact interactive/profile rows over the full page body. The body can contain
  // ratings/review counts from individual reviews or nearby places and previously caused
  // false profile values such as 5.0 / 225 when the visible header was 4.8 / 243.
  const rowSources=(raw.rows||[]).flatMap(r=>[r.aria,r.title,r.text]).map(clean).filter(Boolean);
  const compactSources=rowSources.filter(x=>x.length<=320);
  const sources=[...compactSources, ...rowSources.filter(x=>x.length>320), clean(raw.bodyText)].filter(Boolean);
  const parseCount=(v,{explicit=false,bareSibling=false}={})=>{
    const raw=String(v??'').trim();
    if(!raw) return null;
    // A review count must be integer-like. Decimal ratings such as 4.8 must never
    // be accepted as counts. Thousands separators are allowed (1,234 / 1.234).
    if(/^\d+[.,]\d{1,2}$/.test(raw)) return null;
    const normalized=raw.replace(/[\s,]/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'');
    if(!/^\d+$/.test(normalized)) return null;
    const n=Number(normalized);
    if(!Number.isSafeInteger(n) || n<1 || n>=1000000) return null;
    // Bare sibling counts are structurally weaker than explicit "reviews" labels
    // or parenthesized counts. Tiny bare numbers are much more likely to be stars,
    // UI ordinals, or duplicated rating text than true review totals.
    if(bareSibling && !explicit && n<=5) return null;
    return n;
  };
  const pairs=[];
  // Maps commonly splits the compact header into separate siblings: e.g. `4.8`,
  // star glyphs, and `(243)`. Reconstruct only close same-row pairs near the top
  // of the place panel. Parentheses or an explicit review label are strongest;
  // a bare count is accepted only when horizontally adjacent to a decimal rating.
  const boxes=(raw.textBoxes||[]).filter(b=>b && b.text);
  for(const rb of boxes){
    const rm=String(rb.text).match(/^([1-5](?:\.\d)?)$/);
    if(!rm) continue;
    const rating=Number(rm[1]);
    if(!Number.isFinite(rating) || rating<1 || rating>5) continue;
    for(const cb of boxes){
      if(cb===rb) continue;
      const dy=Math.abs((cb.y||0)-(rb.y||0));
      const dx=(cb.x||0)-((rb.x||0)+(rb.width||0));
      if(dy>36 || dx < -20 || dx>260) continue;
      const t=String(cb.text).trim();
      let m=t.match(/^\(?\s*([\d,.]{1,9})\s*\)?\s*(?:reviews?|รีวิว)?$/i);
      if(!m) continue;
      const explicit=/[()]/.test(t) || /reviews?|รีวิว/i.test(t);
      if(!explicit && !String(rb.text).includes('.')) continue;
      const count=parseCount(m[1],{explicit,bareSibling:true});
      if(Number.isFinite(count)){
        pairs.push({rating,reviewCount:count,idx:-1000 + Math.round(dy+Math.max(0,dx)/10),strong:explicit,spatial:true});
      }
    }
  }
  for(let idx=0; idx<sources.length; idx++){
    const source=String(sources[idx]);
    const strong=[
      /(\d(?:\.\d)?)\s*(?:stars?|ดาว)[^\d]{0,80}([\d,.]+)\s*(?:reviews?|รีวิว)/i,
      /([\d,.]+)\s*(?:reviews?|รีวิว)[^\d]{0,80}(\d(?:\.\d)?)\s*(?:stars?|ดาว)/i,
      /rated\s*(\d(?:\.\d)?)\s*(?:out of 5)?[^\d]{0,80}([\d,.]+)\s*(?:reviews?)/i
    ];
    strong.forEach((re,i)=>{
      const m=source.match(re); if(!m)return;
      const reversed=i===1;
      const rating=Number(reversed?m[2]:m[1]);
      const count=parseCount(reversed?m[1]:m[2],{explicit:true});
      if(rating>=1&&rating<=5&&Number.isFinite(count)&&count>=1) pairs.push({rating,reviewCount:count,idx,strong:true});
    });
    // Google often renders the profile header as "4.8 (243) · Dental clinic".
    // Accept this compact form only from short/interactive sources, never from the whole body.
    if(idx<compactSources.length){
      const m=source.match(/(?:^|\s)(\d(?:\.\d)?)\s*[★⭐]?\s*\(\s*([\d,.]+)\s*\)/);
      if(m){ const rating=Number(m[1]), count=parseCount(m[2]); if(rating>=1&&rating<=5&&Number.isFinite(count)&&count>=1) pairs.push({rating,reviewCount:count,idx,strong:false}); }
    }
  }
  if(pairs.length){
    const sane=pairs.filter(p=>Number.isFinite(p.rating)&&p.rating>=1&&p.rating<=5&&Number.isSafeInteger(p.reviewCount)&&p.reviewCount>=1&&p.reviewCount<1000000);
    sane.sort((a,b)=>(Number(b.strong)-Number(a.strong)) || a.idx-b.idx);
    if(sane.length) return {rating:sane[0].rating,reviewCount:sane[0].reviewCount};
  }
  let rating=null, reviewCount=null;
  const fallbackSources=[...compactSources, ...(clean(raw.bodyText).length<=600?[clean(raw.bodyText)]:[])];
  for(const source of fallbackSources){
    const m=String(source).match(/(?:rated\s*)?(\d(?:\.\d)?)\s*(?:stars?|ดาว|\/\s*5)/i);
    const n=m?Number(m[1]):null; if(n>=1&&n<=5){rating=n;break;}
  }
  for(const source of fallbackSources){
    const m=String(source).match(/([\d,.]+)\s*(?:Google\s*)?(?:reviews?|รีวิว)/i); if(!m)continue;
    const n=parseCount(m[1],{explicit:true}); if(Number.isFinite(n)){reviewCount=n;break;}
  }
  return { rating, reviewCount };
}

function parseCategory(raw = {}) {
  const candidates = [...(raw.rows || []).flatMap(r => [r.text,r.aria,r.title]), raw.bodyText].filter(Boolean);
  const categoryPatterns = [
    /\b(dental clinic|dentist|cosmetic dentist|dental implants periodontist|orthodontist|oral surgeon)\b/i,
    /(คลินิกทันตกรรม|ทันตแพทย์)/i
  ];
  for (const c of candidates) for (const re of categoryPatterns) { const m=String(c).match(re); if(m) return clean(m[1]); }
  return null;
}

function parseRelativeReviewDates(text='') {
  const t=String(text||'');
  const matches=[...t.matchAll(/\b(?:a|an|one|\d+)\s+(day|week|month|year)s?\s+ago\b/gi)].map(m=>m[0]);
  return uniq(matches).slice(0,12);
}

function parseDedicatedReviewCount(raw={}, ratingHint=null) {
  const rows=(raw.rows||[]).map(r=>({
    label:clean([r.aria,r.title,r.text].filter(Boolean).join(' ')),
    role:r.role||r.tag||null,
    href:r.href||null
  })).filter(x=>x.label);
  const parseCount=v=>{
    const n=Number(String(v||'').replace(/[\s,]/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,''));
    return Number.isSafeInteger(n)&&n>=1&&n<1000000?n:null;
  };
  const observations=[];
  const ratingText=Number.isFinite(Number(ratingHint))?String(Number(ratingHint)):null;
  // Dedicated Reviews controls/header rows are substantially safer than generic body text.
  for(const row of rows){
    const label=row.label;
    if(!/reviews?|รีวิว/i.test(label)) continue;
    if(ratingText && label.includes(ratingText)){
      const m=label.match(/([\d,.]{1,9})\s*(?:reviews?|รีวิว)\b/i);
      const n=m&&parseCount(m[1]); if(n) observations.push({value:n,source:'reviews-control-with-rating',label:label.slice(0,240)});
    }
  }
  for(const row of rows){
    const m=row.label.match(/(?:^|\s|\()([\d,.]{1,9})\s*(?:reviews?|รีวิว)\b/i);
    const n=m&&parseCount(m[1]);
    if(n) observations.push({value:n,source:'dedicated-reviews-control',label:row.label.slice(0,240)});
  }
  // Body fallback only on the dedicated Reviews surface, and only explicit "N reviews" semantics.
  if(!observations.length){
    const head=clean(raw.bodyText||'').slice(0,7000);
    const matches=[...head.matchAll(/(?:^|\s|\()([\d,.]{1,9})\s*(?:reviews?|รีวิว)\b/ig)];
    for(const m of matches){const n=parseCount(m[1]); if(n) observations.push({value:n,source:'dedicated-reviews-body',label:m[0].trim()});}
  }
  if(!observations.length) return {value:null,status:'not-observed',observations:[],conflict:false};
  const vals=[...new Set(observations.map(x=>x.value))];
  // Prefer the first high-quality header/control observation. Conflicts are explicit, never silently averaged.
  return {value:observations[0].value,status:vals.length>1?'conflict':'observed',observations,conflict:vals.length>1,values:vals};
}

async function probeReviewsSurface(page, outputDir, ratingHint=null) {
  // V2.2.33: use the dedicated Reviews control as a first-class evidence route.
  // Do not depend on the general profile render to expose the count.
  const candidates = [
    page.locator('button[aria-label*="review" i],button[aria-label*="รีวิว" i]').first(),
    page.getByRole('tab', { name:/reviews?|รีวิว/i }).first(),
    page.getByRole('button', { name:/reviews?|รีวิว/i }).first(),
    page.locator('a[aria-label*="review" i],a[href*="review" i]').first(),
    page.getByText(/\b\d[\d,.]*\s+(?:reviews?|รีวิว)\b/i).first(),
    page.getByText(/reviews?|รีวิว/i).first()
  ];
  let opened=false, openedBy=null;
  for (const loc of candidates) {
    try {
      if (await loc.count() && await loc.isVisible()) {
        const label=clean((await loc.getAttribute('aria-label').catch(()=>'')) || (await loc.innerText().catch(()=>'')) || '');
        await loc.click({timeout:2200}); opened=true; openedBy=label||'reviews-control'; break;
      }
    } catch {}
  }
  if (!opened) return { opened:false, raw:null, screenshot:null, relativeDates:[], reviewCountEvidence:{value:null,status:'not-observed',observations:[],conflict:false}, route:'dedicated-reviews-control' };
  const states=[];
  for(let attempt=0;attempt<3;attempt++){
    await sleep(1100 + attempt*500);
    states.push(await extractVisibleEvidence(page).catch(()=>null));
  }
  const valid=states.filter(Boolean);
  const countEvidences=valid.map(raw=>parseDedicatedReviewCount(raw,ratingHint));
  const counts=[]; const obs=[];
  for(const e of countEvidences){if(e?.value!=null)counts.push(e.value); obs.push(...(e?.observations||[]));}
  const acc=accumulateObserved(counts);
  const reviewCountEvidence={...acc,observations:obs,route:'dedicated-reviews-surface',openedBy};
  const raw=valid[valid.length-1]||null;
  const screenshot=path.join(outputDir || process.cwd(),'google-business-reviews.png');
  await page.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
  return { opened:true, raw, states:valid, screenshot, relativeDates:parseRelativeReviewDates(raw?.bodyText||''), reviewCountEvidence, route:'dedicated-reviews-surface', openedBy };
}

function observedAction(rows, re) {
  const hit = (rows || []).find(r => re.test([r.aria,r.title,r.text,r.dataValue,r.jsaction].filter(Boolean).join(' ')));
  return hit ? { observed:true, label:hit.aria || hit.title || hit.text, href:hit.href || null } : { observed:null, label:null, href:null };
}

async function resolveActionHrefByInteraction(page, actionNameRe) {
  // Maps sometimes renders Book/Appointment as a JS button with no href until it
  // is activated. Opening that action is a read-only GET/navigation and lets us
  // classify the actual handoff without submitting patient data.
  const candidates=page.locator('button,a,[role="button"],[aria-label]');
  const count=Math.min(await candidates.count().catch(()=>0),160);
  for(let i=0;i<count;i++){
    const loc=candidates.nth(i);
    const meta=await loc.evaluate(el=>({
      visible:!!(el.getBoundingClientRect().width&&el.getBoundingClientRect().height),
      label:[el.getAttribute('aria-label'),el.getAttribute('title'),el.innerText,el.textContent,el.getAttribute('data-value')].filter(Boolean).join(' ').replace(/\s+/g,' ').trim(),
      href:el.href||el.closest?.('a[href]')?.href||el.querySelector?.('a[href]')?.href||null
    })).catch(()=>null);
    if(!meta?.visible || !actionNameRe.test(meta.label||'')) continue;
    if(meta.href) return {href:meta.href,label:meta.label,method:'direct-element-href'};
    const before=page.url();
    const popupPromise=page.waitForEvent('popup',{timeout:2200}).catch(()=>null);
    await loc.click({timeout:2200}).catch(()=>{});
    const popup=await popupPromise;
    if(popup){
      await popup.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
      const href=popup.url();
      await popup.close().catch(()=>{});
      if(href && href!== 'about:blank') return {href,label:meta.label,method:'popup-navigation'};
    }
    await sleep(700);
    const after=page.url();
    if(after && after!==before && !/google\.[^/]+\/maps/i.test(after)){
      await page.goBack({waitUntil:'domcontentloaded',timeout:7000}).catch(()=>{});
      await sleep(500);
      return {href:after,label:meta.label,method:'same-tab-navigation'};
    }
    // Some buttons expand an action sheet. Look for a newly revealed external link.
    const expanded=await extractVisibleEvidence(page).catch(()=>null);
    const external=(expanded?.rows||[]).find(r=>r.href && !/google\.[^/]+\/maps|maps\.google/i.test(r.href) && /(book|appointment|schedule|reserve|dental departures)/i.test([r.aria,r.title,r.text,r.href].join(' ')));
    if(external?.href) return {href:external.href,label:meta.label,method:'expanded-action-sheet'};
  }
  return null;
}

function parseContact(raw) {
  const rows = raw.rows || [];
  const addressRow = rows.find(r => /address|ที่อยู่/i.test(`${r.aria} ${r.title}`));
  const websiteRow = rows.find(r => /website|เว็บไซต์/i.test(`${r.aria} ${r.title}`) && r.href && !/google\./i.test(r.href));
  const phoneText = value => {
    const t=clean(value);
    const tel=String(value||'').match(/tel:([^?#]+)/i)?.[1];
    const candidates=[tel,t].filter(Boolean);
    for(const candidate of candidates){
      const m=String(candidate).match(/(?:\+?66|0)[\s().-]*(?:\d[\s().-]*){8,9}/);
      if(m) return clean(m[0]);
    }
    return null;
  };
  let phone=null;
  for(const r of rows){
    const label=`${r.aria||''} ${r.title||''} ${r.text||''}`;
    if(!/phone|call|โทร|โทรศัพท์/i.test(label) && !/^tel:/i.test(r.href||'')) continue;
    phone=phoneText(r.href)||phoneText(r.aria)||phoneText(r.title)||phoneText(r.text);
    if(phone) break;
  }
  return {
    address: addressRow ? clean(addressRow.aria || addressRow.title || addressRow.text).replace(/^(address|ที่อยู่)[:\s]*/i,'') : null,
    phone,
    website: websiteRow?.href || null
  };
}

function expectedNameVisible(raw={}, expectedName='') {
  const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g,' ').replace(/\b(center|centre|clinic|dental|dentistry|the|co|ltd|company)\b/g,' ').replace(/\s+/g,' ').trim();
  const exp=normalize(expectedName), hay=normalize([raw.pageName,raw.title,raw.bodyText].filter(Boolean).join(' '));
  if(!exp || !hay) return false;
  const tokens=exp.split(' ').filter(Boolean);
  const hit=tokens.filter(t=>hay.includes(t));
  return hit.length >= Math.max(1, Math.ceil(tokens.length*0.7));
}

function profileSurfaceConfirmed(raw={}, expectedName='') {
  const url=String(raw.url||'');
  const named=!!raw.pageName && !genericMapsShellName(raw.pageName);
  const placeUrl=/\/maps\/place\//i.test(url);
  // Search-result shells can expose ratings and nearby businesses; never treat them as the clinic profile.
  if(genericMapsShellName(raw.pageName) || /\/maps\/search\//i.test(url) && !placeUrl) return false;
  return (named && expectedNameVisible(raw,expectedName)) || (placeUrl && expectedNameVisible(raw,expectedName));
}

function classifyDestination(url,{auditedWebsite=null,raw=null}={}) {
  if(!url) return {classification:'missing',ownerControl:'none',intentContinuity:'weak',bookingProximity:'none',responseCapability:'none',distractionRisk:'high',qualityScore:0,grade:'critical',rationale:'No usable outbound destination was observed.'};
  let u; try{u=new URL(url);}catch{return {classification:'invalid',ownerControl:'none',intentContinuity:'weak',bookingProximity:'none',responseCapability:'none',distractionRisk:'high',qualityScore:0,grade:'critical',rationale:'The observed destination URL is invalid.'};}
  const host=u.hostname.toLowerCase().replace(/^www\./,'');
  const audited=domainOf(auditedWebsite);
  const path=(u.pathname||'/').toLowerCase();
  const text=clean(raw?.bodyText||'').toLowerCase();
  const social=/^(?:m\.)?(facebook\.com|fb\.com|instagram\.com|line\.me|lin\.ee|wa\.me|whatsapp\.com)$/.test(host);
  const bookingMarketplace=/(dentaldepartures|bookimed|whatclinic)/i.test(host);
  const bookingProvider=/(calendly|setmore|booksy|zocdoc|doctolib|fresha|simplybook|cliniko|mindbody|janeapp|nexhealth)/i.test(host);
  const edenHostOrPath = /(?:^|[.\/_-])eden(?:clinic|ai|reception|booking)?(?:[.\/_-]|$)/i.test(`${host}${path}`) || /(?:^|\.)edenclinic(?:network)?\./i.test(host);
  const edenMarker = /(eden\s+(?:clinic|receptionist|ai)|data-eden|eden-receptionist|edenclinicnetwork|edenclinic\.ai)/i.test(`${text} ${raw?.title||''}`);
  // Never infer Eden merely from a substring such as "smilEDENtal". Require explicit Eden ownership evidence.
  const eden = edenHostOrPath || edenMarker;
  const directBooking=/(appointment|booking|book-online|book-now|reserve|schedule|\/book\/)/i.test(path) || bookingProvider || bookingMarketplace;
  const sameDomain=!!audited && host===audited;
  const aggregator=!sameDomain && !social && !bookingProvider && !bookingMarketplace && !eden && /(dental|dentist|clinic|health|medical|directory|implant)/i.test(host+path);
  const hasChat=/(whatsapp|line|messenger|chat|ask us|talk to|ai receptionist|book online|appointment)/i.test(text);
  let classification='third-party-site', score=35, owner='third-party', continuity='medium', proximity='browse-first', response='static-or-unknown', distraction='medium';
  if(eden){classification='eden-ai-receptionist';score=96;owner='eden-controlled';continuity='strong';proximity='immediate-conversation';response='24/7-ai-capable';distraction='low';}
  else if(directBooking && sameDomain){classification='direct-clinic-booking';score=90;owner='clinic-controlled';continuity='strong';proximity='direct-booking';response=hasChat?'interactive':'booking-flow';distraction='low';}
  else if(bookingMarketplace){classification='third-party-booking-marketplace';score=58;owner='third-party-marketplace';continuity='strong';proximity='quote-or-booking-flow';response='interactive-booking';distraction='medium';}
  else if(bookingProvider){classification='dedicated-booking-provider';score=82;owner='approved-third-party';continuity='strong';proximity='direct-booking';response='booking-flow';distraction='low';}
  else if(social){classification='social-profile';score=68;owner='platform-mediated';continuity='strong';proximity=hasChat?'immediate-conversation':'conversation-or-feed';response=hasChat?'interactive-platform':'platform-dependent';distraction='medium';}
  else if(sameDomain){classification='clinic-website';score=hasChat?76:68;owner='clinic-controlled';continuity='strong';proximity=hasChat?'one-step-to-contact':'browse-first';response=hasChat?'interactive':'static-or-unknown';distraction='low';}
  else if(aggregator){classification='aggregator-or-directory';score=22;owner='third-party';continuity='weak';proximity='browse-first';response='unknown';distraction='high';}
  const transientFrictionObserved=classification==='social-profile' && /login|sign in|log in/i.test(text);
  // V2.2.32: the structural quality of the same Google→social handoff must not
  // oscillate merely because Facebook rendered a transient login/sign-in layer.
  // Surface obstruction remains evidence elsewhere, but the destination score is
  // based on stable semantic properties (classification/control/proximity).
  const grade=score>=90?'excellent':score>=80?'strong':score>=65?'adequate':score>=45?'weak':'critical';
  const rationale={
    'eden-ai-receptionist':'Google sends the patient directly into an Eden-controlled conversational booking path.',
    'direct-clinic-booking':'Google sends the patient directly to a clinic-controlled booking path.',
    'third-party-booking-marketplace':'Google sends the patient into a third-party booking marketplace/lead intermediary rather than a clinic-controlled patient relationship.',
    'dedicated-booking-provider':'Google sends the patient directly to a dedicated booking provider.',
    'clinic-website':'Google sends the patient to the clinic website rather than directly into booking.',
    'social-profile':'Google sends the patient to the clinic’s social profile; conversion quality depends on visible patient actions, login state, and response speed.',
    'aggregator-or-directory':'Google hands the patient to a third-party dental/clinic directory or aggregator where competing choices can create leakage.',
    'third-party-site':'Google hands the patient to a third-party site whose conversion ownership is unclear.'
  }[classification]||'Destination quality is uncertain.';
  return {classification,ownerControl:owner,intentContinuity:continuity,bookingProximity:proximity,responseCapability:response,distractionRisk:distraction,qualityScore:score,grade,rationale,transientFrictionObserved};
}

async function probeConversionDestination(browser,url,options={}) {
  if(!url) return {status:'not-observed',targetUrl:null,finalUrl:null,...classifyDestination(null,{auditedWebsite:options.auditedWebsite})};
  const page=await browser.newPage({viewport:{width:1280,height:900},locale:'en-US'});
  const started=Date.now();
  try{
    const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:options.timeoutMs||18000});
    await sleep(1800);
    const raw=await page.evaluate(()=>({bodyText:String(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,18000),title:document.title,url:location.href}));
    const screenshot=path.join(options.outputDir||process.cwd(),'google-business-destination.png');
    await page.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
    return {status:'probed',targetUrl:url,finalUrl:raw.url,httpStatus:response?.status()??null,durationMs:Date.now()-started,screenshot,...classifyDestination(raw.url,{auditedWebsite:options.auditedWebsite,raw})};
  }catch(error){return {status:'probe-failed',targetUrl:url,finalUrl:null,error:String(error.message||error),...classifyDestination(url,{auditedWebsite:options.auditedWebsite})};}
  finally{await page.close().catch(()=>{});}
}

async function probeGoogleBusiness(browser, template, options = {}) {
  const targetUrl = options.targetUrl || firstCandidate(template);
  if (!targetUrl) return { schemaVersion:VERSION,status:'not-run',reason:'No Google Maps candidate URL or clinic identity available',targetUrl:null };
  const page = await browser.newPage({ viewport:{width:1440,height:1000}, locale:'en-US' });
  const started = Date.now();
  try {
    const response = await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:options.timeoutMs||25000});
    await sleep(2600);
    const consentDismissed = await dismissConsent(page);
    if (consentDismissed) await sleep(1400);
    let raw = await extractVisibleEvidence(page);
    const rawStates=[raw];
    const expectedName=template?.identity?.clinicName||'';
    let confirmed=profileSurfaceConfirmed(raw,expectedName);
    let resultSelection={selected:false,candidate:null,score:0};
    if(!confirmed && /\/maps\/search\//i.test(page.url())){
      resultSelection=await selectBestGoogleResult(page,expectedName).catch(()=>({selected:false,candidate:null,score:0}));
      if(resultSelection.selected){ raw=await extractVisibleEvidence(page); rawStates.push(raw); confirmed=profileSurfaceConfirmed(raw,expectedName); }
    }
    // Reliability guard: Google Maps can hydrate slowly. Re-read the same page before giving up.
    for(let attempt=2; !confirmed && attempt<=3; attempt++){
      await sleep(1400);
      raw=await extractVisibleEvidence(page);
      rawStates.push(raw);
      confirmed=profileSurfaceConfirmed(raw,expectedName);
    }
    const screenshotPath = path.join(options.outputDir || process.cwd(),'google-business-profile.png');
    await page.screenshot({path:screenshotPath,fullPage:false}).catch(()=>{});
    const confirmedStates=confirmed ? rawStates.filter(r=>profileSurfaceConfirmed(r,expectedName)) : [];
    const rrCandidates=confirmedStates.map(r=>parseRatingAndReviews(r));
    let ratingEvidence=accumulateObserved(rrCandidates.map(x=>x.rating));
    let reviewCountEvidence=accumulateObserved(rrCandidates.map(x=>x.reviewCount));
    let rr={rating:ratingEvidence.value,reviewCount:reviewCountEvidence.value};
    const contactStates=confirmedStates.map(r=>parseContact(r));
    const contact={
      address:accumulateObserved(contactStates.map(x=>x.address)).value,
      phone:accumulateObserved(contactStates.map(x=>x.phone)).value,
      website:accumulateObserved(contactStates.map(x=>x.website)).value
    };
    const category = confirmed ? accumulateObserved(confirmedStates.map(parseCategory)).value : null;
    const profileImageVisible = confirmed ? (confirmedStates.some(r=>(r.largeImages||[]).length>0)?true:null) : null;
    const actions = confirmed ? {
      directions: mergeObservedAction(confirmedStates,/\bdirections?\b|เส้นทาง/i), website: mergeObservedAction(confirmedStates,/\bwebsite\b|เว็บไซต์/i), call: mergeObservedAction(confirmedStates,/\bcall\b|\bphone\b|โทร/i), booking: mergeObservedAction(confirmedStates,/\bbook(?:ing| online| appointment)?\b|appointment|schedule|reserve|นัด/i), message: mergeObservedAction(confirmedStates,/\bmessage\b|chat|ข้อความ/i)
    } : Object.fromEntries(['directions','website','call','booking','message'].map(k=>[k,{observed:null,label:null,href:null,evidenceCount:0}]));
    if(confirmed && (!actions.booking.href || actions.booking.observed!==true)) {
      const resolved=await resolveActionHrefByInteraction(page,/\b(book(?:ing| online| appointment)?|appointment|schedule|reserve)\b|นัด/i).catch(()=>null);
      if(resolved){ actions.booking={observed:true,label:resolved.label||actions.booking.label||'Booking',href:resolved.href,resolutionMethod:resolved.method}; }
    }
    const core={raw,rr,contact,category,profileImageVisible,actions};
    // Deep evidence is additive only. It can never invalidate the already captured core profile.
    const reviewsSurface = confirmed ? await probeReviewsSurface(page, options.outputDir || process.cwd(), ratingEvidence.value).catch(error=>({opened:false,raw:null,screenshot:null,relativeDates:[],reviewCountEvidence:{value:null,status:'not-observed',observations:[],conflict:false},error:String(error.message||error)})) : {opened:false,raw:null,screenshot:null,relativeDates:[]};
    if (reviewsSurface.raw) {
      const reviewRR = parseRatingAndReviews(reviewsSurface.raw);
      ratingEvidence=accumulateObserved([...rrCandidates.map(x=>x.rating),reviewRR.rating]);
      reviewCountEvidence=accumulateObserved([...rrCandidates.map(x=>x.reviewCount),reviewRR.reviewCount,reviewsSurface.reviewCountEvidence?.value]);
      rr = { rating:ratingEvidence.value, reviewCount:reviewCountEvidence.value };
    }
    const websiteDestinationUrl=core.actions.website?.href || core.contact.website || null;
    const conversionDestination=confirmed ? await probeConversionDestination(browser,websiteDestinationUrl,{outputDir:options.outputDir,auditedWebsite:template?.reviewedUrl,timeoutMs:options.destinationTimeoutMs||18000}) : {status:'not-observed',targetUrl:null,...classifyDestination(null,{auditedWebsite:template?.reviewedUrl})};
    const bookingDestinationUrl=core.actions.booking?.href || null;
    const bookingDestination=confirmed && bookingDestinationUrl ? await probeConversionDestination(browser,bookingDestinationUrl,{outputDir:options.outputDir,auditedWebsite:template?.reviewedUrl,timeoutMs:options.destinationTimeoutMs||18000}) : {status:'not-observed',targetUrl:null,...classifyDestination(null,{auditedWebsite:template?.reviewedUrl})};
    const hoursPresent = confirmed && /\b(open|closed|closes|opens)\b|เปิด|ปิด/i.test(core.raw.bodyText) ? true : null;
    return {
      schemaVersion:VERSION,status:'probed',targetUrl,finalUrl:core.raw.url,httpStatus:response?.status()??null,durationMs:Date.now()-started,
      consentDismissed,screenshot:screenshotPath,profileSurfaceConfirmed:confirmed,
      identity:{pageName:core.raw.pageName||null,expectedName,expectedLocation:template?.identity?.location||null},
      profile:{rating:rr.rating,reviewCount:rr.reviewCount,primaryCategory:core.category,address:core.contact.address,phone:core.contact.phone,website:core.contact.website,hoursPresent},
      reputation:{sampledReviewDates:reviewsSurface.relativeDates||[],latestReviewRelative:reviewsSurface.relativeDates?.[0]||null},
      media:{profileImageVisible:core.profileImageVisible},actions:core.actions,conversionDestination,bookingDestination,
      visibleEvidence:{title:core.raw.title||null,actionLabels:uniq(Object.values(core.actions).map(a=>a.label)).slice(0,10),largeImageCount:(core.raw.largeImages||[]).length},
      reviewsSurface:{opened:!!reviewsSurface.opened,screenshot:reviewsSurface.screenshot||null,relativeDates:reviewsSurface.relativeDates||[],error:reviewsSurface.error||null},
      diagnostics:{coreProfileCaptured:confirmed,deepReviewAdditive:true,resultSelection,evidenceAccumulation:{profileStatesObserved:confirmedStates.length,rating:ratingEvidence,reviewCount:{...reviewCountEvidence,dedicatedRoute:reviewsSurface.reviewCountEvidence||null},positiveEvidenceMonotonic:true,rule:'Later null/not-observed states cannot erase a positive same-scan observation; conflicting positive values are surfaced.'}},
      provenance:{source:'public-google-maps-browser-probe',collectedAt:new Date().toISOString(),notes:'Core profile evidence is captured before optional deeper probes; deeper probes are additive and cannot erase confirmed core evidence.'}
    };
  } catch (error) {
    return {schemaVersion:VERSION,status:'probe-failed',targetUrl,error:String(error.message||error),durationMs:Date.now()-started};
  } finally { await page.close().catch(()=>{}); }
}

function domainOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./,''); }
  catch { return null; }
}

function identityMatch({ expectedName, observedName, auditedWebsite, profileWebsite, directMapsCandidate = false } = {}) {
  const exp = normalizeIdentityText(expectedName), got = normalizeIdentityText(observedName);
  const expTokens = new Set(exp.split(' ').filter(Boolean));
  const gotTokens = new Set(got.split(' ').filter(Boolean));
  const shared = [...expTokens].filter(t => gotTokens.has(t));
  const tokenCoverage = expTokens.size ? shared.length / expTokens.size : 0;
  const nameStrong = !!exp && !!got && (got.includes(exp) || exp.includes(got) || tokenCoverage >= 0.75);
  const auditedDomain = domainOf(auditedWebsite);
  const profileDomain = domainOf(profileWebsite);
  const domainMatch = !!auditedDomain && !!profileDomain && auditedDomain === profileDomain;
  if (nameStrong && domainMatch) return { matched:true, confidence:'high', basis:['name','website-domain'] };
  if (domainMatch) return { matched:true, confidence:'high', basis:['website-domain'] };
  if (nameStrong && directMapsCandidate) return { matched:true, confidence:'medium', basis:['name','direct-maps-link'] };
  if (nameStrong) return { matched:true, confidence:'medium', basis:['name'] };
  if (exp && got) return { matched:false, confidence:'low', basis:['name-mismatch'] };
  return { matched:null, confidence:null, basis:[] };
}

function mergeProbeIntoEvidence(template, probe, websiteContext = {}) {
  const base = JSON.parse(JSON.stringify(template || {}));
  if (!probe || probe.status !== 'probed' || probe.profileSurfaceConfirmed === false) return base;
  base.status='probed';
  const branch = base.branches?.[0] || {};
  branch.status='probed';
  branch.branchName=probe.identity?.pageName || branch.branchName || null;
  const directMapsCandidate = !!(probe.targetUrl && (template?.discovery?.googleMapsUrls || []).includes(probe.targetUrl));
  const identity = identityMatch({ expectedName:probe.identity?.expectedName, observedName:probe.identity?.pageName, auditedWebsite:template?.reviewedUrl, profileWebsite:probe.profile?.website, directMapsCandidate });
  branch.discovery={...(branch.discovery||{}),profileUrl:probe.finalUrl||probe.targetUrl,matched:identity.matched,matchConfidence:identity.confidence,matchBasis:identity.basis};
  const identityQualified = identity.matched===true && ['medium','high'].includes(identity.confidence);
  branch.identityIsolation={
    qualified:identityQualified,
    status:identityQualified?'confirmed':'quarantined',
    reason:identityQualified?null:'Observed Google profile did not match the audited clinic strongly enough; profile and destination evidence are quarantined from scoring and commercial actions.'
  };
  branch.profile=identityQualified
    ? {...(branch.profile||{}),primaryCategory:probe.profile?.primaryCategory??branch.profile?.primaryCategory??null,rating:probe.profile?.rating??null,reviewCount:probe.profile?.reviewCount??null,address:probe.profile?.address??null,phone:probe.profile?.phone??null,website:probe.profile?.website??null,hoursPresent:probe.profile?.hoursPresent??null,appointmentUrl:probe.actions?.booking?.href??branch.profile?.appointmentUrl??null}
    : {...(branch.profile||{}),primaryCategory:null,rating:null,reviewCount:null,address:null,phone:null,website:null,hoursPresent:null,appointmentUrl:null};
  branch.reputation=identityQualified?{...(branch.reputation||{}),sampledReviewDates:probe.reputation?.sampledReviewDates||branch.reputation?.sampledReviewDates||[],latestReviewDate:branch.reputation?.latestReviewDate??null}:{...(branch.reputation||{}),sampledReviewDates:[],latestReviewDate:null};
  branch.media=identityQualified?{...(branch.media||{}),profileImageVisible:probe.media?.profileImageVisible??null}:{...(branch.media||{}),profileImageVisible:null};
  branch.actions=identityQualified?{...(branch.actions||{}),directionsAvailable:probe.actions?.directions?.observed??null,websiteAvailable:probe.actions?.website?.observed??null,callAvailable:probe.actions?.call?.observed??null,bookingAvailable:probe.actions?.booking?.observed??null,messageAvailable:probe.actions?.message?.observed??null}:{...(branch.actions||{}),directionsAvailable:null,websiteAvailable:null,callAvailable:null,bookingAvailable:null,messageAvailable:null};
  const normalizePhone = v => String(v || '').replace(/\D/g,'').replace(/^66(?=\d{9}$)/,'0');
  const websitePhones=(websiteContext.phoneDisplayedNumbers||[]).map(normalizePhone).filter(Boolean);
  const mapPhone=normalizePhone(probe.profile?.phone);
  const websiteDomain=domainOf(template?.reviewedUrl), mapDomain=domainOf(probe.profile?.website);
  branch.consistency={...(branch.consistency||{}),
    websiteMatches: websiteDomain && mapDomain ? websiteDomain===mapDomain : null,
    phoneMatches: mapPhone && websitePhones.length ? websitePhones.some(p => p===mapPhone || p.endsWith(mapPhone) || mapPhone.endsWith(p)) : null,
    brandNameMatches: identity.matched===true ? true : identity.matched===false ? false : null
  };
  branch.conversionDestination=identityQualified && probe.conversionDestination?{...probe.conversionDestination,identityQualified:true}:{status:'quarantined',targetUrl:null,finalUrl:null,classification:'wrong-entity-evidence',ownerControl:'unknown',qualityScore:null,grade:'unknown',identityQualified:false};
  branch.bookingDestination=identityQualified && probe.bookingDestination?{...probe.bookingDestination,identityQualified:true}:{status:'quarantined',targetUrl:null,finalUrl:null,classification:'wrong-entity-evidence',ownerControl:'unknown',qualityScore:null,grade:'unknown',identityQualified:false};
  branch.provenance={source:'public-google-maps-browser-probe',collectedAt:probe.provenance?.collectedAt||null,sourceRefs:[probe.finalUrl||probe.targetUrl].filter(Boolean),notes:probe.provenance?.notes||''};
  base.branches=[branch,...(base.branches||[]).slice(1)];
  base.probe={status:probe.status,screenshot:probe.screenshot||null,reviewsScreenshot:probe.reviewsSurface?.screenshot||null,targetUrl:probe.targetUrl,finalUrl:probe.finalUrl||null};
  return base;
}

module.exports={VERSION,accumulateObserved,mergeObservedAction,searchUrl,firstCandidate,normalizeIdentityText,identityTokenScore,genericMapsShellName,parseRatingAndReviews,parseDedicatedReviewCount,parseCategory,parseContact,parseRelativeReviewDates,classifyDestination,probeConversionDestination,probeGoogleBusiness,mergeProbeIntoEvidence,identityMatch,observedAction,resolveActionHrefByInteraction};
