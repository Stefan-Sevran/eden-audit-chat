const assert=require('assert');
const {VERSION,clinicnetThemeCss}=require('./owner-report');

assert.equal(VERSION,'2.3.0');
const css=clinicnetThemeCss('owner');
assert(css.includes('clinicnet-continuity-v2300'));
assert(css.includes('.hero{background:linear-gradient(135deg,#11143f'));
assert(css.includes('.decision-money.recover{background:linear-gradient(135deg,#171a49 0%,#4932ad 100%)'));
assert(css.includes('border-top:4px solid #2b7a63'),'Green should remain only as a restrained positive accent');
assert(!css.includes('background:linear-gradient(135deg,#173f36'),'No large dark-green recovery panel may remain');
assert(css.includes('.button{background:linear-gradient(135deg,#7a2cf6 0%,#315ff7 100%)'));
assert(css.includes('font-family:Inter'));

console.log('V2.3.0 full report palette harmonization regression tests passed.');
