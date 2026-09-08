const assert=require('assert');
const {buildActionEngine,buildRevenueOpportunity,priorityIndex}=require('./cross-channel-action-engine');
const manifest={
  bookingFlow:{analyzed:true,manualConfirmationDetected:true,responseWithinDays:1,minimumAdvanceDays:3,urgentFallbackDetected:true,totalRequiredFieldCount:8,measurementCompleteness:{unknownLaterStepBurden:true}},
  googleBusiness:{evidence:{branches:[{discovery:{matched:true,matchConfidence:'high'},identityIsolation:{status:'confirmed'},conversionDestination:{status:'probed',classification:'clinic-website',qualityScore:76,finalUrl:'https://clinic.test/'}}]}},
  aiAuditIntelligence:{facebookVisualAssessments:{handoffQuality:{assessment:'weak',confidence:'high',rationale:'Login wall'},receptionistOpportunity:{opportunity:'not_assessable',confidence:'high',rationale:'thin evidence'}},conflicts:[]}
};
const a=buildActionEngine(manifest);
assert(a.topActions.length===3);
assert(a.actions.some(x=>x.id==='booking-immediate-response'));
assert(a.actions.some(x=>x.id==='near-term-demand-route'));
assert(a.actions.some(x=>x.id==='google-conversion-destination'));
assert(!a.actions.some(x=>x.id==='facebook-ai-receptionist'));
assert(priorityIndex(90,'high',30)>priorityIndex(60,'medium',70));
const r0=buildRevenueOpportunity(manifest,null);
assert.equal(r0.status,'inputs-required');
assert.equal(r0.monthlyRevenueOpportunity,null);
const r=buildRevenueOpportunity(manifest,{currency:'THB',averageRevenuePerRecoveredPatient:12000,monthlyMissedCalls:20,monthlyDelayedMessages:30});
assert.equal(r.status,'scenario-calculated');
assert(r.monthlyRevenueOpportunity.low>0 && r.monthlyRevenueOpportunity.high>r.monthlyRevenueOpportunity.low);
console.log('cross-channel-action-v229 ok');
