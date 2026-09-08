#!/usr/bin/env node
// scripts/bump.js
// Single Source of Truth (SSOT) version management utility for ZenMux Chat.
// Synchronizes package.json and js/state.js atomically, decoupling index.html.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const statePath = path.join(rootDir, 'js', 'state.js');
const swPath = path.join(rootDir, 'sw.js');
const htmlPath = path.join(rootDir, 'index.html');
const versionJsonPath = path.join(rootDir, 'version.json');

function parseSemver(v) {
  const clean = (v || '').replace(/^v/, '').trim();
  const parts = clean.split('.').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver format: "${v}". Expected X.Y.Z (e.g. 2.15.0)`);
  }
  return parts;
}

function calculateTargetVersion(current, arg) {
  const type = (arg || 'sync').trim().toLowerCase();
  const [major, minor, patch] = parseSemver(current);

  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    case 'sync':
      return `${major}.${minor}.${patch}`;
    default: {
      const [m, mi, p] = parseSemver(type);
      return `${m}.${mi}.${p}`;
    }
  }
}

function run() {
  const arg = process.argv[2];

  if (arg === '--help' || arg === '-h') {
    console.log(`
ZenMux Chat - Single Source of Truth Versioning Utility

Usage:
  node scripts/bump.js patch     Increment patch (e.g. 2.14.7 -> 2.14.8)
  node scripts/bump.js minor     Increment minor (e.g. 2.14.7 -> 2.15.0)
  node scripts/bump.js major     Increment major (e.g. 2.14.7 -> 3.0.0)
  node scripts/bump.js <semver>  Set explicit version (e.g. 2.15.0)
  node scripts/bump.js sync      Synchronize js/state.js to package.json version
`);
    process.exit(0);
  }

  // 1. Read package.json (authoritative SSOT)
  if (!fs.existsSync(pkgPath)) {
    console.error(`Error: package.json not found at ${pkgPath}`);
    process.exit(1);
  }

  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const currentVersion = pkg.version || '0.0.0';

  const newVersion = calculateTargetVersion(currentVersion, arg);

  // 2. Update package.json if changed
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // 3. Update js/state.js
  if (fs.existsSync(statePath)) {
    let stateContent = fs.readFileSync(statePath, 'utf8');
    const versionRegex = /(export\s+const\s+APP_VERSION\s*=\s*['"])[^'"]*(['"];)/;
    if (versionRegex.test(stateContent)) {
      stateContent = stateContent.replace(versionRegex, `$1${newVersion}$2`);
      fs.writeFileSync(statePath, stateContent, 'utf8');
    } else {
      console.warn(`Warning: APP_VERSION constant pattern not found in ${statePath}`);
    }
  } else {
    console.error(`Error: ${statePath} not found`);
    process.exit(1);
  }

  // 4. Update sw.js CACHE_NAME (SSOT invalidation key: precipitates PWA worker upgrade and cache eviction)
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    const cacheRegex = /(const\s+CACHE_NAME\s*=\s*['"]zenchat-shell-v)[^'"]*(['"];)/;
    if (cacheRegex.test(swContent)) {
      swContent = swContent.replace(cacheRegex, `$1${newVersion}$2`);
      fs.writeFileSync(swPath, swContent, 'utf8');
    } else {
      console.warn(`Warning: CACHE_NAME constant pattern not found in ${swPath}`);
    }
  }

  // 5. Ensure index.html version badge is neutralized for dynamic runtime hydration
  if (fs.existsSync(htmlPath)) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const badgeRegex = /<span\s+class="app-version-badge">[^<]*<\/span>/g;
    if (badgeRegex.test(htmlContent)) {
      htmlContent = htmlContent.replace(badgeRegex, '<span class="app-version-badge"></span>');
      fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    }
  }

  // 6. Generate version.json for client-side stale detection
  const versionPayload = {
    version: newVersion,
    buildTime: new Date().toISOString()
  };
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionPayload, null, 2) + '\n', 'utf8');

  console.log(`ZenMux Chat version synchronized: v${newVersion}`);
  console.log(`- package.json : ${currentVersion} -> ${newVersion}`);
  console.log(`- js/state.js  : APP_VERSION = '${newVersion}'`);
  console.log(`- sw.js        : CACHE_NAME = 'zenchat-shell-v${newVersion}'`);
  console.log(`- version.json : v${newVersion} (${versionPayload.buildTime})`);
  console.log(`- index.html   : dynamic runtime hydration active (no manual edits needed)`);
}

run();
