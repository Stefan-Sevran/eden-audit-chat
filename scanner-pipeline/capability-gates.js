function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Math.round(n)));}

function evaluateHeroValidity({ hero={}, cta={}, pageMetrics={} }={}) {
  const legacy=pageMetrics.legacy||{};
  const responsiveness=pageMetrics.responsiveness||{};
  const checks={
    meaningfulHeadline: !!hero.headline && hero.headline.trim().length>=12,
    meaningfulPrimaryAction: !!cta && ['booking','consultation','contact','call','whatsapp','line','social-handoff'].includes(cta.intent),
    conversionAction: !!cta && ['booking','consultation'].includes(cta.intent),
    currentFunctionalMedia: !legacy.obsoleteFlashDetected,
    mobileFoundation: responsiveness.viewportMetaPresent !== false,
    readablePrimaryAction: !cta || ((cta.fontSizePx||16)>=14 && (cta.height||44)>=36)
  };
  let score=100;
  if(!checks.meaningfulHeadline) score-=28;
  if(!checks.meaningfulPrimaryAction) score-=24;
  else if(!checks.conversionAction) score-=12;
  if(!checks.currentFunctionalMedia) score-=32;
  if(!checks.mobileFoundation) score-=16;
  if(!checks.readablePrimaryAction) score-=14;
  if((responsiveness.tinyTextCharacterPercent ?? responsiveness.tinyTextPercent ?? 0)>50) score-=12;
  return {score:clamp(score),checks,gateCeiling:clamp(score<25?38:score<45?45:score<65?65:score<80?80:98), legacy};
}

function evaluateAppointmentAccess({ desktop={}, mobile={}, bookingFlow={} }={}) {
  const df=desktop.funnelMetrics||{}, mf=mobile.funnelMetrics||{};
  const dpm=desktop.pageMetrics||{}, mpm=mobile.pageMetrics||{};
  const booking=!!(df.onlineBookingVisible||mf.onlineBookingVisible);
  const nativeBooking=!!((df.nativeBookingLinks?.length||0)+(mf.nativeBookingLinks?.length||0));
  const externalBooking=!!((df.externalBookingLinks?.length||0)+(mf.externalBookingLinks?.length||0));
  const phoneActionable=(df.phoneLinks?.length||0)+(mf.phoneLinks?.length||0)>0;
  const phoneDisplayed=!!(dpm.contact?.phoneDisplayed||mpm.contact?.phoneDisplayed);
  const line=(df.lineLinks?.length||0)+(mf.lineLinks?.length||0)>0;
  const whatsapp=(df.whatsappLinks?.length||0)+(mf.whatsappLinks?.length||0)>0;
  const messenger=(df.messengerLinks?.length||0)+(mf.messengerLinks?.length||0)>0;
  const viber=(desktop.channelMetrics?.viberLinks?.length||0)+(mobile.channelMetrics?.viberLinks?.length||0)>0;
  const contactPage=!!(df.contactPageVisible||mf.contactPageVisible||(df.contactLinks?.length||0)||(mf.contactLinks?.length||0));
  const socialCandidates=[desktop.ctaMetrics?.primaryCta,mobile.ctaMetrics?.primaryCta,...(desktop.ctaMetrics?.candidates||[]),...(mobile.ctaMetrics?.candidates||[])].filter(Boolean);
  const facebookHandoff=socialCandidates.some(c=>c.intent==='social-handoff' && /facebook\.com|fb\.com/i.test(c.href||''));
  const socialHandoff=facebookHandoff || socialCandidates.some(c=>c.intent==='social-handoff') || !!(df.socialHandoffVisible||mf.socialHandoffVisible);
  let score=0;
  if(nativeBooking) score+=52;
  else if(externalBooking) score+=46;
  else if(booking) score+=50;
  else if(socialHandoff) score+=34;
  if(phoneActionable) score+=16; else if(phoneDisplayed) score+=10;
  if(contactPage) score+=8;
  if(line) score+=10;
  if(whatsapp) score+=8;
  if(messenger) score+=4;
  if(viber) score+=8;
  score=Math.min(96,clamp(score));
  let status='no-clear-appointment-path';
  if(nativeBooking) status='native-online-booking';
  else if(externalBooking) status='external-booking-provider';
  else if(booking) status='online-booking-available';
  else if(socialHandoff) status=facebookHandoff?'facebook-handoff':'social-handoff';
  else if(line||whatsapp||messenger||viber||phoneActionable) status='contact-led-booking-only';
  else if(phoneDisplayed||contactPage) status='manual-contact-only';
  return {score,status,ceiling:96,onlineBookingAvailable:booking,nativeBooking,externalBooking,socialHandoff,facebookHandoff,phoneDisplayed,phoneActionable,contactPage,line,whatsapp,messenger,viber,bookingJourneyMeasured:!!bookingFlow?.analyzed};
}
module.exports={evaluateHeroValidity,evaluateAppointmentAccess};
