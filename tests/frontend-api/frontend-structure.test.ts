import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');

test('frontend layered structure stays in the new directories', () => {
  for (const relativePath of ['app', 'features', 'shared', 'core']) {
    assert.ok(fs.existsSync(path.join(srcRoot, relativePath)), `Missing expected directory: src/${relativePath}`);
  }
});

test('legacy frontend directories do not return', () => {
  for (const relativePath of ['agent', 'lib', 'pages', 'store', 'sync']) {
    assert.ok(!fs.existsSync(path.join(srcRoot, relativePath)), `Legacy directory returned: src/${relativePath}`);
  }
});

test('shared and core do not import feature-layer code', () => {
  const roots = [path.join(srcRoot, 'shared'), path.join(srcRoot, 'core')];
  const importPattern = /(?:from|import)\s+['"][^'"]*features\//;

  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(target);
          continue;
        }
        if (!target.endsWith('.ts') && !target.endsWith('.tsx')) {
          continue;
        }
        const source = fs.readFileSync(target, 'utf8');
        assert.ok(!importPattern.test(source), `${target} must not import feature-layer modules`);
      }
    }
  }
});

test('app layer depends on feature public entrypoints only', () => {
  const root = path.join(srcRoot, 'app');
  const importPattern = /(?:from|import)\s+['"][^'"]*features\/[^'"]+\/(?:api|components|pages|runtime|store|sync|types)\//;
  const dynamicImportPattern = /import\(\s*['"][^'"]*features\/[^'"]+\/(?:api|components|pages|runtime|store|sync|types)\//;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!target.endsWith('.ts') && !target.endsWith('.tsx')) {
        continue;
      }
      const source = fs.readFileSync(target, 'utf8');
      assert.ok(!importPattern.test(source), `${target} must only import feature public entrypoints`);
      assert.ok(!dynamicImportPattern.test(source), `${target} must only dynamically import feature public entrypoints`);
    }
  }
});

test('components do not import feature-layer modules', () => {
  const root = path.join(srcRoot, 'components');
  const importPattern = /(?:from|import)\s+['"][^'"]*features\//;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!target.endsWith('.ts') && !target.endsWith('.tsx')) {
        continue;
      }
      const source = fs.readFileSync(target, 'utf8');
      assert.ok(!importPattern.test(source), `${target} must not import feature-layer modules`);
    }
  }
});

test('frontend index files avoid wildcard re-exports', () => {
  const allowed = new Set([path.join(srcRoot, 'core', 'index.ts')]);
  allowed.add(path.join(srcRoot, 'features', 'agent', 'runtime', 'index.ts'));
  allowed.add(path.join(srcRoot, 'features', 'agent', 'types', 'index.ts'));
  allowed.add(path.join(srcRoot, 'features', 'knowledge', 'api', 'index.ts'));
  allowed.add(path.join(srcRoot, 'features', 'knowledge', 'sync', 'index.ts'));
  allowed.add(path.join(srcRoot, 'features', 'settings', 'api', 'index.ts'));
  allowed.add(path.join(srcRoot, 'shared', 'store', 'index.ts'));
  allowed.add(path.join(srcRoot, 'core', 'events', 'index.ts'));
  allowed.add(path.join(srcRoot, 'core', 'errors', 'index.ts'));
  allowed.add(path.join(srcRoot, 'core', 'types', 'index.ts'));
  allowed.add(path.join(srcRoot, 'core', 'validation', 'index.ts'));
  const roots = [path.join(srcRoot, 'app'), path.join(srcRoot, 'features'), path.join(srcRoot, 'shared'), path.join(srcRoot, 'core')];

  for (const root of roots) {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(target);
          continue;
        }
        if (path.basename(target) !== 'index.ts') {
          continue;
        }
        if (allowed.has(target)) {
          continue;
        }
        const source = fs.readFileSync(target, 'utf8');
        assert.ok(!source.includes('export * from'), `${target} must not use wildcard re-exports`);
      }
    }
  }
});

test('feature modules import other features via public entrypoints only', () => {
  const root = path.join(srcRoot, 'features');
  const importPattern = /from\s+['"](?<target>\.\.\/\.\.\/(?<feature>agent|dashboard|finance|knowledge|settings|tasks|tools)(?:\/[^'"]+)?)['"]/g;
  const allowedFeatureApiEntrypoints = new Set(['../../settings/api']);
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!target.endsWith('.ts') && !target.endsWith('.tsx')) {
        continue;
      }
      const source = fs.readFileSync(target, 'utf8');
      const relative = path.relative(root, target);
      const featureName = relative.split(path.sep)[0];
      importPattern.lastIndex = 0;
      for (const match of source.matchAll(importPattern)) {
        const otherFeature = match.groups?.feature;
        const featureTarget = match.groups?.target;
        if (!otherFeature || !featureTarget || otherFeature === featureName) {
          continue;
        }
        assert.ok(
          featureTarget.endsWith('/public') || allowedFeatureApiEntrypoints.has(featureTarget),
          `${target} must use feature public entrypoints for cross-feature imports: ${featureTarget}`
        );
      }
    }
  }
});

test('agent runtime uses settings public entrypoint for provider config access', () => {
  const useAgentRuntimeSource = fs.readFileSync(path.join(srcRoot, 'features', 'agent', 'runtime', 'useAgentRuntime.ts'), 'utf8');
  const stateSource = fs.readFileSync(path.join(srcRoot, 'features', 'agent', 'runtime', 'state.ts'), 'utf8');

  assert.ok(useAgentRuntimeSource.includes("../../settings/public"));
  assert.ok(!useAgentRuntimeSource.includes("../../settings/api/providers"));
  assert.ok(stateSource.includes("../../settings/public"));
  assert.ok(!stateSource.includes("../../settings/api/providers"));
});

test('app layer imports feature public/page entrypoints only', () => {
  const root = path.join(srcRoot, 'app');
  const importPattern = /(?:from|import)\s*['"](?<target>[^'"]*features\/[^'"]+)['"]/g;
  const dynamicImportPattern = /import\(\s*['"](?<target>[^'"]*features\/[^'"]+)['"]\s*\)/g;
  const allowedSuffixes = ['/public', '/page'];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (!target.endsWith('.ts') && !target.endsWith('.tsx')) {
        continue;
      }
      const source = fs.readFileSync(target, 'utf8');
      for (const pattern of [importPattern, dynamicImportPattern]) {
        pattern.lastIndex = 0;
        for (const match of source.matchAll(pattern)) {
          const featureTarget = match.groups?.target;
          if (!featureTarget) continue;
          assert.ok(
            allowedSuffixes.some((suffix) => featureTarget.endsWith(suffix)),
            `${target} must import feature public/page entrypoints only: ${featureTarget}`
          );
        }
      }
    }
  }
});
