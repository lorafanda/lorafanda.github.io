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
  const cohort = _patientCohort(patientId);
  const palette = PAT_COLORS[cohort] || PAT_COLORS.EL;
  const allOfCohort = [...new Set((mobaState.allLabels || []).map(r => r.patient_id))]
    .filter(id => _patientCohort(id) === cohort).sort();
  const idx = allOfCohort.indexOf(patientId);
  const color = palette[Math.max(0, idx) % palette.length];
  getPatientColor._cache[patientId] = color;
  return color;
}

function clusterColor(i, n) {
  // matches the website's existing palette
  const hue = (i * 360 / Math.max(n, 1)) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
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

function _filepathToCleanPngUrl(file_path) {
  if (!file_path) return null;
  let p = String(file_path).replace(/\\\\/g, '/').replace(/\\/g, '/');
  const idx = p.indexOf('01_FBM_Analysis/');
  if (idx === -1) return null;
  p = p.substring(idx);
  p = p.replace('/ERSP_matrix/', '/ERSP_clean/');
  p = p.replace(/\.npy$/i, '_CLEAN.png');
  return `${REPO_RAW}/${p}`;
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

  // Brain viewer
  nv: null,                      // Niivue instance
  meshLoaded: false,
  brainReady: false,
  brainCanvas: null,

  // Selection (clicked electrode)
  selectedSampleIdx: null,
};

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
    meshXRay: 0.3,                        // alpha blending so the bone-tinted cortex stays semi-transparent
    isHighResolutionCapable: true,
  });

  try {
    await nv.attachToCanvas(canvas);
  } catch (e) {
    setStatus(`Niivue attach failed: ${e.message}`);
    return;
  }
  mobaState.nv = nv;

  // Load fsaverage meshes — bone-tinted, ~50% opacity so electrodes show through
  // (recon PNGs use alpha=0.2 over white; we go a touch denser for legibility on
  // a 3D rotatable view where shading helps anchor the geometry).
  const meshRgba = [205, 198, 190, 130];   // bone, alpha ≈ 0.51
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
// FILTER CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function buildFilterChips() {
  const k = mobaState.clusterIds.length;
  const cChips = document.getElementById('clusterChips');
  cChips.innerHTML = '';
  mobaState.clusterIds.forEach(cid => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.cluster = cid;
    chip.innerHTML = `<span class="chip-swatch" style="background:${clusterColor(cid, k)}"></span>${cid + 1}`;
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
function toggleHighSil()      { mobaState.highSilOnly = !mobaState.highSilOnly; refreshChipStates(); rerender(); }
function setColorMode(mode)   {
  mobaState.colorMode = mode;
  document.querySelectorAll('.filter-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  rerender();
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
function renderBrain() {
  if (!mobaState.brainReady || !mobaState.coords.length) {
    document.getElementById('brainStat').textContent = '';
    return;
  }
  const visible = mobaState.coords.filter(isVisible);
  document.getElementById('brainStat').textContent = `${visible.length} contacts`;

  const k = Math.max(mobaState.clusterIds.length, 1);
  const nodes = visible.map((r, i) => {
    const [R, G, B] = colorToRgb255(colorForRow(r));
    return {
      name:  `${r.patient_id}/${r.electrode || r.contact_name}/${r.condition}`,
      x: r.x, y: r.y, z: r.z,
      colorValue: i,                  // we'll feed a per-node colormap
      sizeValue:  1.0,
      _R: R, _G: G, _B: B,
      _row: r,
    };
  });

  // Build a custom colormap with one entry per node so each gets its exact color
  const cm = { R: [], G: [], B: [], A: [], I: [] };
  nodes.forEach((n, i) => {
    cm.R.push(n._R); cm.G.push(n._G); cm.B.push(n._B); cm.A.push(255); cm.I.push(i);
  });
  // Pad colormap with at least 2 entries (Niivue requires ≥2)
  if (cm.R.length < 2) {
    cm.R.push(128); cm.G.push(128); cm.B.push(128); cm.A.push(255); cm.I.push(cm.R.length);
  }

  try { mobaState.nv.addColormap('moba_nodes', cm); } catch (e) { /* may already exist */ }

  const connectome = {
    name: 'electrodes',
    nodeColormap: 'moba_nodes',
    nodeColormapNegative: 'moba_nodes',
    nodeMinColor: 0,
    nodeMaxColor: Math.max(nodes.length - 1, 1),
    nodeScale: 1.5,                              // smaller spheres, closer to recon PNG sphere size
    edgeColormap: 'warm',
    edgeColormapNegative: 'winter',
    edgeMin: 0, edgeMax: 1, edgeScale: 0,
    // Niivue's connectome reader expects capitalized 'Color' and 'Size' on nodes;
    // lowercase silently falls back to defaults (was likely why electrodes
    // looked off before).
    nodes: nodes.map(n => ({
      name: n.name, x: n.x, y: n.y, z: n.z,
      Color: n.colorValue,
      Size:  n.sizeValue,
    })),
    edges: [],
  };

  console.log(`[MOBA] Rendering connectome: ${nodes.length} electrodes, ` +
              `mode=${mobaState.colorMode}, k=${mobaState.clusterIds.length}`);
  console.log('[MOBA] First 3 nodes:', connectome.nodes.slice(0, 3));
  console.log('[MOBA] Niivue methods available:',
              { loadConnectomeFromUrl: typeof mobaState.nv.loadConnectomeFromUrl,
                loadConnectome: typeof mobaState.nv.loadConnectome,
                loadConnectomeFromObject: typeof mobaState.nv.loadConnectomeFromObject,
                addMeshFromUrl: typeof mobaState.nv.addMeshFromUrl,
                removeMesh: typeof mobaState.nv.removeMesh });

  // Re-renders happen on every filter change. Remove any previous electrodes
  // mesh first so we don't accumulate copies. We tag with name 'electrodes'
  // so we can find it again.
  try {
    const meshes = mobaState.nv.meshes || [];
    const old = meshes.find(m => m && (m.name === 'electrodes.jcon' || m.name === 'electrodes' || (m.connectome != null)));
    if (old && typeof mobaState.nv.removeMesh === 'function') {
      mobaState.nv.removeMesh(old.id != null ? old.id : old);
    }
  } catch (e) { console.warn('[MOBA] Could not remove previous electrodes mesh:', e); }

  // Add connectome ADDITIVELY (not via loadConnectomeFromUrl, which on
  // Niivue 0.68 replaces the entire mesh list and wipes the brain).
  // addMeshFromUrl with a .jcon-named blob lets Niivue's loader recognize
  // it as a connectome JSON and append it to the existing meshes.
  try {
    const blob = new Blob([JSON.stringify(connectome)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      if (typeof mobaState.nv.addMeshFromUrl === 'function') {
        await mobaState.nv.addMeshFromUrl({ url, name: 'electrodes.jcon' });
      } else if (typeof mobaState.nv.loadConnectomeFromUrl === 'function') {
        // Last-resort path: this WILL wipe the brain meshes. Re-add them after.
        await mobaState.nv.loadConnectomeFromUrl(url);
        if (mobaState._meshSpec) {
          for (const s of mobaState._meshSpec) {
            try { await mobaState.nv.addMeshFromUrl(s); } catch (e) {}
          }
        }
      } else {
        console.warn('[MOBA] No usable Niivue connectome / addMesh API found');
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    mobaState._brainNodes = nodes;
    console.log(`[MOBA] After add: nv.meshes.length = ${mobaState.nv.meshes ? mobaState.nv.meshes.length : '?'}`);
  } catch (e) {
    console.error('[MOBA] Connectome add failed:', e);
    setStatus(`Could not render electrodes: ${e.message}`);
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
    const url = _filepathToCleanPngUrl(row.file_path);
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
    card.addEventListener('click', () => openLightbox(url, `${row.patient_id} · ${row.electrode} · ${row.condition}` + (hasSil ? ` · sil=${sil.toFixed(3)}` : '')));

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
