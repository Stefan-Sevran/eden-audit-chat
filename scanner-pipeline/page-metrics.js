async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const bodyRect = body ? body.getBoundingClientRect() : { width: 0 };
    const text = (body?.innerText || '').replace(/\s+/g, ' ').trim();
    const title = document.title || '';
    const description = document.querySelector('meta[name="description"]')?.content || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    const lang = doc.lang || '';
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 40).map(el => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    })).filter(h => h.text);
    const links = Array.from(document.querySelectorAll('a[href]'));
    const phoneLinks = links.filter(a => /^tel:/i.test(a.getAttribute('href') || '')).length;
    const emailLinks = links.filter(a => /^mailto:/i.test(a.getAttribute('href') || '')).length;
    const horizontalOverflowPx = Math.max(0, Math.ceil((doc.scrollWidth || 0) - viewport.width));
    const performanceNav = performance.getEntriesByType('navigation')[0];
    const viewportMeta = document.querySelector('meta[name="viewport"]')?.content || '';
    const allVisible = Array.from(document.querySelectorAll('body *')).filter(el => {
      const r=el.getBoundingClientRect(), st=getComputedStyle(el);
      return r.width>1 && r.height>1 && st.display!=='none' && st.visibility!=='hidden' && Number(st.opacity)>0.02;
    });
    const textEls = allVisible.filter(el => el.childElementCount===0 && (el.innerText||'').trim());
    const textSamples = textEls.map(el => {
      const raw=(el.innerText||'').replace(/\s+/g,' ').trim();
      const fontSize=parseFloat(getComputedStyle(el).fontSize||'0')||0;
      const r=el.getBoundingClientRect();
      return { fontSize, chars: raw.length, aboveFold: r.top < viewport.height && r.bottom > 0 };
    });
    const tinyText = textSamples.filter(x => x.fontSize < 12);
    const smallText = textSamples.filter(x => x.fontSize < 14);
    const totalChars = textSamples.reduce((sum,x)=>sum+x.chars,0);
    const tinyChars = tinyText.reduce((sum,x)=>sum+x.chars,0);
    const smallChars = smallText.reduce((sum,x)=>sum+x.chars,0);
    const aboveFoldSamples=textSamples.filter(x=>x.aboveFold);
    const aboveFoldTiny=aboveFoldSamples.filter(x=>x.fontSize<12);
    const aboveFoldChars=aboveFoldSamples.reduce((sum,x)=>sum+x.chars,0);
    const aboveFoldTinyChars=aboveFoldTiny.reduce((sum,x)=>sum+x.chars,0);
    const sortedFontSizes=textSamples.map(x=>x.fontSize).filter(Boolean).sort((a,b)=>a-b);
    const percentile=(arr,p)=>{ if(!arr.length) return null; const idx=Math.min(arr.length-1,Math.max(0,Math.round((arr.length-1)*p))); return Math.round(arr[idx]*10)/10; };
    const interactive = allVisible.filter(el => el.matches('a,button,input,select,textarea,[role="button"]'));
    const targetInfo = interactive.map(el => {
      const r=el.getBoundingClientRect();
      const tag=el.tagName.toLowerCase();
      const href=(el.getAttribute('href')||'').trim();
      const label=((el.innerText||el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('value')||'')+' '+href).replace(/\s+/g,' ').trim().toLowerCase();
      const tiny=r.width<44 || r.height<44;
      const aboveFold=r.top < viewport.height && r.bottom > 0;
      const isFormControl=['button','input','select','textarea'].includes(tag) || el.getAttribute('role')==='button';
      const isHighIntent=/(book|appointment|schedule|consult|contact|call|โทร|นัด|จอง|whatsapp|line\b|messenger|message|inquir|enquir)/i.test(label) || /^tel:/i.test(href);
      const isSocial=/(facebook|instagram|youtube|tiktok|linkedin|twitter|x\.com|social)/i.test(label);
      const navAncestor=!!el.closest('nav,[role="navigation"],header');
      const footerAncestor=!!el.closest('footer,[id*=footer i],[class*=footer i]');
      let category='secondary';
      if(isHighIntent) category='high-intent';
      else if(isFormControl) category='form-control';
      else if(navAncestor) category='navigation';
      else if(isSocial||footerAncestor) category='secondary';
      return {tag,href,label:label.slice(0,120),width:Math.round(r.width),height:Math.round(r.height),tiny,aboveFold,category};
    });
    const tinyTargets = targetInfo.filter(x=>x.tiny);
    const pct=(num,den)=>den ? Math.round(num/den*1000)/10 : 0;
    const targetCategoryStats = category => {
      const items=targetInfo.filter(x=>x.category===category);
      return {count:items.length,tinyCount:items.filter(x=>x.tiny).length,tinyPercent:pct(items.filter(x=>x.tiny).length,items.length)};
    };
    const highIntentStats=targetCategoryStats('high-intent');
    const formControlStats=targetCategoryStats('form-control');
    const navigationStats=targetCategoryStats('navigation');
    const secondaryStats=targetCategoryStats('secondary');
    const aboveFoldTargets=targetInfo.filter(x=>x.aboveFold);
    const criticalTargets=targetInfo.filter(x=>x.category==='high-intent'||x.category==='form-control');
    const fixedWidthCandidates = allVisible.map(el => {
      const r=el.getBoundingClientRect(), st=getComputedStyle(el);
      const cssWidth=parseFloat(st.width||'0');
      return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,120),width:Math.round(r.width),cssWidth:Math.round(cssWidth||0)};
    }).filter(x => x.width>650 && x.width>viewport.width*1.15).slice(0,20);
    // Thailand-aware displayed-phone detection. Handles common formats such as
    // 038-123-456, 094 679 2939, +66 94 679 2939 and +66 (0)38 123 456.
    // This is intentionally separate from tel: detection: a number can be visible
    // while still being non-actionable on mobile.
    const phonePatterns = [
      /(?:\+?66\s*(?:\(0\))?[-.\s]*)?0?\d{1,2}[-.\s]+\d{3}[-.\s]+\d{3,4}/g,
      /(?:\+?66\s*(?:\(0\))?[-.\s]*)?0?\d{2}[-.\s]*\d{3}[-.\s]*\d{4}/g,
      /0\d{8,9}/g,
      /(?:\+?63\s*)?(?:\(?0?\d{2,3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}/g,
      /(?:\+?63\s*)?9\d{2}[-.\s]*\d{3}[-.\s]*\d{4}/g
    ];
    const phoneCandidates = phonePatterns.flatMap(re => text.match(re) || []);
    const isPlausibleClinicPhone = raw => {
      const compact = String(raw || '').replace(/[^+\d]/g, '');
      const digits = compact.replace(/\D/g, '');
      // Thailand: 0x/0xx landlines and 06/08/09 mobile; +66 equivalents.
      if (/^0(?:2\d{7}|[3-9]\d{7,8})$/.test(digits)) return true;
      if (/^66(?:2\d{7}|[3-9]\d{7,8})$/.test(digits)) return true;
      // Philippines: 09 mobile plus 2- or 3-digit area-code landlines (e.g. 02 Manila, 032 Cebu), and +63 equivalents.
      if (/^09\d{9}$/.test(digits)) return true;
      if (/^0(?:2\d{8}|\d{2}\d{7})$/.test(digits)) return true;
      if (/^63(?:9\d{9}|2\d{8}|\d{2}\d{7})$/.test(digits)) return true;
      return false;
    };
    const displayedPhoneNumbers = [...new Set(phoneCandidates
      .map(x=>x.replace(/\s+/g,' ').trim())
      .filter(isPlausibleClinicPhone))].slice(0,20);
    const legacyFlashText = /(adobe flash player is no longer supported|flash player|enable flash)/i.test(text);
    const flashEmbeds = Array.from(document.querySelectorAll('object,embed')).filter(el => /flash|shockwave|\.swf/i.test(`${el.getAttribute('type')||''} ${el.getAttribute('src')||''} ${el.getAttribute('data')||''}`));
    const footerSelectorsText = Array.from(document.querySelectorAll('footer,[id*=footer i],[class*=footer i]')).map(el=>(el.innerText||'').replace(/\s+/g,' ').trim()).join(' ');
    // Legacy table-based sites often have no semantic <footer>. Include text from
    // elements physically near the bottom of the document, plus copyright-context
    // matches from the whole page.
    const docHeight = Math.max(doc.scrollHeight || 0, body?.scrollHeight || 0, viewport.height || 0);
    const bottomText = allVisible.filter(el => {
      const r = el.getBoundingClientRect();
      const absoluteTop = r.top + window.scrollY;
      return absoluteTop >= Math.max(0, docHeight * 0.72);
    }).map(el => el.childElementCount===0 ? (el.innerText||'').replace(/\s+/g,' ').trim() : '').filter(Boolean).join(' ');
    const copyrightContext = [...text.matchAll(/.{0,80}(?:copyright|©|all rights reserved).{0,120}/ig)].map(m=>m[0]).join(' ');
    const footerText = `${footerSelectorsText} ${bottomText} ${copyrightContext}`.replace(/\s+/g,' ').trim().slice(0,6000);
    const years = [...footerText.matchAll(/(?:copyright|©)?\s*(?:\(c\)\s*)?((?:19|20)\d{2})/ig)].map(m=>Number(m[1])).filter(Boolean);
    const latestFooterYear = years.length ? Math.max(...years) : null;
    const tableCount = document.querySelectorAll('table').length;
    const legacyTableLayoutSignal = tableCount >= 3 && !viewportMeta && fixedWidthCandidates.length > 0;
    const currentYear = new Date().getFullYear();
    const oldFooterYearSignal = latestFooterYear ? latestFooterYear <= currentYear - 5 : false;
    // A year by itself is weak evidence. Only call the site visibly stale when an old
    // footer year is corroborated by at least one independent legacy signal.
    const staleFooterYearSignal = !!(oldFooterYearSignal && (legacyFlashText || flashEmbeds.length > 0 || legacyTableLayoutSignal || !viewportMeta || (tinyChars && totalChars && tinyChars/totalChars > 0.5)));

    // Lightweight credential/registration evidence discovery. Candidates are captured
    // as evidence only and are NOT awarded trust points until a later validation layer.
    // Keep the parser conservative so nearby prose (e.g. the tail of "Number") is not
    // accidentally swallowed into the identifier.
    const credentialLabelRegex = /(?:dentist\s*)?(?:license|licence|registration|certificate)(?:\s*(?:number|no\.?|#))?|prc\s*(?:license|licence|registration)?(?:\s*(?:number|no\.?|#))?|ใบอนุญาต(?:เลขที่)?|เลข(?:ที่)?ใบอนุญาต|เลขใบประกอบ(?:วิชาชีพ)?|ทะเบียน(?:เลขที่)?/ig;
    const registrationIdentifierCandidates = [];
    for (const match of text.matchAll(credentialLabelRegex)) {
      const start=match.index||0;
      const context=text.slice(Math.max(0,start-45), Math.min(text.length,start+match[0].length+90));
      const after=text.slice(start+match[0].length, Math.min(text.length,start+match[0].length+70));
      const idMatch=after.match(/^[\s:：#№.\-]*([A-Z]{0,5}(?:[-\s]?[A-Z]{0,3})?[-\s]?\d{4,14}(?:[-\/]\d{1,6})?)/i);
      if(!idMatch) continue;
      const identifier=idMatch[1].replace(/\s+/g,' ').trim();
      if(!/\d{4,}/.test(identifier)) continue;
      const label=match[0].replace(/\s+/g,' ').trim();
      const kind=/dentist|prc|ใบอนุญาต|เลขใบประกอบ/i.test(label) ? 'professional-credential' : /registration|ทะเบียน/i.test(label) ? 'registration-identifier' : 'credential-identifier';
      registrationIdentifierCandidates.push({label,identifier,kind,confidence:'candidate',context:context.replace(/\s+/g,' ').trim().slice(0,180)});
      if(registrationIdentifierCandidates.length>=12) break;
    }

    return {
      url: location.href,
      title,
      description,
      canonical,
      lang,
      viewport,
      document: {
        scrollWidth: doc.scrollWidth,
        scrollHeight: doc.scrollHeight,
        bodyWidth: Math.round(bodyRect.width || 0),
        horizontalOverflowPx
      },
      content: {
        visibleTextLength: text.length,
        wordCount: text ? text.split(/\s+/).length : 0,
        h1Count: document.querySelectorAll('h1').length,
        headings
      },
      contact: { phoneLinks, emailLinks, displayedPhoneNumbers, phoneDisplayed: displayedPhoneNumbers.length>0, phoneActionable: phoneLinks>0 },
      responsiveness: {
        viewportMetaPresent: !!viewportMeta,
        viewportMeta,
        layoutViewportWidth: viewport.width,
        screenWidth: window.screen?.width || null,
        tinyTextElementCount: tinyText.length,
        smallTextElementCount: smallText.length,
        visibleTextElementCount: textEls.length,
        // Backward-compatible field: percentage of sampled *leaf text elements* below 12px.
        // This is NOT a claim that 100% of all rendered text pixels/characters are tiny.
        tinyTextPercent: textEls.length ? Math.round(tinyText.length/textEls.length*1000)/10 : 0,
        tinyTextElementPercent: textEls.length ? Math.round(tinyText.length/textEls.length*1000)/10 : 0,
        smallTextElementPercent: textEls.length ? Math.round(smallText.length/textEls.length*1000)/10 : 0,
        tinyTextCharacterPercent: totalChars ? Math.round(tinyChars/totalChars*1000)/10 : 0,
        smallTextCharacterPercent: totalChars ? Math.round(smallChars/totalChars*1000)/10 : 0,
        aboveFoldTinyTextElementPercent: aboveFoldSamples.length ? Math.round(aboveFoldTiny.length/aboveFoldSamples.length*1000)/10 : 0,
        aboveFoldTinyTextCharacterPercent: aboveFoldChars ? Math.round(aboveFoldTinyChars/aboveFoldChars*1000)/10 : 0,
        medianFontSizePx: percentile(sortedFontSizes,0.5),
        p10FontSizePx: percentile(sortedFontSizes,0.1),
        p25FontSizePx: percentile(sortedFontSizes,0.25),
        p75FontSizePx: percentile(sortedFontSizes,0.75),
        tinyInteractiveTargetCount: tinyTargets.length,
        interactiveTargetCount: targetInfo.length,
        tinyInteractiveTargetPercent: pct(tinyTargets.length,targetInfo.length),
        // Patient-impact weighting: all links remain visible diagnostically, but small
        // footer/social links no longer carry the same weight as booking/contact/form controls.
        criticalInteractiveTargetCount: criticalTargets.length,
        criticalTinyInteractiveTargetCount: criticalTargets.filter(x=>x.tiny).length,
        criticalTinyInteractiveTargetPercent: pct(criticalTargets.filter(x=>x.tiny).length,criticalTargets.length),
        aboveFoldInteractiveTargetCount: aboveFoldTargets.length,
        aboveFoldTinyInteractiveTargetPercent: pct(aboveFoldTargets.filter(x=>x.tiny).length,aboveFoldTargets.length),
        targetCategories: {
          highIntent: highIntentStats,
          formControl: formControlStats,
          navigation: navigationStats,
          secondary: secondaryStats
        },
        interactiveTargetSamples: targetInfo.slice(0,80),
        fixedWidthCandidateCount: fixedWidthCandidates.length,
        fixedWidthCandidates
      },
      legacy: {
        flashUnsupportedTextDetected: legacyFlashText,
        flashEmbedCount: flashEmbeds.length,
        obsoleteFlashDetected: legacyFlashText || flashEmbeds.length>0,
        footerYears: years.slice(0,20),
        latestFooterYear,
        oldFooterYearSignal,
        staleFooterYearSignal,
        tableCount,
        legacyTableLayoutSignal
      },
      trustEvidence: { registrationIdentifierCandidates },
      timing: performanceNav ? {
        domContentLoadedMs: Math.round(performanceNav.domContentLoadedEventEnd || 0),
        loadEventMs: Math.round(performanceNav.loadEventEnd || 0),
        responseEndMs: Math.round(performanceNav.responseEnd || 0)
      } : null
    };
  });
}

module.exports = { collectPageMetrics };
