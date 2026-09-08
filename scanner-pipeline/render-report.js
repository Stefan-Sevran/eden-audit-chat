const fs=require('fs');
const path=require('path');
const {writeReportFiles}=require('./report-engine');

const args=process.argv.slice(2);
const valueAfter=f=>{const i=args.indexOf(f);return i>=0?args[i+1]||null:null;};
const snapshotPath=args.find(a=>!a.startsWith('--'))||valueAfter('--snapshot');
const humanReviewPath=valueAfter('--human-review');
if(!snapshotPath){
  console.error('Usage: node scanners/render-report.js audit-output/<clinic>/snapshot.json [--human-review review.json]');
  process.exit(1);
}
const full=path.resolve(snapshotPath);
const manifest=JSON.parse(fs.readFileSync(full,'utf8'));
const outDir=manifest.outputDir&&fs.existsSync(manifest.outputDir)?manifest.outputDir:path.dirname(full);
const result=writeReportFiles(outDir,manifest,{humanReviewPath});
console.log(`Eden Audit Report complete: ${result.htmlPath}`);
console.log(JSON.stringify(result,null,2));
