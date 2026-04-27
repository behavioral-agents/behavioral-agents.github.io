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
    return `
      ${g.paper_brief ? `<p class="paper-brief">${escapeHtml(g.paper_brief)}</p>` : ""}
      ${tabs}
      <div class="detail-grid" data-exp-id="${exp.id}">
        ${renderExperimentDetail(exp)}
      </div>
      <div class="detail-actions">
        <a class="btn" href="https://doi.org/${encodeURIComponent(g.doi)}" target="_blank" rel="noopener">Original paper (DOI) &rarr;</a>
        ${g.replication_url
          ? `<a class="btn" href="${escapeHtml(g.replication_url)}" target="_blank" rel="noopener">Original human data &rarr;</a>` : ""}
        ${hasRepro
          ? `<a class="btn" href="old.html#repro-${encodeURIComponent(baseId)}" target="_blank" rel="noopener">Reproduction package (simulated data) &rarr;</a>` : ""}
      </div>
    `;
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

  function renderExperimentDetail(exp) {
    return [
      renderDesignBlock(exp),
      renderCombinedComparisonBlock(exp),
      renderDistributionBlock(exp),
      renderConclusionTestsBlock(exp),
      renderNotesBlock(exp),
    ].join("");
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
  function renderCombinedComparisonBlock(exp) {
    const comps = (exp.comparisons || []).filter((c) => !c.modality || c.modality === "text");
    if (!comps.length) return "";

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
        ${comps.map((c) => `
          <th class="num" style="white-space:nowrap">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(c.model)}"></span>
              ${escapeHtml(modelLabel(c.model))}
            </span>
          </th>
        `).join("")}
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
  function renderDistributionBlock(exp) {
    const comps = (exp.comparisons || []).filter((c) => c.distributions && Object.keys(c.distributions).length > 0 && (!c.modality || c.modality === "text"));
    if (!comps.length) return "";
    const condSet = new Map();
    for (const c of comps) for (const cn of Object.keys(c.distributions)) condSet.set(cn, true);
    const conds = [...condSet.keys()];
    const xLabel = exp.design_summary?.outcome_variables?.[0]?.name || "";

    const legend = `
      <div class="chart-legend">
        <span><span class="swatch" style="background:#dc2626"></span>Humans</span>
        ${comps.map((c) => `<span><span class="swatch" style="background:${modelColor(c.model)}"></span>${escapeHtml(modelLabel(c.model))}</span>`).join("")}
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
    const pad = { t: 14, r: 14, b: 34, l: 14 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const dists = comps.filter((c) => c.distributions?.[cond]).map((c) => ({ model: c.model, dist: c.distributions[cond] }));
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
    const modelLayers = dists.map(({ model, dist }) => {
      const col = modelColor(model);
      const dd = dist.replicated_density || toDensity(dist.replicated_counts, dist.bin_width || bw);
      const pts = centers.map((c, i) => `${xs(c).toFixed(1)},${ys(dd[i]).toFixed(1)}`).join(" ");
      const baseY = (pad.t + plotH).toFixed(1);
      const firstX = xs(centers[0]).toFixed(1);
      const lastX = xs(centers[centers.length - 1]).toFixed(1);
      const fill = `${firstX},${baseY} ${pts} ${lastX},${baseY}`;
      return `
        <polygon points="${fill}" fill="${col}" opacity="0.2"/>
        <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" opacity="0.85"/>
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
    const xAxLabel = xLabel ? `<text x="${pad.l + plotW / 2}" y="${H - 2}" text-anchor="middle" font-size="10" fill="#94a3b8">${escapeHtml(xLabel)}</text>` : "";
    return `
      <div class="dist-plot">
        <div class="dist-plot-title">${titleCase(cond)}</div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          ${axis}${origLayer}${modelLayers}${tickSvg}${xAxLabel}
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
  function renderConclusionTestsBlock(exp) {
    const comps = (exp.comparisons || []).filter((c) => c.paper_tests && c.paper_tests.length && (!c.modality || c.modality === "text"));
    if (!comps.length) return "";

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
        ${modelList.map((m) => `
          <th class="num" style="white-space:nowrap">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(m)}"></span>
              ${escapeHtml(modelLabel(m))}
            </span>
          </th>
        `).join("")}
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
