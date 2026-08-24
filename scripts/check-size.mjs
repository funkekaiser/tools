import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BUDGET = 50 * 1024; // bytes, gzipped

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const toolsDir = path.join(repoRoot, 'tools');

let exitCode = 0;
const results = [];
const failures = [];

// Scan tools directory
if (!fs.existsSync(toolsDir)) {
  console.log('No tools directory found.');
  process.exit(0);
}

const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
const toolDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

if (toolDirs.length === 0) {
  console.log('No tools found.');
  process.exit(0);
}

for (const slug of toolDirs) {
  const toolPath = path.join(toolsDir, slug);
  const indexPath = path.join(toolPath, 'index.html');
  const metaPath = path.join(toolPath, 'meta.json');

  // Check for index.html
  if (!fs.existsSync(indexPath)) {
    console.error(`FAIL: ${slug} has no index.html`);
    exitCode = 1;
    continue;
  }

  // Check for meta.json
  if (!fs.existsSync(metaPath)) {
    console.error(`FAIL: ${slug} missing meta.json`);
    exitCode = 1;
    continue;
  }

  // Validate meta.json
  let meta;
  try {
    const metaContent = fs.readFileSync(metaPath, 'utf8');
    meta = JSON.parse(metaContent);
  } catch (e) {
    console.error(`FAIL: ${slug} meta.json is not valid JSON`);
    exitCode = 1;
    continue;
  }

  const requiredKeys = ['title', 'blurb', 'tags', 'keywords'];
  const missingKeys = requiredKeys.filter(k => !(k in meta));
  if (missingKeys.length > 0) {
    console.error(
      `FAIL: ${slug} meta.json missing keys: ${missingKeys.join(', ')}`
    );
    exitCode = 1;
    continue;
  }

  // Read and gzip index.html
  const htmlBuf = fs.readFileSync(indexPath);
  const gzipped = gzipSync(htmlBuf, { level: 9 });
  const gzippedSize = gzipped.length;
  const rawSize = htmlBuf.length;
  const percentage = ((gzippedSize / BUDGET) * 100).toFixed(0);

  const status = gzippedSize > BUDGET ? 'FAIL' : 'ok';
  if (gzippedSize > BUDGET) {
    exitCode = 1;
    failures.push(slug);
  }

  const gzippedKb = (gzippedSize / 1024).toFixed(1);
  const rawKb = (rawSize / 1024).toFixed(1);

  results.push({
    slug,
    gzippedKb,
    rawKb,
    percentage,
    status
  });
}

// Print table
if (results.length > 0) {
  console.log('\nTool size report (gzipped budget: 50 KB):');
  console.log('');

  const slugWidth = Math.max(...results.map(r => r.slug.length), 4);
  const gzipWidth = 6;
  const rawWidth = 6;
  const percWidth = 4;
  const statusWidth = 4;

  // Header
  console.log(
    `${'slug'.padEnd(slugWidth)}  ${'gzip'.padStart(gzipWidth)}  ${'raw'.padStart(rawWidth)}  ${
      '%'.padStart(percWidth)
    }  ${''.padEnd(statusWidth)}`
  );
  console.log('-'.repeat(slugWidth + gzipWidth + rawWidth + percWidth + statusWidth + 12));

  // Rows
  for (const result of results) {
    console.log(
      `${result.slug.padEnd(slugWidth)}  ${result.gzippedKb.padStart(gzipWidth)} KB  ${result.rawKb.padStart(rawWidth)} KB  ${
        result.percentage.padStart(percWidth)
      }%  ${result.status.padEnd(statusWidth)}`
    );
  }
  console.log('');
}

// Summary
if (exitCode === 0) {
  const count = results.length;
  const plural = count === 1 ? 'tool' : 'tools';
  console.log(`✓ ${count} ${plural} within budget (50 KB gzipped)`);
} else {
  if (failures.length > 0) {
    console.error(
      `✗ Budget exceeded by: ${failures.join(', ')}`
    );
  }
}

process.exit(exitCode);
