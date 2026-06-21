import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, 'dist');

const baseline = {
  vendor: 785744,
  main: 297700,
  'chart-vendor': 259955,
  'react-vendor': 144294,
  'animation-vendor': 111662,
};

const allowedGrowthBytes = 12 * 1024;
const warningThresholdBytes = 244 * 1024;

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (!fs.existsSync(distDir)) {
  throw new Error('dist directory not found. Run `npm run build` before bundle checks.');
}

const distFiles = new Map(
  fs.readdirSync(distDir).map((name) => {
    const filePath = path.join(distDir, name);
    const stat = fs.statSync(filePath);
    return [name, stat.size];
  })
);

const failures = [];
const trackedChunks = [];

for (const [prefix, size] of Object.entries(baseline)) {
  const matchedEntry = [...distFiles.entries()].find(
    ([name]) => name === `${prefix}.js` || (name.startsWith(`${prefix}.`) && name.endsWith('.js'))
  );
  const currentSize = matchedEntry?.[1];
  if (currentSize === undefined) {
    failures.push(`Missing expected bundle artifact for prefix: ${prefix}`);
    continue;
  }

  const delta = currentSize - size;
  trackedChunks.push({
    prefix,
    fileName: matchedEntry[0],
    baselineSize: size,
    currentSize,
    delta,
    exceedsWarningThreshold: currentSize > warningThresholdBytes,
  });
  if (delta > allowedGrowthBytes) {
    failures.push(
      `${matchedEntry[0]} grew by ${formatBytes(delta)} (baseline ${formatBytes(size)}, current ${formatBytes(currentSize)})`
    );
  }
}

trackedChunks.sort((left, right) => right.currentSize - left.currentSize);
const warningChunks = trackedChunks.filter((chunk) => chunk.exceedsWarningThreshold);

if (failures.length > 0) {
  console.error('Bundle size regression detected:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('\nTracked bundle sizes:');
  for (const chunk of trackedChunks) {
    console.error(
      `- ${chunk.fileName}: current ${formatBytes(chunk.currentSize)}, baseline ${formatBytes(chunk.baselineSize)}, delta ${formatBytes(chunk.delta)}`
    );
  }
  process.exit(1);
}

console.log('Bundle size baseline check passed.');
console.log('\nTracked bundle sizes:');
for (const chunk of trackedChunks) {
  const deltaLabel = chunk.delta === 0 ? '0.0 KiB' : `${chunk.delta > 0 ? '+' : ''}${formatBytes(chunk.delta)}`;
  console.log(
    `- ${chunk.fileName}: current ${formatBytes(chunk.currentSize)}, baseline ${formatBytes(chunk.baselineSize)}, delta ${deltaLabel}`
  );
}

if (warningChunks.length > 0) {
  console.log('\nTracked bundles still above the webpack warning threshold:');
  for (const chunk of warningChunks) {
    console.log(`- ${chunk.fileName}: ${formatBytes(chunk.currentSize)}`);
  }
  console.log('These are accepted as tracked debt for now; reduce them when touching related entrypoints or dependencies.');
}
