// Validate real HTTP responses against the exact runtime schemas shipped to the browser.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../../packages/contracts/src/schema.ts', import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
const S = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const samples = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = samples.map((sample) => {
  const data = sample.job ? S.jobSnapshot(S[sample.schema]) : S[sample.schema];
  const result = S.apiResponse(data).safeParse(sample.response);
  return { case: sample.case, status: result.success ? 'PASS' : 'FAIL',
    ...(result.success ? {} : { issues: result.error.issues.slice(0, 6) }) };
});
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(results, null, 2));
console.log(JSON.stringify({ total: results.length, passed: results.filter(r => r.status === 'PASS').length, results }));
if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
