async function collectHeroMetrics(page) {
  return page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.02 && r.width > 1 && r.height > 1;
    }
    function compact(el, max = 300) {
      return (el?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, max);
    }
    function rect(el) {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) };
    }
    const h1s = Array.from(document.querySelectorAll('h1')).filter(visible);
    const h1 = h1s[0] || null;
    let hero = null;
    if (h1) {
      let node = h1;
      const candidates = [];
      for (let i = 0; node && i < 8; i++, node = node.parentElement) {
        if (!node || node === document.body || node === document.documentElement) break;
        const r = node.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.65 && r.height >= 180 && r.top < window.innerHeight * 0.45) candidates.push(node);
      }
      hero = candidates.find(el => /hero|banner|masthead|slider|home/i.test(`${el.id} ${el.className}`)) || candidates[candidates.length - 1] || h1.parentElement;
    }
    if (!hero) {
      hero = Array.from(document.querySelectorAll('main > section, body > section, [class*="hero"], [id*="hero"]')).filter(visible).find(el => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight * 0.5 && r.height > 220;
      }) || document.querySelector('main') || document.body;
    }

    const heroRect = hero ? hero.getBoundingClientRect() : null;
    const heroButtons = hero ? Array.from(hero.querySelectorAll('a,button,[role="button"]')).filter(visible).slice(0, 12).map(el => ({ text: compact(el, 120), href: (el.href || el.getAttribute('href') || '').slice(0, 400), ...rect(el) })) : [];
    const videos = Array.from((hero || document).querySelectorAll('video')).filter(visible).map(v => ({
      src: (v.currentSrc || v.src || '').slice(0, 1000), autoplay: !!v.autoplay, muted: !!v.muted, loop: !!v.loop, controls: !!v.controls,
      poster: (v.poster || '').slice(0, 1000), paused: !!v.paused, currentTime: Math.round((v.currentTime || 0) * 10) / 10, ...rect(v)
    }));
    const imgs = Array.from((hero || document).querySelectorAll('img')).filter(visible).map(i => ({ src: (i.currentSrc || i.src || '').slice(0, 1000), alt: (i.alt || '').slice(0, 240), ...rect(i) })).slice(0, 20);
    const bgNodes = [hero, ...(hero ? Array.from(hero.querySelectorAll('*')).slice(0, 250) : [])].filter(Boolean).map(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { image: s.backgroundImage, area: r.width * r.height, opacity: s.opacity };
    }).filter(x => x.image && x.image !== 'none' && x.area > window.innerWidth * 120).sort((a,b) => b.area-a.area);

    const paragraphs = hero ? Array.from(hero.querySelectorAll('p')).filter(visible).map(p => compact(p, 500)).filter(Boolean) : [];
    const h1Text = compact(h1, 500);
    const heroText = compact(hero, 2000);
    const h1Rect = h1 ? h1.getBoundingClientRect() : null;
    const h1LineEstimate = h1 && h1Rect ? Math.max(1, Math.round(h1Rect.height / Math.max(1, parseFloat(getComputedStyle(h1).lineHeight) || parseFloat(getComputedStyle(h1).fontSize) * 1.2))) : null;
    const leadEl = hero ? Array.from(hero.querySelectorAll('p')).find(visible) : null;
    const leadRect = leadEl ? leadEl.getBoundingClientRect() : null;
    const leadLineEstimate = leadEl && leadRect ? Math.max(1, Math.round(leadRect.height / Math.max(1, parseFloat(getComputedStyle(leadEl).lineHeight) || parseFloat(getComputedStyle(leadEl).fontSize) * 1.35))) : null;
    const visibleHeroTextEls = hero ? Array.from(hero.querySelectorAll('h1,h2,h3,p,li')).filter(visible) : [];
    const textArea = visibleHeroTextEls.reduce((sum,el) => { const r=el.getBoundingClientRect(); return sum + Math.max(0,r.width*r.height); }, 0);
    const heroArea = heroRect ? Math.max(1, heroRect.width * heroRect.height) : 1;
    const textAreaPercent = Math.round(Math.min(100, textArea / heroArea * 100) * 10) / 10;
    const controlArea = heroButtons.reduce((sum,b) => sum + Math.max(0,b.width*b.height),0);
    const controlAreaPercent = Math.round(Math.min(100, controlArea / heroArea * 100) * 10) / 10;
    const hasVideo = videos.length > 0;
    const hasBgImage = bgNodes.length > 0;
    const hasLargeImg = imgs.some(i => i.width * i.height > window.innerWidth * window.innerHeight * 0.18);

    const crowdingScore = Math.max(0, Math.min(100, Math.round(
      (h1LineEstimate || 0) * 7 + (leadLineEstimate || 0) * 4 + Math.min(28, heroButtons.length * 5) + Math.min(20, textAreaPercent * 1.2) - (heroRect && heroRect.height > window.innerHeight * 0.75 ? 8 : 0)
    )));

    let mediaType = 'none';
    if (hasVideo) mediaType = 'video';
    else if (hasBgImage) mediaType = 'background-image';
    else if (hasLargeImg) mediaType = 'image';

    return {
      detected: !!hero,
      selectorHint: hero ? `${hero.tagName.toLowerCase()}#${hero.id || ''}.${String(hero.className || '').trim().split(/\s+/).slice(0,4).join('.')}` : '',
      bounds: heroRect ? rect(hero) : null,
      viewportCoveragePercent: heroRect ? Math.round(Math.max(0, Math.min(window.innerHeight, heroRect.bottom) - Math.max(0, heroRect.top)) * Math.min(window.innerWidth, heroRect.width) / (window.innerWidth * window.innerHeight) * 1000) / 10 : 0,
      headline: h1Text,
      headlineLineEstimate: h1LineEstimate,
      leadLineEstimate,
      textAreaPercent,
      controlAreaPercent,
      crowdingScore,
      paragraphCount: paragraphs.length,
      leadCopy: paragraphs[0] || '',
      textLength: heroText.length,
      buttonCount: heroButtons.length,
      buttons: heroButtons,
      mediaType,
      videos,
      backgroundImages: bgNodes.slice(0, 5),
      images: imgs,
      hasOverlayLikely: !!hero && Array.from(hero.querySelectorAll('*')).some(el => {
        if (!visible(el)) return false;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const bg = s.backgroundColor.match(/rgba?\([^)]*\)/i)?.[0] || '';
        const alpha = Number((bg.match(/,\s*([\d.]+)\s*\)$/) || [])[1]);
        return Number.isFinite(alpha) && alpha > 0 && alpha < 0.95 && r.width * r.height > (heroRect?.width || 0) * (heroRect?.height || 0) * 0.5;
      })
    };
  });
}

module.exports = { collectHeroMetrics };
