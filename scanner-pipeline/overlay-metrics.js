async function collectOverlayMetrics(page) {
  return page.evaluate(() => {
    function visible(el) {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.02 && r.width > 20 && r.height > 20;
    }
    function intersection(a, b) {
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return w * h;
    }
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const viewportArea = innerWidth * innerHeight;
    const all = Array.from(document.querySelectorAll('body *')).filter(visible);
    const overlays = all.map((el, index) => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const fixedLike = ['fixed','sticky'].includes(s.position);
      const areaVisible = intersection(r, viewport);
      const coverage = areaVisible / Math.max(1, viewportArea);
      const z = parseInt(s.zIndex, 10);
      const cookie = /(cookie|consent|privacy|gdpr|we use cookies|accept|decline|allow cookies)/i.test(text);
      const modalWords = /(subscribe|newsletter|sign up|special offer|promotion|book now|chat with us)/i.test(text);
      return { el, index, r, text, fixedLike, coverage, z: Number.isFinite(z) ? z : 0, cookie, modalWords };
    }).filter(x => x.coverage >= 0.03 && (x.fixedLike || x.z >= 10) && (x.cookie || x.modalWords || x.coverage >= 0.18));

    const leafish = overlays.filter(a => !overlays.some(b => b !== a && a.el.contains(b.el) && b.coverage >= a.coverage * 0.75));
    const mapped = leafish.sort((a,b) => b.coverage - a.coverage).slice(0, 20).map(x => ({
      index: x.index,
      tag: x.el.tagName.toLowerCase(),
      id: x.el.id || '',
      className: String(x.el.className || '').slice(0, 300),
      text: x.text.slice(0, 500),
      type: x.cookie ? 'cookie-consent' : x.modalWords ? 'modal/promo' : 'overlay',
      position: getComputedStyle(x.el).position,
      zIndex: x.z,
      x: Math.round(x.r.x), y: Math.round(x.r.y), width: Math.round(x.r.width), height: Math.round(x.r.height),
      viewportCoveragePercent: Math.round(x.coverage * 1000) / 10,
      buttons: Array.from(x.el.querySelectorAll('button,a,[role="button"]')).filter(visible).map(b => (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0, 12)
    }));
    const cookies = mapped.filter(x => x.type === 'cookie-consent');
    return {
      overlayCount: mapped.length,
      overlays: mapped,
      cookieConsentDetected: cookies.length > 0,
      cookieConsentViewportCoveragePercent: cookies[0]?.viewportCoveragePercent || 0,
      firstVisitConsentLikely: cookies.length > 0,
      maxViewportCoveragePercent: mapped[0]?.viewportCoveragePercent || 0
    };
  });
}

async function dismissCookieConsent(page) {
  const result = await page.evaluate(() => {
    function visible(el) {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.02 && r.width > 20 && r.height > 20;
    }
    const containers = Array.from(document.querySelectorAll('body *')).filter(visible).filter(el => /(cookie|consent|privacy|we use cookies|gdpr)/i.test((el.innerText || '').replace(/\s+/g,' ')));
    for (const container of containers) {
      const controls = Array.from(container.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')).filter(visible);
      const target = controls.find(el => /^(accept|accept all|allow|allow all|agree|i agree|ok|got it)$/i.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()));
      if (target) {
        target.click();
        return { dismissed: true, actionText: (target.innerText || target.value || '').trim().slice(0,100) };
      }
    }
    return { dismissed: false, actionText: '' };
  }).catch(() => ({ dismissed: false, actionText: '' }));
  if (result.dismissed) await page.waitForTimeout(700).catch(() => {});
  return result;
}

module.exports = { collectOverlayMetrics, dismissCookieConsent };
