/* =============================================================
   The Simulation Gap — shared site script
   - Highlights the active nav link
   - On the landing page, renders the live fidelity gauge from
     papers.json (clamped to [0, 1] for display, with the real
     number shown as text and a status line that flags below-random)
   ============================================================= */

(function () {
  const CACHE_BUST = `v=${Date.now()}`;

  // ---------- 1. Nav active state --------------------------------------
  const current = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach((a) => {
    const href = a.getAttribute("href").split("/").pop();
    if (href === current || (current === "" && href === "index.html")) {
      a.classList.add("is-active");
    }
  });

  // ---------- 2. Fidelity gauge ----------------------------------------
  const gaugeArcFilled = document.getElementById("gauge-filled-arc");
  const gaugeGapArc    = document.getElementById("gauge-gap-arc");
  const gaugeNumber    = document.getElementById("gauge-number");
  const gaugeStatus    = document.getElementById("gauge-status");
  const gaugeMarker    = document.getElementById("gauge-marker");
  const gaugeGapLabel  = document.getElementById("gauge-gap-label");
  const statsEl        = document.querySelector("[data-hero-stats]");

  const gaugePresent = !!(gaugeArcFilled || gaugeNumber || gaugeStatus);

  if (gaugePresent || statsEl) {
    fetch(`static/data/papers.json?${CACHE_BUST}`)
      .then((r) => r.json())
      .then((data) => {
        const s = computeStats(data);
        if (statsEl) {
          statsEl.innerHTML = [
            `<span>${s.nPapers} papers</span>`,
            `<span>${s.nExperiments} experiments</span>`,
            `<span>${s.nModels} AI models</span>`,
          ].join("");
        }
        if (gaugePresent) paintGauge(s.avgFidelity);
      })
      .catch((err) => {
        console.warn("Failed to load papers.json:", err);
        if (gaugePresent) paintGauge(null);
      });
  }

  /**
   * Paint the fidelity gauge given a raw fidelity value (can be
   * negative; we clamp for the arc but show the real number).
   */
  function paintGauge(rawF) {
    if (rawF == null) {
      if (gaugeNumber) gaugeNumber.textContent = "—";
      if (gaugeStatus) gaugeStatus.textContent = "no data";
      return;
    }
    const clamped = Math.max(0, Math.min(1, rawF));

    // Number in the center — show real value to 2 decimals (signed)
    if (gaugeNumber) {
      const sign = rawF < 0 ? "−" : "";
      gaugeNumber.textContent = `${sign}${Math.abs(rawF).toFixed(2)}`;
    }

    // Status line
    if (gaugeStatus) {
      if (rawF < 0)        gaugeStatus.textContent = "below random · start line";
      else if (rawF < 0.3) gaugeStatus.textContent = "early days · big gap";
      else if (rawF < 0.6) gaugeStatus.textContent = "partial · gap shrinking";
      else if (rawF < 0.9) gaugeStatus.textContent = "close · small gap";
      else                 gaugeStatus.textContent = "near perfect";
    }

    // Arc geometry: semicircle from (40,180) to (320,180), radius 140, center (180,180).
    // Fraction t ∈ [0, 1] maps to angle θ = π·(1 − t) measured from +x.
    const R = 140, CX = 180, CY = 180;
    const pointAt = (t) => {
      const theta = Math.PI * (1 - t);
      return {
        x: CX + R * Math.cos(theta),
        y: CY - R * Math.sin(theta),
      };
    };

    // Animated filled arc: stroke-dasharray + dashoffset trick.
    // We set --dash-target to 1000·(1 − F), the stylesheet animates to it.
    if (gaugeArcFilled) {
      const target = Math.max(0, 1000 * (1 - clamped));
      gaugeArcFilled.style.setProperty("--dash-target", String(target));
      // Restart animation: toggle class
      gaugeArcFilled.classList.remove("arc-filled");
      // Force reflow
      void gaugeArcFilled.getBoundingClientRect();
      gaugeArcFilled.classList.add("arc-filled");
    }

    // Gap arc: from (xF, yF) to (320, 180) along the same semicircle
    if (gaugeGapArc && clamped < 1) {
      const { x, y } = pointAt(clamped);
      gaugeGapArc.setAttribute("d", `M ${x.toFixed(2)} ${y.toFixed(2)} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`);
    } else if (gaugeGapArc) {
      gaugeGapArc.setAttribute("d", "");
    }

    // Marker dot at current fidelity position
    if (gaugeMarker) {
      const { x, y } = pointAt(clamped);
      gaugeMarker.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)})`);
    }

    // "the gap" callout at midpoint of the gap arc, nudged inside the ring
    // so it never clips above the viewBox.
    if (gaugeGapLabel) {
      if (clamped >= 0.92) {
        gaugeGapLabel.setAttribute("opacity", "0");
      } else {
        const tMid = (clamped + 1) / 2;
        const { x, y } = pointAt(tMid);
        // Push inward (toward center) so the label sits inside the ring
        const dx = CX - x, dy = CY - y;
        const mag = Math.sqrt(dx*dx + dy*dy) || 1;
        const push = 28;
        const lx = x + (dx / mag) * push;
        const ly = Math.max(y + (dy / mag) * push, 56);
        gaugeGapLabel.setAttribute("transform", `translate(${lx.toFixed(2)},${ly.toFixed(2)})`);
      }
    }
  }

  /**
   * Overall stats from papers.json.
   */
  function computeStats(entries) {
    const dois = new Set();
    const models = new Set();
    let nExperiments = 0;
    const fidByPM = new Map(); // "doi|model" -> [sum, n]

    for (const p of entries) {
      dois.add(p.doi);
      nExperiments += 1;
      for (const c of p.comparisons || []) {
        models.add(c.model);
        if (c.modality && c.modality !== "text") continue;
        const key = `${p.doi}|${c.model}`;
        if (!fidByPM.has(key)) fidByPM.set(key, [0, 0]);
        const entry = fidByPM.get(key);
        for (const cond of c.conditions || []) {
          if (cond.fidelity != null) {
            entry[0] += +cond.fidelity;
            entry[1] += 1;
          }
        }
      }
    }

    const fids = [];
    for (const [, [sum, n]] of fidByPM) if (n) fids.push(sum / n);
    const avgFidelity = fids.length ? fids.reduce((a, b) => a + b, 0) / fids.length : null;

    return {
      nPapers: dois.size,
      nExperiments,
      nModels: models.size,
      avgFidelity,
    };
  }
})();
