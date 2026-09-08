function generateFindings(manifest) {
  const s=manifest.summary||{}, sc=manifest.scoring||{}, b=manifest.bookingFlow||{}, m=manifest.mobile||{};
  const findings=[];
  const push=(severity,category,title,evidence,recommendation='',confidence='verified')=>findings.push({severity,category,title,evidence,recommendation,confidence});

  if(s.primaryDesktopCta?.intent==='booking'&&s.primaryMobileCta?.intent==='booking'&&s.bookingCtaAboveFoldDesktop&&s.bookingCtaAboveFoldMobile)
    push('strength','conversion','Booking action is immediate on desktop and mobile',`Primary CTA is “${s.primaryDesktopCta.text}” on desktop and “${s.primaryMobileCta.text}” on mobile, both above the fold.`);
  else if(!s.bookingCtaAboveFoldMobile) push('high','conversion','Mobile booking action is not immediately visible','The primary mobile booking CTA was not detected above the initial viewport.','Move a clear booking/consultation action into the first mobile viewport.');

  if(s.lineVisible) push('strength','patient-communication','LINE is available as a patient contact channel','A visible LINE link/action was detected, which is especially relevant for Thai patient behavior.');
  if(s.whatsappPatientContactVisible) push('strength','patient-communication','Direct WhatsApp patient contact is available','A direct WhatsApp conversation link with a phone target was detected.');
  else if(s.whatsappVisible) push('info','patient-communication','WhatsApp reference detected, but direct patient-contact use is unverified','A WhatsApp-related link was found, but it did not resolve as a clear direct-to-clinic chat target.','Verify whether this is a share link, social link or genuine clinic contact action.','probable');

  const socialNames=['facebook','instagram','youtube','tiktok'].filter(k=>s.socialPresence?.[k]);
  if(socialNames.length>=3) push('strength','discovery-social','Broad discovery/social presence detected',`Working destinations were detected for ${socialNames.join(', ')}.`);
  if(s.googleMapsVisible) push('strength','location','Google Maps/location access is available','A Google Maps link or map embed was detected on the inspected patient path.');

  if((s.firstVisitCookieCoverageMobilePercent||0)>=12) push('medium','friction','First-visit consent occupies meaningful mobile space',`Cookie consent covers about ${s.firstVisitCookieCoverageMobilePercent}% of the initial mobile viewport.`,'Reduce visual footprint if legally/operationally feasible while keeping consent compliant.');

  const comp=m.ctaCompetition||{};
  if((comp.attentionFragmentationScore||0)>=50) push('medium','conversion','Several actions compete for first-screen attention',`Mobile attention-fragmentation score is ${comp.attentionFragmentationScore}/100 across ${comp.aboveFoldMeaningfulCtaCount||0} meaningful CTAs.`,'Keep one unmistakable primary conversion action and visually subordinate secondary channels.');

  if(s.heroMediaType==='video') push('info','visual','Dynamic hero video detected','The first impression changes over time, so visual quality and readability can vary by frame.','Review several representative frames rather than judging a single screenshot.');
  const heroMobile=sc.explainability?.hero?.mobile;
  if(heroMobile){
    if(heroMobile.overall<80) push('opportunity','mobile','Mobile hero has specific clarity headroom',`Explainable mobile hero clarity is ${heroMobile.overall}/100; lowest components are ${Object.entries(heroMobile.components).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([k,v])=>`${k} ${v}`).join(', ')}.`,'Improve the lowest-scoring components first rather than redesigning the whole hero.','strong-inference');
  }

  if(b.analyzed){
    if(b.externalProvider) push('info','booking','Booking leaves the clinic domain',`Booking resolves to ${b.finalUrl||b.targetUrl}.`,'Ensure branding, trust and mobile continuity remain strong after the handoff.');
    const totalFields=b.totalFieldCount??b.fieldCount??0, totalRequired=b.totalRequiredFieldCount??b.requiredFieldCount??0;
    if(totalRequired>=8) push('medium','booking','Booking journey asks for substantial required information',`The safely traversed booking path exposed ${totalFields} fields, ${totalRequired} required, across ${b.traversedStepCount||1} inspected step(s).`,'Ask only for information needed to secure the appointment; collect the rest later.');
    if((b.detectedStepCount||b.inferredStepCount||1)>=3) push('medium','booking','Booking is a multi-step journey',`The appointment interface structurally exposes about ${b.detectedStepCount||b.inferredStepCount} steps; the scanner safely inspected ${b.traversedStepCount||1} without submitting a booking.`,'Keep each step short, preserve progress visibility and remove non-essential fields.');
    if(b.manualConfirmationDetected) push('high','booking','Online booking does not appear instantly confirmed','The booking page says staff must review/contact the patient before the appointment is confirmed.','Where operationally possible, expose live availability or provide an immediate provisional reservation so patients are not left waiting.');
    if((b.minimumAdvanceDays||0)>=2) push('medium','booking','Website booking has an advance-booking restriction',`The booking page asks patients to book at least ${b.minimumAdvanceDays} days in advance.`,'Offer an obvious faster path for near-term demand and same-day intent.');
    if((b.responseWithinDays||0)>=1) push('medium','booking','Confirmation may take up to a day',`The booking instructions indicate a response window of about ${b.responseWithinDays} day(s).`,'Reduce response latency with instant acknowledgement and fast human/AI follow-up.');
    if(b.loginRequired) push('high','booking','Booking appears to require an account/login','Login/account language was detected on the booking path.','Allow guest booking where possible.');
  }

  if(!s.doctorProfileVisible&&s.clinicianMentionVisible) push('opportunity','trust','Clinicians are mentioned but dedicated profiles were not detected','The site references dentists/clinicians, but the inspected path did not expose a dedicated clinician-profile signal.','Make clinician identity, credentials and reassuring human proof easy to reach from high-intent pages.','probable');

  const discovery=manifest.siteDiscovery;
  if(discovery?.selectedDeepPages?.length) push('info','coverage','High-value patient pages were prioritized for deep inspection',`${discovery.discoveredCount} internal pages were discovered; ${discovery.selectedDeepPages.length} commercially important pages were selected for deeper desktop/mobile inspection.`,'','verified');

  return {version:1.4,overallScore:sc.overall??null,strengths:findings.filter(f=>f.severity==='strength'),opportunities:findings.filter(f=>!['strength','info'].includes(f.severity)),observations:findings.filter(f=>f.severity==='info'),findings};
}
module.exports={generateFindings};
