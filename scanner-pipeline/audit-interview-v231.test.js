const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const request=require('supertest');
const {parseAnswer,inferCurrency,buildInterview}=require('./audit-interview');
const {createInterviewApp}=require('./run-audit-interview');

assert.deepEqual(parseAnswer({kind:'volume'},'20–30').value,{low:20,high:30});
assert.equal(parseAnswer({kind:'rate'},'35%').value,.35);
assert.deepEqual(parseAnswer({kind:'rate'},'25 to 40 percent').value,{low:.25,high:.4});
assert.equal(parseAnswer({kind:'money'},'not sure').skipped,true);
assert.equal(inferCurrency('Pattaya, Thailand'),'THB');
assert.equal(inferCurrency('Cebu City, Philippines'),'PHP');

const clinic={websiteUrl:'digitaldentalpattaya.com',clinicName:'Digital Dental Pattaya',clinicLocation:'Pattaya, Thailand'};
const answers={monthlyWebFormInquiries:'20-30',monthlyMessengerTextInquiries:'80',monthlyMissedDelayedInquiries:'12',monthlyMissedCalls:'8',leadToBookingRate:'30%',attendanceRate:'90%',averageNewPatientValue:'5000'};
const interview=buildInterview({clinic,answers,confirmed:true,mode:'simulated-owner-test'});
assert.equal(interview.status,'confirmed');assert.equal(interview.revenueInputs.currency,'THB');assert.equal(interview.revenueInputs.attendanceRate,.9);assert.equal(interview.integrity.simulated,true);assert.match(interview.integrity.label,/SIMULATED OWNER INPUTS/);
const contradictory=buildInterview({clinic,answers:{...answers,monthlyMessengerTextInquiries:5,monthlyMissedDelayedInquiries:12}});assert.equal(contradictory.status,'needs-correction');assert(contradictory.errors.some(x=>/cannot exceed/.test(x)));

(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'eden-interview-v231-'));const app=createInterviewApp({clinic,port:0,openBrowser:false,outputRoot:root,mode:'simulated-owner-test'});try{await new Promise(r=>app.server.once('listening',r));const state=await request(app.server).get('/api/state').expect(200);assert.equal(state.body.version,'2.3.1');const confirmed=await request(app.server).post('/api/confirm').send({clinic,answers,confirmed:true,mode:'simulated-owner-test'}).expect(200);assert(fs.existsSync(confirmed.body.revenuePath));assert(fs.existsSync(confirmed.body.recordPath));const saved=JSON.parse(fs.readFileSync(confirmed.body.revenuePath,'utf8'));assert.equal(saved.averageNewPatientValue,5000);await request(app.server).post('/api/confirm').send({clinic,answers,confirmed:false}).expect(400);console.log('V2.3.1 interview parsing, integrity, confirmation and file-output tests passed.');}finally{await new Promise(r=>app.server.close(r));}})().catch(error=>{console.error(error);process.exitCode=1;});
