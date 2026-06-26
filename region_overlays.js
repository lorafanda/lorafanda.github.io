/*
 * region_overlays.js — anatomical landmark fills + legend (MOBA / Pool).
 *
 * After the fsaverage brain meshes are loaded into a Niivue instance, call:
 *     roInit(nv, opts)
 * It adds an "Anatomical regions" toggle + grouped color legend.
 *
 * If the page already has <input id="roChk"> and <div id="roLegend"> in its
 * own sidebar, buildUI() wires those instead of creating a floating panel.
 *
 * Regions are rendered as SEMI-TRANSPARENT filled meshes (using the
 * region_fill_*_u8.bin atlas), lifted slightly off the cortex.
 *
 * Call roRefresh(nv) after the page swaps the brain meshes (e.g. pial<->inflated).
 */
(function () {
  const DEFAULT_BASE =
    "https://raw.githubusercontent.com/lorafanda/Analysis_LoraFanda/" +
    "activity-visualizer/02_FBM_Clustering/outputs/250_recon/fsaverage/activity_viz/";
  const FILL_ALPHA = 70;    // semi-transparent fill (~27% opacity)
  const OFFSET_MM = 1.0;    // lift mesh off cortex so it reads above a glass brain

  const RO = { nv: null, on: false, loaded: false, regions: [], regcol: {},
               fill: { lh: null, rh: null } };

  const base = () => (window.RO_BASE || DEFAULT_BASE);

  async function load() {
    if (RO.loaded) return true;
    try {
      const B = base();
      RO.regions = ((await (await fetch(B + "regions.json")).json()).regions) || [];
      RO.regcol = {};
      for (const r of RO.regions) RO.regcol[r.id] = r.color;
      const u8 = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
      RO.fill.lh = await u8(B + "region_fill_lh_u8.bin");
      RO.fill.rh = await u8(B + "region_fill_rh_u8.bin");
      RO.loaded = true;
      return true;
    } catch (e) { console.error("[regions] data load failed:", e); return false; }
  }

  const brainMeshes = (nv) => (nv.meshes || []).filter(
    (m) => typeof m.name === "string" && /fsaverage/i.test(m.name) && m.pts && m.tris);
  const hemiOf = (m) => /rh/i.test(String(m.name).replace(/fsaverage/i, "")) ? "rh" : "lh";

  // OBJ string of the filled region triangles (all 3 vertices in region),
  // lifted outward from each hemisphere's centroid so they float above the glass brain.
  function buildRegionOBJ(id) {
    const nv = RO.nv, v = [], f = []; let vi = 0;
    for (const m of brainMeshes(nv)) {
      const fill = RO.fill[hemiOf(m)]; if (!fill) continue;
      const pts = m.pts, tris = m.tris, n = pts.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < pts.length; k += 3) { cx += pts[k]; cy += pts[k + 1]; cz += pts[k + 2]; }
      cx /= n; cy /= n; cz /= n;
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        if (fill[a] === id && fill[b] === id && fill[c] === id) {
          for (const idx of [a, b, c]) {
            const o = idx * 3; let x = pts[o], y = pts[o + 1], z = pts[o + 2];
            const dx = x - cx, dy = y - cy, dz = z - cz, L = Math.hypot(dx, dy, dz) || 1, s = OFFSET_MM / L;
            v.push("v " + (x + dx * s).toFixed(2) + " " + (y + dy * s).toFixed(2) + " " + (z + dz * s).toFixed(2));
          }
          f.push("f " + (vi + 1) + " " + (vi + 2) + " " + (vi + 3)); vi += 3;
        }
      }
    }
    return f.length ? ("# region " + id + "\n" + v.join("\n") + "\n" + f.join("\n") + "\n") : null;
  }

  async function apply() {
    const nv = RO.nv; if (!nv) return;
    for (const m of [...(nv.meshes || [])])
      if (String(m.name || "").startsWith("region_")) { try { nv.removeMesh(m); } catch (e) {} }
    if (RO.on) {
      for (const r of RO.regions) {
        const obj = buildRegionOBJ(r.id); if (!obj) continue;
        const url = URL.createObjectURL(new Blob([obj], { type: "text/plain" }));
        try {
          await nv.addMeshFromUrl({ url, name: "region_" + r.id + ".obj",
            rgba255: [r.color[0], r.color[1], r.color[2], FILL_ALPHA] });
          const mm = nv.meshes[nv.meshes.length - 1];
          if (mm) try { nv.setMeshShader(mm.id, "Flat"); } catch (e) {}
        } catch (e) { console.error("[regions] add", r.id, e); }
        URL.revokeObjectURL(url);
      }
    }
    try { nv.drawScene(); } catch (e) {}
  }

  function legendHTML() {
    let html = "", last = null;
    for (const r of RO.regions) {
      if (r.system !== last) {
        html += '<div style="margin:5px 0 1px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#aab0ba">' + r.system + "</div>";
        last = r.system;
      }
      const c = r.color;
      html += '<div style="display:flex;align-items:center;gap:5px;padding:1px 2px">' +
        '<span style="width:10px;height:10px;border-radius:2px;flex:none;background:rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.7)"></span>' +
        r.name + "</div>";
    }
    return html;
  }

  function cornerCSS(corner) {
    const c = corner || "bottom-left";
    const v = c.includes("top") ? "top:14px;" : "bottom:14px;";
    const h = c.includes("right") ? "right:14px;" : "left:14px;";
    return v + h;
  }

  function buildUI(corner, mount) {
    // If the page already injected #roChk into its own sidebar, wire it inline.
    const existing = document.getElementById("roChk");
    if (existing) {
      const leg = document.getElementById("roLegend");
      if (leg) leg.innerHTML = legendHTML();
      existing.addEventListener("change", (e) => {
        RO.on = e.target.checked;
        const l = document.getElementById("roLegend");
        if (l) l.style.display = RO.on ? "" : "none";
        apply();
      });
      return;
    }

    // Fallback: create a floating panel (standalone use / pool.html).
    if (document.getElementById("roPanel")) return;
    const host = mount ? (typeof mount === "string" ? document.querySelector(mount) : mount) : null;
    const posMode = host ? "absolute" : "fixed";
    const css =
      "#roPanel{position:" + posMode + ";" + cornerCSS(corner) + "z-index:9999;font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;" +
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
    (host || document.body).appendChild(p);

    let html = "", last = null;
    for (const r of RO.regions) {
      if (r.system !== last) { html += '<div class="sys">' + r.system + "</div>"; last = r.system; }
      const c = r.color;
      html += '<div class="ritem"><span class="sw" style="background:rgb(' + c[0] + "," + c[1] + "," + c[2] + ')"></span>' + r.name + "</div>";
    }
    document.getElementById("roLegend").innerHTML = html;
    document.getElementById("roChk").addEventListener("change", (e) => {
      RO.on = e.target.checked;
      document.getElementById("roLegend").classList.toggle("on", RO.on);
      apply();
    });
  }

  async function roInit(nv, opts) { opts = opts || {}; RO.nv = nv; if (!(await load())) return; buildUI(opts.corner, opts.mount); if (RO.on) apply(); }
  function roRefresh(nv) { if (nv) RO.nv = nv; if (RO.on) apply(); }

  window.roInit = roInit;
  window.roRefresh = roRefresh;
  window.__RO = RO;
})();
