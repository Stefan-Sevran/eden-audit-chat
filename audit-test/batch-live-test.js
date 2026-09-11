const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const listPath = path.join(__dirname, 'batch-clinics.json');
const resultsDir = path.join(__dirname, 'results');

function runClinic(slug, label) {
  return new Promise(resolve => {
    const started = Date.now();

    console.log('\n==================================================');
    console.log(`STARTING: ${label || slug}`);
    console.log('==================================================\n');

    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'live-test.js'), slug],
      {
        cwd: root,
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe']
      }
    );

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      errorOutput += text;
      process.stderr.write(text);
    });

    child.on('close', code => {
      const durationSeconds = Math.round((Date.now() - started) / 1000);

      const passed =
        code === 0 &&
        /LIVE AUDIT PASS/.test(output);

      const statusMatches = [...output.matchAll(
        /\[(\d+)s\]\s+([a-z]+)\s*\/\s*([a-z]+)/gi
      )];

      const finalStatus = statusMatches.length
        ? statusMatches[statusMatches.length - 1][2]
        : null;

      const finalStage = statusMatches.length
        ? statusMatches[statusMatches.length - 1][3]
        : null;

      const tokenMatch = output.match(
        /Public token:\s*([a-f0-9]+)/i
      );

      resolve({
        slug,
        label: label || slug,
        passed,
        exitCode: code,
        durationSeconds,
        finalStatus,
        finalStage,
        publicToken: tokenMatch?.[1] || null,
        errorOutput: passed
          ? null
          : errorOutput.slice(-4000) || output.slice(-4000)
      });
    });
  });
}

async function main() {
  if (!fs.existsSync(listPath)) {
    throw new Error(
      `Clinic list not found: ${listPath}`
    );
  }

  const config = JSON.parse(
    fs.readFileSync(listPath, 'utf8')
  );

  const clinics = Array.isArray(config)
    ? config
    : config.clinics;

  if (!Array.isArray(clinics) || !clinics.length) {
    throw new Error('batch-clinics.json contains no clinics.');
  }

  fs.mkdirSync(resultsDir, { recursive: true });

  console.log('\nEDEN BATCH LIVE AUDIT BENCHMARK');
  console.log('================================');
  console.log(`Clinics: ${clinics.length}`);
  console.log('Mode: sequential production scans');

  const results = [];

  for (const clinic of clinics) {
    if (clinic.enabled === false) continue;

    const result = await runClinic(
      clinic.slug,
      clinic.label
    );

    results.push(result);

    console.log(
      `\n${result.passed ? '✅' : '❌'} ` +
      `${result.label}: ` +
      `${result.durationSeconds}s · ` +
      `${result.finalStatus || 'unknown'} / ` +
      `${result.finalStage || 'unknown'}`
    );
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const jsonPath = path.join(
    resultsDir,
    `batch-${stamp}.json`
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      results
    }, null, 2)
  );

  console.log('\n\nEDEN BATCH BENCHMARK SUMMARY');
  console.log('============================');

  for (const result of results) {
    console.log(
      `${result.passed ? '✅' : '❌'} ` +
      `${result.label.padEnd(30)} ` +
      `${String(result.durationSeconds).padStart(4)}s  ` +
      `${result.finalStatus || 'unknown'} / ` +
      `${result.finalStage || 'unknown'}`
    );
  }

  const passed = results.filter(x => x.passed).length;

  console.log(
    `\n${passed}/${results.length} clinics passed.`
  );

  console.log(`Results saved: ${jsonPath}`);

  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('\nBATCH BENCHMARK FAILED');
  console.error(error);
  process.exitCode = 1;
});
