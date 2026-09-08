async function collectFunnelMetrics(page) {
  return page.evaluate(() => {
    function visible(el) {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.02;
    }
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      href: a.href || ''
    }));
    const visibleText = Array.from(document.querySelectorAll('body *')).filter(visible).map(el => el.childElementCount === 0 ? (el.innerText || '').trim() : '').filter(Boolean).join(' ');
    const lower = `${document.body?.innerText || ''} ${visibleText}`.toLowerCase();
    const htmlLower = document.documentElement.innerHTML.toLowerCase();
    const altAria = Array.from(document.querySelectorAll('[alt],[aria-label],[title]')).map(el => `${el.getAttribute('alt') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`).join(' ').toLowerCase();
    const forms = Array.from(document.forms).map((form, index) => {
      const fields = Array.from(form.querySelectorAll('input,select,textarea')).filter(el => !['hidden','submit','button'].includes((el.type || '').toLowerCase()));
      return { index, action: form.action || '', method: (form.method || 'get').toLowerCase(), fieldCount: fields.length, requiredFieldCount: fields.filter(f => f.required).length,
        fields: fields.slice(0, 30).map(f => ({ type: (f.type || f.tagName).toLowerCase(), name: f.name || '', required: !!f.required })) };
    });
    const bookingRegex = /(book|appointment|schedule|reserve|consult)/i;
    const socialHandoffRegex = /(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com)/i;
    const socialHandoffLinks = links.filter(l => socialHandoffRegex.test(l.href));
    const bookingLinks = links.filter(l => bookingRegex.test(`${l.text} ${l.href}`) && !socialHandoffRegex.test(l.href));
    const nativeBookingLinks = bookingLinks.filter(l => { try { return new URL(l.href).hostname.replace(/^www\./,'') === location.hostname.replace(/^www\./,''); } catch { return false; } });
    const externalBookingLinks = bookingLinks.filter(l => { try { return new URL(l.href).hostname.replace(/^www\./,'') !== location.hostname.replace(/^www\./,''); } catch { return false; } });
    const contactRegex = /(contact|location|directions|find us|get in touch|reach us)/i;
    const contactLinks = links.filter(l => contactRegex.test(`${l.text} ${l.href}`));
    const whatsappLinks = links.filter(l => /(wa\.me|whatsapp)/i.test(l.href));
    const messengerLinks = links.filter(l => /(m\.me|messenger\.com|facebook\.com\/messages)/i.test(l.href));
    const lineLinks = links.filter(l => /(line\.me|lin\.ee|line:\/\/)/i.test(l.href) || /\bline\b/i.test(l.text));
    const phoneLinks = links.filter(l => /^tel:/i.test(l.href));
    const mapsLinks = links.filter(l => /(maps\.google|google\.[^/]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|directions)/i.test(l.href));
    const mapEmbeds = Array.from(document.querySelectorAll('iframe[src]')).filter(f => /(google.*maps|maps\.google|openstreetmap|mapbox)/i.test(f.src || '') && visible(f)).map(f => (f.src || '').slice(0,800));
    const pricingVisible = /(price|pricing|fees|cost|rates|packages|starts at|from ฿|from ₱|บาท|ราคา|fees\s*&\s*offers)/i.test(lower);
    const reviewsVisible = /(review|reviews|testimonial|testimonials|rating|what our patients say|google review|facebook review)/i.test(lower + ' ' + altAria);
    const doctorProfileVisible = /(meet (our |the )?(doctor|dentist|team)|our (doctors|dentists|specialists|dental team)|doctor profile|dentist profile|specialist team|dr\.?\s+[a-z]{2,})/i.test(lower);
    const clinicianMentionVisible = /(expert dentists?|dentists?|doctors?|orthodontists?|implantologists?|specialists?)/i.test(lower);
    const beforeAfterVisible = /(before and after|before\s*&\s*after|before\/after|smile gallery|treatment results|results gallery)/i.test(lower + ' ' + altAria);
    const patientCountTrustVisible = /(trusted by[^.]{0,50}\d[\d,\.]*\+?\s*(patients?|clients?)|more than\s+\d[\d,\.]*\s*(patients?|clients?)|\d[\d,\.]*\+\s*(patients?|smiles?))/i.test(lower);
    const accreditationTrustVisible = /(licensed|certified|accredited|award|straumann|invisalign|neobiotech|board[- ]certified|iso\s*\d+)/i.test(lower + ' ' + altAria);
    const chatWidgetLikely = /(intercom|tawk|crisp|zendesk|livechat|tidio|messenger|chatwoot)/i.test(htmlLower);

    return {
      forms,
      totalFormFields: forms.reduce((sum, f) => sum + f.fieldCount, 0),
      bookingLinks: bookingLinks.slice(0, 30), nativeBookingLinks: nativeBookingLinks.slice(0,30), externalBookingLinks: externalBookingLinks.slice(0,30), onlineBookingVisible: bookingLinks.length > 0,
      socialHandoffLinks: socialHandoffLinks.slice(0,30), socialHandoffVisible: socialHandoffLinks.length > 0,
      contactLinks: contactLinks.slice(0,30), contactPageVisible: contactLinks.length > 0,
      phoneLinks: phoneLinks.slice(0, 20), whatsappLinks: whatsappLinks.slice(0, 20), messengerLinks: messengerLinks.slice(0, 20), lineLinks: lineLinks.slice(0, 20),
      mapsLinks: mapsLinks.slice(0, 20), mapEmbeds: mapEmbeds.slice(0,10), mapEmbedVisible: mapEmbeds.length > 0,
      pricingVisible, reviewsVisible, doctorProfileVisible, clinicianMentionVisible, beforeAfterVisible, patientCountTrustVisible, accreditationTrustVisible, chatWidgetLikely
    };
  });
}

module.exports = { collectFunnelMetrics };
