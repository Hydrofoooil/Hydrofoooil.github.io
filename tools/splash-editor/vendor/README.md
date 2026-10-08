# Vendored upstream runtime files

- Washes: https://github.com/castavridis/washes-js, commit `14e485b6e83dba1b5d02c987ae2ddd2222c60063`, `src/washes.js`; MIT. ESM side-effect import exposes `globalThis.Washes`.
- Hokusai: https://github.com/reearth/hokusai, source commit `f7e998173c0e7427b95afe0b6947e3103da60f00`; official demo's wasm-bindgen JS/WASM and example MyPaint brushes, MIT/Apache-2.0 engine; the unmodified MyPaint brush fixtures are CC0 1.0 (see upstream README and `hokusai/brush-fixtures-CC0.txt`). Exact demo binary hashes are recorded in `sources.json`.
- Aquarelle: https://github.com/Ramotion/aquarelle, commit `aef4c7cd9fc4ab482559f49447822a1df169216d`; unchanged `Aquarelle.js` and `AquarellePass.js`, MIT.
- Three.js: pinned `three-legacy` npm alias; unchanged upstream legacy renderer/postprocessing sources. Required for Aquarelle's old shader API.
- npm libraries and versions: `npm-sources.json`, `../package-lock.json`; copied license texts in `licenses/`.

The upstream artistic algorithms are unmodified. Adapters and shared outline editing live outside this folder.
