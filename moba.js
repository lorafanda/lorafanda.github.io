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
  brainMeshVisible: true,    // toggle for the fsaverage cortex mesh; electrodes always shown

  // Brain viewer
  nv: null,                      // Niivue instance
  meshLoaded: false,
  brainReady: false,
  brainCanvas: null,

  // Selection (clicked electrode / clicked thumbnail)
  selectedSampleIdx: null,
  _highlightedSampleIdx: null,    // sample_idx of the currently-highlighted electrode
};


// Yellow halo around the highlighted electrode. A separate small mesh
// (named 'highlight.obj') so we can swap it on every thumbnail click
// without rebuilding any of the other electrode meshes.
async function updateHighlight() {
  if (!mobaState.nv) return;

  // Remove previous halo if any
  const old = (mobaState.nv.meshes || []).filter(m =>
    typeof m.name === 'string' && m.name === 'highlight.obj');
  for (const m of old) {
    try { mobaState.nv.removeMesh(m); }
    catch (e) { try { mobaState.nv.removeMesh(m.id); } catch (e2) {} }
  }

  const sid = mobaState._highlightedSampleIdx;
  if (sid == null) return;

  const coord = (mobaState.coords || []).find(r => String(r.sample_idx) === String(sid));
  if (!coord) return;

  // Bigger, brighter sphere — pure highlighter yellow at full opacity.
  // Sits just outside the regular electrode mesh so the cluster colour
  // is still visible at the centre when rotating.
  const HIGHLIGHT_RADIUS_MM = 4.5;       // ~1.6x normal sphere; clear halo without obscuring it
  const obj = buildSpheresOBJ([{ x: coord.x, y: coord.y, z: coord.z }], HIGHLIGHT_RADIUS_MM);
  const blob = new Blob([obj], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    await mobaState.nv.addMeshFromUrl({
      url,
      name: 'highlight.obj',
      rgba255: [255, 215, 0, 220],       // bright highlighter yellow
    });
    if (typeof mobaState.nv.drawScene === 'function') mobaState.nv.drawScene();
  } catch (e) {
    console.warn('[MOBA] Could not add highlight mesh:', e);
  } finally {
    URL.revokeObjectURL(url);
  }
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

// Build an OBJ text containing one icosphere per electrode, each at
// (e.x, e.y, e.z) with the given mm radius. Returns a string ready to
// blob-URL into addMeshFromUrl.
function buildSpheresOBJ(electrodes, radius) {
  const out = [`# MOBA generated · ${electrodes.length} spheres · radius=${radius}mm`];
  for (const e of electrodes) {
    for (const v of ICO_VERTS) {
      out.push(`v ${(e.x + v[0]*radius).toFixed(3)} ${(e.y + v[1]*radius).toFixed(3)} ${(e.z + v[2]*radius).toFixed(3)}`);
    }
  }
  // OBJ vertex indices are 1-based and global across the file
  for (let i = 0; i < electrodes.length; i++) {
    const off = i * ICO_VERTS.length + 1;
    for (const f of ICO_FACES) {
      out.push(`f ${f[0]+off} ${f[1]+off} ${f[2]+off}`);
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
    const SPHERE_RADIUS_MM = 2.8;        // ~30% smaller than the previous 4mm
    for (const [cat, electrodes] of byCategory.entries()) {
      const obj = buildSpheresOBJ(electrodes, SPHERE_RADIUS_MM);
      const blob = new Blob([obj], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      try {
        const c = categoryColors[Math.min(cat, categoryColors.length - 1)] || [128, 128, 128];
        // Brighten the colour so Niivue's mesh shader doesn't make
        // the spheres look muddy against the bone-tinted cortex.
        // Multiply by 1.3 and clamp; preserves hue, lifts value.
        const r = Math.min(255, Math.round(c[0] * 1.3));
        const g = Math.min(255, Math.round(c[1] * 1.3));
        const b = Math.min(255, Math.round(c[2] * 1.3));
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
    card.addEventListener('click', () => {
      // Click highlights the corresponding electrode in 3D — no lightbox
      // (Lora doesn't want clicks to zoom the thumbnails).
      document.querySelectorAll('.output-card.highlighted').forEach(c => c.classList.remove('highlighted'));
      card.classList.add('highlighted');
      mobaState._highlightedSampleIdx = row.sample_idx;
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
