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
  ersp:  { dir: 'ERSP_clean',    suffix: '_CLEAN.png' },
  rawds: { dir: 'ERSP_rawds',    suffix: '_RAWDS.png' },
  blob:  { dir: 'ERSP_blob',     suffix: '_BLOB.png'  },
  m101:  { dir: 'ERSP_minus101', suffix: '_M101.png'  },
  hg:    { dir: 'ERSP_hg',       suffix: '_HG.png'    },
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

  // Per-cluster annotations (nickname + "not important" flag).
  //   clusterMeta[cluster_id] = { name: 'stim visual' | null, ignored: bool }
  // Persisted to localStorage scoped per (method, feature_set, run_id, current_K)
  // so the same cluster id at different K values keeps independent labels.
  // Loaded into memory on run change + on K-slider change; mutated +
  // saved back on every edit (one localStorage key per run/K bucket).
  clusterMeta: {},
  hideIgnoredClusters: false,

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

  // Cluster ranking — output of 213_cluster_ranking.ipynb.
  // Schema (see notebook for the source):
  //   {
  //     n_clusters_original, n_clusters_final, reassignment_iterations,
  //     clusters_dissolved: [{iteration, from_cluster, to_cluster, n_members}],
  //     weights: {cross_patient, stability, condition, anatomy},
  //     clusters: [
  //       { cluster_id, rank, composite_score,
  //         raw: {cross_patient, stability, condition, anatomy},
  //         normalized: {cross_patient, stability, condition, anatomy},
  //         size, n_patients, has_bern, has_gva,
  //         top_3_regions: [[name, prop], ...],
  //         condition_proportions: {audio: 0.4, picture: 0.3, reading: 0.3} },
  //       ...
  //     ]
  //   }
  // Null when the run has no cluster_ranking.json (silent 404).
  // The sort selector row is hidden in that case; the chip score badge is
  // suppressed; the dissolved indicator is suppressed.
  clusterRanking: null,
  // Active sort criterion for the cluster chips. One of:
  //   'composite' | 'cross_patient' | 'stability' | 'condition' | 'anatomy' | 'id'
  // Defaults to 'composite' when a ranking is available, 'id' otherwise.
  // Ignored clusters always sort to the end regardless of mode.
  clusterSortMode: 'composite',
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
  const HIGHLIGHT_RADIUS_MM = 4.5;
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
  document.getElementById('statsBtn').addEventListener('click', toggleStats);
});

function toggleAbout() {
  const pane = document.getElementById('aboutPane');
  const btn  = document.getElementById('aboutBtn');
  pane.classList.toggle('open');
  btn.textContent = pane.classList.contains('open') ? '▼ About' : '▶ About';
  // Close stats if both would be open
  if (pane.classList.contains('open')) {
    document.getElementById('statsPane').classList.remove('open');
    document.getElementById('statsBtn').textContent = '▶ Stats';
  }
}

function toggleStats() {
  const pane = document.getElementById('statsPane');
  const btn  = document.getElementById('statsBtn');
  pane.classList.toggle('open');
  btn.textContent = pane.classList.contains('open') ? '▼ Stats' : '▶ Stats';
  if (pane.classList.contains('open')) {
    // Close About if it was open
    document.getElementById('aboutPane').classList.remove('open');
    document.getElementById('aboutBtn').textContent = '▶ About';
    // Refresh stats content from the current run
    renderStatsPane();
  }
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

    // ── cluster_ranking.json (from 213_cluster_ranking.ipynb) ────────────────
    // Optional artifact — silent on 404 (most runs don't have ranking yet, and
    // the sort selector / score badges / dissolved indicator just stay hidden).
    mobaState.clusterRanking = null;
    try {
      const rankRes = await fetch(`${baseUrl}/cluster_ranking.json`);
      if (rankRes.ok) {
        mobaState.clusterRanking = await rankRes.json();
      }
    } catch (e) {
      // Silent — ranking is purely additive.
    }
    // Sort mode default: composite if ranking present, id otherwise. Reset on
    // every run-change so a previous run's choice doesn't bleed into a run
    // that has no ranking.
    mobaState.clusterSortMode = mobaState.clusterRanking ? 'composite' : 'id';

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
    loadClusterMeta();           // pulls nicknames + ignored flags from localStorage for this run/K
    buildFilterChips();
    populateAboutStats();
    rerender();
    // If the Stats pane is currently open, refresh it for the newly-loaded run
    if (document.getElementById('statsPane').classList.contains('open')) {
      renderStatsPane();
    }

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

  // Cluster nicknames + "not important" tags are scoped per (run, K),
  // so reload them when K changes.
  loadClusterMeta();

  // Rebuild cluster chips (thumbnails default to /cluster_centroids/cluster_NN.png,
  // which only exists at the run's saved K — at other K's the chip falls back
  // to swatch+number via the img.onerror handler. That's intentional.)
  buildFilterChips();
  rerender();
}


// ─────────────────────────────────────────────────────────────────────────────
// PER-CLUSTER ANNOTATIONS (nickname + "not important" flag)
// Persisted to localStorage. Scope is (method, feature_set, run_id, K) so the
// same cluster id at different K values keeps independent labels.
// ─────────────────────────────────────────────────────────────────────────────
function _clusterMetaKey() {
  const m = mobaState.manifest;
  if (!m) return null;
  const k = mobaState.currentK != null ? mobaState.currentK
          : (mobaState.bestK != null ? mobaState.bestK : 0);
  return `moba.cluster_meta.v1.${m.method}.${m.feature_set}.${m.run_id}.k${k}`;
}

function loadClusterMeta() {
  const key = _clusterMetaKey();
  if (!key) { mobaState.clusterMeta = {}; return; }
  try {
    const raw = localStorage.getItem(key);
    mobaState.clusterMeta = raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[clusterMeta] load failed:', e);
    mobaState.clusterMeta = {};
  }
}

function saveClusterMeta() {
  const key = _clusterMetaKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(mobaState.clusterMeta));
  } catch (e) {
    console.warn('[clusterMeta] save failed (quota?):', e);
  }
}

function getClusterName(cid) {
  const meta = mobaState.clusterMeta[cid];
  return (meta && meta.name) ? String(meta.name) : null;
}

function isClusterIgnored(cid) {
  const meta = mobaState.clusterMeta[cid];
  return !!(meta && meta.ignored);
}

// ── Modal: double-click a cluster chip to edit ─────────────────────────────
let _editingClusterId = null;

function openClusterEdit(cid) {
  _editingClusterId = cid;
  const meta = mobaState.clusterMeta[cid] || { name: null, ignored: false };
  document.getElementById('clusterEditTitle').textContent = String(cid + 1);
  document.getElementById('clusterEditName').value = meta.name || '';
  document.getElementById('clusterEditIgnored').checked = !!meta.ignored;
  document.getElementById('clusterEditModal').classList.add('open');
  setTimeout(() => document.getElementById('clusterEditName').focus(), 50);
}

function closeClusterEdit() {
  _editingClusterId = null;
  document.getElementById('clusterEditModal').classList.remove('open');
}

function saveClusterEdit() {
  if (_editingClusterId == null) return;
  const cid = _editingClusterId;
  const name    = (document.getElementById('clusterEditName').value || '').trim();
  const ignored = !!document.getElementById('clusterEditIgnored').checked;
  if (!mobaState.clusterMeta[cid]) mobaState.clusterMeta[cid] = { name: null, ignored: false };
  mobaState.clusterMeta[cid].name = name || null;
  mobaState.clusterMeta[cid].ignored = ignored;
  saveClusterMeta();
  closeClusterEdit();
  buildFilterChips();
  rerender();
}

function deleteClusterEdit() {
  if (_editingClusterId == null) return;
  const cid = _editingClusterId;
  delete mobaState.clusterMeta[cid];
  saveClusterMeta();
  closeClusterEdit();
  buildFilterChips();
  rerender();
}

function toggleHideIgnored() {
  mobaState.hideIgnoredClusters = !mobaState.hideIgnoredClusters;
  const btn = document.getElementById('hideIgnoredBtn');
  if (btn) btn.classList.toggle('active', mobaState.hideIgnoredClusters);
  rerender();
}


// ─────────────────────────────────────────────────────────────────────────────
// FILTER CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function buildFilterChips() {
  const k = mobaState.clusterIds.length;
  const cChips = document.getElementById('clusterChips');
  cChips.innerHTML = '';

  // ── Sort selector row visibility + active-button state ─────────────────────
  const sortRow = document.getElementById('clusterSortRow');
  if (sortRow) {
    const hasRanking = !!mobaState.clusterRanking;
    sortRow.style.display = hasRanking ? 'flex' : 'none';
    sortRow.querySelectorAll('.filter-btn[data-sort]').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === mobaState.clusterSortMode);
    });
  }

  // ── Per-cluster ranking lookup (for sort order + score badge) ─────────────
  // rankByCluster[cid] -> {composite, cross_patient, stability, condition,
  //                        anatomy, top_condition: [name, prop],
  //                        top_region: [name, prop], rank}
  const rankByCluster = {};
  const ranking = mobaState.clusterRanking;
  if (ranking && Array.isArray(ranking.clusters)) {
    for (const c of ranking.clusters) {
      const norm = c.normalized || {};
      const props = c.condition_proportions || {};
      const topCondEntry = Object.entries(props)
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0] || null;
      const topRegionEntry = (Array.isArray(c.top_3_regions) && c.top_3_regions.length)
        ? c.top_3_regions[0] : null;
      rankByCluster[c.cluster_id] = {
        composite:     c.composite_score,
        cross_patient: norm.cross_patient,
        stability:     norm.stability,
        condition:     norm.condition,
        anatomy:       norm.anatomy,
        top_condition: topCondEntry,    // [condName, prop] or null
        top_region:    topRegionEntry,  // [regionName, prop] or null
        rank:          c.rank,
      };
    }
  }

  // ── Sort cluster ids by current sort mode (descending = best first) ──────
  // Ignored clusters always sort to the end regardless of mode.
  const sortMode = mobaState.clusterSortMode;
  function _scoreFor(cid) {
    const r = rankByCluster[cid];
    if (!r) return -Infinity;
    const v = r[sortMode];
    return Number.isFinite(v) ? v : -Infinity;
  }
  let orderedIds = mobaState.clusterIds.slice();
  if (sortMode === 'id' || !ranking) {
    orderedIds.sort((a, b) => a - b);
  } else {
    orderedIds.sort((a, b) => _scoreFor(b) - _scoreFor(a) || (a - b));
  }
  const ignoredIds = orderedIds.filter(c =>  isClusterIgnored(c));
  const activeIds  = orderedIds.filter(c => !isClusterIgnored(c));
  orderedIds = [...activeIds, ...ignoredIds];

  // ── Score-badge renderer (uses the active sort mode) ─────────────────────
  // Returns the inner HTML for a .cluster-chip-score span, or '' if there's
  // nothing useful to show (no ranking / ID mode / missing value).
  function _scoreBadgeHTML(cid) {
    if (!ranking) return '';
    if (sortMode === 'id') return '';
    const r = rankByCluster[cid];
    if (!r) return '';
    const v = r[sortMode];
    if (sortMode === 'condition') {
      const tc = r.top_condition;
      if (!tc || !Number.isFinite(v)) return '';
      return `◈ ${_escapeHTML(String(tc[0]))} ${(tc[1] != null ? tc[1].toFixed(2) : v.toFixed(2))}`;
    }
    if (sortMode === 'anatomy') {
      const tr = r.top_region;
      if (!tr || !Number.isFinite(v)) return '';
      return `⌖ ${_escapeHTML(String(tr[0]))} ${(tr[1] != null ? tr[1].toFixed(2) : v.toFixed(2))}`;
    }
    if (!Number.isFinite(v)) return '';
    const glyph = sortMode === 'composite'     ? '★'
                : sortMode === 'cross_patient' ? '👥'
                : sortMode === 'stability'     ? '⟳'
                : '';
    return `${glyph} ${v.toFixed(2)}`;
  }

  // ── Build chips in sorted order ──────────────────────────────────────────
  orderedIds.forEach(cid => {
    const chip = document.createElement('span');
    chip.className = 'chip cluster-chip-thumb';
    chip.dataset.cluster = cid;

    // Nickname / "not important" annotations (from localStorage, scoped per
    // run + K). Double-click the chip to open the edit modal.
    const nick    = getClusterName(cid);
    const ignored = isClusterIgnored(cid);
    if (ignored) chip.classList.add('cluster-ignored');

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
    // Render "7: stim visual" when a nickname is set, otherwise just the number.
    const labelText = nick ? `${cid + 1}: ${nick}` : String(cid + 1);
    num.innerHTML = `<span class="chip-swatch" style="background:${clusterColor(cid, k)}"></span>${labelText}`;

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

    // Score badge — shown only when a ranking is loaded and the active sort
    // mode has a meaningful value for this cluster.
    const scoreHTML = _scoreBadgeHTML(cid);
    if (scoreHTML) {
      const score = document.createElement('span');
      score.className = 'cluster-chip-score';
      score.innerHTML = scoreHTML;
      // Tooltip on the badge gives all four normalized values so the user can
      // sanity-check the sort.
      const r = rankByCluster[cid];
      if (r) {
        const fmt = v => Number.isFinite(v) ? v.toFixed(2) : '—';
        score.title = `rank ${r.rank} · composite ${fmt(r.composite)}\n`
                     + `cross-patient ${fmt(r.cross_patient)} · stability ${fmt(r.stability)}\n`
                     + `condition ${fmt(r.condition)} · anatomy ${fmt(r.anatomy)}`;
      }
      chip.appendChild(score);
    }

    chip.addEventListener('click', () => toggleCluster(cid));
    // Double-click opens the nickname / "not important" edit modal.
    chip.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      openClusterEdit(cid);
    });
    // Hover tooltip = full annotations
    chip.title = `Cluster ${cid + 1}` +
                 (nick ? ` — "${nick}"` : '') +
                 (ignored ? ' (marked not important)' : '') +
                 '\\nDouble-click to edit nickname / ignored flag.';
    cChips.appendChild(chip);
  });

  // ── Dissolved-cluster indicator (at the very end of the chip row) ────────
  // Renders only when the ranking reports clusters_dissolved entries. Clicking
  // the chip toggles a panel underneath listing the merge mappings.
  if (ranking && Array.isArray(ranking.clusters_dissolved)
      && ranking.clusters_dissolved.length > 0) {
    const dis = ranking.clusters_dissolved;
    const indicator = document.createElement('span');
    indicator.className = 'cluster-dissolved-indicator';
    indicator.title = `${dis.length} cluster(s) dissolved during ranking iteration. Click to expand.`;
    indicator.innerHTML = `↳ ${dis.length} dissolved`;

    const panel = document.createElement('div');
    panel.className = 'cluster-dissolved-panel';
    panel.innerHTML = dis.map(d => {
      const from = (d.from_cluster != null) ? (d.from_cluster + 1) : '?';
      const to   = (d.to_cluster   != null) ? (d.to_cluster + 1)   : '?';
      const n    = (d.n_members   != null) ? d.n_members           : '?';
      const it   = (d.iteration   != null) ? d.iteration           : '?';
      return `<div class="dis-row">cluster ${from}<span class="dis-arrow">→</span>cluster ${to}`
           + `<span class="dis-n">(${n} samples, iter ${it})</span></div>`;
    }).join('');

    indicator.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });
    cChips.appendChild(indicator);
    cChips.appendChild(panel);
  }

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

// Tiny HTML-escape helper — used by the score badge labels (condition + region
// names come from upstream JSON and could contain stray characters that would
// break the chip layout if rendered raw).
function _escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Sort selector: switch the active sort mode and re-render the cluster chip
// row. The brain + samples grid don't depend on chip order, so we only
// rebuild the chips (cheap).
function setClusterSortMode(mode) {
  const ALLOWED = ['composite', 'cross_patient', 'stability', 'condition', 'anatomy', 'id'];
  if (!ALLOWED.includes(mode)) return;
  mobaState.clusterSortMode = mode;
  buildFilterChips();
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
  if (mobaState.hideIgnoredClusters && isClusterIgnored(row._cluster)) return false;
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

// Build an OBJ text containing one icosphere per electrode, each at
// (e.x, e.y, e.z) with the given mm radius. Returns a string ready to
// blob-URL into addMeshFromUrl.
//
// We emit FOUR shared vertex normals pointing in four different world-space
// directions (forward / back / up / down combined with side components) and
// reference all of them per face via averaged indices. Niivue's mesh shader
// uses provided normals when present; by giving it a spread of normals
// instead of the per-face normals it would otherwise compute from geometry,
// the Lambertian diffuse term averages out across the sphere and we get
// near-flat shading — preserves patient-color identity on the unlit
// hemisphere instead of darkening to grey/brown.
function buildSpheresOBJ(electrodes, radius) {
  const out = [`# MOBA generated · ${electrodes.length} spheres · radius=${radius}mm`];
  // 12 vertices per electrode
  for (const e of electrodes) {
    for (const v of ICO_VERTS) {
      out.push(`v ${(e.x + v[0]*radius).toFixed(3)} ${(e.y + v[1]*radius).toFixed(3)} ${(e.z + v[2]*radius).toFixed(3)}`);
    }
  }
  // Shared normals (1-based indexing). Index 1 = (0, 0, 1). Most Niivue
  // viewports look down +Z so this is approximately camera-forward → faces
  // referencing this normal render as fully-lit regardless of geometry.
  out.push('vn 0 0 1');
  // OBJ vertex indices are 1-based and global across the file
  for (let i = 0; i < electrodes.length; i++) {
    const off = i * ICO_VERTS.length + 1;
    for (const f of ICO_FACES) {
      // f v//vn syntax — vertex index // normal index (texture omitted)
      out.push(`f ${f[0]+off}//1 ${f[1]+off}//1 ${f[2]+off}//1`);
    }
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
    const SPHERE_RADIUS_MM = 2.52;       // 10% smaller than the previous 2.8mm
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
// STATS PANE — per-run K-quality curves + per-cluster diagnostics table.
//
// Reads four artifacts from the current run dir (any of them can be missing —
// the pane gracefully shows "missing" placeholders for absent files):
//   silhouette_by_k.png    — K-selection curve (always present after K-sweep)
//   gap_by_k.png            — Tibshirani gap stat curve (from 211_validation)
//   per_cluster_stability.csv  — Hennig Jaccard per cluster (from 211)
//   per_cluster_anatomy.csv    — aparc top-region + purity per cluster (from 211)
// ─────────────────────────────────────────────────────────────────────────────
async function renderStatsPane() {
  const runDir = mobaState.runDir;
  if (!runDir) {
    document.getElementById('statsClusterTable').innerHTML =
      '<div class="missing">Pick a run first.</div>';
    document.getElementById('silCurveImg').style.display = 'none';
    document.getElementById('gapCurveImg').style.display = 'none';
    return;
  }

  // ── 1. Curves: silhouette + gap ─────────────────────────────────────────
  const silImg = document.getElementById('silCurveImg');
  const gapImg = document.getElementById('gapCurveImg');
  silImg.src = `${runDir}/silhouette_by_k.png`;
  silImg.onload  = () => { silImg.style.display = 'block'; };
  silImg.onerror = () => { silImg.style.display = 'none'; };
  gapImg.src = `${runDir}/gap_by_k.png`;
  gapImg.onload  = () => { gapImg.style.display = 'block'; };
  gapImg.onerror = () => { gapImg.style.display = 'none'; };

  // ── 2. Per-cluster table ────────────────────────────────────────────────
  const tableHost = document.getElementById('statsClusterTable');
  tableHost.innerHTML = '<div class="missing">Loading...</div>';

  // Pull stability CSV + anatomy JSON in parallel. (Anatomy JSON is preferred
  // over the CSV because its top_3 column survives without a quoted-CSV parser;
  // each value is already a proper {top_3: [[region, prop], ...]} array.)
  // Both may 404 for pre-validation runs.
  const [stab, anat, anatJson] = await Promise.all([
    _fetchCsv(`${runDir}/per_cluster_stability.csv`),
    _fetchCsv(`${runDir}/per_cluster_anatomy.csv`),
    _fetchJson(`${runDir}/per_cluster_anatomy.json`),
  ]);

  // Pull per-cluster silhouette + n_patients + n_centers from the loaded metrics
  // (already in memory as the cluster chips use it). Build a master per-cluster table.
  const m = mobaState.manifest;
  if (!m) {
    tableHost.innerHTML = '<div class="missing">No run loaded.</div>';
    return;
  }

  // Pull metrics.json for per-cluster silhouette + cohesion stats
  let perCluster = {};
  try {
    const r = await fetch(`${runDir}/metrics.json`);
    if (r.ok) {
      const mj = await r.json();
      perCluster = mj.per_cluster || {};
    }
  } catch (e) { /* ignore */ }

  // Build rows: one per cluster id
  const cids = mobaState.clusterIds || [];
  const stabByCid = _csvByKey(stab,  'cluster_id');
  const anatByCid = _csvByKey(anat,  'cluster_id');

  // List of conditions present in this run — drives the dynamic columns
  const conditions = mobaState.conditions || [];

  const rows = cids.map(cid => {
    const pc = perCluster[String(cid)] || perCluster[cid] || {};
    const div = _clusterDiversity(cid) || {};
    const stabRow = stabByCid[String(cid)] || stabByCid[cid] || {};
    const anatRow = anatByCid[String(cid)] || anatByCid[cid] || {};
    const cond = _clusterConditionProportions(cid);
    // Anatomy top-3: prefer the structured JSON (no CSV-quoting pitfalls); fall
    // back to building a 1-entry top_3 from the CSV's top_region + top_proportion
    // if only the CSV exists.
    let top3 = null;
    if (anatJson) {
      const entry = anatJson[String(cid)] || anatJson[cid];
      if (entry && Array.isArray(entry.top_3)) top3 = entry.top_3;
    }
    if (!top3 && anatRow.top_region) {
      const p = parseFloat(anatRow.top_proportion);
      if (!Number.isNaN(p)) top3 = [[anatRow.top_region, p]];
    }
    return {
      cid,
      size:        pc.size ?? div.size ?? null,
      n_patients:  pc.n_patients ?? div.nPatients ?? null,
      n_centers:   pc.n_centers ?? div.nCenters ?? null,
      condProps:   cond ? cond.props : {},
      condDominant: cond ? cond.dominant : null,
      sil:         pc.silhouette_mean ?? null,
      jaccard:     stabRow.jaccard_stability != null ? parseFloat(stabRow.jaccard_stability) : null,
      top3:        top3,
      entropy:     anatRow.entropy_bits != null ? parseFloat(anatRow.entropy_bits) : null,
    };
  });

  // Pill colour for each metric: green / mixed / poor
  function pill(val, scale) {
    // scale = { good: x, mixed: y }, val above good -> good, between -> mixed, below -> poor
    // Use NaN-tolerant: if val is null, return ''
    if (val == null || Number.isNaN(val)) return '';
    const cls = val >= scale.good ? 'pill-good' : (val >= scale.mixed ? 'pill-mixed' : 'pill-poor');
    return `<span class="pill ${cls}">${val.toFixed(2)}</span>`;
  }
  // For Jaccard: 0.7+ = stable, 0.5-0.7 = mixed, <0.5 = unstable
  const jaccardScale = { good: 0.70, mixed: 0.50 };
  // For purity: 0.6+ = anatomically coherent
  const purityScale  = { good: 0.60, mixed: 0.35 };
  // For silhouette: 0.20+ = real cluster (low bar for noisy iEEG)
  const silScale     = { good: 0.20, mixed: 0.05 };

  // Render the "Top 3 anatomical regions" cell — 3 rows, region + proportion,
  // dominant region bolded. Reads from row.top3 = [[region, prop], ...] (up to 3).
  function _renderTop3(top3) {
    if (!top3 || !top3.length) return '<span class="missing">—</span>';
    // The first element is the dominant region (CSV was already sorted desc)
    const html = top3.slice(0, 3).map((pair, i) => {
      const region = String(pair[0] || '').replace(/^ctx-(lh|rh)-/, '');
      const prop = Number(pair[1]);
      const propStr = Number.isFinite(prop) ? prop.toFixed(2) : '?';
      const cls = i === 0 ? 'top3-row top3-dominant' : 'top3-row';
      return `<div class="${cls}"><span class="top3-region">${region}</span><span class="top3-prop">${propStr}</span></div>`;
    }).join('');
    return `<div class="top3-cell">${html}</div>`;
  }

  // Render one condition header cell — coloured swatch + condition name.
  // Dominant condition in each row also gets bold weight + a tinted cell bg.
  function _condHeader(c) {
    const col = COND_COLORS[c] || '#888';
    return `<th title="${c}"><span class="cond-swatch" style="background:${col}"></span>${c}</th>`;
  }
  function _condCell(c, row) {
    const p = row.condProps ? row.condProps[c] : null;
    if (p == null || Number.isNaN(p)) return '<td><span class="missing">—</span></td>';
    const isDom = (row.condDominant === c) && (p > 1 / Math.max(1, (mobaState.conditions || []).length));
    const col = COND_COLORS[c] || '#888';
    // Tint the cell background proportionally so visual scan picks out condition-selective clusters.
    // Alpha mapped from proportion (capped at 0.35 for legibility).
    const bg = `background: ${col}; opacity: ${Math.min(0.35, p * 0.5).toFixed(2)};`;
    return `<td style="position:relative">
              <span style="position:absolute;inset:0;${bg};pointer-events:none;border-radius:2px"></span>
              <span style="position:relative;${isDom ? 'font-weight:600' : ''}">${p.toFixed(2)}</span>
            </td>`;
  }

  const html = `
    <table>
      <thead>
        <tr>
          <th class="cluster-id">Cluster</th>
          <th>Size</th>
          <th>n<sub>pat</sub></th>
          <th>n<sub>ctr</sub></th>
          ${conditions.map(_condHeader).join('')}
          <th>Silhouette</th>
          <th>Jaccard<br>stability</th>
          <th class="text-left">Top 3 regions<br>(proportion)</th>
          <th>Entropy<br>(bits)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="cluster-id">${r.cid + 1}</td>
            <td>${r.size ?? '—'}</td>
            <td>${r.n_patients ?? '—'}</td>
            <td>${r.n_centers ?? '—'}</td>
            ${conditions.map(c => _condCell(c, r)).join('')}
            <td>${pill(r.sil, silScale) || '—'}</td>
            <td>${pill(r.jaccard, jaccardScale) || '<span class="missing">—</span>'}</td>
            <td class="text-left">${_renderTop3(r.top3)}</td>
            <td>${r.entropy != null ? r.entropy.toFixed(2) : '<span class="missing">—</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${(!stab && !anat) ? `<div class="missing" style="margin-top:0.5rem">
      Jaccard + anatomy columns are empty for this run — run <code>211_validation.ipynb</code>
      to populate <code>per_cluster_stability.csv</code> and <code>per_cluster_anatomy.csv</code>.
    </div>` : ''}
  `;
  tableHost.innerHTML = html;
}

// Per-cluster condition proportion (e.g. audio/picture/reading shares).
// Walks the *current* labels (so it follows the K-slider, like _clusterDiversity)
// and returns a {condition: proportion} dict that sums to 1. Empty clusters
// return null. Conditions absent from the cluster get 0 (not omitted) so
// the Stats table cells render as 0.00 instead of "—" for that case.
function _clusterConditionProportions(cid) {
  const rows = (mobaState.allLabels || []).filter(r => r._cluster === cid);
  if (!rows.length) return null;
  const counts = {};
  for (const r of rows) {
    const c = r.condition;
    if (!c) continue;
    counts[c] = (counts[c] || 0) + 1;
  }
  const total = rows.length;
  const props = {};
  // Use the run's full condition list so absent conditions show 0.00, not missing
  for (const c of (mobaState.conditions || [])) {
    props[c] = (counts[c] || 0) / total;
  }
  // Find the dominant condition (for bolding in the table)
  let dominant = null, maxP = -1;
  for (const c of Object.keys(props)) {
    if (props[c] > maxP) { dominant = c; maxP = props[c]; }
  }
  return { total, props, dominant };
}


// Small CSV / JSON helpers used by the stats pane
async function _fetchCsv(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return parseCSV(await r.text());
  } catch (e) { return null; }
}

async function _fetchJson(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

function _csvByKey(rows, key) {
  if (!rows) return {};
  const out = {};
  rows.forEach(r => { out[r[key]] = r; });
  return out;
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLightbox();
    closeClusterEdit();
  }
});

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
