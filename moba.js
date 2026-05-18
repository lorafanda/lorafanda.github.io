/* MOBA — Mosaics of Brain Activity
 *
 * Single-page dashboard for clustering results: 3D fsaverage brain (Niivue) +
 * ERSP samples grid + live filters + live metrics.
 *
 * Helpers (parseCSV, _filepathToCleanPngUrl, _patientCohort, getPatientColor,
 * clusterColor, fetchColorsConfig) are deliberately copy-pasted from
 * results.html instead of factored into a shared module — keeps both pages
 * self-contained and avoids any risk of breaking results.html during this
 * MOBA introduction. If/when this becomes painful, lift them into a shared
 * lf_clustering_data.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CODE = 'LiLo';
const REPO_RAW = 'https://raw.githubusercontent.com/lorafanda/Analysis_LoraFanda/main';
const CLUSTERING_ROOT = `${REPO_RAW}/02_FBM_Clustering/outputs/clustering`;
const FSAV_MESH_BASE  = `${REPO_RAW}/02_FBM_Clustering/outputs/250_recon/fsaverage/meshes`;
const COLORS_CONFIG_URL = `${REPO_RAW}/02_FBM_Clustering/outputs/colors_config.json`;

// ─────────────────────────────────────────────────────────────────────────────
// COLOR HELPERS  (copy-paste from results.html — keep in sync if you change them)
// ─────────────────────────────────────────────────────────────────────────────
let PAT_COLORS = {
  EL:    ['#1d4ed8','#0891b2','#16a34a','#0e7490','#4ade80','#6366f1','#059669','#38bdf8','#134e4a'],
  PAT:   ['#dc2626','#ea580c','#d97706','#ca8a04','#b45309','#be185d','#e11d48','#f59e0b','#92400e','#c2410c','#db2777','#7c2d12','#fbbf24','#9f1239','#f97316','#a16207'],
  MICRO: ['#164e63','#1e3a5f','#14532d','#1a2e05','#0c2340'],
};
let COND_COLORS = { audio: '#b85c6e', picture: '#c47a5a', reading: '#7a8c6e' };

// Glasbey-style 32-color palette — perceptually-spaced, vetted for maximum
// distinguishability on the beige cortex background. Used as:
//   * patient view when mobaState.patientPaletteSource === 'glasbey' (toggle)
//   * cluster view automatically when n_clusters > 8 (HSL spacing breaks
//     down past ~8 categories — yellows + oranges read as the same colour
//     even at 30° hue separation).
// Skipped: pure greys (would collide with cortex), near-whites (invisible),
// and very dark navy-blacks that read as 'no electrode'.
const GLASBEY_PALETTE = [
  '#0072BD', '#D95319', '#EDB120', '#7E2F8E', '#77AC30',
  '#4DBEEE', '#A2142F', '#FF8B00', '#7FC97F', '#386CB0',
  '#F0027F', '#BF5B17', '#1B9E77', '#D95F02', '#7570B3',
  '#E7298A', '#66A61E', '#E6AB02', '#A6761D', '#FF1493',
  '#00CED1', '#9932CC', '#FF4500', '#2F4F4F', '#8B008B',
  '#191970', '#FFD700', '#228B22', '#DC143C', '#FF00FF',
  '#00008B', '#5E3C99',
];

async function fetchColorsConfig() {
  try {
    const res = await fetch(COLORS_CONFIG_URL);
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg.EL)         PAT_COLORS.EL    = cfg.EL;
    if (cfg.PAT)        PAT_COLORS.PAT   = cfg.PAT;
    if (cfg.MICRO)      PAT_COLORS.MICRO = cfg.MICRO;
    if (cfg.conditions) Object.assign(COND_COLORS, cfg.conditions);
    getPatientColor._cache = {};
  } catch (e) { console.warn('colors_config.json load failed:', e); }
}

function _patientCohort(patientId) {
  const s = String(patientId || '').toUpperCase();
  if (s.startsWith('EL'))  return 'EL';
  if (s.startsWith('PAT')) return 'PAT';
  if (s.startsWith('MICRO') || s.startsWith('G-') || s.startsWith('B-')) return 'MICRO';
  return 'EL';
}

function getPatientColor(patientId) {
  if (!getPatientColor._cache) getPatientColor._cache = {};
  if (getPatientColor._cache[patientId]) return getPatientColor._cache[patientId];

  let color;
  if (mobaState.patientPaletteSource === 'glasbey') {
    // Glasbey: cohort-agnostic flat sequence. Patients sorted alphabetically
    // across ALL cohorts so the mapping is stable across runs.
    const allPatients = [...new Set((mobaState.allLabels || []).map(r => r.patient_id))]
      .filter(id => id != null && id !== '').sort();
    const idx = Math.max(0, allPatients.indexOf(patientId));
    color = GLASBEY_PALETTE[idx % GLASBEY_PALETTE.length];
  } else {
    // Curated: cohort-aware. PAT patients use PAT_COLORS.PAT, EL → PAT_COLORS.EL, etc.
    const cohort = _patientCohort(patientId);
    const palette = PAT_COLORS[cohort] || PAT_COLORS.EL;
    const allOfCohort = [...new Set((mobaState.allLabels || []).map(r => r.patient_id))]
      .filter(id => _patientCohort(id) === cohort).sort();
    const idx = allOfCohort.indexOf(patientId);
    color = palette[Math.max(0, idx) % palette.length];
  }
  getPatientColor._cache[patientId] = color;
  return color;
}

function clusterColor(i, n) {
  // At ≤8 clusters the HSL spread (i * 360/n) gives clearly-separated hues.
  // Past 8 the spacing drops below ~45° per category and yellows / oranges /
  // greens become hard to tell apart — switch to glasbey for perceptual
  // distinctness.
  if (n > 8) {
    return GLASBEY_PALETTE[i % GLASBEY_PALETTE.length];
  }
  const hue = (i * 360 / Math.max(n, 1)) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

// Toggle the patient palette source between 'curated' and 'glasbey'.
// Re-renders the brain + sample cards immediately. Cluster mode is unaffected
// (it always uses glasbey at N>8, HSL otherwise).
function togglePatientPalette() {
  mobaState.patientPaletteSource =
    mobaState.patientPaletteSource === 'glasbey' ? 'curated' : 'glasbey';
  const btn = document.getElementById('paletteBtn');
  if (btn) {
    btn.textContent = `Palette: ${mobaState.patientPaletteSource === 'glasbey' ? 'Glasbey' : 'Curated'}`;
    btn.classList.toggle('active', mobaState.patientPaletteSource === 'glasbey');
  }
  getPatientColor._cache = {};   // clear the memoization so new colors are picked
  buildFilterChips();            // patient chips need recolor
  rerender();
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2;                break;
      case b: h = (r - g) / d + 4;                break;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

// Pre-light the electrode base colour so Niivue's mesh shader doesn't kill it
// on the unlit hemisphere. Operating in HSL space preserves hue (red stays
// red, purple stays purple) while pushing lightness up — works much better
// than the previous RGB-multiply, which over-saturated bright hues and left
// dark hues like #911eb4 with a near-black shaded side.
//
//   lFloor = 60   — even the darkest input maps to 60% L; shaded side stays readable
//   lCeil  = 78   — cap so we don't wash out into pastel-white
function preLightElectrodeRGB(c) {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const newL = Math.max(60, Math.min(78, l + 18));
  return hslToRgb(h, s, newL);
}

function colorToRgb255(cssColor) {
  // Cheap parser for hex, rgb(), and hsl() — covers everything we use
  if (!cssColor) return [128, 128, 128];
  const c = String(cssColor).trim();
  if (c.startsWith('#')) {
    const hex = c.replace('#', '');
    if (hex.length === 3) {
      return [parseInt(hex[0]+hex[0], 16), parseInt(hex[1]+hex[1], 16), parseInt(hex[2]+hex[2], 16)];
    }
    return [parseInt(hex.slice(0,2), 16), parseInt(hex.slice(2,4), 16), parseInt(hex.slice(4,6), 16)];
  }
  let m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  m = c.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (m) return hslToRgb(+m[1], +m[2], +m[3]);
  return [128, 128, 128];
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV / DATA HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
    return obj;
  });
}

// The labels.csv file_path column points at the ERSP_matrix .npy. We swap
// the subdir + suffix to land at one of three pre-rendered PNG sets that
// live alongside in 04_ersp_LM_RAWONLY/<pid>/LM/. The same path-rewrite
// trick that already powered _filepathToCleanPngUrl, parameterized by view.
const SAMPLE_VIEWS = {
  ersp: { dir: 'ERSP_clean',    suffix: '_CLEAN.png' },
  blob: { dir: 'ERSP_blob',     suffix: '_BLOB.png'  },
  m101: { dir: 'ERSP_minus101', suffix: '_M101.png'  },
};

function _filepathToSampleViewUrl(file_path, view) {
  if (!file_path) return null;
  const v = SAMPLE_VIEWS[view] || SAMPLE_VIEWS.ersp;
  let p = String(file_path).replace(/\\\\/g, '/').replace(/\\/g, '/');
  const idx = p.indexOf('01_FBM_Analysis/');
  if (idx === -1) return null;
  p = p.substring(idx);
  p = p.replace('/ERSP_matrix/', `/${v.dir}/`);
  p = p.replace(/\.npy$/i, v.suffix);
  return `${REPO_RAW}/${p}`;
}

// Back-compat shim: anything still calling the old name lands on the ersp view.
function _filepathToCleanPngUrl(file_path) {
  return _filepathToSampleViewUrl(file_path, 'ersp');
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const mobaState = {
  // Index + run picker
  index: null,
  runs: [],
  // Currently loaded run
  manifest: null,
  runDir: null,                  // base URL of the current run on GitHub raw
  allLabels: [],                 // all rows from labels.csv (with metadata)
  coords: [],                    // rows from <algo>_<run_id>__with_fsaverage.csv (joined to labels by sample idx)
  clusterCol: null,              // e.g. "cluster_kmeans_raw"
  clusterIds: [],                // unique cluster IDs in this run
  patients: [],                  // unique patient IDs
  conditions: [],                // unique conditions

  // Filters
  colorMode: 'cluster',
  enabledClusters: new Set(),
  enabledPatients: new Set(),
  enabledConditions: new Set(),
  highSilOnly: false,
  brainMeshVisible: true,    // toggle for the fsaverage cortex mesh; electrodes always shown

  // Brain viewer
  nv: null,                      // Niivue instance
  meshLoaded: false,
  brainReady: false,
  brainCanvas: null,

  // Selection (clicked electrode / clicked thumbnail)
  selectedSampleIdx: null,
  _highlightedSampleIdx: null,    // sample_idx of the currently-highlighted electrode

  // Samples-pane view: 'ersp' | 'blob' | 'm101'. Swaps the img.src on each
  // sample card by re-running _filepathToSampleViewUrl with the new view.
  // The three PNG sets are generated by 230 (per-sample BLOB + M101) and 140
  // (ERSP_clean), all living alongside each other under 04_ersp_LM_RAWONLY.
  sampleView: 'ersp',

  // Patient-color palette source: 'curated' | 'glasbey'.
  //   curated → colors_config.json PAT/EL/MICRO arrays (cohort-aware)
  //   glasbey → flat 32-color GLASBEY_PALETTE (ignores cohort, max distinguishability)
  // Toggled by the "Palette" button next to the Color-by row.
  patientPaletteSource: 'curated',

  // K-sweep slider (populated only when the run has cluster_labels_by_k.csv).
  // labelsByK: { 5: Int32Array, 6: Int32Array, ... }  indexed by sample_idx.
  // silByK:    { 5: 0.34, 6: 0.31, ... }              silhouette score per K.
  // kSliderKs: sorted array of K's available on the slider.
  // bestK:     the K that maximized silhouette (saved as the default labels.csv).
  // currentK:  whichever K the slider is currently showing.
  labelsByK: null,
  silByK:    null,
  kSliderKs: [],
  bestK:     null,
  currentK:  null,
};


// Pulsating yellow halo around the highlighted electrode. Mesh is named
// 'highlight.obj' so it's easy to find and swap on click. A
// requestAnimationFrame loop ramps mesh.opacity 0↔1 so it visibly
// pulses; the loop self-cancels when the highlight clears.
async function updateHighlight() {
  if (!mobaState.nv) return;

  // Remove previous halo if any
  const old = (mobaState.nv.meshes || []).filter(m =>
    typeof m.name === 'string' && m.name === 'highlight.obj');
  for (const m of old) {
    try { mobaState.nv.removeMesh(m); }
    catch (e) { try { mobaState.nv.removeMesh(m.id); } catch (e2) {} }
  }

  // Stop any running pulse animation
  if (mobaState._pulseRaf) {
    cancelAnimationFrame(mobaState._pulseRaf);
    mobaState._pulseRaf = null;
  }

  const sid = mobaState._highlightedSampleIdx;
  if (sid == null) {
    if (typeof mobaState.nv.drawScene === 'function') mobaState.nv.drawScene();
    return;
  }

  const coord = (mobaState.coords || []).find(r => String(r.sample_idx) === String(sid));
  if (!coord) return;

  // Big bright pure-yellow sphere ~1.7x normal size. Cluster colour stays
  // visible underneath because we pulse the highlight's opacity to zero
  // periodically.
  const HIGHLIGHT_RADIUS_MM = 3.5;     // ~1.75x the new 2.0mm electrode size
  const obj = buildSpheresOBJ([{ x: coord.x, y: coord.y, z: coord.z }], HIGHLIGHT_RADIUS_MM);
  const blob = new Blob([obj], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    await mobaState.nv.addMeshFromUrl({
      url,
      name: 'highlight.obj',
      rgba255: [255, 255, 0, 255],       // pure bright highlighter yellow
    });
  } catch (e) {
    console.warn('[MOBA] Could not add highlight mesh:', e);
    URL.revokeObjectURL(url);
    return;
  }
  URL.revokeObjectURL(url);

  // Start the pulse loop. We try several opacity properties since Niivue
  // versions wire transparency through different uniforms. Whichever one
  // sticks visually wins.
  const startMs = performance.now();
  const PULSE_PERIOD_MS = 1400;          // matches the CSS 1.4s on the thumbnail
  function pulse(ts) {
    if (mobaState._highlightedSampleIdx == null) {
      mobaState._pulseRaf = null;
      return;
    }
    const t = (ts - startMs) / PULSE_PERIOD_MS;
    // sine wave 0..1, peak at half period
    const a = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
    const mesh = (mobaState.nv.meshes || []).find(m => m.name === 'highlight.obj');
    if (mesh) {
      if ('opacity' in mesh)      mesh.opacity = a;
      if ('layerOpacity' in mesh) mesh.layerOpacity = a;
      if (mesh.rgba255 && mesh.rgba255.length >= 4) mesh.rgba255[3] = Math.round(a * 255);
      if (typeof mobaState.nv.drawScene === 'function') mobaState.nv.drawScene();
    }
    mobaState._pulseRaf = requestAnimationFrame(pulse);
  }
  mobaState._pulseRaf = requestAnimationFrame(pulse);
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE
// ─────────────────────────────────────────────────────────────────────────────
function checkCode() {
  const input = document.getElementById('gateInput');
  const errEl = document.getElementById('gateError');
  if (input.value.trim() === CODE) {
    document.getElementById('gate').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    initApp();
  } else {
    input.classList.add('error');
    errEl.textContent = 'Wrong code';
    setTimeout(() => input.classList.remove('error'), 350);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('gateInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') checkCode();
  });
  document.getElementById('aboutBtn').addEventListener('click', toggleAbout);
});

function toggleAbout() {
  const pane = document.getElementById('aboutPane');
  const btn  = document.getElementById('aboutBtn');
  pane.classList.toggle('open');
  btn.textContent = pane.classList.contains('open') ? '▼ About' : '▶ About';
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function initApp() {
  await fetchColorsConfig();
  await loadIndex();
  await initBrain();
  // If URL hash names a run, load it
  const wantRun = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (wantRun && mobaState.runs.find(r => r.path === wantRun || r.run_id === wantRun)) {
    const i = mobaState.runs.findIndex(r => r.path === wantRun || r.run_id === wantRun);
    document.getElementById('runSelect').value = i;
    onRunChange();
  } else if (mobaState.runs.length === 1) {
    document.getElementById('runSelect').value = 0;
    onRunChange();
  }
  document.getElementById('runSelect').addEventListener('change', onRunChange);
}

async function loadIndex() {
  const sel = document.getElementById('runSelect');
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const res = await fetch(`${CLUSTERING_ROOT}/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const idx = await res.json();
    mobaState.index = idx;
    const methodLabel  = Object.fromEntries((idx.methods       || []).map(m => [m.id, m.label]));
    const featureLabel = Object.fromEntries((idx.feature_sets  || []).map(f => [f.id, f.label]));
    mobaState.runs = (idx.runs || []).slice().sort((a, b) => {
      if (a.method !== b.method) return a.method.localeCompare(b.method);
      if (a.feature_set !== b.feature_set) return a.feature_set.localeCompare(b.feature_set);
      return b.run_id.localeCompare(a.run_id);
    }).map(r => ({
      ...r,
      label: `[${methodLabel[r.method] || r.method} · ${featureLabel[r.feature_set] || r.feature_set}] ${r.run_id} — k=${r.n_clusters}, sil=${(r.silhouette ?? 0).toFixed(3)}`,
    }));
    sel.innerHTML = '<option value="">Select a run...</option>';
    mobaState.runs.forEach((r, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = r.label;
      sel.appendChild(o);
    });
    if (!mobaState.runs.length) sel.innerHTML = '<option value="">No runs in index.json</option>';
  } catch (e) {
    sel.innerHTML = `<option value="">index.json: ${e.message}</option>`;
    setStatus('Could not load index.json — has 210 been run yet?');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN INIT (Niivue)
// ─────────────────────────────────────────────────────────────────────────────
async function initBrain() {
  const NV = window.niivue?.Niivue || window.Niivue;
  if (!NV) { setStatus('Niivue not loaded — check your network'); return; }

  const canvas = document.getElementById('brainCanvas');
  mobaState.brainCanvas = canvas;

  const nv = new NV({
    backColor: [1, 1, 1, 1],              // white — matches the look of the existing recon PNGs
    show3Dcrosshair: false,
    isOrientCube: false,
    isResizeCanvas: true,
    isColorbar: false,
    meshXRay: 0,                          // 0.3 was breaking the shader on ANGLE Metal; rely on rgba alpha alone
    isHighResolutionCapable: true,
  });

  try {
    await nv.attachToCanvas(canvas);
  } catch (e) {
    setStatus(`Niivue attach failed: ${e.message}`);
    return;
  }
  mobaState.nv = nv;

  // Load fsaverage meshes — bone-tinted, very transparent (glass-like).
  // Niivue's mesh shader on ANGLE Metal seems to ignore rgba alpha at
  // load time, so we set mesh.opacity *after* load (below) which goes
  // through a different shader uniform. We still send a low rgba alpha
  // here as a fallback for renderers that do honour it.
  const meshRgba = [205, 198, 190, 30];
  // Remember mesh URLs so we can re-add them after a connectome load if
  // Niivue's loadConnectome wipes the mesh list (it does on some versions).
  mobaState._meshSpec = null;
  try {
    const spec = [
      { url: `${FSAV_MESH_BASE}/fsaverage_lh.mz3`, rgba255: meshRgba, visible: true },
      { url: `${FSAV_MESH_BASE}/fsaverage_rh.mz3`, rgba255: meshRgba, visible: true },
    ];
    await nv.loadMeshes(spec);
    mobaState._meshSpec = spec;
    mobaState.meshLoaded = true;
  } catch (e) {
    try {
      const spec = [
        { url: `${FSAV_MESH_BASE}/fsaverage_lh.gii`, rgba255: meshRgba },
        { url: `${FSAV_MESH_BASE}/fsaverage_rh.gii`, rgba255: meshRgba },
      ];
      await nv.loadMeshes(spec);
      mobaState._meshSpec = spec;
      mobaState.meshLoaded = true;
    } catch (e2) {
      setStatus(`Mesh load failed: ${e2.message}\nRun scripts/build_fsaverage_meshes.py once to generate the .mz3 files.`);
      return;
    }
  }
  console.log(`[MOBA] Mesh loaded; nv.meshes.length = ${nv.meshes ? nv.meshes.length : '?'}`);
  // ── Force brain transparency ──────────────────────────────────────────
  // rgba alpha at load time is ignored by Niivue's mesh shader on ANGLE
  // Metal. Setting per-mesh opacity directly hits a different uniform
  // and DOES seem to work for transparency. Try a few property names
  // since Niivue versions differ. After tweak, force a redraw.
  try {
    for (const m of (nv.meshes || [])) {
      if (typeof m.name === 'string' && /fsaverage/i.test(m.name)) {
        const targetOpacity = 0.18;
        if ('opacity' in m)        m.opacity = targetOpacity;
        if ('layerOpacity' in m)   m.layerOpacity = targetOpacity;
        if ('meshOpacity' in m)    m.meshOpacity = targetOpacity;
        if (m.rgba255 && m.rgba255.length >= 4) m.rgba255[3] = Math.round(targetOpacity * 255);
        console.log(`[MOBA] Brain mesh "${m.name}" keys:`, Object.keys(m));
      }
    }
    if (typeof nv.updateGLVolume === 'function') nv.updateGLVolume();
    if (typeof nv.drawScene === 'function')      nv.drawScene();
  } catch (e) { console.warn('[MOBA] Could not set brain opacity:', e); }

  // Default view: dorsal-anterior (similar feel to the "dorsal" recon PNG;
  // both hemispheres visible in the same frame).
  try {
    if (typeof nv.setRenderAzimuthElevation === 'function') {
      nv.setRenderAzimuthElevation(180, 35);
    }
  } catch (e) { /* older Niivue without this API */ }

  mobaState.brainReady = true;
  setStatus(null);

  // Hover tooltip — find nearest electrode in 2D screen space
  canvas.addEventListener('mousemove', onBrainMouseMove);
  canvas.addEventListener('mouseleave', () => {
    document.getElementById('brainTooltip').style.display = 'none';
  });
  canvas.addEventListener('click', onBrainClick);
}

function setStatus(msg) {
  const el = document.getElementById('brainStatus');
  if (!msg) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN LOAD
// ─────────────────────────────────────────────────────────────────────────────
async function onRunChange() {
  const idxStr = document.getElementById('runSelect').value;
  if (idxStr === '') return;
  const run = mobaState.runs[idxStr];
  location.hash = run.path;

  setStatus(`Loading ${run.label}...`);
  document.getElementById('samplesGrid').innerHTML = '<div class="samples-empty">Loading...</div>';
  document.getElementById('metricsSummary').textContent = 'Loading...';

  const baseUrl = `${CLUSTERING_ROOT}/${run.path}`;
  mobaState.runDir = baseUrl;

  try {
    const manifestRes = await fetch(`${baseUrl}/manifest.json`);
    if (!manifestRes.ok) throw new Error(`manifest.json HTTP ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    mobaState.manifest = manifest;

    const arts = manifest.artifacts || {};
    const labelsRes = await fetch(`${baseUrl}/${arts.labels || 'labels.csv'}`);
    if (!labelsRes.ok) throw new Error(`labels.csv HTTP ${labelsRes.status}`);
    const labels = parseCSV(await labelsRes.text());

    // Alias the run-specific cluster column to a stable name
    const clusterCol = `cluster_${manifest.method}_${manifest.feature_set}`;
    mobaState.clusterCol = clusterCol;
    labels.forEach(r => {
      if (r[clusterCol] !== undefined) r._cluster = parseInt(r[clusterCol]);
      else if (r.cluster !== undefined) r._cluster = parseInt(r.cluster);
      r._sil = parseFloat(r.silhouette);
      if (Number.isNaN(r._sil)) r._sil = NaN;
    });
    mobaState.allLabels = labels;
    getPatientColor._cache = {};   // recompute palette indices for this run's patients

    // ── K-sweep artifacts ─────────────────────────────────────────────────────
    // If this run was saved with a k_range (HC sweep, or KMeans sweep), the
    // orchestrator writes:
    //   cluster_labels_by_k.csv   — wide: sample_idx, k_5, k_6, ..., k_15
    //   silhouette_by_k.json      — {k: silhouette score, ...}
    // Both let MOBA's K slider scrub across cuts without re-fitting.
    mobaState.labelsByK = null;
    mobaState.silByK    = null;
    mobaState.kSliderKs = [];
    mobaState.bestK     = (manifest.summary && Number.isFinite(parseInt(manifest.summary.best_k))) ? parseInt(manifest.summary.best_k) : null;
    mobaState.currentK  = null;
    if (arts.labels_by_k) {
      try {
        const lbkRes = await fetch(`${baseUrl}/${arts.labels_by_k}`);
        if (lbkRes.ok) {
          const rows = parseCSV(await lbkRes.text());
          if (rows.length) {
            const ks = Object.keys(rows[0])
              .filter(c => /^k_\d+$/.test(c))
              .map(c => parseInt(c.slice(2)))
              .sort((a,b) => a - b);
            const byK = {};
            ks.forEach(k => {
              const col = `k_${k}`;
              byK[k] = rows.map(r => parseInt(r[col]));
            });
            mobaState.labelsByK = byK;
            mobaState.kSliderKs = ks;
          }
        }
      } catch (e) { console.warn('cluster_labels_by_k.csv load failed:', e); }
    }
    if (arts.silhouette_sweep) {
      try {
        const sbkRes = await fetch(`${baseUrl}/${arts.silhouette_sweep}`);
        if (sbkRes.ok) {
          const data = await sbkRes.json();
          const sbk = {};
          Object.entries(data).forEach(([k, v]) => { sbk[parseInt(k)] = parseFloat(v); });
          mobaState.silByK = sbk;
        }
      } catch (e) { console.warn('silhouette_by_k.json load failed:', e); }
    }

    // Load coords (joined to labels by 252)
    const algoTag = `${manifest.method}_${manifest.feature_set}`;
    const coordsUrl = `${baseUrl}/recon/${algoTag}_${manifest.run_id}__with_fsaverage.csv`;
    let coords = [];
    try {
      const cRes = await fetch(coordsUrl);
      if (cRes.ok) {
        const rows = parseCSV(await cRes.text());
        coords = rows.filter(r =>
          r.x !== '' && r.y !== '' && r.z !== ''
          && !Number.isNaN(parseFloat(r.x))
          && !Number.isNaN(parseFloat(r.y))
          && !Number.isNaN(parseFloat(r.z))
        );
        coords.forEach(r => {
          r.x = parseFloat(r.x);
          r.y = parseFloat(r.y);
          r.z = parseFloat(r.z);
          r._cluster = parseInt(r[clusterCol] ?? r.cluster ?? -1);
          r._sil = parseFloat(r.silhouette);
          if (Number.isNaN(r._sil)) r._sil = NaN;
        });
      } else {
        console.warn(`No coords CSV at ${coordsUrl} (HTTP ${cRes.status}). Brain electrodes won't render — run 252 for this run.`);
      }
    } catch (e) {
      console.warn('Coords load failed:', e);
    }
    mobaState.coords = coords;

    // Compute id sets
    mobaState.clusterIds = [...new Set(labels.map(r => r._cluster).filter(c => Number.isFinite(c) && c >= 0))].sort((a,b) => a - b);
    mobaState.patients   = [...new Set(labels.map(r => r.patient_id))].sort();
    mobaState.conditions = [...new Set(labels.map(r => r.condition))].sort();

    // Default: everything enabled
    mobaState.enabledClusters   = new Set(mobaState.clusterIds);
    mobaState.enabledPatients   = new Set(mobaState.patients);
    mobaState.enabledConditions = new Set(mobaState.conditions);

    setupKSlider();
    buildFilterChips();
    populateAboutStats();
    rerender();

    if (!coords.length) {
      setStatus('No coords yet for this run — run 252 to generate brain coords.');
    } else {
      setStatus(null);
    }
  } catch (e) {
    setStatus(`Run load failed: ${e.message}`);
    console.error(e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-CLUSTER PATIENT DIVERSITY
// ─────────────────────────────────────────────────────────────────────────────
// Walks the *current* labels (so it follows the K-slider) and returns
// {size, nPatients, nCenters, patients[]} for the given cluster id. Empty
// clusters return null. Centers are derived from patient_id prefix:
//   "EL*"  -> BERN ;   "PAT*" -> GVA ;   "MicroEPI*"/"G-*"/"B-*" -> MICRO
function _clusterDiversity(cid) {
  const rows = (mobaState.allLabels || []).filter(r => r._cluster === cid);
  if (!rows.length) return null;
  const pats = new Set();
  const cohorts = new Set();
  for (const r of rows) {
    const p = r.patient_id;
    if (!p) continue;
    pats.add(p);
    cohorts.add(_patientCohort(p));
  }
  return {
    size: rows.length,
    nPatients: pats.size,
    nCenters: cohorts.size,
    patients: [...pats].sort(),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// K-CUT SLIDER (HC k_range runs)
// ─────────────────────────────────────────────────────────────────────────────
// Shown only when the loaded run has cluster_labels_by_k.csv. Sliding through
// values re-points every sample's _cluster at the labels for that K, then
// rebuilds chips + rerenders the brain, samples grid, metrics. Coords are
// re-indexed from sample_idx so the brain electrode colours follow.
function setupKSlider() {
  const row    = document.getElementById('kSliderRow');
  const slider = document.getElementById('kSlider');
  const ks = mobaState.kSliderKs;
  if (!ks || ks.length === 0) {
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';
  slider.min = 0;
  slider.max = ks.length - 1;
  // Default to best K (which is what labels.csv already reflects on first load)
  let idx = mobaState.bestK != null ? ks.indexOf(mobaState.bestK) : -1;
  if (idx < 0) idx = ks.length - 1;
  slider.value = idx;
  mobaState.currentK = ks[idx];
  updateKSliderLabel(ks[idx]);
}

function updateKSliderLabel(k) {
  const el = document.getElementById('kSliderLabel');
  if (!el) return;
  const sil = (mobaState.silByK || {})[k];
  const silStr = (sil != null && !Number.isNaN(sil)) ? `sil=${sil.toFixed(3)}` : '';
  const bestTag = (mobaState.bestK === k) ? '★ best' : '';
  el.innerHTML = `K = ${k} <span class="stat">${[silStr, bestTag].filter(Boolean).join(' · ')}</span>`;
}

function onKSliderInput(ev) {
  const ks = mobaState.kSliderKs;
  const idx = parseInt(ev.target.value);
  const k = ks[idx];
  if (!Number.isFinite(k)) return;
  applyKCut(k);
}

function resetKToBest() {
  if (mobaState.bestK == null) return;
  const ks = mobaState.kSliderKs;
  const idx = ks.indexOf(mobaState.bestK);
  if (idx < 0) return;
  document.getElementById('kSlider').value = idx;
  applyKCut(mobaState.bestK);
}

function applyKCut(k) {
  const labelsForK = (mobaState.labelsByK || {})[k];
  if (!labelsForK) return;
  mobaState.currentK = k;
  updateKSliderLabel(k);

  // Swap _cluster on every label row + every coord row, indexed by sample_idx
  mobaState.allLabels.forEach(r => {
    const i = parseInt(r.sample_idx);
    if (Number.isFinite(i) && i >= 0 && i < labelsForK.length) {
      r._cluster = labelsForK[i];
    }
  });
  mobaState.coords.forEach(r => {
    const i = parseInt(r.sample_idx);
    if (Number.isFinite(i) && i >= 0 && i < labelsForK.length) {
      r._cluster = labelsForK[i];
    }
  });

  // Recompute the cluster ID set + reset cluster filter to "all on"
  mobaState.clusterIds = [...new Set(labelsForK)]
    .filter(c => Number.isFinite(c) && c >= 0)
    .sort((a, b) => a - b);
  mobaState.enabledClusters = new Set(mobaState.clusterIds);

  // Rebuild cluster chips (thumbnails default to /cluster_centroids/cluster_NN.png,
  // which only exists at the run's saved K — at other K's the chip falls back
  // to swatch+number via the img.onerror handler. That's intentional.)
  buildFilterChips();
  rerender();
}


// ─────────────────────────────────────────────────────────────────────────────
// FILTER CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function buildFilterChips() {
  const k = mobaState.clusterIds.length;
  const cChips = document.getElementById('clusterChips');
  cChips.innerHTML = '';
  mobaState.clusterIds.forEach(cid => {
    const chip = document.createElement('span');
    chip.className = 'chip cluster-chip-thumb';
    chip.dataset.cluster = cid;

    // Per-cluster mean-ERSP thumbnail. Generated on the server by the
    // BACKFILL_CENTROIDS cell in 210 — present for any run whose feature
    // set is 'raw'. img.onerror hides it gracefully if a run hasn't been
    // backfilled yet (chip falls back to swatch + number).
    const img = document.createElement('img');
    img.className = 'cluster-chip-img';
    img.loading = 'lazy';
    img.alt = `cluster ${cid + 1} mean ERSP`;
    if (mobaState.runDir) {
      const cidStr = String(cid).padStart(2, '0');
      img.src = `${mobaState.runDir}/cluster_centroids/cluster_${cidStr}.png`;
    }
    img.onerror = () => { img.style.display = 'none'; };

    const num = document.createElement('span');
    num.className = 'cluster-chip-num';
    num.innerHTML = `<span class="chip-swatch" style="background:${clusterColor(cid, k)}"></span>${cid + 1}`;

    // Patient-diversity badge: "n_pat / n_centers". A 1/1 means single-patient
    // (likely artifact), a 6/3 means cross-patient cross-center (likely real).
    // Computed client-side from allLabels so it stays correct at any K-slider
    // position. Title = comma-separated patient list for the hover tooltip.
    const div = _clusterDiversity(cid);
    if (div) {
      const badge = document.createElement('span');
      badge.className = 'cluster-chip-divbadge';
      badge.title = `${div.size} samples · ${div.patients.join(', ')}`;
      // Warmth scale: 1/1 = washed-out grey (suspect), >=4 patients = green
      const tier = div.nPatients >= 4 ? 'good'
                 : div.nPatients >= 2 ? 'mixed'
                 : 'solo';
      badge.dataset.tier = tier;
      badge.textContent = `${div.nPatients}/${div.nCenters}`;
      chip.appendChild(badge);
    }

    chip.appendChild(img);
    chip.appendChild(num);
    chip.addEventListener('click', () => toggleCluster(cid));
    cChips.appendChild(chip);
  });

  const pChips = document.getElementById('patientChips');
  pChips.innerHTML = '';
  mobaState.patients.forEach(pid => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.patient = pid;
    chip.innerHTML = `<span class="chip-swatch" style="background:${getPatientColor(pid)}"></span>${pid}`;
    chip.addEventListener('click', () => togglePatient(pid));
    pChips.appendChild(chip);
  });

  const condChips = document.getElementById('conditionChips');
  condChips.innerHTML = '';
  mobaState.conditions.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.condition = c;
    chip.innerHTML = `<span class="chip-swatch" style="background:${COND_COLORS[c] || '#888'}"></span>${c}`;
    chip.addEventListener('click', () => toggleCondition(c));
    condChips.appendChild(chip);
  });

  refreshChipStates();
}

function refreshChipStates() {
  document.querySelectorAll('#clusterChips .chip').forEach(el => {
    el.classList.toggle('off', !mobaState.enabledClusters.has(parseInt(el.dataset.cluster)));
  });
  document.querySelectorAll('#patientChips .chip').forEach(el => {
    el.classList.toggle('off', !mobaState.enabledPatients.has(el.dataset.patient));
  });
  document.querySelectorAll('#conditionChips .chip').forEach(el => {
    el.classList.toggle('off', !mobaState.enabledConditions.has(el.dataset.condition));
  });
  document.getElementById('highSilBtn').classList.toggle('active', mobaState.highSilOnly);
}

function toggleCluster(cid)   { mobaState.enabledClusters.has(cid)   ? mobaState.enabledClusters.delete(cid)   : mobaState.enabledClusters.add(cid);   refreshChipStates(); rerender(); }
function togglePatient(pid)   { mobaState.enabledPatients.has(pid)   ? mobaState.enabledPatients.delete(pid)   : mobaState.enabledPatients.add(pid);   refreshChipStates(); rerender(); }
function toggleCondition(c)   { mobaState.enabledConditions.has(c)   ? mobaState.enabledConditions.delete(c)   : mobaState.enabledConditions.add(c);   refreshChipStates(); rerender(); }
function setAllClusters(on)   { mobaState.enabledClusters = on ? new Set(mobaState.clusterIds) : new Set(); refreshChipStates(); rerender(); }
function setAllPatients(on)   { mobaState.enabledPatients = on ? new Set(mobaState.patients)  : new Set(); refreshChipStates(); rerender(); }
function setAllConditions(on) { mobaState.enabledConditions = on ? new Set(mobaState.conditions) : new Set(); refreshChipStates(); rerender(); }
function toggleHighSil()      { mobaState.highSilOnly = !mobaState.highSilOnly; refreshChipStates(); rerender(); }
function toggleBrainMesh()    {
  mobaState.brainMeshVisible = !mobaState.brainMeshVisible;
  document.getElementById('brainBtn').classList.toggle('active', mobaState.brainMeshVisible);
  rerender();
}
function setColorMode(mode)   {
  mobaState.colorMode = mode;
  document.querySelectorAll('.filter-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  rerender();
}

// Samples-pane view toggle: ERSP | Blob | -101. Just swaps every card's
// img.src by re-running renderSamples with the new mobaState.sampleView.
// Doesn't touch the brain (electrode rendering is independent of which
// sample-PNG we display).
function setSampleView(view) {
  if (!SAMPLE_VIEWS[view]) return;
  mobaState.sampleView = view;
  document.querySelectorAll('.sample-view-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  renderSamples();
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER PREDICATE
// ─────────────────────────────────────────────────────────────────────────────
function isVisible(row) {
  if (!mobaState.enabledClusters.has(row._cluster))   return false;
  if (!mobaState.enabledPatients.has(row.patient_id)) return false;
  if (!mobaState.enabledConditions.has(row.condition))return false;
  if (mobaState.highSilOnly && !(row._sil > 0))       return false;
  return true;
}

function colorForRow(row) {
  if (mobaState.colorMode === 'patient')    return getPatientColor(row.patient_id);
  if (mobaState.colorMode === 'condition')  return COND_COLORS[row.condition] || '#888';
  return clusterColor(row._cluster, mobaState.clusterIds.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER (calls all three panels)
// ─────────────────────────────────────────────────────────────────────────────
let _rerenderTimer = null;
function rerender() {
  // debounce to avoid hammering the brain rebuild on quick clicks
  clearTimeout(_rerenderTimer);
  _rerenderTimer = setTimeout(() => {
    renderBrain();
    renderSamples();
    renderMetrics();
  }, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN RENDER
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// ICOSPHERE — minimal sphere geometry (12 verts, 20 faces) used to bake
// electrode markers into regular OBJ meshes. Niivue's connectome path
// is broken on ANGLE Metal; mesh path works everywhere.
// ─────────────────────────────────────────────────────────────────────────────
const _PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = (() => {
  const raw = [
    [-1,  _PHI,    0], [1,  _PHI,    0], [-1, -_PHI,   0], [1, -_PHI,   0],
    [ 0, -1,    _PHI], [0,  1,    _PHI], [ 0, -1,   -_PHI], [0,  1,   -_PHI],
    [ _PHI, 0, -1],     [_PHI, 0,  1],   [-_PHI, 0, -1],     [-_PHI, 0,  1],
  ];
  return raw.map(v => {
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0]/len, v[1]/len, v[2]/len];
  });
})();
const ICO_FACES = [
  [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
  [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
  [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
  [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
];

// Switched from icosphere (12 verts / 20 faces, smooth-shaded) to tetrahedron
// (4 verts / 4 flat faces). With only 4 facets, each face renders as a
// single uniform colour patch — no within-face gradient. The four patches
// still differ in brightness (the "spotlight" Lora wants to preserve) but
// only as 4 distinct steps, not a smooth ramp.
//
// Vertices: (±1, ±1, ±1) with an even number of negatives → 4 corners of
// a regular tetrahedron inscribed in the unit cube. Divided by √3 to land
// on the unit sphere.
const _S3 = 1 / Math.sqrt(3);
const TET_VERTS = [
  [ _S3,  _S3,  _S3],
  [ _S3, -_S3, -_S3],
  [-_S3,  _S3, -_S3],
  [-_S3, -_S3,  _S3],
];
// 4 triangular faces, each excluding one vertex (so the outward normal of
// face F_i = negation of vertex i — points away from the centroid).
const TET_FACES = [
  [0, 1, 2],   // F0: excludes v3
  [0, 1, 3],   // F1: excludes v2
  [0, 2, 3],   // F2: excludes v1
  [1, 2, 3],   // F3: excludes v0
];
// Outward face normals = −(excluded vertex). Dampened toward camera-forward
// (0, 0, 1) so the lighting variation between faces is reduced but not
// zero — preserves the "3D facet" feel without the previous harsh
// hemisphere darkening. blend=0.55 means each normal is 55% pulled toward
// the camera; tune this to taste (0 = full gradient, 1 = totally flat).
const _NORMAL_BLEND_TO_CAMERA = 0.55;
function _blendNormal(n, t) {
  const bx = (1-t)*n[0] + t*0;
  const by = (1-t)*n[1] + t*0;
  const bz = (1-t)*n[2] + t*1;
  const L = Math.hypot(bx, by, bz);
  return [bx/L, by/L, bz/L];
}
const TET_FACE_NORMALS = [
  _blendNormal([-TET_VERTS[3][0], -TET_VERTS[3][1], -TET_VERTS[3][2]], _NORMAL_BLEND_TO_CAMERA),
  _blendNormal([-TET_VERTS[2][0], -TET_VERTS[2][1], -TET_VERTS[2][2]], _NORMAL_BLEND_TO_CAMERA),
  _blendNormal([-TET_VERTS[1][0], -TET_VERTS[1][1], -TET_VERTS[1][2]], _NORMAL_BLEND_TO_CAMERA),
  _blendNormal([-TET_VERTS[0][0], -TET_VERTS[0][1], -TET_VERTS[0][2]], _NORMAL_BLEND_TO_CAMERA),
];

// Build an OBJ text containing one tetrahedron per electrode, each at
// (e.x, e.y, e.z) with the given mm "radius" (here = inscribed-sphere
// radius). Returns a string ready to blob-URL into addMeshFromUrl.
function buildSpheresOBJ(electrodes, radius) {
  const out = [`# MOBA generated · ${electrodes.length} tetrahedra · radius=${radius}mm`];
  // 4 vertices per electrode
  for (const e of electrodes) {
    for (const v of TET_VERTS) {
      out.push(`v ${(e.x + v[0]*radius).toFixed(3)} ${(e.y + v[1]*radius).toFixed(3)} ${(e.z + v[2]*radius).toFixed(3)}`);
    }
  }
  // Shared face normals — 4 entries, indices 1..4. All electrodes' faces
  // reuse the same 4 normals (tetrahedron orientation is identical for
  // every electrode; only positions vary).
  for (const n of TET_FACE_NORMALS) {
    out.push(`vn ${n[0].toFixed(4)} ${n[1].toFixed(4)} ${n[2].toFixed(4)}`);
  }
  // OBJ vertex indices are 1-based and global across the file
  const NV = TET_VERTS.length;
  for (let i = 0; i < electrodes.length; i++) {
    const vOff = i * NV + 1;
    TET_FACES.forEach((f, j) => {
      const ni = j + 1;  // normal index 1..4
      out.push(`f ${f[0]+vOff}//${ni} ${f[1]+vOff}//${ni} ${f[2]+vOff}//${ni}`);
    });
  }
  return out.join('\n') + '\n';
}


async function renderBrain() {
  if (!mobaState.brainReady || !mobaState.coords.length) {
    document.getElementById('brainStat').textContent = '';
    return;
  }
  const visible = mobaState.coords.filter(isVisible);
  document.getElementById('brainStat').textContent = `${visible.length} contacts`;

  // Empty selection: just keep brain meshes, drop any electrode meshes
  if (visible.length === 0) {
    if (mobaState._electrodeMeshIds && mobaState.nv) {
      for (const id of mobaState._electrodeMeshIds) {
        try { mobaState.nv.removeMesh(id); } catch (e) {}
      }
    }
    mobaState._electrodeMeshIds = [];
    mobaState._brainNodes = [];
    return;
  }

  // ── Per-CATEGORY colormap ────────────────────────────────────────────
  // Was a per-node 1050-entry hack with I=[0..N-1]; Niivue's LUT expects
  // I to span 0..255 (the warning "indices expected end with 255 not 25"),
  // and even then linear interpolation across 1050 entries doesn't give
  // crisp per-cluster colors. Switch to a 256-entry LUT where slot i
  // holds the color of category i (cluster / patient / condition,
  // whichever is the active color mode). Each node's Color = its category
  // index — looked up exactly by Niivue's LUT[Color].
  const colorMode = mobaState.colorMode;
  let categoryColors, nodeColorOf, categoryCount;

  if (colorMode === 'cluster') {
    const K = mobaState.clusterIds.length;
    categoryColors = mobaState.clusterIds.map(cid => colorToRgb255(clusterColor(cid, K)));
    const idxOf = new Map(mobaState.clusterIds.map((cid, i) => [cid, i]));
    nodeColorOf = r => idxOf.get(r._cluster) ?? 0;
    categoryCount = K;
  } else if (colorMode === 'patient') {
    categoryColors = mobaState.patients.map(pid => colorToRgb255(getPatientColor(pid)));
    const idxOf = new Map(mobaState.patients.map((pid, i) => [pid, i]));
    nodeColorOf = r => idxOf.get(r.patient_id) ?? 0;
    categoryCount = mobaState.patients.length;
  } else { // condition
    categoryColors = mobaState.conditions.map(c => colorToRgb255(COND_COLORS[c] || '#888'));
    const idxOf = new Map(mobaState.conditions.map((c, i) => [c, i]));
    nodeColorOf = r => idxOf.get(r.condition) ?? 0;
    categoryCount = mobaState.conditions.length;
  }

  const nodes = visible.map(r => ({
    name: `${r.patient_id}/${r.contact_name || r.electrode || '?'}/${r.condition}`,
    x: r.x, y: r.y, z: r.z,
    Color: nodeColorOf(r),
    Size:  1.0,
    _row:  r,
  }));

  // Render lock — drop concurrent renderBrain calls so they don't pile up
  if (mobaState._brainBusy) {
    mobaState._brainPending = true;
    return;
  }
  mobaState._brainBusy = true;

  console.log(`[MOBA] Rendering ${nodes.length} electrodes, mode=${mobaState.colorMode}`);

  try {
    // Group visible electrodes by category (cluster / patient / condition)
    // so each group can become one OBJ mesh with a single rgba255 colour.
    const byCategory = new Map();
    for (const n of nodes) {
      if (!byCategory.has(n.Color)) byCategory.set(n.Color, []);
      byCategory.get(n.Color).push(n);
    }

    // Remove any electrode meshes from the previous render. Niivue's
    // removeMesh signature varies across versions: some take the mesh
    // object, others take an id. Find the meshes by name pattern and
    // try both to be safe.
    const oldElec = (mobaState.nv.meshes || []).filter(m =>
      typeof m.name === 'string' && m.name.indexOf('electrodes_') === 0);
    for (const m of oldElec) {
      let removed = false;
      try { mobaState.nv.removeMesh(m); removed = true; } catch (e) {}
      if (!removed && m.id != null) {
        try { mobaState.nv.removeMesh(m.id); removed = true; } catch (e) {}
      }
      if (!removed) console.warn('[MOBA] Could not remove old electrode mesh:', m.name);
    }
    mobaState._electrodeMeshIds = [];

    // If the brain meshes got wiped at any point (early Niivue versions
    // do this on internal state changes), re-add them so the cortex stays.
    const haveBrainMesh = (mobaState.nv.meshes || []).some(m =>
      typeof m.name === 'string' && /fsaverage/i.test(m.name));
    if (mobaState.brainMeshVisible
        && !haveBrainMesh
        && mobaState._meshSpec
        && typeof mobaState.nv.addMeshFromUrl === 'function') {
      for (const s of mobaState._meshSpec) {
        try { await mobaState.nv.addMeshFromUrl(s); }
        catch (e) { console.warn('[MOBA] Could not re-add brain mesh:', e); }
      }
    }

    // For each category, bake one OBJ mesh of all its electrodes' icospheres
    // and load via Niivue's standard mesh path — same path that successfully
    // renders the brain, so we know the GPU/version handles it.
    const SPHERE_RADIUS_MM = 2.0;        // tetrahedron inscribed-sphere radius (was 2.52mm icosphere)
    for (const [cat, electrodes] of byCategory.entries()) {
      const obj = buildSpheresOBJ(electrodes, SPHERE_RADIUS_MM);
      const blob = new Blob([obj], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      try {
        const c = categoryColors[Math.min(cat, categoryColors.length - 1)] || [128, 128, 128];
        // HSL-based pre-light (see preLightElectrodeRGB). Bumps perceptual
        // lightness floor to 60% so the shaded hemisphere stays the right
        // hue instead of going near-black, while preserving hue + saturation.
        // Replaces the previous RGB ×1.6 multiply which over-saturated
        // bright hues and lost dark ones in the shadow.
        const [r, g, b] = preLightElectrodeRGB(c);
        await mobaState.nv.addMeshFromUrl({
          url,
          name: `electrodes_${cat}.obj`,
          rgba255: [r, g, b, 255],
        });
        const last = mobaState.nv.meshes[mobaState.nv.meshes.length - 1];
        if (last && last.id != null) mobaState._electrodeMeshIds.push(last.id);
      } catch (e) {
        console.warn(`[MOBA] Failed to add electrode mesh for category ${cat}:`, e);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    // Re-apply any active highlight after a re-render (filter changed,
    // color mode changed, etc.) so the yellow halo stays on the
    // currently-selected thumbnail.
    if (mobaState._highlightedSampleIdx != null) {
      try { await updateHighlight(); } catch (e) { console.warn('[MOBA] updateHighlight after re-render:', e); }
    }

    mobaState._brainNodes = nodes;
    console.log(`[MOBA] After render: nv.meshes.length = ${mobaState.nv.meshes ? mobaState.nv.meshes.length : '?'} ` +
                `(${mobaState._electrodeMeshIds.length} electrode-meshes + brain)`);
    try { if (typeof mobaState.nv.drawScene === 'function') mobaState.nv.drawScene(); } catch (e) {}
    setStatus(null);
  } catch (e) {
    console.error('[MOBA] Render failed:', e);
    setStatus(`Could not render electrodes: ${e.message}`);
  } finally {
    mobaState._brainBusy = false;
    if (mobaState._brainPending) {
      mobaState._brainPending = false;
      setTimeout(() => renderBrain(), 0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOVER + CLICK on brain
// ─────────────────────────────────────────────────────────────────────────────
function _projectNodeToCanvas(node) {
  // Project (x,y,z) world coord through Niivue's MVP to canvas pixels.
  // Niivue exposes scene; if not available, fall back to "no hover".
  const nv = mobaState.nv;
  if (!nv || !nv.scene) return null;
  // Try the helper if present
  if (typeof nv.modelMat === 'function' && typeof nv.scene.projectionMatrix !== 'undefined') {
    // Best-effort manual project: skipped — Niivue's API isn't stable enough
    // across versions to do this in pure JS reliably. We use a screen-space
    // proximity check via mouseworld instead (below).
  }
  return null;
}

function onBrainMouseMove(ev) {
  if (!mobaState._brainNodes || !mobaState._brainNodes.length) return;
  const tip = document.getElementById('brainTooltip');
  // Niivue exposes mousewheel/click coords as world; for a hover tooltip we use
  // its own mouseDown / mouseMove world-coordinate via getCanvasFromMouse.
  // Defensive: if the API isn't available, hide tooltip and bail.
  const nv = mobaState.nv;
  let world = null;
  if (nv && typeof nv.canvasPosToWorldXYZ === 'function') {
    try { world = nv.canvasPosToWorldXYZ(ev.offsetX, ev.offsetY); } catch (e) {}
  }
  if (!world) { tip.style.display = 'none'; return; }

  // Find the nearest node in 3D world space (cheap O(N))
  let best = null, bestD = 1e9;
  for (const n of mobaState._brainNodes) {
    const dx = n.x - world[0], dy = n.y - world[1], dz = n.z - world[2];
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best || bestD > 36) {  // ~6mm radius cutoff
    tip.style.display = 'none';
    return;
  }
  const r = best._row;
  const sil = Number.isFinite(r._sil) ? r._sil.toFixed(3) : '?';
  tip.textContent = `${r.patient_id}\n${r.electrode || r.contact_name}\n${r.condition}\ncluster ${r._cluster + 1} · sil ${sil}`;
  tip.style.left = (ev.offsetX) + 'px';
  tip.style.top  = (ev.offsetY) + 'px';
  tip.style.display = 'block';
}

function onBrainClick(ev) {
  if (!mobaState._brainNodes || !mobaState._brainNodes.length) return;
  const nv = mobaState.nv;
  let world = null;
  if (nv && typeof nv.canvasPosToWorldXYZ === 'function') {
    try { world = nv.canvasPosToWorldXYZ(ev.offsetX, ev.offsetY); } catch (e) {}
  }
  if (!world) return;
  let best = null, bestD = 1e9;
  for (const n of mobaState._brainNodes) {
    const dx = n.x - world[0], dy = n.y - world[1], dz = n.z - world[2];
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best || bestD > 36) return;
  const idx = parseInt(best._row.sample_idx);
  mobaState.selectedSampleIdx = isFinite(idx) ? idx : best._row.sample_idx;
  renderSamples(true);  // re-render with highlight
  // Scroll the highlighted card into view
  const card = document.querySelector(`.output-card[data-sample-idx="${mobaState.selectedSampleIdx}"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLES GRID — same .output-card / .output-caption layout as results.html
// ─────────────────────────────────────────────────────────────────────────────
function renderSamples(highlightOnly = false) {
  if (highlightOnly) {
    document.querySelectorAll('.output-card.highlighted').forEach(c => c.classList.remove('highlighted'));
    const card = document.querySelector(`.output-card[data-sample-idx="${mobaState.selectedSampleIdx}"]`);
    if (card) card.classList.add('highlighted');
    return;
  }

  const grid = document.getElementById('samplesGrid');
  grid.innerHTML = '';

  const visible = mobaState.allLabels.filter(isVisible);
  document.getElementById('samplesStat').textContent = `${visible.length} samples`;

  if (!visible.length) {
    grid.innerHTML = '<div class="samples-empty">No samples match the current filters.</div>';
    return;
  }

  // Sort by silhouette desc (P2 behavior — most-confident first)
  visible.sort((a, b) => {
    const va = Number.isFinite(a._sil) ? a._sil : -Infinity;
    const vb = Number.isFinite(b._sil) ? b._sil : -Infinity;
    if (vb !== va) return vb - va;
    if (a.patient_id !== b.patient_id) return String(a.patient_id).localeCompare(String(b.patient_id));
    return String(a.electrode || '').localeCompare(String(b.electrode || ''));
  });

  visible.forEach(row => {
    const url = _filepathToSampleViewUrl(row.file_path, mobaState.sampleView || 'ersp');
    if (!url) return;
    const filename = url.split('/').pop();
    const sil = row._sil;
    const hasSil = Number.isFinite(sil);

    const card = document.createElement('div');
    card.className = 'output-card';
    card.dataset.sampleIdx = row.sample_idx;
    if (mobaState.selectedSampleIdx !== null && String(row.sample_idx) === String(mobaState.selectedSampleIdx)) {
      card.classList.add('highlighted');
    }

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = filename;
    img.src = url;
    img.onerror = () => { card.style.display = 'none'; };
    card.addEventListener('click', () => {
      // Toggle: clicking the already-highlighted card clears the highlight;
      // clicking a different card switches to it.
      const wasHighlighted = card.classList.contains('highlighted');
      document.querySelectorAll('.output-card.highlighted').forEach(c => c.classList.remove('highlighted'));
      if (wasHighlighted) {
        mobaState._highlightedSampleIdx = null;
      } else {
        card.classList.add('highlighted');
        mobaState._highlightedSampleIdx = row.sample_idx;
      }
      updateHighlight();
    });

    if (hasSil) {
      const badge = document.createElement('div');
      badge.className = 'sample-sil-badge';
      badge.textContent = (sil >= 0 ? '+' : '') + sil.toFixed(2);
      badge.style.background = sil >= 0 ? 'rgba(5,150,105,0.85)' : 'rgba(220,38,38,0.85)';
      card.appendChild(badge);
    }

    const cap = document.createElement('div');
    cap.className = 'output-caption';
    cap.textContent = filename;
    card.appendChild(img);
    card.appendChild(cap);
    grid.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// METRICS
// ─────────────────────────────────────────────────────────────────────────────
function renderMetrics() {
  const visible = mobaState.allLabels.filter(isVisible);
  const total = mobaState.allLabels.length;

  const patientsInSel = new Set(visible.map(r => r.patient_id));
  const cohortsInSel  = new Set([...patientsInSel].map(_patientCohort));
  const sils = visible.map(r => r._sil).filter(Number.isFinite);
  const meanSil = sils.length ? (sils.reduce((a,b)=>a+b,0) / sils.length) : NaN;
  const minSil  = sils.length ? Math.min(...sils) : NaN;
  const maxSil  = sils.length ? Math.max(...sils) : NaN;

  const summary = document.getElementById('metricsSummary');
  summary.innerHTML = `
    <span class="key">selection:</span> ${visible.length}/${total} contacts
    · <span class="key">patients:</span> ${patientsInSel.size}
    · <span class="key">centers:</span> ${cohortsInSel.size}
    · <span class="key">silhouette mean/min/max:</span> ${isFinite(meanSil) ? meanSil.toFixed(3) : '—'} / ${isFinite(minSil) ? minSil.toFixed(3) : '—'} / ${isFinite(maxSil) ? maxSil.toFixed(3) : '—'}
  `;

  // Patient stack bar
  const patCounts = {};
  visible.forEach(r => { patCounts[r.patient_id] = (patCounts[r.patient_id] || 0) + 1; });
  renderStackBar('patientStackBar', 'patientStackLegend', patCounts, getPatientColor, visible.length);

  // Condition stack bar
  const condCounts = {};
  visible.forEach(r => { condCounts[r.condition] = (condCounts[r.condition] || 0) + 1; });
  renderStackBar('conditionStackBar', 'conditionStackLegend', condCounts, c => COND_COLORS[c] || '#888', visible.length);
}

function renderStackBar(barId, legendId, counts, colorFn, total) {
  const bar = document.getElementById(barId);
  const leg = document.getElementById(legendId);
  bar.innerHTML = ''; leg.innerHTML = '';
  if (total <= 0) { bar.innerHTML = '<div style="flex:1;background:var(--surface2)"></div>'; return; }
  const keys = Object.keys(counts).sort();
  keys.forEach(k => {
    const seg = document.createElement('div');
    seg.className = 'stack-segment';
    seg.style.width = `${100 * counts[k] / total}%`;
    seg.style.background = colorFn(k);
    seg.title = `${k}: ${counts[k]} (${Math.round(100*counts[k]/total)}%)`;
    bar.appendChild(seg);

    const sw = document.createElement('span');
    sw.innerHTML = `<span class="swatch" style="background:${colorFn(k)}"></span>${k} <span style="opacity:0.65">${counts[k]}</span>`;
    leg.appendChild(sw);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT STATS (run-specific)
// ─────────────────────────────────────────────────────────────────────────────
function populateAboutStats() {
  const m = mobaState.manifest;
  if (!m) return;
  const s = m.summary || {};
  const params = m.params || {};
  document.getElementById('aboutStats').innerHTML = `
method            ${m.method_label || m.method}<br>
feature_set       ${m.feature_set_label || m.feature_set}<br>
run_id            ${m.run_id}<br>
n_samples         ${s.n_samples ?? '?'}<br>
n_features        ${s.n_features ?? '?'}<br>
n_clusters        ${s.n_clusters ?? '?'}<br>
silhouette        ${s.silhouette_overall != null ? s.silhouette_overall.toFixed(4) : '?'}<br>
calinski_harabasz ${s.calinski_harabasz != null ? s.calinski_harabasz.toFixed(1) : '?'}<br>
davies_bouldin    ${s.davies_bouldin != null ? s.davies_bouldin.toFixed(3) : '?'}<br>
random_state      ${params.random_state ?? '?'}<br>
predictor_type    ${m.predictor_type ?? '?'}
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// LIGHTBOX
// ─────────────────────────────────────────────────────────────────────────────
function openLightbox(src, caption) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxCaption').textContent = caption || '';
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ─────────────────────────────────────────────────────────────────────────────
// PDF DOWNLOAD — one page per enabled cluster, brain coloured by patient.
// ─────────────────────────────────────────────────────────────────────────────
async function _fetchAsDataURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function downloadPDF() {
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFCtor) { alert('jsPDF not loaded — refresh and try again.'); return; }
  if (!mobaState.manifest || !mobaState.coords || !mobaState.coords.length) {
    alert('Pick a run first, then download.');
    return;
  }

  const btn = document.getElementById('downloadPdfBtn');
  const origText = btn.textContent;
  btn.disabled = true;

  // Snapshot current state so we can restore at the end
  const saved = {
    colorMode: mobaState.colorMode,
    clusters:  new Set(mobaState.enabledClusters),
    patients:  new Set(mobaState.enabledPatients),
    conds:     new Set(mobaState.enabledConditions),
    highSil:   mobaState.highSilOnly,
    highlight: mobaState._highlightedSampleIdx,
  };

  // Force "color by patient" everywhere visible: all patients, all conditions,
  // no high-sil filter, no highlight in the captured frames
  mobaState.colorMode         = 'patient';
  mobaState.enabledPatients   = new Set(mobaState.patients);
  mobaState.enabledConditions = new Set(mobaState.conditions);
  mobaState.highSilOnly       = false;
  mobaState._highlightedSampleIdx = null;
  await updateHighlight();

  // Only enabled clusters get a page, in numeric order
  const clustersToExport = mobaState.clusterIds.filter(c => saved.clusters.has(c));
  const total = clustersToExport.length;

  if (total === 0) {
    alert('No clusters are enabled — turn at least one cluster on, then download.');
    btn.disabled = false; btn.textContent = origText;
    return;
  }

  const pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format: 'a4' });
  const m = mobaState.manifest;

  for (let i = 0; i < clustersToExport.length; i++) {
    const cid = clustersToExport[i];
    btn.textContent = `📄 ${i+1}/${total}…`;

    // Filter to just this cluster, render, wait for the WebGL frame
    mobaState.enabledClusters = new Set([cid]);
    await renderBrain();
    await new Promise(r => setTimeout(r, 350));

    let brainDataUrl = '';
    try {
      brainDataUrl = mobaState.brainCanvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[MOBA] Could not capture brain canvas:', e);
    }

    if (i > 0) pdf.addPage();

    // Header
    pdf.setFontSize(18);
    pdf.text(`Cluster ${cid + 1}`, 15, 18);
    pdf.setFontSize(9);
    pdf.setTextColor(120, 100, 90);
    pdf.text(
      `${m.method_label || m.method}  ·  ${m.feature_set_label || m.feature_set}  ·  K=${mobaState.clusterIds.length}  ·  ${m.run_id || ''}`,
      15, 25
    );
    pdf.setTextColor(0, 0, 0);

    // Brain image (coloured by patient because we forced colorMode above)
    if (brainDataUrl) {
      try { pdf.addImage(brainDataUrl, 'PNG', 15, 30, 180, 110); } catch (e) {}
    }
    pdf.setFontSize(8);
    pdf.setTextColor(140, 120, 100);
    pdf.text('3D fsaverage brain — electrodes coloured by patient', 15, 144);
    pdf.setTextColor(0, 0, 0);

    // Mean ERSP (centroid PNG produced by 210's BACKFILL_CENTROIDS cell)
    try {
      const cidStr = String(cid).padStart(2, '0');
      const centroidUrl = `${mobaState.runDir}/cluster_centroids/cluster_${cidStr}.png`;
      const centroidData = await _fetchAsDataURL(centroidUrl);
      pdf.setFontSize(11);
      pdf.text('Mean ERSP', 15, 154);
      pdf.addImage(centroidData, 'PNG', 15, 158, 80, 30);
    } catch (e) {
      pdf.setFontSize(9);
      pdf.setTextColor(180, 100, 90);
      pdf.text('(centroid PNG missing — run BACKFILL_CENTROIDS cell in 210)', 15, 165);
      pdf.setTextColor(0, 0, 0);
    }

    // Per-cluster electrodes for the breakdown
    const electrodes = (mobaState.coords || []).filter(c => c._cluster === cid);
    const patCounts = {}, condCounts = {};
    electrodes.forEach(e => {
      patCounts[e.patient_id] = (patCounts[e.patient_id] || 0) + 1;
      condCounts[e.condition] = (condCounts[e.condition] || 0) + 1;
    });
    const sils = electrodes.map(e => e._sil).filter(Number.isFinite);
    const meanSil = sils.length ? sils.reduce((a,b)=>a+b,0)/sils.length : NaN;

    // Cluster stats line
    pdf.setFontSize(10);
    pdf.text(
      `${electrodes.length} contacts · ${Object.keys(patCounts).length} patients · ` +
      `${Object.keys(condCounts).length} conditions · ` +
      `silhouette mean ${isFinite(meanSil) ? meanSil.toFixed(3) : 'n/a'}`,
      105, 154
    );

    // Patients column
    let py = 200;
    pdf.setFontSize(11);
    pdf.text(`Patients`, 15, py);
    py += 5;
    pdf.setFontSize(8);
    Object.entries(patCounts).sort((a, b) => b[1] - a[1]).forEach(([pid, count]) => {
      const rgb = colorToRgb255(getPatientColor(pid));
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.rect(15, py - 3, 4, 3, 'F');
      pdf.text(`${pid}    ${count} (${Math.round(100*count/electrodes.length)}%)`, 22, py);
      py += 4.2;
      if (py > 280) { py = 200; }   // crude wrap; fine for typical patient counts
    });

    // Conditions column
    let cy = 200;
    pdf.setFontSize(11);
    pdf.text(`Conditions`, 110, cy);
    cy += 5;
    pdf.setFontSize(8);
    Object.entries(condCounts).sort((a, b) => b[1] - a[1]).forEach(([c, count]) => {
      const rgb = colorToRgb255(COND_COLORS[c] || '#888');
      pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
      pdf.rect(110, cy - 3, 4, 3, 'F');
      pdf.text(`${c}    ${count} (${Math.round(100*count/electrodes.length)}%)`, 117, cy);
      cy += 4.2;
    });

    // Footer
    pdf.setFontSize(7);
    pdf.setTextColor(160, 140, 120);
    pdf.text(`MOBA — Mosaics of Brain Activity · ${new Date().toISOString().slice(0,10)}`, 15, 290);
    pdf.setTextColor(0, 0, 0);
  }

  // Restore previous filters / mode and re-render
  mobaState.colorMode         = saved.colorMode;
  mobaState.enabledClusters   = saved.clusters;
  mobaState.enabledPatients   = saved.patients;
  mobaState.enabledConditions = saved.conds;
  mobaState.highSilOnly       = saved.highSil;
  mobaState._highlightedSampleIdx = saved.highlight;
  document.querySelectorAll('.filter-btn[data-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === saved.colorMode));
  refreshChipStates();
  await renderBrain();
  if (saved.highlight != null) await updateHighlight();

  const fname = `MOBA_${m.method}_${m.feature_set}_${m.run_id}.pdf`;
  pdf.save(fname);

  btn.textContent = origText;
  btn.disabled = false;
}
