// Cloudflare Workers refuse to compile WebAssembly from bytes at runtime, and
// @dimforge/rapier2d-compat ships its WASM as an embedded base64 string.
// This script writes a copy of the library that instead uses a precompiled
// WebAssembly.Module (imported by the Worker as a .wasm file) from globalThis.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/@dimforge/rapier2d-compat/dist');
const out = path.resolve('worker/vendor');
fs.mkdirSync(out, { recursive: true });

const code = fs.readFileSync(path.join(src, 'rapier.mjs'), 'utf8');
const pattern = /module_or_path:\w+\.toByteArray\("[A-Za-z0-9+/=]+"\)(\.buffer)?/g;
const matches = code.match(pattern) ?? [];
if (matches.length !== 1) {
  throw new Error(`Expected one embedded WASM blob in rapier.mjs, found ${matches.length}. Rapier's build changed; update this script.`);
}
fs.writeFileSync(path.join(out, 'rapier.mjs'), code.replace(pattern, 'module_or_path:globalThis.__RAPIER_WASM__'));
fs.copyFileSync(path.join(src, 'rapier_wasm2d_bg.wasm'), path.join(out, 'rapier.wasm'));
console.log('wrote worker/vendor/rapier.mjs and rapier.wasm');
