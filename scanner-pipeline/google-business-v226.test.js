const assert=require('assert');
const {classifyDestination,mergeProbeIntoEvidence}=require('./google-business-probe');
const {buildReportModel}=require('./report-engine');

let x=classifyDestination('https://clinic.example/appointment',{auditedWebsite:'https://clinic.example'});
assert.equal(x.classification,'direct-clinic-booking'); assert(x.qualityScore>=85);
x=classifyDestination('https://facebook.com/exampleclinic',{auditedWebsite:'https://clinic.example',raw:{bodyText:'Log in to Facebook'}});
assert.equal(x.classification,'social-profile'); assert(x.qualityScore>=45 && x.qualityScore<70);
x=classifyDestination('https://cebudentalimplants.com/best-dentists',{auditedWebsite:'https://clinic.example'});
assert.equal(x.classification,'aggregator-or-directory'); assert(x.qualityScore<30);
x=classifyDestination('https://edenclinic.ai/reception/book',{auditedWebsite:'https://clinic.example',raw:{bodyText:'AI receptionist book appointment'}});
assert.equal(x.classification,'eden-ai-receptionist'); assert(x.qualityScore>=95);

const template={reviewedUrl:'https://clinic.example',identity:{clinicName:'Example Dental',location:'Cebu'},discovery:{googleMapsUrls:['https://maps.app.goo.gl/x']},branches:[{status:'awaiting-evidence',identity:{clinicName:'Example Dental'},discovery:{},profile:{},reputation:{},media:{},consistency:{},actions:{}}]};
const probe={status:'probed',targetUrl:'https://maps.app.goo.gl/x',finalUrl:'https://www.google.com/maps/place/Example+Dental',profileSurfaceConfirmed:true,identity:{pageName:'Example Dental Clinic',expectedName:'Example Dental'},profile:{rating:4.8,reviewCount:200,address:'123',phone:'09171234567',website:'https://clinic.example',hoursPresent:true},reputation:{sampledReviewDates:['a week ago']},media:{profileImageVisible:true},actions:{directions:{observed:true},website:{observed:true},call:{observed:true},booking:{observed:null},message:{observed:null}},conversionDestination:classifyDestination('https://facebook.com/exampleclinic',{auditedWebsite:'https://clinic.example'}),provenance:{collectedAt:'2026-08-28T00:00:00Z'},reviewsSurface:{}};
const evidence=mergeProbeIntoEvidence(template,probe,{phoneDisplayedNumbers:['0917-123-4567']});
assert.equal(evidence.branches[0].conversionDestination.classification,'social-profile');
const model=buildReportModel({version:'2.2.6',clinicIdentity:{clinicName:'Example Dental'},reviewedUrl:'https://clinic.example',summary:{bookingCtaVisible:true,phoneActionable:true,mobileHeroClarity:80},scoring:{overall:80,categories:{conversionCta:85}},findings:{findings:[]},googleBusiness:{assessment:{status:'insufficient-evidence',overall:null,confidence:'low'},evidence},googleBusinessProbe:probe,facebook:{assessment:{status:'awaiting-evidence'}}});
assert(model.priorityFindings.some(f=>f.id==='google-conversion-destination'));
assert(model.quickWins.some(w=>/Google patient handoff/i.test(w.title)));
console.log('google-business-v226 tests passed');
