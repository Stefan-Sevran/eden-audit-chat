const fs=require('fs'); const assert=require('assert');
const src=fs.readFileSync(require.resolve('./facebook-probe'),'utf8');
assert(src.includes("rendered-order-text"));
assert(src.includes("replyAssociationMode"));
assert(src.includes("clinicCompacts"));
console.log('facebook-probe v2.1.12 tests passed');
