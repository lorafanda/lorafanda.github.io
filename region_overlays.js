/*
 * region_overlays.js — anatomical landmark outlines + bottom-left legend.
 *
 * Shared by activity_visualizer / moba / pool. After the fsaverage brain meshes
 * are loaded into a Niivue instance, call:  roInit(nv)
 * It injects a "Anatomical regions" toggle (bottom-left) + a grouped color legend,
 * and on toggle paints colored outlines of small Destrieux landmarks onto the
 * fsaverage cortical surface (per-vertex rgba255).
 *
 * Data (per-vertex region-id outline bands + region table) lives in the
 * Analysis_LoraFanda repo and is fetched via raw.githubusercontent (CORS-open).
 * The arrays are in fsaverage vertex order, identical to the lh/rh meshes the
 * pages load — so no remapping is needed.
 *
 * After a page reloads/swaps the brain meshes (e.g. MOBA's pial<->inflated), call
 * roRefresh(nv) to re-apply the outlines if the toggle is on.
 */
(function () {
  // Region bundle currently lives on the 'activity-visualizer' branch. If it is
  // ever merged into main, change this to .../main/...
  const BASE = "https://raw.githubusercontent.com/lorafanda/Analysis_LoraFanda/" +
               "activity-visualizer/02_FBM_Clustering/outputs/250_recon/fsaverage/activity_viz/";

  const RO = { nv: null, on: false, loaded: false, regions: [], regcol: {}, edge: { lh: null, rh: null } };

  async function load() {
    if (RO.loaded) return true;
    try {
      RO.regions = ((await (await fetch(BASE + "regions.json")).json()).regions) || [];
      RO.regcol = {};
      for (const r of RO.regions) RO.regcol[r.id] = r.color;
      const u8 = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
      RO.edge.lh = await u8(BASE + "region_edge_lh_u8.bin");
      RO.edge.rh = await u8(BASE + "region_edge_rh_u8.bin");
      RO.loaded = true;
      return true;
    } catch (e) { console.error("[regions] data load failed:", e); return false; }
  }

  const brainMeshes = (nv) => (nv.meshes || []).filter(
    (m) => typeof m.name === "string" && /fsaverage/i.test(m.name));
  const hemiOf = (m) => /rh/i.test(String(m.name).replace(/fsaverage/i, "")) ? "rh" : "lh";

  // paint outlines (or restore bone) onto every fsaverage brain mesh
  function apply() {
    const nv = RO.nv; if (!nv) return;
    for (const m of brainMeshes(nv)) {
      const nvert = m.pts ? (m.pts.length / 3) : 0;
      if (!nvert) continue;
      if (!m._roBase) {                                    // capture the bone base color once
        const r = m.rgba255;
        m._roBase = (r && r.length >= 4) ? [r[0], r[1], r[2], r[3]] : [205, 198, 190, 46];
      }
      const base = m._roBase, rgba = new Uint8Array(nvert * 4);
      for (let v = 0; v < nvert; v++) { const o = v * 4; rgba[o] = base[0]; rgba[o + 1] = base[1]; rgba[o + 2] = base[2]; rgba[o + 3] = base[3]; }
      if (RO.on) {
        const e = RO.edge[hemiOf(m)];
        if (e) { const n = Math.min(nvert, e.length);
          for (let v = 0; v < n; v++) { const rid = e[v];
            if (rid) { const c = RO.regcol[rid]; const o = v * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; } } }
      }
      m.rgba255 = rgba;
      try { if (typeof m.updateMesh === "function") m.updateMesh(nv.gl); } catch (e) {}
    }
    try { nv.drawScene(); } catch (e) {}
  }

  function buildUI() {
    if (document.getElementById("roPanel")) return;
    const css =
      "#roPanel{position:fixed;left:14px;bottom:14px;z-index:9999;font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;" +
      "background:rgba(18,18,22,.86);color:#e8e8ec;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 10px;" +
      "max-width:240px;max-height:52vh;overflow:auto;backdrop-filter:blur(6px)}" +
      "#roPanel label.hd{display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:600;user-select:none}" +
      "#roLegend{display:none;margin-top:6px}#roLegend.on{display:block}" +
      "#roLegend .sys{margin:6px 0 2px;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#aab0ba}" +
      "#roLegend .ritem{display:flex;align-items:center;gap:7px;padding:1px 0 1px 2px}" +
      "#roLegend .sw{width:12px;height:12px;border-radius:3px;flex:none;border:1px solid rgba(255,255,255,.25)}";
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

    const p = document.createElement("div"); p.id = "roPanel";
    p.innerHTML = '<label class="hd"><input type="checkbox" id="roChk"> Anatomical regions</label><div id="roLegend"></div>';
    document.body.appendChild(p);

    let html = "", last = null;
    for (const r of RO.regions) {
      if (r.system !== last) { html += `<div class="sys">${r.system}</div>`; last = r.system; }
      const c = r.color;
      html += `<div class="ritem"><span class="sw" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>${r.name}</div>`;
    }
    document.getElementById("roLegend").innerHTML = html;
    document.getElementById("roChk").addEventListener("change", (e) => {
      RO.on = e.target.checked;
      document.getElementById("roLegend").classList.toggle("on", RO.on);
      apply();
    });
  }

  async function roInit(nv) { RO.nv = nv; if (!(await load())) return; buildUI(); if (RO.on) apply(); }
  function roRefresh(nv) { if (nv) RO.nv = nv; if (RO.on) apply(); }

  window.roInit = roInit;
  window.roRefresh = roRefresh;
  window.__RO = RO;   // debug hook
})();
