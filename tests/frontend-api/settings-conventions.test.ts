import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const settingsPagePath = path.join(repoRoot, 'src', 'features', 'settings', 'pages', 'SettingsPage.tsx');
const settingsSectionDir = path.join(repoRoot, 'src', 'features', 'settings', 'pages', 'sections');

test('SettingsPage is a thin page shell', () => {
  const source = fs.readFileSync(settingsPagePath, 'utf8');
  const lineCount = source.split(/\r?\n/).length;

  assert.ok(lineCount <= 120, `SettingsPage.tsx should stay thin, got ${lineCount} lines`);
  assert.ok(!source.includes('fetch('), 'SettingsPage.tsx must not call fetch directly');
  assert.ok(!source.includes('alert('), 'SettingsPage.tsx must not use alert');
});

test('settings sections exist as split components', () => {
  const entries = fs.readdirSync(settingsSectionDir);

  assert.ok(entries.includes('ProfileSettingsSection.tsx'));
  assert.ok(entries.includes('SecuritySettingsSection.tsx'));
  assert.ok(entries.includes('DataManagementSection.tsx'));
  assert.ok(entries.includes('AgentConfigSection.tsx'));
});
