const fs=require('fs');
const path=require('path');
const {writeOwnerReportFiles}=require('./owner-report');
const args=process.argv.slice(2);
const valueAfter=f=>{const i=args.indexOf(f);return i>=0?args[i+1]||null:null;};
const valueFlags=['--demo-url','--proof-url','--owner-review','--snapshot','--cover-image','--fix-image'];
const snapshotPath=args.find((a,i)=>!a.startsWith('--')&&(i===0||!valueFlags.includes(args[i-1])))||valueAfter('--snapshot');
if(!snapshotPath){console.error('Usage: node scanners/render-owner-report.js audit-output/<clinic>/snapshot.json [--owner-review owner-review.json] [--cover-image image.jpg] [--fix-image image.jpg] [--demo-url https://...] [--proof-url https://...]');process.exit(1);}
const full=path.resolve(snapshotPath);
const manifest=JSON.parse(fs.readFileSync(full,'utf8'));
const outDir=manifest.outputDir&&fs.existsSync(manifest.outputDir)?manifest.outputDir:path.dirname(full);
const result=writeOwnerReportFiles(outDir,manifest,{demoUrl:valueAfter('--demo-url')||process.env.EDEN_DEMO_URL||null,proofUrl:valueAfter('--proof-url')||process.env.EDEN_PROOF_URL||null,ownerReviewPath:valueAfter('--owner-review')||process.env.EDEN_OWNER_REVIEW||null,coverImage:valueAfter('--cover-image')||process.env.EDEN_COVER_IMAGE||null,fixImage:valueAfter('--fix-image')||process.env.EDEN_FIX_IMAGE||null});
console.log(`Eden Owner Report complete: ${result.htmlPath}`);
console.log(`Human review template: ${result.reviewTemplatePath}`);
console.log(JSON.stringify(result,null,2));
