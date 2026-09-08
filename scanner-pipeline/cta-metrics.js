async function collectCtaMetrics(page) {
  return page.evaluate(() => {
    function parseRgba(value) {
      const m = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])];
    }
    function blend(fg, bg) {
      const a = Math.max(0, Math.min(1, fg[3] == null ? 1 : fg[3]));
      return [
        Math.round(fg[0] * a + bg[0] * (1 - a)),
        Math.round(fg[1] * a + bg[1] * (1 - a)),
        Math.round(fg[2] * a + bg[2] * (1 - a)),
        1
      ];
    }
    function effectiveBackground(el) {
      let node = el;
      const raw = [];
      while (node && node.nodeType === 1 && raw.length < 12) {
        const style = getComputedStyle(node);
        const parsed = parseRgba(style.backgroundColor);
        if (parsed) raw.push({ tag: node.tagName.toLowerCase(), color: style.backgroundColor, rgba: parsed });
        if (parsed && parsed[3] >= 0.98) break;
        node = node.parentElement;
      }
      // Composite from the deepest opaque/outer layer back toward the element.
      let bg = [255, 255, 255, 1];
      for (const layer of [...raw].reverse()) {
        if (layer.rgba[3] > 0) bg = blend(layer.rgba, bg);
      }
      return { rgb: bg.slice(0, 3), css: `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`, layers: raw.map(({tag,color}) => ({tag,color})).slice(0, 8) };
    }
    function luminance(rgb) {
      if (!rgb) return null;
      const c = rgb.map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    function contrastRatio(fg, bg) {
      const a = luminance(fg), b = luminance(bg);
      if (a == null || b == null) return null;
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    function isVisible(el) {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.02 && r.width > 1 && r.height > 1;
    }
    function textOf(el) {
      return ((el.innerText || el.value || el.getAttribute('aria-label') || el.title || '') + '').replace(/\s+/g, ' ').trim();
    }
    function overlapArea(a, b) {
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return x * y;
    }
    function closestRegion(el) {
      const header = el.closest('header, nav, [role="navigation"], .header, .navbar, .nav, .menu');
      if (header) return 'navigation';
      const footer = el.closest('footer, .footer, [role="contentinfo"]');
      if (footer) return 'footer';
      const h1 = document.querySelector('h1');
      if (h1) {
        let hero = h1.closest('section,main,article,[class*="hero"],[id*="hero"],div');
        for (let i = 0; hero && i < 5; i++, hero = hero.parentElement) {
          if (hero.contains(el)) return 'hero';
        }
        const hr = h1.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        if (er.top < window.innerHeight * 0.92 && Math.abs((er.top + er.bottom) / 2 - (hr.top + hr.bottom) / 2) < window.innerHeight * 0.65) return 'hero';
      }
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight ? 'above-fold-content' : 'content';
    }
    function intentFor(text, href) {
      const s = `${text} ${href}`.toLowerCase();
      const socialHost = /(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)/i.test(String(href || ''));
      if (socialHost) return { name: 'social-handoff', score: 72 };
      const tests = [
        ['booking', 120, /book\s*(online|now)?|appointment|schedule|reserve/],
        ['consultation', 105, /consult|assessment|free\s+consult/],
        ['whatsapp', 95, /whatsapp|wa\.me/],
        ['call', 88, /call|tel:|phone/],
        ['message', 78, /message|messenger|m\.me|chat/],
        ['contact', 58, /contact|inquir|enquir/],
        ['directions', 45, /direction|maps|location/],
        ['generic', 25, /get started|learn more|discover|read more|visit/]
      ];
      for (const [name, score, regex] of tests) if (regex.test(s)) return { name, score };
      return { name: 'other', score: 0 };
    }

    const viewportRect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const interactive = Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"]')).filter(isVisible);
    const candidates = interactive.map((el, index) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const text = textOf(el);
      const href = el.href || el.getAttribute('href') || '';
      const intent = intentFor(text, href);
      const region = closestRegion(el);
      const fg = parseRgba(style.color);
      const bg = effectiveBackground(el);
      const contrast = contrastRatio(fg ? fg.slice(0, 3) : null, bg.rgb);
      const centerX = r.left + r.width / 2;
      const centerY = r.top + r.height / 2;
      const dx = Math.abs(centerX - window.innerWidth / 2) / Math.max(1, window.innerWidth / 2);
      const dy = Math.abs(centerY - window.innerHeight / 2) / Math.max(1, window.innerHeight / 2);
      const centrality = Math.max(0, 1 - (dx * 0.65 + dy * 0.35));
      const aboveFold = overlapArea(r, viewportRect) > 0;
      const fullyAboveFold = r.top >= 0 && r.bottom <= window.innerHeight;
      const targetLargeEnough = r.width >= 44 && r.height >= 44;
      const area = Math.max(0, r.width * r.height);
      const visualScore = Math.min(35, Math.log2(Math.max(1, area / 500)) * 7) + Math.min(18, (parseFloat(style.fontSize) || 0) * 0.7) + (targetLargeEnough ? 12 : 0) + (contrast != null && contrast >= 4.5 ? 12 : contrast != null && contrast >= 3 ? 7 : 0) + centrality * 16;
      let score = intent.score + visualScore + (aboveFold ? 42 : 0);
      if (region === 'hero') score += 75;
      if (region === 'above-fold-content') score += 20;
      if (region === 'navigation') score -= 72;
      if (region === 'footer') score -= 80;
      if (intent.name === 'booking' && region === 'hero') score += 45;
      if (!text && !href) score -= 50;
      return {
        index,
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 180),
        href: String(href).slice(0, 500),
        intent: intent.name,
        region,
        score: Math.round(score * 10) / 10,
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY), viewportY: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height), area: Math.round(area),
        aboveFold, fullyAboveFold, targetLargeEnough,
        fontSizePx: parseFloat(style.fontSize) || 0,
        fontWeight: style.fontWeight,
        foreground: style.color,
        declaredBackground: style.backgroundColor,
        effectiveBackground: bg.css,
        backgroundLayers: bg.layers,
        contrastRatio: contrast,
        centrality: Math.round(centrality * 100) / 100
      };
    }).filter(c => c.intent !== 'other');

    const ranked = [...candidates].sort((a, b) => b.score - a.score);
    // Primary CTA must be credible in the patient's initial journey. Never promote a deep footer/social icon
    // just because it is the highest-scoring action somewhere in the DOM.
    const patientIntent = c => ['booking','consultation','whatsapp','call','message','contact','social-handoff'].includes(c.intent);
    const credibleInitial = ranked.filter(c => patientIntent(c) && c.aboveFold && c.region !== 'footer' && c.score >= 55);
    const credibleNearFold = ranked.filter(c => patientIntent(c) && c.region !== 'footer' && c.viewportY >= 0 && c.viewportY <= window.innerHeight * 1.35 && c.score >= 85);
    const primary = credibleInitial[0] || credibleNearFold[0] || null;
    const fallbackCta = primary ? null : (ranked.find(c => patientIntent(c) && c.region !== 'footer') || null);
    const meaningfulAboveFold = ranked.filter(c => c.aboveFold && c.score >= 70);
    return {
      interactiveElementCount: interactive.length,
      ctaCandidateCount: candidates.length,
      aboveFoldCtaCount: candidates.filter(c => c.aboveFold).length,
      meaningfulAboveFoldCtaCount: meaningfulAboveFold.length,
      competingAboveFoldCtas: meaningfulAboveFold.slice(0, 20),
      primaryCta: primary,
      fallbackCta,
      primarySelection: primary ? 'credible-initial-journey' : (fallbackCta ? 'no-credible-primary-fallback-recorded' : 'none-detected'),
      secondaryCtas: ranked.slice(1, 6),
      candidates: ranked.slice(0, 60),
      rankingVersion: 3
    };
  });
}

module.exports = { collectCtaMetrics };
