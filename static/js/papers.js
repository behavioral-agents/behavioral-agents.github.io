/* =============================================================
   The Simulation Gap — papers page
   Accordion list of papers. Each detail panel shows:
   - paper brief
   - experimental design (with conditions pooled when the data
     has parameter-expanded variants)
   - ONE table: rows = conditions, columns = Human + each AI model,
     fidelity shown inline per AI cell
   - conclusion tests: rows = tests (with plain-English
     description), columns = models
   ============================================================= */

(function () {
  const CACHE_BUST = `v=${Date.now()}`;

  const MODEL_LABELS = {
    "gpt-4o":                    "GPT-4o",
    "gpt-4o-mini":               "GPT-4o mini",
    "claude-sonnet-4-6":         "Claude Sonnet 4.6",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "claude-opus-4-6":           "Claude Opus 4.6",
    "gemini-2.5-pro":            "Gemini 2.5 Pro",
    "gemini-2.5-flash":          "Gemini 2.5 Flash",
  };
  const MODEL_COLORS = {
    "gpt-4o":                    "#3b82f6",
    "gpt-4o-mini":               "#0891b2",
    "claude-sonnet-4-6":         "#7c3aed",
    "claude-haiku-4-5-20251001": "#f59e0b",
    "claude-opus-4-6":           "#06b6d4",
    "gemini-2.5-pro":            "#10b981",
    "gemini-2.5-flash":          "#34d399",
  };
  const modelLabel = (m) => MODEL_LABELS[m] || m;
  const modelColor = (m) => MODEL_COLORS[m] || "#64748b";

  // Distinct hue per (model, modality) so we can overlay Text + Visual
  // distributions in one plot without ambiguity. Claude Text=indigo,
  // Claude Visual=violet. Other models keep their MODEL_COLORS entry
  // regardless of modality.
  function modelModalityColor(m, modality) {
    if (m === "claude-sonnet-4-6") {
      return modality === "visual" ? "#7c3aed" : "#6366f1";
    }
    return modelColor(m);
  }

  const container = document.getElementById("paper-list-root");
  const countEl = document.getElementById("paper-count");
  const searchInput = document.getElementById("paper-search");
  const journalSelect = document.getElementById("journal-filter");

  let groups = [];

  fetch(`static/data/papers.json?${CACHE_BUST}`)
    .then((r) => r.json())
    .then((entries) => {
      groups = groupByDoi(entries);
      render(groups);
      bindFilters();
    })
    .catch((err) => {
      if (container) container.innerHTML = `<p class="loading">Failed to load papers: ${err.message}</p>`;
    });

  // ---------- Grouping -------------------------------------------------
  function groupByDoi(entries) {
    const m = new Map();
    for (const e of entries) {
      if (!m.has(e.doi)) {
        m.set(e.doi, {
          doi: e.doi,
          title: (e.title || "").replace(/ \u2014 .*$/, ""),
          authors: e.authors || [],
          journal: e.journal,
          year: e.year,
          paper_brief: e.paper_brief || "",
          replication_url: e.replication_url || null,
          experiments: [],
        });
      }
      const grp = m.get(e.doi);
      if (!grp.replication_url && e.replication_url) grp.replication_url = e.replication_url;
      grp.experiments.push(e);
    }
    const grps = [...m.values()];
    for (const g of grps) {
      g.experiments.sort((a, b) => {
        if (a.is_main_experiment && !b.is_main_experiment) return -1;
        if (!a.is_main_experiment && b.is_main_experiment) return 1;
        return (a.id || "").localeCompare(b.id || "");
      });
      if (!g.paper_brief) g.paper_brief = g.experiments.find((e) => e.paper_brief)?.paper_brief || "";
    }
    grps.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));
    return grps;
  }

  // ---------- Pooled condition logic -----------------------------------
  /**
   * Given a list of condition names, return a mapping of
   * pooledLabel -> [raw condition names], IF the conditions share
   * a small number of prefix families and pooling makes sense.
   * Otherwise, return null (meaning: keep raw conditions as-is).
   *
   * Heuristic: split by underscore. Take first token as family.
   * Pool only if families count < conditions count and ≤ 4 families
   * AND every family has at least 2 members.
   */
  function poolConditions(conditions) {
    if (!conditions || conditions.length <= 3) return null;
    const families = new Map();
    for (const c of conditions) {
      const fam = String(c).split(/[_\s]/)[0].toLowerCase();
      if (!families.has(fam)) families.set(fam, []);
      families.get(fam).push(c);
    }
    if (families.size >= conditions.length) return null;
    if (families.size > 4) return null;
    for (const members of families.values()) {
      if (members.length < 2) return null;
    }
    return families; // Map<familyLabel, conditions[]>
  }

  function titleCase(s) {
    return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ---------- Per-paper summary metric (best-AI conclusion match) ------
  function summarize(group) {
    const byModel = new Map();
    for (const exp of group.experiments) {
      for (const c of exp.comparisons || []) {
        if (c.modality && c.modality !== "text") continue;
        if (!byModel.has(c.model)) byModel.set(c.model, { correct: 0, total: 0 });
        const r = byModel.get(c.model);
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          r.total += 1;
          if (concl.startsWith("correct")) r.correct += 1;
        }
      }
    }
    let bestRate = null;
    for (const r of byModel.values()) {
      const rate = r.total ? r.correct / r.total : null;
      if (rate != null && (bestRate == null || rate > bestRate)) bestRate = rate;
    }
    const numRep = group.experiments.filter((e) => e.has_results).length;
    const numExp = group.experiments.length;
    const status = numRep === numExp ? "replicated" : numRep === 0 ? "pending" : "partial";
    return { bestRate, numExp, numRep, status };
  }

  // ---------- Rendering: list -----------------------------------------
  function render(list) {
    if (countEl) countEl.textContent = list.length === 1 ? "1 paper" : `${list.length} papers`;
    if (!list.length) { container.innerHTML = `<p class="loading">No papers match those filters.</p>`; return; }
    container.innerHTML = list.map(renderRow).join("");
    container.querySelectorAll(".paper-row-head").forEach((head) => {
      head.addEventListener("click", () => {
        const row = head.closest(".paper-row");
        const body = row.querySelector(".paper-row-body");
        const isOpen = row.classList.toggle("is-open");
        if (isOpen && body.dataset.rendered !== "1") {
          const doi = row.dataset.doi;
          const g = groups.find((x) => x.doi === doi);
          if (g) body.innerHTML = renderDetail(g);
          body.dataset.rendered = "1";

          // Wire the column-header modality pickers via event delegation.
          // There may now be multiple .modality-picker selects in a single
          // card (one in each AI column header). When any of them changes,
          // we re-render the entire detail grid — the new render naturally
          // sets every picker's "selected" option to the new modality, so
          // all pickers stay in sync.
          const grid = body.querySelector(".detail-grid");
          if (grid) {
            const expId = grid.dataset.expId;
            const exp = (g && g.experiments || []).find((e) => e.id === expId) || (g && g.experiments && g.experiments[0]);
            grid.addEventListener("change", (ev) => {
              const t = ev.target;
              if (!t || !t.classList || !t.classList.contains("modality-picker")) return;
              if (!exp) return;
              const modality = t.value;
              const modalities = (grid.dataset.modalities || "text").split(",").filter(Boolean);
              grid.dataset.modality = modality;
              grid.innerHTML = renderExperimentDetail(exp, modality, modalities);
            });
          }
        }
      });
    });
  }

  function renderRow(g, i) {
    const s = summarize(g);
    const bestPct = s.bestRate != null ? Math.round(s.bestRate * 100) + "%" : "—";
    const statusLabel =
      s.status === "replicated" ? "Simulated" :
      s.status === "pending"    ? "Pending"   :
                                  `${s.numRep}/${s.numExp} simulated`;
    return `
      <article class="paper-row" data-doi="${g.doi}">
        <div class="paper-row-head">
          <div class="paper-row-num">${String(i + 1).padStart(2, "0")}</div>
          <div class="paper-row-main">
            <div class="paper-row-title">${escapeHtml(g.title)}</div>
            <div class="paper-row-meta">
              <span class="journal-tag">${escapeHtml(g.journal || "")}</span>
              <span>${escapeHtml(g.authors.join(", "))}</span>
              <span>${g.year ?? ""}</span>
              <span class="status-chip ${s.status}">${statusLabel}</span>
            </div>
          </div>
          <div class="paper-row-metrics">
            <div class="paper-row-metric">
              <div class="v is-strong">${bestPct}</div>
              <div class="l">Best conclusion match</div>
            </div>
          </div>
          <button class="paper-row-toggle" aria-label="Expand">+</button>
        </div>
        <div class="paper-row-body"></div>
      </article>
    `;
  }

  // ---------- Rendering: paper detail ---------------------------------
  function renderDetail(g) {
    const exp = g.experiments[0];
    const tabs = g.experiments.length > 1 ? renderExperimentTabs(g) : "";
    const hasRepro = g.experiments.some((e) => e.has_reproduce_text || e.has_reproduce_visual);
    // baseId = shortest experiment ID in the group, matching old/app.js convention
    const baseId = g.experiments.reduce((a, b) => (a.id.length <= b.id.length ? a : b)).id;
    // What modalities does this experiment have? Used to render the picker.
    const modalities = [...new Set((exp.comparisons || []).map((c) => c.modality || "text"))];
    const defaultModality = modalities.includes("text") ? "text" : (modalities[0] || "text");
    // We stash the modality list on the grid so column-header pickers
    // (rendered inside each block) can read it when re-rendering. The
    // dropdown itself now lives inline at the AI column header in the
    // comparison table + the conclusion tests table.
    return `
      ${g.paper_brief ? `<p class="paper-brief">${escapeHtml(g.paper_brief)}</p>` : ""}
      ${tabs}
      <div class="detail-grid" data-exp-id="${exp.id}" data-modality="${defaultModality}" data-modalities="${escapeHtml(modalities.join(","))}">
        ${renderExperimentDetail(exp, defaultModality, modalities)}
      </div>
      <div class="detail-actions">
        <a class="btn" href="https://doi.org/${encodeURIComponent(g.doi)}" target="_blank" rel="noopener">Original paper (DOI) &rarr;</a>
        ${g.replication_url
          ? `<a class="btn" href="${escapeHtml(g.replication_url)}" target="_blank" rel="noopener">Original human data &rarr;</a>` : ""}
        ${hasRepro
          ? `<a class="btn" href="reproduce.html?paper=${encodeURIComponent(baseId)}" target="_blank" rel="noopener">Reproduction package (simulated data) &rarr;</a>` : ""}
      </div>
    `;
  }

  // The picker lives INSIDE the AI column header of each AI-data table
  // (comparison table + conclusion tests). Styled as a clearly-clickable
  // pill: a Claude-purple-tinted background, soft 1px purple border, rounded
  // corners, and an explicit chevron. Reads as "[ CLAUDE SONNET 4.6 (TEXT) ▾ ]"
  // — a first-time visitor immediately sees it's a control, not static text.
  //
  // `data-col-picker` lets the change-event delegator find these and sync
  // every picker in the card to a single modality value.
  function renderColumnModalityPicker(model, modalities, current) {
    if (modalities.length < 2) return escapeHtml(modelLabel(model));
    const options = modalities.map((m) =>
      `<option value="${m}" ${m === current ? "selected" : ""}>${modalityLabel(m)}</option>`
    ).join("");
    // `appearance:none` strips the native select chrome; the pill styling
    // makes the control discoverable. Text-transform inherits so it matches
    // the surrounding uppercase column-header treatment.
    return `<span class="modality-picker-wrap" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:3px 10px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.32);border-radius:14px;transition:background 0.15s, border-color 0.15s;"
      onmouseover="this.style.background='rgba(124,58,237,0.16)';this.style.borderColor='rgba(124,58,237,0.55)'"
      onmouseout="this.style.background='rgba(124,58,237,0.08)';this.style.borderColor='rgba(124,58,237,0.32)'">
      <select class="modality-picker" data-col-picker="1" autocomplete="off"
        style="appearance:none;-webkit-appearance:none;-moz-appearance:none;background:transparent;border:none;padding:0;margin:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer;outline:none;">${options}</select>
      <span aria-hidden="true" style="font-size:0.78em;color:#7c3aed;line-height:1;font-weight:600;">▾</span>
    </span>`;
  }

  // Used by the column-header picker's <option> labels.
  function modalityLabel(m) {
    return m === "visual" ? "Claude Sonnet 4.6 (Visual)" : "Claude Sonnet 4.6 (Text)";
  }
  // For model-specific column headers WITHOUT a picker (single modality, or a
  // non-Claude model). Appends the modality to the Claude label.
  function modelHeaderLabel(model, modality) {
    const base = modelLabel(model);
    if (model !== "claude-sonnet-4-6") return base;
    return modality === "visual" ? `${base} (Visual)` : `${base} (Text)`;
  }

  function renderExperimentTabs(g) {
    return `
      <div class="filters-bar" style="padding:0.5rem 0 1rem; border:0;">
        ${g.experiments.map((e, i) => {
          const label = e.title.includes("\u2014") ? e.title.split("\u2014").pop().trim() : e.title;
          return `<button class="btn ${i === 0 ? "btn-primary" : ""}" data-exp-switch="${e.id}">${escapeHtml(label)}</button>`;
        }).join("")}
      </div>
    `;
  }

  function renderExperimentDetail(exp, modality = "text", modalities = null) {
    if (!modalities) {
      modalities = [...new Set((exp.comparisons || []).map((c) => c.modality || "text"))];
    }
    return [
      renderDesignBlock(exp),
      renderCombinedComparisonBlock(exp, modality, modalities),
      renderFidelityBlock(exp, modality),
      renderDistributionBlock(exp, modality),
      renderConclusionTestsBlock(exp, modality, modalities),
      renderModalityCaveatsBlock(exp, modality),
      renderNotesBlock(exp),
    ].join("");
  }

  // For visual mode, surface the per-paper coverage caveats Prashant flagged
  // in the bundle README (partial subject coverage, condition exclusions, etc).
  function renderModalityCaveatsBlock(exp, modality) {
    if (modality !== "visual") return "";
    const visual = (exp.comparisons || []).find((c) => c.modality === "visual");
    if (!visual || !visual.coverage) return "";
    const cov = visual.coverage;
    const parts = [];
    if (cov.subjects) {
      const [a, b, label] = cov.subjects;
      parts.push(`<li><b>Subject coverage:</b> ${a}/${b} — ${escapeHtml(label)}</li>`);
    }
    if (cov.rows) {
      const [a, b, label] = cov.rows;
      parts.push(`<li><b>Row coverage:</b> ${a.toLocaleString()}/${b.toLocaleString()} — ${escapeHtml(label)}</li>`);
    }
    if (cov.note) {
      parts.push(`<li><b>Note:</b> ${escapeHtml(cov.note)}</li>`);
    }
    if (!parts.length) return "";
    return `
      <div class="detail-block">
        <h4>Visual-mode coverage caveats</h4>
        <ul style="font-size:0.88rem; color:var(--muted-2); line-height:1.55;">${parts.join("")}</ul>
      </div>
    `;
  }

  // --- Per-condition fidelity table ------------------------------------
  function renderFidelityBlock(exp, modality = "text") {
    const comps = (exp.comparisons || []).filter((c) => (c.modality || "text") === modality);
    if (!comps.length) return "";
    const rows = [];
    for (const c of comps) {
      for (const cond of (c.conditions || [])) {
        if (cond.f_individual == null && cond.f_population == null) continue;
        rows.push({
          model: c.model,
          condition: cond.condition,
          f_ind: cond.f_individual,
          f_pop: cond.f_population,
        });
      }
    }
    if (!rows.length) return "";

    const fmt = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(3);
    const cellColor = (v) => {
      if (v == null) return "color:var(--muted-2)";
      if (v >= 0.3) return "color:#15803d;font-weight:600";
      if (v >= 0)   return "color:#1d4ed8";
      if (v >= -1)  return "color:#b45309";
      return "color:#b91c1c;font-weight:600";
    };

    const avgByModel = new Map();
    for (const r of rows) {
      if (!avgByModel.has(r.model)) avgByModel.set(r.model, { ind: [], pop: [] });
      const m = avgByModel.get(r.model);
      if (r.f_ind != null) m.ind.push(r.f_ind);
      if (r.f_pop != null) m.pop.push(r.f_pop);
    }
    const avgRows = [...avgByModel.entries()].map(([model, m]) => ({
      model,
      condition: "Paper average",
      f_ind: m.ind.length ? m.ind.reduce((a, b) => a + b, 0) / m.ind.length : null,
      f_pop: m.pop.length ? m.pop.reduce((a, b) => a + b, 0) / m.pop.length : null,
      isAvg: true,
    }));

    const showModelCol = avgByModel.size > 1;
    const tableRows = [...rows, ...avgRows].map((r) => {
      const tone = r.isAvg ? "background:var(--surface-2);font-weight:500" : "";
      return `
        <tr style="${tone}">
          ${showModelCol ? `<td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(r.model)};margin-right:6px"></span>${escapeHtml(modelHeaderLabel(r.model, modality))}</td>` : ""}
          <td>${escapeHtml(titleCase(r.condition))}</td>
          <td class="num" style="${cellColor(r.f_ind)}">${fmt(r.f_ind)}</td>
          <td class="num" style="${cellColor(r.f_pop)}">${fmt(r.f_pop)}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="detail-block">
        <h4>Fidelity scores per condition</h4>
        <div style="overflow-x:auto">
          <table class="data-table" style="font-size:0.88rem">
            <thead>
              <tr>
                ${showModelCol ? "<th>Model</th>" : ""}
                <th>Condition</th>
                <th class="num">F<sub>individual</sub></th>
                <th class="num">F<sub>population</sub></th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- Design summary --------------------------------------------------
  function renderDesignBlock(exp) {
    const ds = exp.design_summary;
    if (!ds) return "";

    const rawConds = ds.conditions || [];
    const pool = poolConditions(rawConds);
    const condChips = pool
      ? [...pool.entries()].map(([fam, members]) =>
          `<span class="design-chip">${titleCase(fam)} <span class="mono" style="color:var(--muted-2);font-size:0.78em">(${members.length} configs)</span></span>`
        ).join(" ")
      : rawConds.map((c) => {
          const n = exp.original_results?.[c]?.n;
          return `<span class="design-chip">${titleCase(c)}${n != null ? ` <span style="color:var(--muted-2);font-size:0.82em">N=${n}</span>` : ""}</span>`;
        }).join(" ");

    const outcomeChips = (ds.outcome_variables || []).map((o, i) => {
      const prim = i === 0 && ds.outcome_variables.length > 1 ? " (primary)" : "";
      return `<span class="design-chip">${escapeHtml(o.name)}${prim}</span>`;
    }).join(" ");

    const sampleText = (() => {
      const parts = [];
      if (ds.sample_size != null) parts.push(`${ds.sample_size} participants`);
      if (ds.sample_type) parts.push(ds.sample_type);
      return parts.join(" · ") || "—";
    })();

    const rows = [
      ["Decision type", ds.decision_type],
      ["Outcome", outcomeChips ? `<span class="design-chips">${outcomeChips}</span>` : null],
      ["Scale", ds.outcome_variables?.[0]?.scale],
      ["Conditions", condChips ? `<span class="design-chips">${condChips}</span>` : null],
      ["Sample", sampleText],
      ["Total observations", ds.total_observations],
    ].filter((r) => r[1] != null && r[1] !== "");

    return `
      <div class="detail-block">
        <h4>Experimental design</h4>
        <p style="font-size:0.92rem;color:var(--muted);margin-bottom:1rem;line-height:1.55">${escapeHtml(exp.description || "")}</p>
        <table class="design-table"><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</tbody></table>
        ${pool ? `<p style="font-size:0.78rem;color:var(--muted);margin-top:0.75rem">Parameter-expanded variants of each condition have been pooled in the tables below.</p>` : ""}
      </div>
    `;
  }

  // --- Combined comparison: Human + each AI model, pooled conditions ---
  function renderCombinedComparisonBlock(exp, modality = "text", modalities = null) {
    const comps = (exp.comparisons || []).filter((c) => (c.modality || "text") === modality);
    if (!comps.length) return "";
    if (!modalities) modalities = [...new Set((exp.comparisons || []).map((c) => c.modality || "text"))];

    const ds = exp.design_summary || {};
    const rawConds = ds.conditions || [];
    const pool = poolConditions(rawConds);

    // Determine the row grouping. If pool is non-null:
    //   rows = [{ label: family, rawConditions: [c1, c2, ...] }, ...]
    // Else:
    //   rows = [{ label: cond, rawConditions: [cond] }, ...]
    const rowGroups = pool
      ? [...pool.entries()].map(([fam, members]) => ({ label: titleCase(fam), raw: members }))
      : rawConds.map((c) => ({ label: titleCase(c), raw: [c] }));

    if (!rowGroups.length) return "";

    // For each row & each comparison (model), compute the average replicated_mean
    // and average fidelity across the raw conditions in that row.
    // Also compute human mean per row from original_results.
    const rowData = rowGroups.map((g) => {
      // Human mean: average across raw conditions (weighted by n if available)
      let hSum = 0, hW = 0;
      for (const rc of g.raw) {
        const or = exp.original_results?.[rc];
        if (or?.mean != null) {
          const w = or.n || 1;
          hSum += or.mean * w;
          hW += w;
        }
      }
      const humanMean = hW ? hSum / hW : null;

      // Per-model
      const perModel = comps.map((c) => {
        let rSum = 0, rW = 0, fSum = 0, fN = 0, pSig = 0, pTotal = 0;
        for (const rc of g.raw) {
          const d = (c.conditions || []).find((x) => x.condition === rc);
          if (!d) continue;
          const w = 1; // all configurations weighted equally; could use N
          if (d.replicated_mean != null) { rSum += +d.replicated_mean * w; rW += w; }
          if (d.fidelity != null) { fSum += +d.fidelity; fN += 1; }
          const p = parseFloat(d.p_value);
          if (!isNaN(p)) { pTotal += 1; if (p < 0.05) pSig += 1; }
        }
        return {
          model: c.model,
          mean: rW ? rSum / rW : null,
          fidelity: fN ? fSum / fN : null,
          fracSig: pTotal ? pSig / pTotal : null,
        };
      });

      return { label: g.label, nConfigs: g.raw.length, humanMean, perModel };
    });

    const head = `
      <tr>
        <th>Condition</th>
        <th class="num">Human</th>
        ${comps.map((c) => {
          const isClaude = c.model === "claude-sonnet-4-6";
          const headerLabel = isClaude && modalities.length >= 2
            ? renderColumnModalityPicker(c.model, modalities, modality)
            : escapeHtml(modelHeaderLabel(c.model, modality));
          return `
          <th class="num" style="white-space:nowrap">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(c.model)}"></span>
              ${headerLabel}
            </span>
          </th>
        `;
        }).join("")}
      </tr>
    `;

    const body = rowData.map((rd) => {
      const cells = rd.perModel.map((m) => {
        if (m.mean == null && m.fidelity == null) return `<td class="num">—</td>`;
        const isBadMean = m.fracSig != null && m.fracSig >= 0.5;
        // Fidelity bar: 0 = random (middle), 1 = perfect (right), -1 = much worse (far left)
        // Map fidelity [-1, 1] to width% [0, 100], with zero at 50%.
        const fid = m.fidelity;
        let barHtml = "";
        if (fid != null) {
          const clamped = Math.max(-1, Math.min(1, fid));
          if (clamped >= 0) {
            // Rightward from center
            const pct = clamped * 50;
            barHtml = `
              <div class="cc-bar">
                <div class="cc-fill" style="left:50%;width:${pct.toFixed(1)}%;background:${pct > 20 ? "#16a34a" : "#2563eb"}"></div>
                <div class="cc-ref" style="left:50%"></div>
              </div>
              <div class="cc-fid">fid ${fid.toFixed(2)}</div>
            `;
          } else {
            // Leftward from center (below random)
            const pct = Math.abs(clamped) * 50;
            barHtml = `
              <div class="cc-bar">
                <div class="cc-fill" style="right:50%;width:${pct.toFixed(1)}%;background:#dc2626"></div>
                <div class="cc-ref" style="left:50%"></div>
              </div>
              <div class="cc-fid" style="color:var(--bad)">fid &minus;${Math.abs(fid).toFixed(2)}</div>
            `;
          }
        }
        const cellClass = fid != null && fid < 0 ? "compare-cell bad" : fid != null && fid > 0.4 ? "compare-cell good" : "compare-cell";
        return `
          <td class="num">
            <div class="${cellClass}${isBadMean ? " bad" : ""}">
              <div class="cc-num">${fmt(m.mean)}</div>
              ${barHtml}
            </div>
          </td>
        `;
      }).join("");
      return `
        <tr>
          <td>
            <div style="font-weight:500">${escapeHtml(rd.label)}</div>
            ${rd.nConfigs > 1 ? `<div style="font-size:0.75rem;color:var(--muted-2)">${rd.nConfigs} configurations pooled</div>` : ""}
          </td>
          <td class="num">
            <div class="compare-cell human">
              <div class="cc-num">${fmt(rd.humanMean)}</div>
              <div class="cc-bar"><div class="cc-fill" style="left:0;width:100%"></div></div>
              <div class="cc-fid" style="color:#991b1b">reference</div>
            </div>
          </td>
          ${cells}
        </tr>
      `;
    }).join("");

    return `
      <div class="detail-block">
        <h4>Human vs. AI-simulated means</h4>
        <p style="font-size:0.82rem;color:var(--muted);margin-bottom:0.9rem;max-width:70ch">
          Each row shows the average decision in that condition. The
          <strong>Human</strong> column is the original data; each AI column
          is the mean across AI agents matched to the sample.
          <strong>fid</strong> is the fidelity score (0&nbsp;=&nbsp;random,
          1&nbsp;=&nbsp;perfect). Red means the AI mean is significantly
          different from the humans' at p&nbsp;&lt;&nbsp;0.05.
        </p>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>${head}</thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- Distributions ---------------------------------------------------
  // Per Timo's spec, the distribution panel shows ALL modalities overlaid
  // in one plot (humans + Claude Sonnet 4.6 (Text) + Claude Sonnet 4.6
  // (Visual)). The dropdown does NOT filter this block — it only affects
  // the per-condition comparison table, fidelity table, and paper-tests
  // table. That keeps the visual + text distributions directly comparable
  // at a glance.
  function renderDistributionBlock(exp, modality = "text") {
    const comps = (exp.comparisons || []).filter(
      (c) => c.distributions && Object.keys(c.distributions).length > 0,
    );
    if (!comps.length) return "";

    const condSet = new Map();
    for (const c of comps) for (const cn of Object.keys(c.distributions)) condSet.set(cn, true);
    const conds = [...condSet.keys()];
    const xLabel = exp.design_summary?.outcome_variables?.[0]?.name || "";

    const legend = `
      <div class="chart-legend">
        <span><span class="swatch" style="background:#dc2626"></span>Humans</span>
        ${comps.map((c) => {
          const mod = c.modality || "text";
          const col = modelModalityColor(c.model, mod);
          return `<span><span class="swatch" style="background:${col}"></span>${escapeHtml(modelHeaderLabel(c.model, mod))}</span>`;
        }).join("")}
      </div>
    `;
    const plots = conds.map((cond) => distPlot(cond, comps, xLabel)).filter(Boolean).join("");
    if (!plots) return "";
    return `
      <div class="detail-block">
        <h4>Decision distributions: humans vs. AI agents</h4>
        ${legend}
        <div class="dist-grid">${plots}</div>
      </div>
    `;
  }

  function distPlot(cond, comps, xLabel) {
    const W = 360, H = 200;
    const pad = { t: 14, r: 14, b: 34, l: 44 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const dists = comps
      .filter((c) => c.distributions?.[cond])
      .map((c) => ({
        model: c.model,
        modality: c.modality || "text",
        dist: c.distributions[cond],
      }));
    if (!dists.length) return "";
    const ref = dists[0].dist;
    const centers = ref.bin_centers;
    if (!centers || !centers.length) return "";
    const bw = ref.bin_width || 1;
    const toDensity = (arr, binW) => {
      if (!arr || !arr.length) return centers.map(() => 0);
      const total = arr.reduce((s, v) => s + v, 0);
      if (!total) return arr;
      return arr.map((v) => v / (total * binW));
    };
    const origDensity = ref.original_density || toDensity(ref.original_counts, bw);
    const xMin = centers[0] - bw / 2;
    const xMax = centers[centers.length - 1] + bw / 2;
    let yMax = Math.max(...origDensity);
    dists.forEach((d) => {
      const dd = d.dist.replicated_density || toDensity(d.dist.replicated_counts, d.dist.bin_width || bw);
      yMax = Math.max(yMax, ...dd);
    });
    yMax *= 1.15 || 1;
    const xs = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
    const ys = (v) => pad.t + plotH - (v / yMax) * plotH;
    const barW = (bw / (xMax - xMin)) * plotW;
    const isEmpirical = ref.original_type === "empirical";
    let origLayer;
    if (isEmpirical) {
      origLayer = centers.map((c, i) => {
        const x = xs(c) - barW / 2;
        const h = (origDensity[i] / yMax) * plotH;
        const y = pad.t + plotH - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#dc2626" opacity="0.28"/>`;
      }).join("");
    } else {
      const pts = centers.map((c, i) => `${xs(c).toFixed(1)},${ys(origDensity[i]).toFixed(1)}`).join(" ");
      origLayer = `<polyline points="${pts}" fill="none" stroke="#dc2626" stroke-width="2.2"/>`;
    }
    const modelLayers = dists.map(({ model, modality, dist }) => {
      const col = modelModalityColor(model, modality);
      const dd = dist.replicated_density || toDensity(dist.replicated_counts, dist.bin_width || bw);
      const pts = centers.map((c, i) => `${xs(c).toFixed(1)},${ys(dd[i]).toFixed(1)}`).join(" ");
      const baseY = (pad.t + plotH).toFixed(1);
      const firstX = xs(centers[0]).toFixed(1);
      const lastX = xs(centers[centers.length - 1]).toFixed(1);
      const fill = `${firstX},${baseY} ${pts} ${lastX},${baseY}`;
      return `
        <polygon points="${fill}" fill="${col}" opacity="0.18"/>
        <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" opacity="0.9"/>
      `;
    }).join("");
    const ticks = niceTicks(xMin, xMax, centers);
    const allInt = ticks.every((v) => Number.isInteger(v));
    const fmtTick = (v) => allInt ? String(v) : (+v.toFixed(2)).toString();
    const tickSvg = ticks.map((v) => {
      const x = xs(v);
      return `
        <line x1="${x.toFixed(1)}" y1="${pad.t + plotH}" x2="${x.toFixed(1)}" y2="${pad.t + plotH + 4}" stroke="#cbd5e1"/>
        <text x="${x.toFixed(1)}" y="${pad.t + plotH + 15}" text-anchor="middle" font-size="10" fill="#64748b">${fmtTick(v)}</text>
      `;
    }).join("");
    const axis = `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${pad.l + plotW}" y2="${pad.t + plotH}" stroke="#e5e7eb"/>`;
    const yAxis = `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + plotH}" stroke="#e5e7eb"/>`;
    const yTickValues = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax];
    const fmtYTick = (v) => v === 0 ? "0" : (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
    const yTickSvg = yTickValues.map((v) => {
      const y = ys(v);
      return `
        <line x1="${pad.l - 4}" y1="${y.toFixed(1)}" x2="${pad.l}" y2="${y.toFixed(1)}" stroke="#cbd5e1"/>
        <text x="${(pad.l - 6).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${fmtYTick(v)}</text>
      `;
    }).join("");
    const yAxLabelX = 11;
    const yAxLabelY = pad.t + plotH / 2;
    const yAxLabel = `<text x="${yAxLabelX}" y="${yAxLabelY}" text-anchor="middle" font-size="10" fill="#94a3b8" transform="rotate(-90, ${yAxLabelX}, ${yAxLabelY})">Density</text>`;
    const xAxLabel = xLabel ? `<text x="${pad.l + plotW / 2}" y="${H - 2}" text-anchor="middle" font-size="10" fill="#94a3b8">${escapeHtml(xLabel)}</text>` : "";
    return `
      <div class="dist-plot">
        <div class="dist-plot-title">${titleCase(cond)}</div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          ${axis}${yAxis}${origLayer}${modelLayers}${tickSvg}${yTickSvg}${yAxLabel}${xAxLabel}
        </svg>
      </div>
    `;
  }

  function niceTicks(lo, hi, centers, nTarget = 5) {
    const unique = [...new Set(centers.map((v) => +v.toFixed(6)))];
    if (unique.length <= 10) return unique;
    const range = hi - lo;
    if (range <= 0) return [lo];
    const raw = range / nTarget;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const cands = [1, 2, 2.5, 5, 10];
    const step = cands.map((c) => c * mag).find((s) => range / s <= nTarget + 1) || raw;
    const out = [];
    const start = Math.ceil(lo / step) * step;
    for (let v = start; v <= hi + step * 0.01; v += step) out.push(+v.toFixed(6));
    return out;
  }

  // --- Conclusion tests: rows=tests, columns=models --------------------
  function renderConclusionTestsBlock(exp, modality = "text", modalities = null) {
    const comps = (exp.comparisons || []).filter((c) => c.paper_tests && c.paper_tests.length && (c.modality || "text") === modality);
    if (!comps.length) return "";
    if (!modalities) modalities = [...new Set((exp.comparisons || []).map((c) => c.modality || "text"))];

    // Build a map: test_index -> { description, test_name, originalEffect, perModel: {model -> {effect, conclusion}} }
    const tests = new Map();
    for (const c of comps) {
      for (const pt of c.paper_tests || []) {
        const key = pt.test_index != null ? `idx-${pt.test_index}` : `desc-${pt.description || pt.test_name || ""}`;
        if (!tests.has(key)) {
          tests.set(key, {
            description: pt.result_description || pt.description || pt.test_name || "",
            test_name: pt.test_name || "",
            originalEffect: pt.original_effect,
            perModel: {},
          });
        }
        tests.get(key).perModel[c.model] = {
          effect: pt.effect,
          conclusion: (pt.conclusion || "").trim(),
        };
      }
    }
    if (!tests.size) return "";

    const modelList = comps.map((c) => c.model);

    // Convert to ordered array (preserve insertion order by test_index where possible)
    const testArr = [...tests.values()];

    const head = `
      <tr>
        <th style="width:42%">Test</th>
        <th class="num">Human<br>effect</th>
        ${modelList.map((m) => {
          const isClaude = m === "claude-sonnet-4-6";
          const headerLabel = isClaude && modalities.length >= 2
            ? renderColumnModalityPicker(m, modalities, modality)
            : escapeHtml(modelHeaderLabel(m, modality));
          return `
          <th class="num" style="white-space:nowrap">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(m)}"></span>
              ${headerLabel}
            </span>
          </th>
        `;
        }).join("")}
      </tr>
    `;

    const body = testArr.map((t) => {
      const cells = modelList.map((m) => {
        const data = t.perModel[m];
        if (!data) return `<td class="num">—</td>`;
        const cls =
          data.conclusion.includes("correct_significant") ? "correct-sig" :
          data.conclusion.includes("correct_direction")   ? "correct-dir" :
          data.conclusion.includes("wrong")               ? "wrong" : "null";
        const shortLabel =
          cls === "correct-sig" ? "match" :
          cls === "correct-dir" ? "same dir" :
          cls === "wrong"       ? "wrong"   : "null";
        return `
          <td class="num">
            <div style="font-weight:600">${fmt(data.effect)}</div>
            <span class="concl-chip ${cls}" style="margin-top:0.25rem;font-size:0.65rem">${shortLabel}</span>
          </td>
        `;
      }).join("");
      const testHint = t.test_name ? `<div style="font-size:0.72rem;color:var(--muted-2);margin-top:0.15rem">${escapeHtml(t.test_name)}</div>` : "";
      return `
        <tr>
          <td>
            <div style="font-weight:500;line-height:1.35">${escapeHtml(t.description)}</div>
            ${testHint}
          </td>
          <td class="num" style="color:var(--ink);font-weight:600">${fmt(t.originalEffect)}</td>
          ${cells}
        </tr>
      `;
    }).join("");

    return `
      <div class="detail-block">
        <h4>Does the scientific conclusion survive?</h4>
        <p style="font-size:0.82rem;color:var(--muted);margin-bottom:0.9rem;max-width:72ch">
          Each row is a statistical test the original paper ran. We rerun the
          same test on AI-simulated data and report the effect size. The
          chip says whether the AI version reaches the same conclusion:
          <span class="concl-chip correct-sig" style="font-size:0.65rem">match</span> (same direction, significant),
          <span class="concl-chip correct-dir" style="font-size:0.65rem">same dir</span> (right direction, not significant),
          <span class="concl-chip null" style="font-size:0.65rem">null</span> (near zero),
          <span class="concl-chip wrong" style="font-size:0.65rem">wrong</span> (opposite or significantly opposite).
        </p>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>${head}</thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- Notes -----------------------------------------------------------
  function renderNotesBlock(exp) {
    const notes = exp.notes || [];
    if (!notes.length) return "";
    return `
      <details class="paper-notes">
        <summary>Notes from the extraction pipeline (${notes.length})</summary>
        <ul>${notes.map((n) => `<li><strong>${escapeHtml(n.category || "")}:</strong> ${escapeHtml(n.message || "")}</li>`).join("")}</ul>
      </details>
    `;
  }

  // ---------- Filters --------------------------------------------------
  function bindFilters() {
    if (!searchInput && !journalSelect) return;
    const handler = () => {
      const q = (searchInput?.value || "").toLowerCase().trim();
      const j = journalSelect?.value || "";
      let list = groups;
      if (j) list = list.filter((g) => g.journal === j);
      if (q) {
        list = list.filter((g) =>
          g.title.toLowerCase().includes(q) ||
          g.authors.join(" ").toLowerCase().includes(q) ||
          (g.paper_brief || "").toLowerCase().includes(q)
        );
      }
      render(list);
    };
    searchInput?.addEventListener("input", handler);
    journalSelect?.addEventListener("change", handler);
  }

  // ---------- Helpers --------------------------------------------------
  function fmt(v) {
    if (v == null || v === "") return "—";
    const n = parseFloat(v);
    if (isNaN(n)) return String(v);
    return n.toFixed(3);
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
