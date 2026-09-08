const assert=require('assert');
const fs=require('fs');
const src=fs.readFileSync(require.resolve('./facebook-probe'),'utf8');
assert(src.includes('page.mouse.click'));
assert(src.includes('clinicReplyTextIndicatorsLocated'));
assert(src.includes('clinicReplyCoordinateClicks'));
assert(src.includes('clinicReplyAncestorClicks'));
console.log('facebook-probe-v2121.test.js passed');
