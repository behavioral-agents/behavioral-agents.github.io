/* =============================================================
   The Simulation Gap — reproduction-package page

   URL-driven:
     ?paper=<baseId>                                 → modality picker (hub)
     ?paper=<baseId>&exp=<expId>&mode=<text|visual>  → single-package view

   Ports the data-fetch logic from old app.js (showReproductionHub /
   showReproduction / downloadSingleFile / downloadAllScreens / etc.)
   onto the redesigned site shell. Keeps the same flow:
     paper -> modality picker -> file list + visual flow.
   ============================================================= */

(function () {
  const CACHE_BUST = `v=${Date.now()}`;

  const root      = document.getElementById("repro-root");
  const titleEl   = document.getElementById("repro-title");
  const ledeEl    = document.getElementById("repro-lede");

  const params  = new URLSearchParams(location.search);
  const baseId  = params.get("paper");
  const expId   = params.get("exp");
  const mode    = params.get("mode");

  if (!baseId) {
    root.innerHTML = `
      <p class="loading">No paper selected. Open a reproduction package from the
        <a href="papers.html">Papers</a> page.</p>`;
    return;
  }

  // Load papers.json so we can resolve titles, available modalities, etc.
  fetch(`static/data/papers.json?${CACHE_BUST}`)
    .then((r) => r.json())
    .then((entries) => {
      const group = findGroupForPaper(entries, baseId);
      if (!group) {
        root.innerHTML = `<p class="loading">Paper not found: <code>${escapeHtml(baseId)}</code>.</p>`;
        return;
      }
      if (expId && mode) {
        renderSingle(group, expId, mode);
      } else {
        renderHub(group);
      }
    })
    .catch((err) => {
      root.innerHTML = `<p class="loading">Failed to load papers metadata: ${escapeHtml(err.message)}</p>`;
    });

  // ---------- helpers --------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function titleCase(s) {
    return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Group entries with matching DOI; return the group containing baseId.
  function findGroupForPaper(entries, paperId) {
    const byDoi = new Map();
    for (const e of entries) {
      if (!byDoi.has(e.doi)) {
        byDoi.set(e.doi, {
          doi: e.doi,
          title: (e.title || "").replace(/ — .*$/, ""),
          authors: e.authors || [],
          year: e.year,
          journal: e.journal,
          experiments: [],
        });
      }
      byDoi.get(e.doi).experiments.push(e);
    }
    for (const g of byDoi.values()) {
      if (g.experiments.some((e) => e.id === paperId)) return g;
    }
    return null;
  }

  // ---------- HUB view: pick a modality --------------------------------

  function renderHub(group) {
    titleEl.textContent = `Reproduction package: ${group.title}`;
    ledeEl.textContent =
      "Download and run the exact same simulation locally. Each package " +
      "is a self-contained script with the survey, agent profiles and " +
      "scenarios serialized to JSON.";

    const combos = [];
    for (const exp of group.experiments) {
      if (exp.has_reproduce_text)   combos.push({ id: exp.id, modality: "text",   title: exp.title });
      if (exp.has_reproduce_visual) combos.push({ id: exp.id, modality: "visual", title: exp.title });
    }
    if (combos.length === 0) {
      root.innerHTML = `
        <a class="repro-back" href="papers.html">&larr; Back to papers</a>
        <p class="loading">No reproduction packages available for this paper.</p>`;
      return;
    }

    const expLabels = {};
    for (const exp of group.experiments) {
      expLabels[exp.id] = exp.title.includes("—")
        ? exp.title.split("—").pop().trim()
        : exp.title;
    }

    const byExp = new Map();
    for (const c of combos) {
      if (!byExp.has(c.id)) byExp.set(c.id, []);
      byExp.get(c.id).push(c.modality);
    }

    const modalityDesc = {
      text:   "Agents receive written descriptions of the experimental task and respond based on text instructions alone.",
      visual: "Agents see screenshot images of the original decision screens, replicating the visual experience participants had.",
    };

    const renderCard = (eid, mod) => `
      <a class="repro-mode-card" href="reproduce.html?paper=${encodeURIComponent(baseId)}&exp=${encodeURIComponent(eid)}&mode=${encodeURIComponent(mod)}">
        <div class="repro-mode-name">${mod}</div>
        <div class="repro-mode-desc">${modalityDesc[mod] || ""}</div>
      </a>
    `;

    const single = byExp.size === 1;

    let html = `
      <a class="repro-back" href="papers.html">&larr; Back to papers</a>
    `;

    if (single) {
      const [eid, mods] = [...byExp.entries()][0];
      html += `<div class="repro-mode-grid">${mods.map((m) => renderCard(eid, m)).join("")}</div>`;
    } else {
      html += [...byExp.entries()].map(([eid, mods]) => `
        <div class="repro-exp-card">
          <div class="repro-exp-title">${escapeHtml(expLabels[eid] || eid)}</div>
          <div class="repro-mode-grid">${mods.map((m) => renderCard(eid, m)).join("")}</div>
        </div>
      `).join("");
    }

    root.innerHTML = html;
  }

  // ---------- SINGLE view: file list + visual flow ---------------------

  async function renderSingle(group, paperId, modality) {
    titleEl.textContent = `Reproduction package: ${paperId}`;
    ledeEl.textContent = `${titleCase(modality)}-mode simulation. Download the files below and run the script locally.`;

    // Try new path layout first, fall back to legacy.
    let basePath = `static/data/reproduce/${baseId}/${modality}/${paperId}`;
    try {
      const probe = await fetch(`${basePath}/reproduce.py?${CACHE_BUST}`, { method: "HEAD" });
      if (!probe.ok) basePath = `static/data/reproduce/${paperId}_${modality}`;
    } catch (e) {
      basePath = `static/data/reproduce/${paperId}_${modality}`;
    }

    const wantedFiles = [
      { name: "reproduce.py",  desc: "Main script that loads the serialized objects and runs the simulation via EDSL" },
      { name: "survey.json",   desc: "The survey instrument (questions, answer options, instructions shown to the LLM)" },
      { name: "agents.json",   desc: "Simulated participant profiles with demographic traits matching the original sample" },
      { name: "scenarios.json", desc: `Experimental conditions (treatments) presented to each agent${modality === "visual" ? ", including references to the decision screen images" : ""}` },
    ];

    // Page header / instructions block
    const screenNote = modality === "visual"
      ? " In visual mode, the LLM sees screenshot images of the original decision screens instead of text descriptions."
      : "";

    let header = `
      <a class="repro-back" href="reproduce.html?paper=${encodeURIComponent(baseId)}">&larr; Back to reproduction packages</a>

      <div class="detail-block">
        <h4>How to run</h4>
        <div class="repro-instructions">
          <p>This package contains everything needed to replicate the ${escapeHtml(modality)}-mode simulation for this paper.${screenNote}</p>
          <ol>
            <li>Install the EDSL framework: <code>pip install edsl</code></li>
            <li>Download all files below into a single directory${modality === "visual" ? " (keep the <code>screens/</code> subfolder intact)" : ""}</li>
            <li>Run: <code>python reproduce.py</code></li>
            <li>Results will be saved to <code>results_${escapeHtml(modality)}.csv</code></li>
          </ol>
          <p style="margin-top:0.6rem;font-weight:500">Files</p>
          <ul>
            ${wantedFiles.map((f) => `<li><code>${f.name}</code> — ${f.desc}</li>`).join("")}
            ${modality === "visual" ? '<li><code>screens/</code> — PNG screenshots of the original experiment decision screens shown to the LLM</li>' : ""}
          </ul>
        </div>
      </div>
    `;

    root.innerHTML = header + `<div id="repro-files-block"><p class="loading">Loading files…</p></div>`;

    // Probe which files actually exist.
    const loaded = [];
    for (const file of wantedFiles) {
      try {
        const res = await fetch(`${basePath}/${file.name}?${CACHE_BUST}`, { method: "HEAD" });
        if (res.ok) loaded.push(file);
      } catch (e) { /* skip */ }
    }

    if (loaded.length === 0) {
      document.getElementById("repro-files-block").innerHTML =
        '<div class="detail-block"><p class="loading">No reproduction files found.</p></div>';
      return;
    }

    let filesHtml = `
      <div class="detail-block">
        <h4>Files</h4>
        <div class="repro-actions">
          <button class="btn btn-primary" id="repro-download-all">Download all files</button>
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr><th style="width:60%">File</th><th></th></tr>
            </thead>
            <tbody>
              ${loaded.map((f, i) => `
                <tr>
                  <td><code>${f.name}</code></td>
                  <td class="num"><button class="btn" data-idx="${i}">Download</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // For visual mode: discover screen PNGs + chronological flow.
    let visualHtml = "";
    if (modality === "visual") {
      visualHtml = await renderVisualFlow(basePath);
    }

    document.getElementById("repro-files-block").innerHTML = filesHtml + visualHtml;

    // Wire up download buttons
    document.getElementById("repro-download-all").addEventListener("click", () => {
      downloadAll(basePath, loaded.map((f) => f.name));
    });
    document.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const f = loaded[parseInt(btn.dataset.idx, 10)];
        downloadSingleFile(`${basePath}/${f.name}`, f.name);
      });
    });
  }

  // ---------- visual-mode helpers --------------------------------------

  async function renderVisualFlow(basePath) {
    let screens = [];
    let scenList = [];
    let conditions = new Set();

    // 1. Discover screens listed in scenarios.json
    try {
      const r = await fetch(`${basePath}/scenarios.json?${CACHE_BUST}`);
      if (r.ok) {
        const sd = await r.json();
        scenList = sd.scenarios || sd.data || [];
        const screenPaths = new Set();
        for (const s of scenList) {
          for (const v of Object.values(s)) {
            if (typeof v === "object" && v && v.path) screenPaths.add(v.path);
          }
          if (s.condition) conditions.add(s.condition);
        }
        // Probe per-condition variants (same heuristic as the old app.js)
        if (conditions.size > 0) {
          const baseNames = new Set();
          for (const p of screenPaths) {
            const fname = p.split("/").pop().replace(".png", "");
            for (const cond of conditions) {
              if (fname.endsWith("_" + cond)) baseNames.add(fname.slice(0, -(cond.length + 1)));
            }
          }
          for (const base of baseNames) {
            for (const cond of conditions) {
              const variant = `screens/${base}_${cond}.png`;
              if (!screenPaths.has(variant)) {
                try {
                  const probe = await fetch(`${basePath}/${variant}?${CACHE_BUST}`, { method: "HEAD" });
                  if (probe.ok) screenPaths.add(variant);
                } catch (e) { /* skip */ }
              }
            }
          }
        }
        screens = [...screenPaths].sort();
      }
    } catch (e) { /* skip */ }

    // 2. Load flow + manifest
    let flowData = null, manifest = null;
    try {
      const r = await fetch(`${basePath}/screen_flow.json?${CACHE_BUST}`);
      if (r.ok) flowData = await r.json();
    } catch (e) { /* skip */ }
    try {
      const r = await fetch(`${basePath}/screen_manifest.json?${CACHE_BUST}`);
      if (r.ok) manifest = await r.json();
    } catch (e) { /* skip */ }

    const manifestMap = {};
    if (manifest && manifest.mappings) {
      for (const m of manifest.mappings) manifestMap[m.generated] = m;
    }

    // 3. Build chronological flow items
    const flowItems = [];
    const shownOriginals = new Set();

    if (flowData) {
      const instrByPage = new Map();
      for (const instr of (flowData.instructions || [])) {
        if (!instr.page) continue;
        if (!instrByPage.has(instr.page)) {
          instrByPage.set(instr.page, { page: instr.page, descriptions: [], sequence: instr.sequence_order || 0 });
        }
        instrByPage.get(instr.page).descriptions.push(instr.description || "Instruction");
      }
      let instrIdx = 0;
      for (const [page, info] of instrByPage) {
        instrIdx++;
        const origPage = (page && !shownOriginals.has(page)) ? page : null;
        if (origPage) shownOriginals.add(origPage);
        flowItems.push({
          type: "instruction",
          label: info.descriptions.join(" · "),
          originalPage: origPage,
          generatedFile: `_instruction_${instrIdx}_default.png`,
          sequence: info.sequence,
        });
      }

      const allScreenFiles = new Set(screens.map((s) => s.split("/").pop()));
      for (const trial of (flowData.trials || [])) {
        for (const screen of (trial.screens || [])) {
          const qname = screen.question_name;
          if (!qname) continue;
          const probeSuffixes = ["default", ...conditions];
          const variants = [];
          for (const suffix of probeSuffixes) {
            const fname = `${qname}_${suffix}.png`;
            if (allScreenFiles.has(`screens/${fname}`) || allScreenFiles.has(fname)) {
              variants.push({ file: fname, condition: suffix });
            } else {
              try {
                const probe = await fetch(`${basePath}/screens/${fname}?${CACHE_BUST}`, { method: "HEAD" });
                if (probe.ok) { variants.push({ file: fname, condition: suffix }); allScreenFiles.add(fname); }
              } catch (e) { /* skip */ }
            }
          }
          variants.sort((a, b) => {
            if (a.condition === "default") return -1;
            if (b.condition === "default") return 1;
            return a.condition.localeCompare(b.condition);
          });
          const nonDefault = variants.filter((v) => v.condition !== "default");
          const toShow = nonDefault.length > 0 ? nonDefault : variants;
          for (const v of toShow) {
            const mEntry = manifestMap[v.file];
            const condLabel = v.condition === "default" ? "" : ` [${v.condition.replace(/_/g, " ")}]`;
            const rawOrig = screen.page || (mEntry?.original_pages?.[0]?.replace(".png", "")) || null;
            const origPage = (rawOrig && !shownOriginals.has(rawOrig)) ? rawOrig : null;
            if (origPage) shownOriginals.add(origPage);
            flowItems.push({
              type: "decision",
              label: (screen.task_label || qname) + condLabel,
              originalPage: origPage,
              generatedFile: v.file,
              sequence: 100 + (trial.trial_number || 0) * 10 + (flowItems.length),
            });
          }
        }
      }
    } else if (manifest && manifest.mappings) {
      for (const m of manifest.mappings) {
        const rawOrig = m.original_pages?.[0]?.replace(".png", "") || null;
        const origPage = (rawOrig && !shownOriginals.has(rawOrig)) ? rawOrig : null;
        if (origPage) shownOriginals.add(origPage);
        flowItems.push({
          type: "decision",
          label: m.task_label || m.generated,
          originalPage: origPage,
          generatedFile: m.generated,
          sequence: flowItems.length,
        });
      }
    }

    if (flowItems.length === 0 && screens.length === 0) return "";

    // 4. Probe whether original_screens/ exists
    let hasAnyOriginals = false;
    try {
      const probeItem = flowItems.find((f) => f.originalPage);
      if (probeItem) {
        const probeRes = await fetch(`${basePath}/original_screens/${probeItem.originalPage}.png?${CACHE_BUST}`, { method: "HEAD" });
        hasAnyOriginals = probeRes.ok;
      }
    } catch (e) { /* skip */ }

    let html = `<div class="detail-block">`;

    if (flowItems.length > 0) {
      const nInstr = flowItems.filter((f) => f.type === "instruction").length;
      const nDecision = flowItems.filter((f) => f.type === "decision").length;
      html += `
        <h4>Survey flow (${flowItems.length} screens: ${nInstr} instruction, ${nDecision} decision)</h4>
        <p style="font-size:0.84rem;color:var(--muted);margin-bottom:0.8rem;max-width:78ch">
          ${hasAnyOriginals
            ? "The complete survey in chronological order. Original pages from the paper's appendix are shown alongside the generated screens shown to the LLM."
            : "The complete survey in chronological order as shown to the LLM agent. Screens are generated from the experiment's survey file."
          }
        </p>
      `;

      if (hasAnyOriginals) {
        html += `<div class="repro-comparison-grid">${flowItems.map((item) => {
          const badge = item.type === "instruction"
            ? '<span class="flow-badge flow-badge-instruction">Instruction</span>'
            : '<span class="flow-badge flow-badge-decision">Decision</span>';
          const origSrc = item.originalPage ? `${basePath}/original_screens/${item.originalPage}.png` : null;
          const genSrc  = item.generatedFile ? `${basePath}/screens/${item.generatedFile}` : null;
          if (item.type === "instruction" && origSrc) {
            return `<div class="repro-comparison-pair">
              <div class="repro-comparison-item">
                <div class="repro-comparison-label">Original (paper appendix)</div>
                <img src="${origSrc}?${CACHE_BUST}" alt="Original">
              </div>
              <div class="repro-comparison-item">
                <div class="repro-comparison-label">Shown to LLM (same image)</div>
                <img src="${origSrc}?${CACHE_BUST}" alt="Shown to LLM">
              </div>
              <div class="repro-comparison-caption">${badge} ${escapeHtml(item.label)}</div>
            </div>`;
          }
          return `<div class="repro-comparison-pair">
            <div class="repro-comparison-item">
              <div class="repro-comparison-label">Original (paper appendix)</div>
              ${origSrc ? `<img src="${origSrc}?${CACHE_BUST}" alt="Original">` : '<div class="repro-no-original">No original available</div>'}
            </div>
            <div class="repro-comparison-item">
              <div class="repro-comparison-label">Generated (shown to LLM)</div>
              ${genSrc ? `<img src="${genSrc}?${CACHE_BUST}" alt="Generated">` : '<div class="repro-no-original">No generated screen</div>'}
            </div>
            <div class="repro-comparison-caption">${badge} ${escapeHtml(item.label)}</div>
          </div>`;
        }).join("")}</div>`;
      } else {
        html += `<div class="repro-flow-grid">${flowItems.map((item) => {
          const badge = item.type === "instruction"
            ? '<span class="flow-badge flow-badge-instruction">Instruction</span>'
            : '<span class="flow-badge flow-badge-decision">Decision</span>';
          const imgSrc = item.generatedFile ? `${basePath}/screens/${item.generatedFile}` : null;
          return `<div class="repro-flow-item">
            ${badge}
            ${imgSrc ? `<img src="${imgSrc}?${CACHE_BUST}" alt="${escapeHtml(item.label)}">` : '<div class="repro-no-original">No image</div>'}
            <div class="repro-flow-label">${escapeHtml(item.label)}</div>
          </div>`;
        }).join("")}</div>`;
      }
    } else if (screens.length > 0) {
      html += `
        <h4>Decision screens (${screens.length})</h4>
        <div class="repro-flow-grid">${screens.map((s) => {
          const fname = s.split("/").pop();
          return `<div class="repro-flow-item">
            <img src="${basePath}/${s}?${CACHE_BUST}" alt="${escapeHtml(fname)}">
            <div class="repro-flow-label">${escapeHtml(fname)}</div>
          </div>`;
        }).join("")}</div>`;
    }

    html += `</div>`;
    return html;
  }

  // ---------- download helpers (sequential, no JSZip) ------------------

  function downloadSingleFile(url, filename) {
    const a = document.createElement("a");
    a.href = `${url}?${CACHE_BUST}`;
    a.download = filename;
    a.click();
  }

  async function downloadAll(basePath, fileNames) {
    for (const name of fileNames) {
      downloadSingleFile(`${basePath}/${name}`, name);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
})();
