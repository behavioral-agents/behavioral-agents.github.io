/* =============================================================
   The Simulation Gap — results page
   Main scatter at the top, then breakdowns by decision type,
   journal, and model. No leaderboard — this is about the
   simulation approach, not a shootout between AI companies.
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
  // Approximate release order (oldest first). Used for the "model generation" cut.
  const MODEL_ORDER = [
    "gpt-4o",
    "gpt-4o-mini",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5-20251001",
  ];
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

  const scatterRoot = document.getElementById("scatter-root");
  const dtypeRoot   = document.getElementById("dtype-root");
  const journalRoot = document.getElementById("journal-root");
  const modelgenRoot = document.getElementById("modelgen-root");
  const modalityRoot = document.getElementById("modality-root");

  fetch(`static/data/papers.json?${CACHE_BUST}`)
    .then((r) => r.json())
    .then((papers) => {
      if (scatterRoot) renderScatter(papers);
      if (dtypeRoot)   renderDecisionTypes(papers);
      if (journalRoot) renderJournalBreakdown(papers);
      if (modelgenRoot) renderModelBreakdown(papers);
      if (modalityRoot) renderModalityBreakdown(papers);
    })
    .catch((err) => {
      [scatterRoot, dtypeRoot, journalRoot, modelgenRoot, modalityRoot].forEach((r) => {
        if (r) r.innerHTML = `<p class="loading">Failed to load data: ${err.message}</p>`;
      });
    });

  // --------------------------------------------------------------------
  // Main scatter: paper-level fidelity × conclusion match
  // --------------------------------------------------------------------
  function renderScatter(papers) {
    const rows = [];
    const byDoi = new Map();
    for (const p of papers) {
      if (!byDoi.has(p.doi)) {
        byDoi.set(p.doi, {
          doi: p.doi,
          title: (p.title || "").replace(/ \u2014 .*$/, ""),
          year: p.year,
          journal: p.journal,
          byModel: new Map(),
        });
      }
      const g = byDoi.get(p.doi);
      for (const c of p.comparisons || []) {
        if (c.modality && c.modality !== "text") continue;
        if (!g.byModel.has(c.model)) g.byModel.set(c.model, { correct: 0, total: 0, fidSum: 0, fidN: 0 });
        const r = g.byModel.get(c.model);
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          r.total += 1;
          if (concl.startsWith("correct")) r.correct += 1;
        }
        for (const cond of c.conditions || []) {
          if (cond.fidelity != null) { r.fidSum += +cond.fidelity; r.fidN += 1; }
        }
      }
    }
    for (const g of byDoi.values()) {
      let bestRate = null, bestFid = null;
      for (const r of g.byModel.values()) {
        const rate = r.total ? r.correct / r.total : null;
        const fid = r.fidN ? r.fidSum / r.fidN : null;
        if (rate != null && (bestRate == null || rate > bestRate)) bestRate = rate;
        if (fid != null && (bestFid == null || fid > bestFid)) bestFid = fid;
      }
      if (bestRate != null && bestFid != null) {
        rows.push({ ...g, conclRate: bestRate, fidelity: bestFid });
      }
    }

    if (!rows.length) {
      scatterRoot.innerHTML = `<p class="loading">No scatter data available.</p>`;
      return;
    }

    // SVG scatter
    const W = 860, H = 520;
    const pad = { t: 36, r: 200, b: 72, l: 80 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;

    const xs = (v) => pad.l + v * pw;
    const yMin = Math.min(-1, ...rows.map((r) => r.fidelity));
    const yMax = Math.max(1, ...rows.map((r) => r.fidelity));
    const ys = (v) => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

    // Quadrant backgrounds — subtle tint to show "good / bad" regions
    const midX = xs(0.5);
    const zeroY = ys(0);
    const quadrants = `
      <rect x="${midX}"    y="${pad.t}" width="${pad.l + pw - midX}" height="${zeroY - pad.t}" fill="#16a34a" fill-opacity="0.04"/>
      <rect x="${pad.l}"   y="${zeroY}" width="${midX - pad.l}"      height="${pad.t + ph - zeroY}" fill="#dc2626" fill-opacity="0.04"/>
    `;

    const gridX = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const x = xs(t);
      return `
        <line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + ph}" stroke="#eef2f7" stroke-width="1"/>
        <text x="${x}" y="${pad.t + ph + 22}" text-anchor="middle" font-size="12" fill="#64748b">${Math.round(t * 100)}%</text>
      `;
    }).join("");
    const gridYTicks = [yMin, -0.5, 0, 0.5, yMax].filter((v, i, a) => a.indexOf(v) === i && v >= yMin && v <= yMax);
    const gridY = gridYTicks.map((t) => {
      const y = ys(t);
      return `
        <line x1="${pad.l}" y1="${y}" x2="${pad.l + pw}" y2="${y}" stroke="#eef2f7" stroke-width="1"/>
        <text x="${pad.l - 10}" y="${y + 3}" text-anchor="end" font-size="12" fill="#64748b">${(+t).toFixed(2)}</text>
      `;
    }).join("");
    const zeroLine = `<line x1="${pad.l}" y1="${ys(0)}" x2="${pad.l + pw}" y2="${ys(0)}" stroke="#94a3b8" stroke-dasharray="4,4"/>`;
    const zeroLabel = `<text x="${pad.l + pw + 4}" y="${ys(0) + 3}" font-size="10" fill="#64748b">random</text>`;

    // Points + label placement (no overlap)
    const placed = [];
    const points = rows.map((r) => {
      const cx = xs(r.conclRate);
      const cy = ys(r.fidelity);
      // Dot color: green if in top-right, red if in bottom-left, blue otherwise
      const topRight = r.conclRate >= 0.5 && r.fidelity > 0;
      const bottomLeft = r.conclRate < 0.5 && r.fidelity <= 0;
      const color = topRight ? "#16a34a" : bottomLeft ? "#dc2626" : "#2563eb";

      const labelShort = truncateWords(r.title || "", 32);
      let labelX = cx + 18;
      let labelY = cy + 4;
      for (const p of placed) {
        if (Math.abs(p.x - labelX) < 6 && Math.abs(p.y - labelY) < 24) labelY = p.y + 28;
      }
      placed.push({ x: labelX, y: labelY });

      return `
        <g>
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10" fill="${color}" fill-opacity="0.8" stroke="#fff" stroke-width="2.5">
            <title>${escapeHtml(r.title)} — ${r.journal} ${r.year} — fidelity ${r.fidelity.toFixed(2)}, conclusion ${Math.round(r.conclRate * 100)}%</title>
          </circle>
          <line x1="${(cx + 10).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(labelX - 4).toFixed(1)}" y2="${(labelY - 4).toFixed(1)}" stroke="#cbd5e1" stroke-width="1"/>
          <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="12" fill="#0a0a0a" font-weight="600">${escapeHtml(labelShort)}</text>
          <text x="${labelX.toFixed(1)}" y="${(labelY + 15).toFixed(1)}" font-size="11" fill="#64748b">${r.journal} ${r.year ?? ""}</text>
        </g>
      `;
    }).join("");

    const xLabel = `<text x="${pad.l + pw / 2}" y="${H - 18}" text-anchor="middle" font-size="13" fill="#334155" font-weight="600">Conclusion match (best AI)</text>`;
    const yLabel = `<text transform="translate(20,${pad.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#334155" font-weight="600">Fidelity (best AI)</text>`;

    scatterRoot.innerHTML = `
      <div class="scatter-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
          ${quadrants}${gridX}${gridY}${zeroLine}${zeroLabel}${points}${xLabel}${yLabel}
        </svg>
        <p style="font-size:0.82rem;color:var(--muted);margin:1rem 0 0;max-width:68ch;line-height:1.55">
          The horizontal <em>random</em> line at fidelity&nbsp;=&nbsp;0 marks what
          a baseline with no information about the humans would look like.
          Papers below that line have AI-simulated distributions farther from
          the humans than chance.
        </p>
      </div>
    `;
  }

  // --------------------------------------------------------------------
  // Breakdown: replication by decision type
  // --------------------------------------------------------------------
  function renderDecisionTypes(papers) {
    const groups = new Map();
    for (const p of papers) {
      const dt = p.design_summary?.decision_type || "Other";
      if (!groups.has(dt)) groups.set(dt, { correct: 0, total: 0, papers: new Set() });
      const g = groups.get(dt);
      g.papers.add(p.doi);
      for (const c of p.comparisons || []) {
        if (c.modality && c.modality !== "text") continue;
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          g.total += 1;
          if (concl.startsWith("correct")) g.correct += 1;
        }
      }
    }
    const rows = [...groups.entries()]
      .map(([dt, g]) => ({ label: dt, rate: g.total ? g.correct / g.total : 0, n: g.total, papers: g.papers.size }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.rate - a.rate);
    renderRateBars(dtypeRoot, rows, "conclusion match");
  }

  // --------------------------------------------------------------------
  // Breakdown: by journal
  // --------------------------------------------------------------------
  function renderJournalBreakdown(papers) {
    const groups = new Map();
    for (const p of papers) {
      const j = p.journal || "Other";
      if (!groups.has(j)) groups.set(j, { correct: 0, total: 0, papers: new Set() });
      const g = groups.get(j);
      g.papers.add(p.doi);
      for (const c of p.comparisons || []) {
        if (c.modality && c.modality !== "text") continue;
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          g.total += 1;
          if (concl.startsWith("correct")) g.correct += 1;
        }
      }
    }
    const rows = [...groups.entries()]
      .map(([j, g]) => ({ label: j, rate: g.total ? g.correct / g.total : 0, n: g.total, papers: g.papers.size }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.rate - a.rate);
    renderRateBars(journalRoot, rows, "conclusion match");
  }

  // --------------------------------------------------------------------
  // Breakdown: by model (approximate generation ordering)
  // --------------------------------------------------------------------
  function renderModelBreakdown(papers) {
    const byModel = new Map();
    const papersByModel = new Map();
    for (const p of papers) {
      for (const c of p.comparisons || []) {
        if (c.modality && c.modality !== "text") continue;
        if (!byModel.has(c.model)) {
          byModel.set(c.model, { correct: 0, total: 0, fidSum: 0, fidN: 0 });
          papersByModel.set(c.model, new Set());
        }
        papersByModel.get(c.model).add(p.doi);
        const r = byModel.get(c.model);
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          r.total += 1;
          if (concl.startsWith("correct")) r.correct += 1;
        }
        for (const cond of c.conditions || []) {
          if (cond.fidelity != null) { r.fidSum += +cond.fidelity; r.fidN += 1; }
        }
      }
    }
    const rows = [...byModel.entries()]
      .map(([m, r]) => ({
        model: m,
        label: modelLabel(m),
        rate: r.total ? r.correct / r.total : null,
        fidelity: r.fidN ? r.fidSum / r.fidN : null,
        papers: papersByModel.get(m).size,
      }))
      .filter((r) => r.rate != null || r.fidelity != null)
      // order by approximate release
      .sort((a, b) => {
        const ai = MODEL_ORDER.indexOf(a.model);
        const bi = MODEL_ORDER.indexOf(b.model);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

    if (!rows.length) { modelgenRoot.innerHTML = `<p class="loading">No model data available.</p>`; return; }

    // Table: model × conclusion% × fidelity × papers
    modelgenRoot.innerHTML = `
      <table class="data-table" style="margin-top:0.5rem">
        <thead>
          <tr>
            <th>Model</th>
            <th class="num">Conclusion match</th>
            <th class="num">Fidelity</th>
            <th class="num">Papers</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${modelColor(r.model)};margin-right:8px;vertical-align:middle"></span>${escapeHtml(r.label)}</td>
              <td class="num">${r.rate != null ? Math.round(r.rate * 100) + "%" : "—"}</td>
              <td class="num">${r.fidelity != null ? (r.fidelity < 0 ? "−" : "") + Math.abs(r.fidelity).toFixed(2) : "—"}</td>
              <td class="num">${r.papers}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p style="font-size:0.78rem;color:var(--muted);margin-top:1rem;max-width:58ch">
        The current dataset only contains models released in 2024&ndash;2025
        — essentially one "generation" of frontier systems. As older and
        newer models get added, the trend will sharpen.
      </p>
    `;
  }

  // --------------------------------------------------------------------
  // Breakdown: text vs visual modality
  // --------------------------------------------------------------------
  function renderModalityBreakdown(papers) {
    const groups = new Map();
    const fidByModalityPM = new Map(); // modality -> [sum, n]
    for (const p of papers) {
      for (const c of p.comparisons || []) {
        const mod = c.modality || "text";
        if (!groups.has(mod)) groups.set(mod, { correct: 0, total: 0, papers: new Set() });
        const g = groups.get(mod);
        g.papers.add(p.doi);
        for (const pt of c.paper_tests || []) {
          const concl = (pt.conclusion || "").trim();
          if (!concl) continue;
          g.total += 1;
          if (concl.startsWith("correct")) g.correct += 1;
        }
        if (!fidByModalityPM.has(mod)) fidByModalityPM.set(mod, [0, 0]);
        const fm = fidByModalityPM.get(mod);
        for (const cond of c.conditions || []) {
          if (cond.fidelity != null) { fm[0] += +cond.fidelity; fm[1] += 1; }
        }
      }
    }
    const rows = [...groups.entries()].map(([mod, g]) => {
      const fm = fidByModalityPM.get(mod) || [0, 0];
      return {
        label: mod.charAt(0).toUpperCase() + mod.slice(1),
        rate: g.total ? g.correct / g.total : null,
        fidelity: fm[1] ? fm[0] / fm[1] : null,
        papers: g.papers.size,
      };
    }).filter((r) => r.rate != null || r.fidelity != null);

    if (!rows.length) { modalityRoot.innerHTML = `<p class="loading">No modality data.</p>`; return; }

    modalityRoot.innerHTML = `
      <table class="data-table" style="margin-top:0.5rem">
        <thead>
          <tr>
            <th>Modality</th>
            <th class="num">Conclusion match</th>
            <th class="num">Fidelity</th>
            <th class="num">Papers</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${escapeHtml(r.label)}</td>
              <td class="num">${r.rate != null ? Math.round(r.rate * 100) + "%" : "—"}</td>
              <td class="num">${r.fidelity != null ? (r.fidelity < 0 ? "−" : "") + Math.abs(r.fidelity).toFixed(2) : "—"}</td>
              <td class="num">${r.papers}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p style="font-size:0.78rem;color:var(--muted);margin-top:1rem;max-width:58ch">
        Current dataset has many more text runs than visual. As more visual
        papers are added, this comparison becomes more meaningful.
      </p>
    `;
  }

  // --------------------------------------------------------------------
  // Shared rate-bar renderer
  // --------------------------------------------------------------------
  function renderRateBars(root, rows, metricLabel) {
    if (!rows.length) { root.innerHTML = `<p class="loading">No data.</p>`; return; }
    const maxRate = Math.max(...rows.map((r) => r.rate), 0.01);
    root.innerHTML = `
      <div class="dtype-list">
        ${rows.map((r) => {
          const pct = Math.round(r.rate * 100);
          const barW = (r.rate / Math.max(maxRate, 1)) * 100;
          return `
            <div class="dtype-row">
              <div class="dtype-label">${escapeHtml(r.label)}</div>
              <div class="dtype-bar"><div class="dtype-bar-fill" style="width:${barW}%"></div></div>
              <div class="dtype-value"><strong>${pct}%</strong> · ${r.papers} paper${r.papers === 1 ? "" : "s"}</div>
            </div>
          `;
        }).join("")}
      </div>
      <p style="font-size:0.78rem;color:var(--muted);margin:1rem 0 0;max-width:58ch">
        Averaged across all models and all tests within each group. Higher =
        the simulation reaches the paper's own scientific conclusion more often.
      </p>
    `;
  }

  function truncateWords(s, max) {
    s = String(s).split(":")[0].trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + "…";
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
