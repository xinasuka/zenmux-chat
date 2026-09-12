#!/usr/bin/env node
// scripts/build.js
// Production build pipeline for ZenMux Chat.
// Bundles and minifies JS and CSS into a dedicated ./dist output directory,
// protecting internal source files and configurations from public exposure.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

async function build() {
  const startTime = performance.now();
  console.log('ZenMux Chat: Initiating production compilation pipeline...');

  // 1. Clean and initialize ./dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(distDir, 'js'), { recursive: true });

  // 2. Bundle & minify JavaScript via esbuild
  console.log('Compiling JavaScript modules...');
  await Promise.all([
    esbuild.build({
      entryPoints: [path.join(srcDir, 'js', 'app.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      target: ['es2020'],
      outfile: path.join(distDir, 'js', 'app.js'),
      legalComments: 'none',
      sourcemap: false
    }),
    esbuild.build({
      entryPoints: [path.join(srcDir, 'js', 'admin.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      target: ['es2020'],
      outfile: path.join(distDir, 'js', 'admin.js'),
      legalComments: 'none',
      sourcemap: false
    })
  ]);

  // 3. Minify CSS stylesheets
  console.log('Compiling stylesheets...');
  await Promise.all([
    esbuild.build({
      entryPoints: [path.join(srcDir, 'styles.css')],
      minify: true,
      outfile: path.join(distDir, 'styles.css')
    }),
    esbuild.build({
      entryPoints: [path.join(srcDir, 'admin.css')],
      minify: true,
      outfile: path.join(distDir, 'admin.css')
    })
  ]);

  // 4. Transfer static assets
  console.log('Transferring static assets...');
  const staticFiles = [
    'index.html',
    'admin.html',
    'manifest.webmanifest',
    'sw.js',
    'version.json'
  ];

  for (const file of staticFiles) {
    const src = path.join(srcDir, file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    } else {
      console.warn(`[WARN] Static file not found: ${file}`);
    }
  }

  // 4.1 Transfer assets directory (ONNX models, WASM runtimes, icons)
  const assetsSrc = path.join(srcDir, 'assets');
  const assetsDest = path.join(distDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    console.log('Synchronizing assets directory to ./dist/assets/...');
    fs.cpSync(assetsSrc, assetsDest, { recursive: true });

    // Also project root icons to dist/ root for W3C /favicon.ico and PWA canonical resolution
    const rootIcons = ['favicon.ico', 'icon.png', 'icon-192.png', 'icon-512.png'];
    for (const icon of rootIcons) {
      const iconSrc = path.join(assetsSrc, icon);
      const iconDest = path.join(distDir, icon);
      if (fs.existsSync(iconSrc)) {
        fs.copyFileSync(iconSrc, iconDest);
      }
    }
  }

  const duration = (performance.now() - startTime).toFixed(1);
  console.log(`\nCompilation completed successfully in ${duration}ms.\n`);

  // 5. Output artifact metrics
  const formatKB = (bytes) => (bytes / 1024).toFixed(1);
  const artifacts = [
    { path: 'dist/index.html', desc: 'Main SPA Entry' },
    { path: 'dist/admin.html', desc: 'Admin Console Entry' },
    { path: 'dist/js/app.js', desc: 'Main Application Bundle' },
    { path: 'dist/js/admin.js', desc: 'Admin Controller Bundle' },
    { path: 'dist/styles.css', desc: 'Minified Application CSS' },
    { path: 'dist/admin.css', desc: 'Minified Admin CSS' },
    { path: 'dist/version.json', desc: 'Release Metadata' },
    { path: 'dist/assets/onnx/silero_vad.onnx', desc: 'Silero Neural VAD v5 Model' },
    { path: 'dist/assets/onnx/ort.min.js', desc: 'ONNX Runtime Web Loader' },
    { path: 'dist/assets/onnx/ort-wasm-simd.wasm', desc: 'ONNX SIMD WebAssembly Engine' },
    { path: 'dist/assets/onnx/ort-wasm.wasm', desc: 'ONNX Standard WASM Fallback' }
  ];

  console.log('Artifact Manifest:');
  for (const art of artifacts) {
    const fullPath = path.join(rootDir, art.path);
    if (fs.existsSync(fullPath)) {
      const size = fs.statSync(fullPath).size;
      console.log(`  - ${art.path.padEnd(20)} ${formatKB(size).padStart(6)} KB  (${art.desc})`);
    }
  }
}

build().catch((err) => {
  console.error('[ERROR] Build pipeline failed:', err);
  process.exit(1);
});
