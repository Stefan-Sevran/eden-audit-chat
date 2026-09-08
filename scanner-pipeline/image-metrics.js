async function collectImageMetrics(page) {
  return page.evaluate(() => {
    function isVisible(el) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
    }
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    const images = Array.from(document.images).filter(isVisible).map((img, index) => {
      const r = img.getBoundingClientRect();
      const renderedW = Math.round(r.width), renderedH = Math.round(r.height);
      const naturalW = img.naturalWidth || 0, naturalH = img.naturalHeight || 0;
      return {
        index,
        src: (img.currentSrc || img.src || '').slice(0, 1000),
        alt: (img.alt || '').slice(0, 240),
        loading: img.loading || '',
        renderedWidth: renderedW,
        renderedHeight: renderedH,
        naturalWidth: naturalW,
        naturalHeight: naturalH,
        aboveFold: r.top < window.innerHeight && r.bottom > 0,
        viewportAreaShare: Math.round(((renderedW * renderedH) / viewportArea) * 1000) / 10,
        undersized: naturalW > 0 && naturalH > 0 && (naturalW < renderedW || naturalH < renderedH),
        scaleRatio: naturalW > 0 && renderedW > 0 ? Math.round((naturalW / renderedW) * 100) / 100 : null
      };
    });
    const broken = Array.from(document.images).filter(img => img.complete && img.naturalWidth === 0).map(img => (img.currentSrc || img.src || '').slice(0, 1000));
    const heroCandidates = images.filter(i => i.aboveFold && i.viewportAreaShare >= 12).sort((a,b) => b.viewportAreaShare - a.viewportAreaShare);
    return {
      totalImages: document.images.length,
      visibleImages: images.length,
      brokenImageCount: broken.length,
      brokenImages: broken.slice(0, 20),
      undersizedVisibleImages: images.filter(i => i.undersized).length,
      heroCandidate: heroCandidates[0] || null,
      images: images.slice(0, 100)
    };
  });
}

module.exports = { collectImageMetrics };
