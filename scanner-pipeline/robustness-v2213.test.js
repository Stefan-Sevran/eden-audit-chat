const assert=require('assert');
const {summarizeLogicalQuestions,dedupeObservedFields}=require('./booking-flow');
const {classifyDestination}=require('./google-business-probe');
const {buildActionEngine}=require('./cross-channel-action-engine');

// A long checkbox list is one logical patient question, not one required field per option.
const dentalChoiceFields=[
  {type:'text',name:'input_text',label:'Phone',required:true},
  ...['Twisted tooth','Old crowns','Dark tooth','Missing teeth','Tooth Pain'].map(label=>({type:'checkbox',name:'checkbox[]',label,required:true})),
  ...['Veneers','Teeth whitening','Braces','Implants'].map(label=>({type:'checkbox',name:'checkbox_4[]',label,required:true})),
  ...['Facebook','Google','Friends or Family'].map(label=>({type:'checkbox',name:'checkbox_2[]',label,required:true})),
  {type:'textarea',name:'description',label:'Main concern',required:true}
];
const logical=summarizeLogicalQuestions(dentalChoiceFields);
assert.equal(logical.logicalFieldCount,5); // phone + 3 option groups + concern
assert.equal(logical.logicalRequiredFieldCount,5);
assert.equal(logical.groupedChoiceQuestionCount,3);

// The same DOM questions rendered in a second state must not double the burden.
const deduped=dedupeObservedFields([
  {fingerprint:'state-a',fields:dentalChoiceFields},
  {fingerprint:'state-b',fields:dentalChoiceFields.map(x=>({...x}))}
]);
assert.equal(deduped.totalLogicalFieldCount,5);
assert.equal(deduped.totalLogicalRequiredFieldCount,5);
assert.equal(deduped.rawFieldCount,dentalChoiceFields.length);
assert(deduped.rawRequiredFieldCount>deduped.totalLogicalRequiredFieldCount);

// Dental Departures is not a neutral clinic-controlled booking provider.
const dd=classifyDestination('https://www.dentaldepartures.com/book/dentist/the-dental-design-center',{auditedWebsite:'https://dentaldesignpattaya.com'});
assert.equal(dd.classification,'third-party-booking-marketplace');
assert.equal(dd.ownerControl,'third-party-marketplace');
assert(dd.qualityScore<80);

// Marketplace Google booking should create an ownership action, while grouped controls
// should not create a fake "78 fields" action when logical burden is low.
const actions=buildActionEngine({
  bookingFlow:{analyzed:true,totalRequiredFieldCount:78,totalLogicalRequiredFieldCount:5,rawRequiredFieldCount:78,measurementCompleteness:{fullyTraversed:false}},
  googleBusiness:{evidence:{branches:[{discovery:{matched:true,matchConfidence:'high'},identityIsolation:{status:'confirmed'},conversionDestination:{status:'probed',classification:'clinic-website',qualityScore:76,finalUrl:'https://dentaldesignpattaya.com'},bookingDestination:{status:'probed',classification:'third-party-booking-marketplace',qualityScore:58,finalUrl:'https://www.dentaldepartures.com/book/dentist/the-dental-design-center'}}]}},
  aiAuditIntelligence:{conflicts:[]}
});
assert(actions.actions.some(x=>x.id==='google-booking-ownership'));
assert(!actions.actions.some(x=>x.id==='booking-field-friction'));
assert(!actions.actions.some(x=>x.id==='google-conversion-destination'));

console.log('robustness-v2213.test.js passed');
