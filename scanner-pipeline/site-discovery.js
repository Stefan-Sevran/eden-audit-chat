const { URL } = require('url');
const { resilientGoto } = require('./navigation');

const TYPE_RULES = [
  ['booking', /appointment|book(?:ing)?|schedule|reserve|consult/i, 100],
  ['contact', /contact|location|find-us|directions/i, 92],
  ['pricing', /price|pricing|fees?|offers?|promotion|packages?/i, 88],
  ['results', /before[-_ ]?after|results?|gallery|cases?|smile-gallery/i, 86],
  ['team', /doctor|dentist|team|about|specialist|provider|surgeon/i, 84],
  ['service', /implant|invisalign|orthodont|braces|veneer|whiten|crown|root-canal|aesthetic|laser|treatment|service/i, 82],
  ['reviews', /review|testimonial|patient-stor/i, 78],
  ['home', /^\/?$/, 110]
];

function normalizeCandidate(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'].forEach(k=>u.searchParams.delete(k));
    return u;
  } catch { return null; }
}

function classifyPage(url, text = '', title = '') {
  const u = new URL(url);
  const hay = `${u.pathname} ${text} ${title}`;
  for (const [type,re,base] of TYPE_RULES) if (re.test(hay)) return { type, baseScore:base };
  return { type:'other', baseScore:35 };
}

function rankCandidate(candidate) {
  const { type, baseScore } = classifyPage(candidate.url, candidate.anchorText, candidate.title);
  let score = baseScore;
  if (candidate.inNavigation) score += 10;
  if (candidate.inFooter) score += 2;
  if (candidate.anchorText && candidate.anchorText.length > 2) score += 3;
  const depth = new URL(candidate.url).pathname.split('/').filter(Boolean).length;
  score -= Math.max(0, depth - 2) * 3;
  if (/privacy|cookie|terms|policy|blog|news|author|tag|category|wp-|feed|login|cart|checkout/i.test(candidate.url)) score -= 80;
  return { ...candidate, pageType:type, commercialScore:Math.max(0,score) };
}

async function discoverSite(browser, startUrl, options = {}) {
  const maxPages = options.discoveryPageLimit || 40;
  const context = await browser.newContext({ viewport:{width:1280,height:800}, ignoreHTTPSErrors:true });
  const page = await context.newPage();
  const start = new URL(startUrl);
  const host = start.hostname.replace(/^www\./,'');
  const queue = [startUrl];
  const seen = new Set();
  const pages = [];
  try {
    while (queue.length && pages.length < maxPages) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      let response;
      try { response = (await resilientGoto(page, url, { timeoutMs: options.discoveryTimeoutMs || 12000, fallbackTimeoutMs: options.discoveryFallbackTimeoutMs || 25000, slowThresholdMs: options.slowLoadThresholdMs || 8000 })).response; }
      catch { continue; }
      if (!response || response.status() >= 500) continue;
      await page.waitForTimeout(150);
      const data = await page.evaluate(() => {
        const visible = el => { const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>1&&r.height>1; };
        return {
          title: document.title || '',
          h1: (Array.from(document.querySelectorAll('h1')).find(visible)?.innerText || '').replace(/\s+/g,' ').trim().slice(0,220),
          links: Array.from(document.querySelectorAll('a[href]')).slice(0,800).map(a => ({
            href:a.href,
            text:(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,160),
            nav:!!a.closest('header,nav'), footer:!!a.closest('footer')
          }))
        };
      });
      const cls = classifyPage(url, data.h1, data.title);
      pages.push({ url, title:data.title, h1:data.h1, pageType:cls.type, status:response.status() });
      for (const l of data.links) {
        const u = normalizeCandidate(l.href, url); if (!u) continue;
        const h = u.hostname.replace(/^www\./,'');
        if (h !== host) continue;
        const normalized = u.toString();
        if (seen.has(normalized) || queue.includes(normalized)) continue;
        if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)(\?|$)/i.test(u.pathname)) continue;
        queue.push(normalized);
      }
    }

    // Re-open homepage once to get anchor context used for commercial ranking.
    await resilientGoto(page, startUrl, { timeoutMs: options.discoveryTimeoutMs || 12000, fallbackTimeoutMs: options.discoveryFallbackTimeoutMs || 25000, slowThresholdMs: options.slowLoadThresholdMs || 8000 }).catch(()=>{});
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0,1000).map(a=>({href:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,160),nav:!!a.closest('header,nav'),footer:!!a.closest('footer')}))).catch(()=>[]);
    const candidates = [];
    const byUrl = new Map();
    for (const p of pages) byUrl.set(p.url,p);
    for (const l of links) {
      const u=normalizeCandidate(l.href,startUrl); if(!u) continue;
      if(u.hostname.replace(/^www\./,'')!==host) continue;
      const p=byUrl.get(u.toString()) || {};
      candidates.push(rankCandidate({url:u.toString(),anchorText:l.text,title:p.title||'',h1:p.h1||'',inNavigation:l.nav,inFooter:l.footer}));
    }
    // Ensure discovered pages not linked on homepage remain eligible.
    for (const p of pages) if (!candidates.some(c=>c.url===p.url)) candidates.push(rankCandidate({url:p.url,anchorText:p.h1||'',title:p.title||'',h1:p.h1||'',inNavigation:false,inFooter:false}));
    const unique = Array.from(new Map(candidates.map(c=>[c.url,c])).values()).sort((a,b)=>b.commercialScore-a.commercialScore);
    const deepLimit = options.deepPageLimit || 8;
    const selected = [];
    const typesSeen = new Set();
    // First pass: diversity across key page types.
    for (const c of unique) {
      if (selected.length >= deepLimit) break;
      if (['other'].includes(c.pageType)) continue;
      if (!typesSeen.has(c.pageType) || ['service'].includes(c.pageType)) { selected.push(c); typesSeen.add(c.pageType); }
    }
    // Fill remaining slots by score.
    for (const c of unique) {
      if (selected.length >= deepLimit) break;
      if (!selected.some(x=>x.url===c.url) && c.commercialScore >= 45) selected.push(c);
    }
    if (!selected.some(x=>new URL(x.url).pathname === new URL(startUrl).pathname)) selected.unshift(rankCandidate({url:startUrl,anchorText:'Home',title:'',h1:'',inNavigation:true,inFooter:false}));
    return { startUrl, discoveredCount:Math.max(pages.length, unique.length), successfullyLoadedCount:pages.length, pages, ranked:unique.slice(0,60), selectedDeepPages:selected.slice(0,deepLimit), discoveryStatus: pages.length ? (pages.length < unique.length ? 'partial-recovered' : 'complete') : (unique.length ? 'partial-recovered' : 'empty') };
  } finally { await context.close(); }
}

module.exports = { discoverSite, classifyPage, rankCandidate };
