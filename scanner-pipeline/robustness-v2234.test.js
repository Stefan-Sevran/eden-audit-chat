const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'facebook-probe.js'),'utf8');

// Structural guardrail: generic facebook.com can never qualify merely because its hostname contains "book".
assert.ok(src.includes('Never let the word \"book\" inside facebook.com count as booking evidence.'));
assert.match(src,/bookingActionIntegrity/);
assert.match(src,/explicit-booking-label/);
assert.match(src,/recognized-booking-provider/);
assert.match(src,/booking-route-semantics/);

// Evaluate just the pure helpers so we test semantics, not only source strings.
const start=src.indexOf("function bookingHrefEvidence");
const end=src.indexOf("function pageBaseUrl",start);
assert.ok(start>=0&&end>start,'booking helpers should exist');
const sandbox={URL};
vm.createContext(sandbox);
vm.runInContext(src.slice(start,end),sandbox);

assert.equal(sandbox.bookingActionEvidence({href:'https://www.facebook.com/YourDentistPattaya'}).qualified,false,'generic Facebook URL is not booking');
assert.equal(sandbox.bookingActionEvidence({href:'https://www.facebook.com/YourDentistPattaya/posts/abc'}).qualified,false,'Facebook post URL is not booking');
assert.equal(sandbox.bookingActionEvidence({label:'Book Now',href:'https://www.facebook.com/YourDentistPattaya'}).qualified,true,'explicit Book Now label qualifies');
assert.equal(sandbox.bookingActionEvidence({href:'https://www.facebook.com/YourDentistPattaya/appointments'}).qualified,true,'explicit appointments route qualifies');
assert.equal(sandbox.bookingActionEvidence({href:'https://calendly.com/clinic/consult'}).qualified,true,'recognized booking provider qualifies');
assert.equal(sandbox.facebookActionKind({href:'https://www.facebook.com/YourDentistPattaya'}),null,'facebook hostname substring must not create book action');
assert.equal(sandbox.facebookActionKind({label:'Appointment'}),'book');
console.log('V2.2.34 booking action integrity regression passed');
