// lm_visualizer/patient.js - one patient: the electrodes coloured by response type on the glass brain;
// a click on an electrode shows its ERSP (audio | picture | reading, stimulus and response marked) and
// its most likely response type.
//
// SEVERAL CLASSIFIERS. META.sols lists the clustering solutions the page switches between (the switch top
// right; ?c=<short key> in the address). c.v[i] is the contact's record under solution i: its type and
// numbers when the clustering took it, or {p:1, ...} = a PROJECTED type (its ERSP fitted with that run's
// types, no refit). A projected contact is coloured only when nothing but its patient kept it out (c.ok);
// otherwise it stays grey and the card gives the closest type as a secondary line. Only the reference
// solution has type names: a type of another solution carries `like` (the reference type it shares most
// electrodes with), takes its colour and is shown as "≈ that name". data/types.json holds every type's
// mean response, drawn as the legend's thumbnails. A patient with no reconstruction has no positions:
// the brain is shown without electrodes and the contacts as a list, shaft by shaft.
//
// Data: data/<patient>.json, written by 02_FBM_Clustering/make_lm_patient_pages.py (analysis repo), which
// also writes the stubs <patient>/index.html that load this file. The ERSP files and the fsaverage
// surface come from the LM review bundle on the activity-visualizer branch, as LM_visualizer.html does
// (a patient that bundle does not have yet: data/ersp/<patient>/, written with the page data).
//   ?bundle=http://localhost:8000/02_FBM_Clustering/outputs/250_recon/fsaverage/activity_viz/
// points the page at a local copy of that bundle.
import { Niivue, NVMesh } from "https://unpkg.com/@niivue/niivue@0.69.0/dist/index.js";

const BASE = new URL(".", import.meta.url);                       // .../lm_visualizer/
const Q = new URLSearchParams(location.search);
const PID = document.body.dataset.patient || Q.get("p") || "";
const VLIM = 6;                                                   // dB at the two ends of the colour scale
const GLASS_RGBA = [205, 198, 190, 30], GLASS_OPACITY = 0.18;     // the glass of LM_visualizer.html
const R_TYPED = 1.9, R_UNTYPED = 1.25, R_NODATA = 0.8;            // sphere radius, mm
const GREY = [154, 162, 171], LIGHT = [201, 206, 213], DIM = [96, 106, 118];   // no type · not analysed · a type under the minimum share
const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const pct = (v) => (v == null ? "–" : Math.round(v * 100) + " %");
const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const hasE = (c) => !!(c.f || c.fl);                              // the contact has an ERSP
const ink = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 140 ? "#17202a" : "#fff");   // text that reads on colour c

let D, META, BUNDLE, C = [], nv, elecMesh = null, sel = -1, surf = "fsaverage";
let LIST = false;                                                  // some contacts have no position: the page lists them
let SOLS = [], SOL = 0, REFSOL = null, TYPE = new Map(), CEN = null;   // the classifiers, the one shown, the reference one, the shown one's types by id, the types' mean responses
let MIN = 0;                                                       // the slider: the least share (%) of its type a contact needs to take the type's colour; 0 = off
const rec = (c) => (c.v ? c.v[SOL] : null);                        // the contact's record under the classifier shown
const clu = (c) => { const r = rec(c); return r && !r.p ? r : null; };   // ... when the clustering took the contact
const typed = (c) => { const r = rec(c); return r && (!r.p || c.ok) ? r : null; };   // the record that gives the contact a type: the clustering's, or a projection that counts
const topPct = (r) => Math.round((r.w[r.t] || 0) * 100);           // the share of its type, as the card prints it
const shownT = (c) => { const r = typed(c); return r && topPct(r) >= MIN ? r.t : null; };   // the type a contact is coloured by
const below = (c) => { const r = typed(c); return !!r && topPct(r) < MIN; };   // it has a type, under the slider's minimum share
const tname = (t) => t.name || (t.like ? "≈ " + t.like.name : "type c" + t.id);
let filesReady = Promise.resolve(), liveBuilt = "";              // liveBuilt: set when the bundle online is another build
const erspCache = new Map();
let erspShown = null;                                              // {c, a}: what the ERSP canvas shows

// ---- the icosphere every contact is drawn with (one subdivision: 42 vertices, 80 faces) ----
const [ICO, ICOF] = (() => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]]
    .map((v) => { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; });
  const F0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const mid = new Map(), F = [];
  const cut = (x, y) => { const key = x < y ? x + "_" + y : y + "_" + x; if (mid.has(key)) return mid.get(key);
    const a = V[x], b = V[y]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], L = Math.hypot(m[0], m[1], m[2]) || 1;
    V.push([m[0] / L, m[1] / L, m[2] / L]); mid.set(key, V.length - 1); return V.length - 1; };
  for (const [x, y, z] of F0) { const xy = cut(x, y), yz = cut(y, z), zx = cut(z, x); F.push([x, xy, zx], [y, yz, xy], [z, zx, yz], [xy, yz, zx]); }
  return [V, F];
})();

function bwr255(val) {                                             // blue - white - red, the ERSP map of every figure
  const t = Math.max(0, Math.min(1, (val + VLIM) / (2 * VLIM)));
  if (t <= 0.5) { const u = Math.round(510 * t); return [u, u, 255]; }
  const u = Math.round(510 * (1 - t)); return [255, u, u];
}

// ---- the page --------------------------------------------------------------------------------
function build() {
  const h = D.header, nProj = h.n_proj || 0;
  $("app").innerHTML = `
  <div class="page">
    <section class="brainpane${h.n_pos === 0 ? " bare" : ""}">
      <header class="phead"><h1>${esc(D.patient)}</h1>
        <p id="headcount"></p>
        ${h.in_cohort ? "" : `<p class="note">Not in the clustering${h.note ? ": " + esc(h.note) : ""}.</p>${nProj ? `<p class="note" id="headfit"></p>` : ""}`}
      </header>
      <div class="tools">
        ${SOLS.length > 1 ? `<div class="segrow"><span class="seglab">classifier</span><div class="seg" id="solSeg" role="group" aria-label="Classifier">${SOLS.map((s, i) => `<button data-sol="${i}" title="${esc(`${s.method_label} on ${s.feature_label}, K ${s.k}`)}">${esc(s.label)}</button>`).join("")}</div></div>` : ""}
        <div class="segrow" title="A contact whose type holds less than this share of its loading is shown grey"><span class="seglab">min. share</span><input type="range" id="minR" min="0" max="80" step="5" value="${MIN}" aria-label="Minimum share of its type for a contact to take the type's colour"><output id="minV" for="minR"></output></div>
        ${D.own ? `<div class="seg" id="surfSeg" role="group" aria-label="Brain surface"><button data-surf="fsaverage" class="on">fsaverage</button><button data-surf="own">own brain</button></div>` : ""}
        <div class="seg" id="viewSeg" role="group" aria-label="View"><button data-view="90,0">left</button><button data-view="270,0">right</button><button data-view="0,90">top</button><button data-view="180,0">front</button><button data-view="0,0">back</button></div>
        <div class="hint">drag to turn · scroll to zoom${h.n_pos === 0 ? "" : " · click an electrode"}</div>
      </div>
      <div class="stage" id="pane">
        <canvas class="gl" id="gl"></canvas><canvas class="ov" id="ov"></canvas>
        <div class="tip" id="tip" hidden></div>
        ${h.n_pos === 0 ? `<p class="nopos">No electrode positions: this patient's reconstruction has not been run. Its contacts are listed below.</p>` : ""}
        <div class="loading" id="loading">Loading the brain…</div>
      </div>
      ${LIST ? `<div class="clist" id="clist"></div>` : ""}
      <ul class="legend" id="legend"></ul>
    </section>
    <section class="side">
      <div class="card" id="card"><p class="empty">Click an electrode to see its ERSP.</p></div>
      <footer class="stamp" id="stamp"></footer>
    </section>
  </div>`;
}

function headCount() {                                             // the line under the patient's name
  const h = D.header, n = C.filter((c) => typed(c)).length, kept = C.filter((c) => shownT(c) != null).length;
  $("headcount").textContent = `${h.n} contacts · ${n} with a ${h.in_cohort ? "" : "projected "}response type` + (MIN ? ` · ${kept} at ${MIN} % or more` : "");
}
function headFit() {                                               // how well the shown classifier's types fit this patient's projected contacts
  const el = $("headfit"); if (!el) return;
  const v = (D.header.proj_r2 || [])[SOL], med = SOLS[SOL].r2_med;
  el.textContent = "The types are projected" + (v == null ? "." : `; they explain a median ${pct(v)} of a contact's ERSP shape` + (med != null ? ` (clustered contacts: ${pct(med)}).` : "."));
}

// A type's mean response (data/types.json): the 15 bands, low at the bottom, by the three conditions side by side.
function thumb(cv, id) {
  const S = CEN && CEN.sols[SOLS[SOL].short], b64 = S && S[id]; if (!b64) return;
  const raw = atob(b64), nb = CEN.n_bands, nc = CEN.n_cond, nt = CEN.n_time, gap = 2, W = nc * nt + (nc - 1) * gap, H = nb * 2;
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), img = g.createImageData(W, H), px = img.data;
  px.fill(255);
  for (let b = 0; b < nb; b++) for (let c = 0; c < nc; c++) for (let t = 0; t < nt; t++) {
    let v = raw.charCodeAt((b * nc + c) * nt + t); if (v > 127) v -= 256;       // int8: -127..127 = -db..+db
    const col = bwr255((v / 127) * VLIM), x = c * (nt + gap) + t;
    for (let dy = 0; dy < 2; dy++) { const o = (((nb - 1 - b) * 2 + dy) * W + x) * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; }
  }
  g.putImageData(img, 0, 0);
}
async function loadCentroids() {
  try { const r = await fetch(new URL("data/types.json", BASE), { cache: "no-cache" }); if (r.ok) { CEN = await r.json(); legend(); } } catch (e) { /* no thumbnails */ }
}

function legend() {
  const S = SOLS[SOL], n = new Map(); let untyped = 0, nodata = 0, nClu = 0, nPro = 0, nBelow = 0;
  for (const c of C) { const t = shownT(c);
    if (t != null) { n.set(t, (n.get(t) || 0) + 1); if (clu(c)) nClu++; else nPro++; }
    else if (below(c)) nBelow++; else if (hasE(c)) untyped++; else nodata++; }
  const tip = CEN ? `Mean response of this type's electrodes: ${CEN.conditions.join(" | ")}, ${CEN.n_bands} bands (low at the bottom), ±${CEN.db} dB` : "";
  let html = `<li class="lt">${nPro && !nClu ? "Projected response type" : nPro ? "Response type, clustered or projected" : "Response type"} · contacts`
    + (S.ref || !REFSOL ? "" : ` · ≈ the “${esc(REFSOL.label)}” type it shares most electrodes with, and the share`) + `</li>`;
  for (const t of S.types) { const k = n.get(t.id) || 0;
    html += `<li class="ty${k ? "" : " zero"}">${CEN ? `<canvas class="th" data-t="${t.id}" title="${esc(tip)}"></canvas>` : ""}<span class="sw" style="background:${rgb(t.rgb)}"></span><span class="cid">c${t.id}</span>`
      + `<span>${esc(tname(t))}${t.like && !t.name ? ` <span class="sh">${pct(t.like.share)}</span>` : ""}</span><span class="ct">${k}</span></li>`; }
  html += `<li class="sep"></li>` + (MIN ? `<li><span class="sw" style="background:${rgb(DIM)}"></span><span>type under ${MIN} %</span><span class="ct">${nBelow}</span></li>` : "")
    + `<li><span class="sw" style="background:${rgb(GREY)}"></span><span>recorded, no type</span><span class="ct">${untyped}</span></li>`;
  if (nodata) html += `<li><span class="sw small" style="background:${rgb(LIGHT)}"></span><span>not analysed</span><span class="ct">${nodata}</span></li>`;
  $("legend").innerHTML = html;
  $("legend").querySelectorAll("canvas.th").forEach((cv) => thumb(cv, cv.dataset.t));
}

function stamp() {
  const r = SOLS[SOL];
  $("stamp").innerHTML = `Types: ${esc(r.method_label)} on ${esc(r.feature_label)}, K ${r.k}, ${META.n_electrodes} electrodes of ${META.n_patients} patients (${esc(META.cache)}). `
    + (C.some((c) => c.v && c.v.some((x) => x && x.p)) ? `A contact outside the clustering: its ERSP fitted with those ${r.k} types, no refit (projection). ` : "")
    + `ERSP: dB against the pre-stimulus baseline, ` + (C.some((c) => c.fl) ? `written with the page data` : `bundle of ${esc(liveBuilt || META.review_built)}`)
    + (liveBuilt ? ` <span class="warn">(newer than this page's data: the ERSP files were matched by contact name)</span>` : "")
    + `. Page data built ${esc(META.built)}.`;
}

// ---- the brain ---------------------------------------------------------------------------------
const pos = (c) => (surf === "own" ? c.nat || null : c.x == null ? null : [c.x, c.y, c.z]);
function meshUrls(kind) {
  return ["lh", "rh"].map((h) => (kind === "own" ? new URL("data/" + D.own[h].file, BASE).href : `${BUNDLE}../meshes/fsaverage_${h}.gii`));
}
async function loadSurface(kind) {
  if (elecMesh) { try { nv.removeMesh(elecMesh); } catch (e) {} elecMesh = null; }
  [...nv.meshes].forEach((m) => nv.removeMesh(m));
  await nv.loadMeshes(meshUrls(kind).map((url) => ({ url, rgba255: GLASS_RGBA })));
  for (const m of nv.meshes) {
    for (const k of ["opacity", "layerOpacity", "meshOpacity"]) { try { if (k in m) m[k] = GLASS_OPACITY; } catch (e) {} }
    try { nv.setMeshShader(m.id, "Phong"); } catch (e) {}
  }
  surf = kind;
  drawContacts();
}
function drawContacts() {
  if (elecMesh) { try { nv.removeMesh(elecMesh); } catch (e) {} elecMesh = null; }
  const pts = [], tris = [], cols = []; let vi = 0;
  for (const c of C) {
    const p = pos(c); if (!p) continue;
    const t = shownT(c), [r, col] = t != null ? [R_TYPED, TYPE.get(t).rgb] : below(c) ? [R_UNTYPED, DIM] : hasE(c) ? [R_UNTYPED, GREY] : [R_NODATA, LIGHT];
    for (const o of ICO) pts.push(p[0] + o[0] * r, p[1] + o[1] * r, p[2] + o[2] * r);
    for (const f of ICOF) tris.push(vi + f[0], vi + f[1], vi + f[2]);
    for (let j = 0; j < ICO.length; j++) cols.push(col[0], col[1], col[2], 255);
    vi += ICO.length;
  }
  if (vi) { elecMesh = new NVMesh(new Float32Array(pts), new Uint32Array(tris), "contacts", new Uint8Array(cols), 1.0, true, nv.gl); nv.addMesh(elecMesh); }
  nv.drawScene();
}
function setView(az, el) { try { nv.setRenderAzimuthElevation(az, el); nv.drawScene(); } catch (e) {} }

// The contacts are projected with the scene's own matrix; the one nearest the pointer (within a few
// pixels) is the one hovered or clicked. Niivue 0.69: calculateMvpMatrix, calculateScreenPoint.
function mvpNow() {
  const g = nv.gl, W = g.canvas.width, H = g.canvas.height;
  if (!W || !H) return null;
  try { return [nv.calculateMvpMatrix(null, [0, 0, W, H], nv.scene.renderAzimuth, nv.scene.renderElevation)[0], W, H]; } catch (e) { return null; }
}
function nearest(clientX, clientY) {
  const m = mvpNow(); if (!m) return -1;
  const [mvp, W, H] = m, rect = nv.gl.canvas.getBoundingClientRect(); if (!rect.width) return -1;
  const k = W / rect.width, sx = (clientX - rect.left) * k, sy = (clientY - rect.top) * (H / rect.height), tol = 12 * k;
  let best = -1, bd = tol * tol, bz = Infinity;
  C.forEach((c, i) => {
    const p3 = pos(c); if (!p3) return;
    const p = nv.calculateScreenPoint(p3, mvp, [0, 0, W, H]), d = (p[0] - sx) ** 2 + (p[1] - sy) ** 2;
    if (d < bd - 4 || (d <= tol * tol && Math.abs(d - bd) <= 4 && p[2] < bz)) { best = i; bd = d; bz = p[2]; }
  });
  return best;
}
function tipText(c) {
  const t = shownT(c), r = typed(c);
  return c.n + " · " + (t != null ? tname(TYPE.get(t)) + (clu(c) ? "" : " (projected)")
    : r ? `${tname(TYPE.get(r.t))} ${topPct(r)} %, under ${MIN} %` : hasE(c) ? "no type" : "not analysed");
}
// The contacts as a list, shaft by shaft, each a disc in its colour: the way to a contact that has no
// position (no reconstruction). Built only for such a page.
function contactList() {
  const el = $("clist"); if (!el) return;
  const shafts = new Map();
  C.forEach((c, i) => { if (!shafts.has(c.s)) shafts.set(c.s, []); shafts.get(c.s).push(i); });
  let html = `<div class="lt">Contacts by shaft</div>`;
  for (const [s, idx] of shafts) {
    html += `<div class="crow"><span class="cs">${esc(s)}</span><span class="chips">` + idx.map((i) => {
      const c = C[i], t = shownT(c), col = t != null ? TYPE.get(t).rgb : below(c) ? DIM : hasE(c) ? GREY : LIGHT;
      return `<button class="chip" data-i="${i}" style="background:${rgb(col)};color:${ink(col)}" title="${esc(tipText(c))}" aria-label="${esc(tipText(c))}">${esc(c.k || c.n)}</button>`;
    }).join("") + `</span></div>`;
  }
  el.innerHTML = html;
  if (el.dataset.wired) return;                                    // rebuilt at every change of classifier: one listener
  el.dataset.wired = "1";
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    select(+b.dataset.i);
    if (matchMedia("(max-width: 900px)").matches) $("card").scrollIntoView({ block: "start" });   // stacked: the card is below
  });
}
function markList() {
  const el = $("clist"); if (!el) return;
  el.querySelectorAll(".chip.on").forEach((b) => b.classList.remove("on"));
  const b = el.querySelector(`.chip[data-i="${sel}"]`); if (!b) return;
  b.classList.add("on");
  const r = b.getBoundingClientRect(), R = el.getBoundingClientRect();   // keep it in view inside the list, without moving the page
  if (r.top < R.top) el.scrollTop -= R.top - r.top + 8; else if (r.bottom > R.bottom) el.scrollTop += r.bottom - R.bottom + 8;
}
function wireBrain() {
  const pane = $("pane"), tip = $("tip"); let down = null, raf = 0;
  pane.addEventListener("pointerdown", (e) => { down = e.button === 0 && e.target.id === "gl" ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; tip.hidden = true; });
  pane.addEventListener("pointerup", (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 4 || dt > 700) return;                             // a drag turns the brain; it is not a click
    const i = nearest(e.clientX, e.clientY); if (i >= 0) select(i);
  });
  pane.addEventListener("pointermove", (e) => {
    if (e.buttons || e.target.id !== "gl") { tip.hidden = true; return; }
    const x = e.clientX, y = e.clientY; cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = nearest(x, y), r = pane.getBoundingClientRect();
      if (i < 0) { tip.hidden = true; return; }
      tip.textContent = tipText(C[i]); tip.style.left = x - r.left + "px"; tip.style.top = y - r.top + "px"; tip.hidden = false;
    });
  });
  pane.addEventListener("pointerleave", () => { tip.hidden = true; });
  $("viewSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const [az, el] = b.dataset.view.split(",").map(Number); setView(az, el); });
  const ss = $("surfSeg");
  if (ss) ss.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.dataset.surf === surf) return;
    const L = $("loading"); L.textContent = b.dataset.surf === "own" ? "Loading the patient's own surface…" : "Loading fsaverage…"; L.classList.remove("gone");
    try { await loadSurface(b.dataset.surf); ss.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.surf === surf)); L.classList.add("gone"); }
    catch (err) { L.classList.add("failed"); L.textContent = "The surface could not be loaded: " + err.message; }
  });
  window.addEventListener("resize", () => { try { nv.resizeListener(); } catch (e) {} });
}
// the ring of the selected contact, in the viewer's plane, on a 2D canvas over the brain
function ring() {
  const ov = $("ov"), g = nv.gl, W = g.canvas.width, H = g.canvas.height;
  if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
  const ctx = ov.getContext("2d"); ctx.clearRect(0, 0, W, H);
  const c = sel >= 0 ? C[sel] : null, p3 = c ? pos(c) : null, m = p3 ? mvpNow() : null;
  if (m) {
    const p = nv.calculateScreenPoint(p3, m[0], [0, 0, W, H]);
    if (p && p[0] === p[0]) {
      const dpr = W / Math.max(1, ov.clientWidth), r = 11 * dpr;
      ctx.lineWidth = 4 * dpr; ctx.strokeStyle = "#000"; ctx.beginPath(); ctx.arc(p[0], p[1], r + 1.5 * dpr, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 2.6 * dpr; ctx.strokeStyle = "#19ff6a"; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.stroke();
      ctx.font = `600 ${Math.round(12 * dpr)}px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const w = ctx.measureText(c.n).width, x = p[0] + r + 7 * dpr;
      ctx.fillStyle = "rgba(23,32,42,.9)"; ctx.fillRect(x - 4 * dpr, p[1] - 10 * dpr, w + 8 * dpr, 20 * dpr);
      ctx.fillStyle = "#fff"; ctx.fillText(c.n, x, p[1]);
    }
  }
  requestAnimationFrame(ring);
}

// ---- the ERSP of one contact -----------------------------------------------------------------
// The live bundle may be a newer build than the one this page's data was made against: its ERSP files
// are then renumbered, so their names are taken from the live contacts.json, by contact name.
async function resolveFiles() {
  try {
    const man = await (await fetch(BUNDLE + "review/manifest.json", { cache: "no-cache" })).json();
    if (!man.built || man.built === META.review_built) return;
    const rows = await (await fetch(BUNDLE + "review/contacts.json")).json();
    const by = new Map(rows.filter((r) => r.patient === D.patient).map((r) => [norm(r.name), r.file || null]));
    for (const c of C) if (c.st === "data" && !c.fl) c.f = by.has(norm(c.n)) ? by.get(norm(c.n)) : null;
    liveBuilt = man.built;
    stamp();
  } catch (e) { /* no manifest: the file names of the build are used as they are */ }
}
async function ersp(c) {
  await filesReady;
  const url = c.fl ? new URL("data/" + c.fl, BASE).href : c.f ? BUNDLE + "review/" + c.f : null;   // written with the page data, or the review bundle's
  if (!url) return null;
  if (erspCache.has(url)) return erspCache.get(url);
  const r = await fetch(url);
  if (!r.ok) return null;
  const a = new Uint8Array(await r.arrayBuffer());
  erspCache.set(url, a);
  return a;
}
// One canvas: a label row for the conditions, a label row for stimulus | response, the three blocks
// (0 Hz at the bottom), the GO cue as a dashed line, the frequency axis and the colour bar.
function drawErsp(cv, a) {
  const E = META.ersp, nf = E.n_freq, nt = E.n_time, conds = E.conditions, nC = conds.length;
  const W = Math.max(300, Math.round(cv.parentElement.clientWidth)), padL = 42, padR = 50, padT = 46, padB = 24, gap = 10;
  const bw = (W - padL - padR - gap * (nC - 1)) / nC, bh = Math.round(Math.min(300, Math.max(180, bw * 1.4)));
  const H = padT + bh + padB, dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + "px";
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const span = E.vmax - E.vmin, INK = "#17202a", MUTED = "#5b6672", LINE = "#c5ccd4";
  const txt = (s, x, y, align, font, col) => { g.font = font; g.textAlign = align; g.textBaseline = "middle"; g.fillStyle = col; g.fillText(s, x, y); };
  conds.forEach((cond, k) => {
    const x0 = padL + k * (bw + gap), xm = x0 + bw / 2;
    // the block
    const off = document.createElement("canvas"); off.width = nt; off.height = nf;
    const og = off.getContext("2d"), img = og.createImageData(nt, nf), px = img.data; let any = false;
    for (let f = 0; f < nf; f++) { const row = nf - 1 - f;
      for (let t = 0; t < nt; t++) { const b = a[(k * nf + f) * nt + t], o = (row * nt + t) * 4;
        if (!b) { px[o] = 236; px[o + 1] = 239; px[o + 2] = 243; px[o + 3] = 255; continue; }
        any = true; const c = bwr255(E.vmin + ((b - 1) / 254) * span); px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; } }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(off, x0, padT, bw, bh);
    if (!any) txt("not recorded", xm, padT + bh / 2, "center", `12px ${FONT}`, MUTED);
    g.strokeStyle = LINE; g.lineWidth = 1; g.strokeRect(x0 + 0.5, padT + 0.5, bw - 1, bh - 1);
    // the GO cue
    g.strokeStyle = "rgba(23,32,42,.85)"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xm, padT); g.lineTo(xm, padT + bh); g.stroke(); g.setLineDash([]);
    // row 1: the condition
    g.fillStyle = "#e9edf2"; g.beginPath(); if (g.roundRect) g.roundRect(x0, 2, bw, 19, 5); else g.rect(x0, 2, bw, 19); g.fill();
    try { g.letterSpacing = "0.08em"; } catch (e) {}
    txt(cond.toUpperCase(), xm, 12, "center", `650 11.5px ${FONT}`, INK);
    try { g.letterSpacing = "0px"; } catch (e) {}
    // row 2: stimulus | response, each over its half, with a bracket down to the block
    g.font = `11.5px ${FONT}`;
    const short = g.measureText("response").width > bw / 2 - 8;      // narrow blocks: stim. | resp.
    [[short ? "stim." : "stimulus", x0, xm], [short ? "resp." : "response", xm, x0 + bw]].forEach(([lab, xa, xb]) => {
      txt(lab, (xa + xb) / 2, 31, "center", `11.5px ${FONT}`, MUTED);
      g.strokeStyle = "#9aa3ad"; g.lineWidth = 1; g.beginPath();
      g.moveTo(xa + 2.5, padT - 2); g.lineTo(xa + 2.5, padT - 6.5); g.lineTo(xb - 2.5, padT - 6.5); g.lineTo(xb - 2.5, padT - 2); g.stroke();
    });
    // the time marks under the block
    const yb = padT + bh + 13, f = `11px ${FONT}`;
    if (!short) { txt("onset", x0, yb, "left", f, MUTED); txt("end", x0 + bw, yb, "right", f, MUTED); }
    txt(bw >= 170 ? "GO cue" : "GO", xm, yb, "center", f, INK);
  });
  // frequency axis
  const fmax = E.f_hz[1];
  for (let hz = 0; hz <= fmax + 2; hz += 100) {
    const y = padT + bh - (hz / fmax) * bh;
    g.strokeStyle = LINE; g.beginPath(); g.moveTo(padL - 4, y + 0.5); g.lineTo(padL, y + 0.5); g.stroke();
    txt(String(hz), padL - 7, Math.min(padT + bh - 5, Math.max(padT + 5, y)), "right", `11px ${FONT}`, MUTED);
  }
  txt("Hz", padL - 7, 31, "right", `11px ${FONT}`, MUTED);
  // colour bar
  const cx = W - padR + 14, cw = 9;
  for (let i = 0; i < bh; i++) { const c = bwr255(VLIM - (2 * VLIM * i) / (bh - 1)); g.fillStyle = rgb(c); g.fillRect(cx, padT + i, cw, 1.5); }
  g.strokeStyle = LINE; g.strokeRect(cx + 0.5, padT + 0.5, cw - 1, bh - 1);
  txt("+" + VLIM, cx + cw + 5, padT + 6, "left", `11px ${FONT}`, MUTED); txt("0", cx + cw + 5, padT + bh / 2, "left", `11px ${FONT}`, MUTED);
  txt("−" + VLIM, cx + cw + 5, padT + bh - 6, "left", `11px ${FONT}`, MUTED); txt("dB", cx + cw / 2, 31, "center", `11px ${FONT}`, MUTED);
}

// ---- the type of one contact ---------------------------------------------------------------------
// Everything here reads the contact's record under the classifier shown (rec): r.t the type, r.w the shares,
// r.ho / r.cs the held-out and consensus numbers where that solution has them, r.p = projected.
const DEF = {
  membership: () => `Membership: this contact's share of loading on each of the ${SOLS[SOL].types.length} response types (${SOLS[SOL].method_label}). The shares add to 100 %; the type is the largest.`,
  heldout: (r) => `Held out: the share of the ${r.ho ? r.ho[3] : ""} models fitted on half of the patients, without this patient, that placed the contact in this type.`,
  consensus: () => `Consensus: over patient-resampled fits, how often this contact fell in the same cluster as the members of this type (mean over the members). The mark is the next type.`,
};
function projFit(r) {                                               // how much of a projected contact the types explain
  const m = SOLS[SOL].r2_med;
  return r.r2 == null ? "" : ` The ${SOLS[SOL].types.length} types explain ${pct(r.r2)} of its ERSP shape` + (m != null ? ` (clustered contacts: median ${pct(m)}).` : ".");
}
function typeHtml(c) {
  const nm = (id) => tname(TYPE.get(id));
  const item = (id, v) => `<span class="it"><span class="dot" style="background:${rgb(TYPE.get(id).rgb)}"></span>${esc(nm(id))} ${pct(v)}</span>`;
  const seg = (id, v) => `<span style="flex:${v};background:${rgb(TYPE.get(id).rgb)}" title="c${id} ${esc(nm(id))}: ${pct(v)}"></span>`;
  const r = rec(c);
  const under = below(c) ? `<p class="below">Under the minimum share of ${MIN} %: shown dark grey, not in its type's colour.</p>` : "";
  if (!r || r.p) {                                                  // not in the clustering: nothing, the closest type, or a projected type
    const why = esc(c.why || "not in the clustering"), nT = SOLS[SOL].types.length;
    if (!r) return `<div class="cap">Response type</div><p class="none">None: ${why}.</p>`;
    const pt = TYPE.get(r.t), own = r.w[r.t];
    if (!c.ok) return `<div class="cap">Response type</div><p class="none">None: ${why}.</p>
    <p class="closest"><span class="k">Closest type</span><span class="dot" style="background:${rgb(pt.rgb)}"></span><span>${esc(tname(pt))}</span><span class="cid">c${pt.id}</span><span class="v">${pct(own)}</span></p>
    <p class="def">Closest type: the largest share when this contact's ERSP is fitted with the ${nT} response types anyway, without a refit.${esc(projFit(r))}</p>`;
    const parts = r.w.map((v, id) => ({ id, v: v || 0 })).sort((a, b) => b.v - a.v), nx = parts.filter((q) => q.id !== r.t && q.v >= 0.05).slice(0, 2);
    return `<div class="cap">Projected response type</div>
    <div class="tline"><span class="sw" style="background:${rgb(pt.rgb)}"></span><b>${esc(tname(pt))}</b><span class="cid">c${pt.id}</span><span class="pct">${pct(own)}</span></div>${under}
    <div class="stack">${parts.filter((q) => q.v > 0.004).map((q) => seg(q.id, q.v)).join("")}</div>
    ${nx.length ? `<p class="then">then ${nx.map((q) => item(q.id, q.v)).join("")}</p>` : ""}
    <p class="def">Projected, not clustered: ${why}. Its ERSP is fitted with the ${nT} response types of the clustering, without a refit; the shares add to 100 % and the type is the largest.${esc(projFit(r))}</p>`;
  }
  const t = TYPE.get(r.t), mode = META.prob === "heldout" && r.ho ? "heldout" : META.prob === "consensus" && r.cs ? "consensus" : "membership";
  let num = "", bar = "", then = "";
  if (mode === "heldout") {
    const [hit, goes, share] = r.ho, rest = Math.max(0, 1 - hit - (goes !== r.t ? share : 0));
    num = pct(hit);
    bar = `<div class="stack">${hit > 0 ? seg(r.t, hit) : ""}${goes !== r.t && share > 0 ? seg(goes, share) : ""}${rest > 0.004 ? `<span class="rest" style="flex:${rest}" title="other types: ${pct(rest)}"></span>` : ""}</div>`;
    then = goes !== r.t && share > 0 ? `<p class="then">otherwise mostly ${item(goes, share)}</p>` : "";
  } else if (mode === "consensus") {
    const others = r.cs.map((v, id) => ({ id, v: v || 0 })).filter((p) => p.id !== r.t).sort((a, b) => b.v - a.v), own = r.cs[r.t] || 0;
    num = own.toFixed(2);
    bar = `<div class="track"><span style="width:${100 * own}%;background:${rgb(t.rgb)}"></span><i style="left:${100 * others[0].v}%" title="${esc(nm(others[0].id))}: ${others[0].v.toFixed(2)}"></i></div>`;
    then = `<p class="then">next <span class="it"><span class="dot" style="background:${rgb(TYPE.get(others[0].id).rgb)}"></span>${esc(nm(others[0].id))} ${others[0].v.toFixed(2)}</span></p>`;
  } else {
    const parts = r.w.map((v, id) => ({ id, v: v || 0 })).sort((a, b) => b.v - a.v);
    num = pct(r.w[r.t]);
    bar = `<div class="stack">${parts.filter((p) => p.v > 0.004).map((p) => seg(p.id, p.v)).join("")}</div>`;
    const nx = parts.filter((p) => p.id !== r.t && p.v >= 0.05).slice(0, 2);
    then = nx.length ? `<p class="then">then ${nx.map((p) => item(p.id, p.v)).join("")}</p>` : "";
  }
  return `<div class="cap">Most likely response type</div>
    <div class="tline"><span class="sw" style="background:${rgb(t.rgb)}"></span><b>${esc(tname(t))}</b><span class="cid">c${t.id}</span><span class="pct">${num}</span></div>${under}
    ${bar}${then}<p class="def">${esc(DEF[mode](r))}</p>`;
}
function markSol() { const sg = $("solSeg"); if (sg) sg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.sol === SOL)); }
function setSol(i) {                                               // another classifier: the colours, the legend, the list, the card's type
  if (i === SOL || !SOLS[i]) return;
  SOL = i; TYPE = new Map(SOLS[i].types.map((t) => [t.id, t]));
  markSol(); headCount(); headFit(); contactList(); markList(); legend(); stamp();
  if (nv && nv.meshes && nv.meshes.length) drawContacts();
  const el = sel >= 0 ? document.querySelector("#card .type") : null;
  if (el) el.innerHTML = typeHtml(C[sel]);
  try { const u = new URL(location.href); u.searchParams.set("c", SOLS[i].short); history.replaceState(null, "", u); } catch (e) {}
}
function markMin() { const o = $("minV"), r = $("minR"); if (o) o.textContent = MIN ? MIN + " %" : "off"; if (r && +r.value !== MIN) r.value = MIN; }
function setMin(v) {                                               // the slider: a contact whose type holds less than v % of its loading goes grey
  v = Math.max(0, Math.min(100, Math.round(+v) || 0));
  if (v === MIN) return;
  MIN = v;
  markMin(); headCount(); contactList(); markList(); legend();
  if (nv && nv.meshes && nv.meshes.length) drawContacts();
  const el = sel >= 0 ? document.querySelector("#card .type") : null;
  if (el) el.innerHTML = typeHtml(C[sel]);
  try { const u = new URL(location.href); if (MIN) u.searchParams.set("min", MIN); else u.searchParams.delete("min"); history.replaceState(null, "", u); } catch (e) {}
}

async function renderCard() {
  const c = C[sel], card = $("card");
  const where = [c.lab && c.lab !== "?" ? c.lab : "", c.h === "L" ? "left hemisphere" : c.h === "R" ? "right hemisphere" : ""].filter(Boolean).join(" · ");
  card.innerHTML = `<h2>${esc(c.n)}</h2><p class="where">${esc(where || "no anatomical label")}</p>`
    + (hasE(c) ? `<div class="erspwrap"><canvas id="ersp" role="img" aria-label="ERSP of ${esc(c.n)}: ${esc(META.ersp.conditions.join(", "))}; in each block the stimulus, then the response; ${esc(String(Math.round(META.ersp.f_hz[1])))} Hz at the top"></canvas></div>
         <p class="axisnote">Time runs left to right in each block and is normalised within each trial: stimulus onset, GO cue (dashed line), end of the response.</p>`
           : `<p class="noersp">No ERSP and no response type: ${esc(c.why || "not analysed")}.</p>`)
    + (hasE(c) || rec(c) ? `<div class="type">${typeHtml(c)}</div>` : "");
  erspShown = null;
  if (!hasE(c)) return;
  const a = await ersp(c);
  if (C[sel] !== c) return;                                        // another contact was picked meanwhile
  if (!a) { card.querySelector(".erspwrap").outerHTML = `<p class="noersp">The ERSP file of this contact could not be loaded.</p>`; return; }
  erspShown = { c, a }; drawErsp($("ersp"), a);
}
function select(i) {
  if (i < 0 || i >= C.length) return;
  sel = i; renderCard(); markList();
  try { history.replaceState(null, "", "#" + encodeURIComponent(C[i].n)); } catch (e) {}
}
function step(dir) {                                               // up / down: along the list (shaft by shaft)
  if (!C.length) return; let i = sel;
  for (let n = 0; n < C.length; n++) { i = (i + dir + C.length) % C.length; if (pos(C[i]) || (LIST && hasE(C[i]))) break; }
  select(i);
}
function stepShaft(dir) {                                          // left / right: the same place on the next shaft
  if (sel < 0) return step(dir);
  const shafts = [...new Set(C.map((c) => c.s))], si = shafts.indexOf(C[sel].s), next = shafts[(si + dir + shafts.length) % shafts.length];
  const place = C.filter((c) => c.s === C[sel].s).indexOf(C[sel]), on = C.map((c, i) => [c, i]).filter(([c]) => c.s === next);
  if (on.length) select(on[Math.min(place, on.length - 1)][1]);
}

// ---- start ---------------------------------------------------------------------------------------
async function main() {
  const app = $("app");
  if (!PID) { app.textContent = "No patient given."; return; }
  try {
    const r = await fetch(new URL(`data/${PID}.json`, BASE), { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    D = await r.json();
  } catch (e) { app.innerHTML = `<p style="padding:24px">No page data for ${esc(PID)} (${esc(e.message)}).</p>`; return; }
  META = D.meta; C = D.contacts;
  LIST = C.some((c) => c.x == null && hasE(c));
  SOLS = META.sols; REFSOL = SOLS.find((s) => s.ref) || null;
  const wantSol = Q.get("c"), si = wantSol ? SOLS.findIndex((s) => s.short === wantSol || s.key === wantSol) : -1;
  SOL = si >= 0 ? si : META.sol0 || 0;                             // the address names a classifier, else the page's default
  TYPE = new Map(SOLS[SOL].types.map((t) => [t.id, t]));
  MIN = Math.max(0, Math.min(100, parseInt(Q.get("min"), 10) || 0));   // ?min=35: the slider's value in a shared address
  BUNDLE = Q.get("bundle") || `https://raw.githubusercontent.com/lorafanda/Analysis_LoraFanda/${META.branch}/02_FBM_Clustering/outputs/250_recon/fsaverage/activity_viz/`;
  if (!BUNDLE.endsWith("/")) BUNDLE += "/";
  document.title = `${D.patient} electrodes`;
  build(); markSol(); markMin(); headCount(); headFit(); contactList(); legend(); stamp();
  const sg = $("solSeg");
  if (sg) sg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSol(+b.dataset.sol); });
  $("minR").addEventListener("input", (e) => setMin(e.target.value));
  loadCentroids();
  filesReady = resolveFiles();

  // open on the contact the address names, else on the contact with the clearest type (no clustered
  // contact: the projected one the types explain best)
  const want = decodeURIComponent(location.hash.slice(1));
  let first = want ? C.findIndex((c) => c.n === want || norm(c.n) === norm(want)) : -1;
  if (first < 0) { let bv = -1; C.forEach((c, i) => { const r = clu(c); if (r && hasE(c) && r.w[r.t] > bv) { bv = r.w[r.t]; first = i; } }); }
  if (first < 0) { let bv = -1; C.forEach((c, i) => { const r = rec(c); if (r && r.p && c.ok && hasE(c) && (r.r2 || 0) > bv) { bv = r.r2 || 0; first = i; } }); }
  if (first < 0) first = C.findIndex(hasE);

  const L = $("loading");
  try {
    nv = new Niivue({ backColor: [1, 1, 1, 1], show3Dcrosshair: false, isColorbar: false, meshXRay: 0.0, isOrientCube: false });
    await nv.attachToCanvas($("gl")); nv.setSliceType(nv.sliceTypeRender);
    await loadSurface("fsaverage");
  } catch (e) { L.classList.add("failed"); L.textContent = "The brain could not be loaded: " + e.message; console.error(e); if (first >= 0) select(first); return; }
  // look at the side that carries the contacts (the typed ones if there are any)
  const side = (list) => list.reduce((s, c) => s + (c.h === "L" ? 1 : c.h === "R" ? -1 : 0), 0);
  const typed = C.filter((c) => shownT(c) != null), s = side(typed.length ? typed : C);
  setView(s >= 0 ? 90 : 270, 0);
  L.classList.add("gone");
  wireBrain(); requestAnimationFrame(ring);
  if (first >= 0) select(first);
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { step(e.key === "ArrowDown" ? 1 : -1); e.preventDefault(); }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { stepShaft(e.key === "ArrowRight" ? 1 : -1); e.preventDefault(); }
  });
  window.addEventListener("hashchange", () => {                    // another contact's link opened in the same tab
    const w = decodeURIComponent(location.hash.slice(1)), i = C.findIndex((c) => c.n === w || norm(c.n) === norm(w));
    if (i >= 0 && i !== sel) select(i);
  });
  if ("ResizeObserver" in window) new ResizeObserver(() => { if (erspShown && $("ersp")) drawErsp($("ersp"), erspShown.a); }).observe($("card"));
}
main();
