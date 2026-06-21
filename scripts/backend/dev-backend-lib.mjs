import fs from 'node:fs';
import path from 'node:path';

export function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }
  return values;
}

export function loadRepoEnv(repoRoot) {
  const merged = {};
  const envFiles = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'python-backend', '.env'),
  ];

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) {
      continue;
    }
    Object.assign(merged, parseEnvFile(fs.readFileSync(envFile, 'utf8')));
  }

  return merged;
}

export function parseDatabaseTarget(databaseUrl) {
  if (!databaseUrl) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return null;
  }

  if (!['postgresql:', 'postgres:'].includes(parsedUrl.protocol)) {
    return null;
  }

  const host = parsedUrl.hostname || '127.0.0.1';
  const port = Number(parsedUrl.port || '5432');
  return {
    host,
    port,
    isLocal: ['127.0.0.1', 'localhost', '::1'].includes(host),
  };
}
