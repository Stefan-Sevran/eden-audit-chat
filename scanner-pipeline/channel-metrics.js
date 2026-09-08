async function collectChannelMetrics(page) {
  return page.evaluate(() => {
    const visible = el => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.02;
    };
    const regionFor = el => {
      const r = el.getBoundingClientRect();
      if (el.closest('footer')) return 'footer';
      if (el.closest('header,nav')) return 'navigation';
      if (r.top < innerHeight) return 'above-fold';
      return 'body';
    };
    const allAnchors = Array.from(document.querySelectorAll('a[href]'));
    const toLink = a => {
      const r=a.getBoundingClientRect();
      const isVisible=visible(a);
      return {
        text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g,' ').trim().slice(0,160),
        href: a.href || '',
        y: Math.round(r.y),
        visible:isVisible,
        aboveFold: isVisible && r.top < innerHeight && r.bottom > 0,
        region: isVisible ? regionFor(a) : 'hidden-or-collapsed'
      };
    };
    const links = allAnchors.filter(visible).map(toLink);
    // Discovery also inspects collapsed menus, structured `sameAs` links and raw
    // anchor destinations. This prevents active social channels from disappearing
    // simply because the desktop/mobile capture had a closed navigation drawer.
    const discoveredLinks = allAnchors.map(toLink);
    for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))){
      try{
        const data=JSON.parse(script.textContent||'{}');
        const nodes=Array.isArray(data)?data:[data];
        for(const node of nodes){
          for(const href of [].concat(node?.sameAs||[])){
            if(typeof href==='string') discoveredLinks.push({text:'structured sameAs',href,visible:false,aboveFold:false,region:'structured-data'});
          }
        }
      }catch{}
    }
    const pick = re => discoveredLinks.filter(l => re.test(`${l.text} ${l.href}`));
    const pickVisible = re => links.filter(l => re.test(`${l.text} ${l.href}`));
    const line = pick(/line\.me|lin\.ee|line:\/\/|\bline\b/i);
    const visibleLine = pickVisible(/line\.me|lin\.ee|line:\/\/|\bline\b/i);
    const whatsappAll = pick(/wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/|\bwhatsapp\b/i);
    const visibleWhatsappAll = pickVisible(/wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|whatsapp:\/\/|\bwhatsapp\b/i);
    const whatsappDirect = whatsappAll.filter(l => /wa\.me\/\+?\d|[?&]phone=\+?\d|whatsapp:\/\/send\?phone=/i.test(l.href));
    const whatsappShare = whatsappAll.filter(l => /[?&]text=|share/i.test(l.href) && !/[?&]phone=\+?\d/i.test(l.href));
    const messenger = pick(/m\.me|messenger\.com|facebook\.com\/messages|\bmessenger\b/i);
    const visibleMessenger = pickVisible(/m\.me|messenger\.com|facebook\.com\/messages|\bmessenger\b/i);
    const viber = pick(/viber:\/\/|vb\.me|invite\.viber\.com|\bviber\b/i);
    const visibleViber = pickVisible(/viber:\/\/|vb\.me|invite\.viber\.com|\bviber\b/i);
    const phone = links.filter(l => /^tel:/i.test(l.href));
    const email = links.filter(l => /^mailto:/i.test(l.href));
    const booking = pickVisible(/book\s*(online|now)?|appointment|schedule|reserve|consult/i);
    const facebook = pick(/facebook\.com|fb\.com/i).filter(l => !/facebook\.com\/messages/i.test(l.href));
    const instagram = pick(/instagram\.com/i);
    const youtube = pick(/youtube\.com|youtu\.be/i);
    const tiktok = pick(/tiktok\.com/i);
    const maps = pick(/google\.[^/]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|google\.[^/]+\/search\?q=/i);
    const mapIntent = discoveredLinks.filter(l => /\b(map|maps|location|directions|get directions|click here for map)\b|แผนที่|เส้นทาง/i.test(`${l.text} ${l.href}`));
    const patientContact = {
      phone: phone.length > 0,
      line: visibleLine.length > 0,
      whatsapp: visibleWhatsappAll.some(l => /wa\.me\/\+?\d|[?&]phone=\+?\d|whatsapp:\/\/send\?phone=/i.test(l.href)),
      messenger: visibleMessenger.length > 0,
      viber: visibleViber.length > 0,
      email: email.length > 0,
      booking: booking.length > 0
    };
    const socialPresence = {
      facebook: facebook.length > 0,
      instagram: instagram.length > 0,
      youtube: youtube.length > 0,
      tiktok: tiktok.length > 0,
      line: line.length > 0,
      whatsapp: whatsappAll.length > 0,
      viber: viber.length > 0
    };
    const locationNavigation = { googleMaps: maps.length > 0, locationIntent: mapIntent.length > 0 };
    const conversion = { onlineBooking: booking.length > 0, phoneCall: phone.length > 0, lineChat: line.length > 0, whatsappChat: whatsappDirect.length > 0, messengerChat: messenger.length > 0, viberChat: viber.length > 0 };
    const accessibility = {
      phone:{available:phone.length>0,aboveFold:phone.some(x=>x.aboveFold),persistent:phone.some(x=>x.region==='navigation')&&phone.some(x=>x.region==='footer'),directConversation:true,bookingCapable:true},
      line:{available:line.length>0,aboveFold:line.some(x=>x.aboveFold),persistent:line.some(x=>x.region==='navigation')&&line.some(x=>x.region==='footer'),directConversation:true,bookingCapable:true},
      whatsapp:{available:whatsappDirect.length>0,aboveFold:whatsappDirect.some(x=>x.aboveFold),persistent:whatsappDirect.some(x=>x.region==='navigation')&&whatsappDirect.some(x=>x.region==='footer'),directConversation:true,bookingCapable:true},
      messenger:{available:messenger.length>0,aboveFold:messenger.some(x=>x.aboveFold),persistent:messenger.some(x=>x.region==='navigation')&&messenger.some(x=>x.region==='footer'),directConversation:true,bookingCapable:true},
      viber:{available:viber.length>0,aboveFold:viber.some(x=>x.aboveFold),persistent:viber.some(x=>x.region==='navigation')&&viber.some(x=>x.region==='footer'),directConversation:true,bookingCapable:true},
      email:{available:email.length>0,aboveFold:email.some(x=>x.aboveFold),persistent:email.some(x=>x.region==='navigation')&&email.some(x=>x.region==='footer'),directConversation:false,bookingCapable:false},
      booking:{available:booking.length>0,aboveFold:booking.some(x=>x.aboveFold),persistent:booking.some(x=>x.region==='navigation')&&booking.some(x=>x.region==='footer'),directConversation:false,bookingCapable:true}
    };
    const visibleChannelCount = Object.values(patientContact).filter(Boolean).length;
    const aboveFoldChannelCount = [phone,line,whatsappDirect,messenger,viber,email,booking].filter(arr => arr.some(x => x.aboveFold)).length;
    return {
      patientContact,
      socialPresence,
      locationNavigation,
      conversion,
      accessibility,
      visibleChannelCount,
      aboveFoldChannelCount,
      lineLinks: line.slice(0,12),
      whatsappLinks: whatsappAll.slice(0,12),
      whatsappDirectLinks: whatsappDirect.slice(0,12),
      whatsappShareLinks: whatsappShare.slice(0,12),
      messengerLinks: messenger.slice(0,12),
      viberLinks: viber.slice(0,12),
      phoneLinks: phone.slice(0,12),
      emailLinks: email.slice(0,12),
      bookingLinks: booking.slice(0,20),
      facebookLinks: facebook.slice(0,12),
      mapIntentLinks: mapIntent.slice(0,12),
      hiddenOrStructuredChannelEvidence: discoveredLinks.filter(l=>!l.visible && /(facebook\.com|fb\.com|instagram\.com|youtube\.com|tiktok\.com|maps\.app\.goo\.gl|google\.[^/]+\/maps)/i.test(l.href)).slice(0,20),
      instagramLinks: instagram.slice(0,12),
      youtubeLinks: youtube.slice(0,12),
      tiktokLinks: tiktok.slice(0,12),
      mapLinks: maps.slice(0,12)
    };
  });
}
module.exports = { collectChannelMetrics };
