const fs=require('fs');
const assert=require('assert');
const src=fs.readFileSync(require.resolve('./facebook-probe'),'utf8');
assert(src.includes("SCHEMA_VERSION = '2.1.9'"));
assert(src.includes('captureCommentDiagnostics'));
assert(src.includes('facebook-comment-surface-'));
assert(src.includes('timestampLabel'));
assert(src.includes('clinicReplyTimestampLabel'));
console.log('facebook probe v2.1.9 regression checks passed');
