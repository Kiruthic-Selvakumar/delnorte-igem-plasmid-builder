// Automatic Design Mode -- Phase 1 UI.
//
// Loaded by index.html as a SEPARATE <script type="text/babel" src="..."> tag
// (same Babel-standalone, no-build-step mechanism index.html already uses for its
// own inline script), specifically so this file does not need to touch the
// existing App()/PartCombo script at all -- it only reads window.Automatic
// (set up by automatic/index.js via a <script type="module"> in index.html,
// mirroring the existing window.Designer pattern) and exposes itself back as
// window.AutomaticModeUI, which index.html's App() renders with <window.AutomaticModeUI/>
// when the user switches to Automatic Design mode. No PartCombo code is reused or
// modified here -- this is a deliberately simpler, independent local-part search
// box, since Phase 1 doesn't need PartCombo's floating-menu positioning logic.
//
// No literal DNA sequence appears anywhere in this file -- only descriptive
// placeholder text for the paste box.

(function () {
  const { useState, useMemo } = React;

  const COLORS = {
    bg: "#0f172a", card: "#1e293b", border: "#334155", text: "#e2e8f0",
    dim: "#94a3b8", faint: "#64748b", accent: "#0ea5e9", accent2: "#38bdf8",
    good: "#22c55e", bad: "#f87171", warn: "#fbbf24", placeholder: "#f97316",
  };

  const TYPE_OPTIONS = ["promoter", "operator", "rbs", "cds", "signal", "terminator", "marker", "origin", "orit", "other"];

  // Phase 6, item 12: low-risk exports. Pure browser download helper -- the
  // actual file CONTENT always comes from automatic/exportFormats.js (never
  // built here), this just triggers the save.
  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function Badge({ children, color }) {
    return (
      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, border: `1px solid ${color}55`, color, background: `${color}1a`, whiteSpace: "nowrap" }}>
        {children}
      </span>
    );
  }

  // Deliberately not PartCombo: a simpler, independent local-catalog search box
  // (no floating-menu positioning) -- adequate for Phase 1's scope.
  function LocalPartPicker({ db, onPick, selected, onClear }) {
    const [q, setQ] = useState("");
    const hits = useMemo(() => {
      if (!db || !q.trim()) return [];
      const s = q.trim().toLowerCase();
      return db.filter(p => p.name.toLowerCase().includes(s)).slice(0, 8);
    }, [db, q]);

    if (selected) {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6 }}>
          <span style={{ flex: 1, fontSize: 12, color: COLORS.accent2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.name}</span>
          <span style={{ fontSize: 10, color: COLORS.faint, whiteSpace: "nowrap" }}>{selected.length ? selected.length.toLocaleString() + " bp" : "—"}</span>
          <Badge color={selected.evidence === "verified" ? COLORS.good : COLORS.placeholder}>{selected.evidence}</Badge>
          <button onClick={onClear} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 15 }} title="Clear">×</button>
        </div>
      );
    }
    return (
      <div>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search the local catalog by name…"
          style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: "8px 10px", outline: "none" }}
        />
        {hits.length > 0 && (
          <div style={{ marginTop: 4, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, overflow: "hidden" }}>
            {hits.map(p => (
              <div key={p.id} onClick={() => { onPick(p); setQ(""); }}
                style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 10px", cursor: "pointer", borderBottom: `1px solid ${COLORS.border}` }}>
                <span style={{ flex: 1, fontSize: 12, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ fontSize: 10, color: COLORS.faint }}>{p.type}</span>
                <Badge color={p.evidence === "verified" ? COLORS.good : COLORS.placeholder}>{p.evidence}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const DIM_LABELS = {
    functionalCompleteness: "Functional completeness",
    assemblyFeasibility: "Assembly feasibility",
    verifiedPartSupport: "Verified-part support",
    architectureEvidence: "Architecture evidence",
    sequenceQuality: "Sequence quality (proxy)",
    registrySupport: "Registry/reference support",
  };

  function ScoreBar({ label, value, note }) {
    return (
      <div style={{ marginBottom: 6 }} title={note}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: COLORS.faint, marginBottom: 2 }}>
          <span>{label}</span>
          <span>{value === null ? "n/a" : `${Math.round(value * 100)}%`}</span>
        </div>
        <div style={{ height: 5, background: COLORS.bg, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: value === null ? "0%" : `${value * 100}%`, background: value === null ? COLORS.faint : COLORS.accent2 }} />
        </div>
      </div>
    );
  }

  // Phase 6, item 5: CANDIDATE COMPARISON MODE. Reuses window.Automatic.compareCandidates
  // (already used for #1-vs-#2) for arbitrary pairs, and the same
  // scoreCandidate() breakdown every CandidateCard already renders -- no new
  // biological prose is generated, only real, already-computed fields are
  // reformatted side by side.
  const COMPARE_ROLE_ROWS = [
    { role: "marker", label: "Marker" }, { role: "ori", label: "Origin" }, { role: "promoter", label: "Promoter" },
    { role: "rbs", label: "RBS" }, { role: "signal", label: "Signal" }, { role: "terminator", label: "Terminator" },
  ];

  function ComparisonPanel({ candidateA, candidateB, scoredA, scoredB }) {
    if (!candidateA || !candidateB || !scoredA || !scoredB) {
      return <div style={{ fontSize: 12, color: COLORS.faint }}>Select two valid candidates above to compare.</div>;
    }
    const partAt = (cand, role) => cand.plan.order.find(o => o.role === role) || null;
    const scalarRows = [
      { label: "Score", a: `${scoredA.overallScore}/100`, b: `${scoredB.overallScore}/100`, differs: scoredA.overallScore !== scoredB.overallScore },
      { label: "Total bp", a: candidateA.plan.totalLength.toLocaleString(), b: candidateB.plan.totalLength.toLocaleString(), differs: candidateA.plan.totalLength !== candidateB.plan.totalLength },
    ];
    const componentRows = COMPARE_ROLE_ROWS.map(({ role, label }) => {
      const pa = partAt(candidateA, role), pb = partAt(candidateB, role);
      return { label, a: pa ? pa.name : "—", b: pb ? pb.name : "—", differs: (pa ? pa.id : null) !== (pb ? pb.id : null) };
    });
    const tailRows = [
      { label: "Assembly", a: candidateA.assembly, b: candidateB.assembly, differs: candidateA.assembly !== candidateB.assembly },
      {
        label: "Registry support",
        a: (scoredA.registryComparison || []).length ? `${scoredA.registryComparison.length} match(es)` : "none",
        b: (scoredB.registryComparison || []).length ? `${scoredB.registryComparison.length} match(es)` : "none",
        differs: (scoredA.registryComparison || []).length !== (scoredB.registryComparison || []).length,
      },
    ];
    const allRows = [...scalarRows, ...componentRows, ...tailRows];
    const differingComponents = componentRows.filter(r => r.differs).map(r => r.label);

    const dimensionRows = Object.keys(scoredA.breakdown).map(dim => ({
      dim, label: DIM_LABELS[dim] || dim, a: scoredA.breakdown[dim], b: scoredB.breakdown[dim],
      weighted: !scoredA.weights || scoredA.weights[dim] > 0,
    }));

    const [winner, loser] = scoredA.overallScore >= scoredB.overallScore ? [scoredA, scoredB] : [scoredB, scoredA];
    const winnerLabel = winner === scoredA ? "Candidate A" : "Candidate B";
    const comparison = window.Automatic && window.Automatic.compareCandidates ? window.Automatic.compareCandidates(winner, loser) : null;

    return (
      <div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "4px 8px" }}></th>
                <th style={{ textAlign: "left", padding: "4px 8px", color: COLORS.text }}>Candidate A</th>
                <th style={{ textAlign: "left", padding: "4px 8px", color: COLORS.text }}>Candidate B</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map(r => (
                <tr key={r.label} style={{ background: r.differs ? `${COLORS.warn}14` : "transparent" }}>
                  <td style={{ padding: "4px 8px", color: COLORS.faint }}>{r.label}</td>
                  <td style={{ padding: "4px 8px", color: r.differs ? COLORS.warn : COLORS.dim, fontWeight: r.differs ? 700 : 400 }}>{r.a}</td>
                  <td style={{ padding: "4px 8px", color: r.differs ? COLORS.warn : COLORS.dim, fontWeight: r.differs ? 700 : 400 }}>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Score dimensions</div>
          {dimensionRows.map(d => (
            <div key={d.dim} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 2 }}>{d.label}{!d.weighted ? " (diagnostic, not weighted)" : ""}</div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}><ScoreBar label="A" value={d.a} /></div>
                <div style={{ flex: 1 }}><ScoreBar label="B" value={d.b} /></div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}`, fontSize: 12, color: COLORS.text, lineHeight: 1.6 }}>
          {differingComponents.length > 0 ? (
            <>
              <b>Candidate A differs from Candidate B in:</b>
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                {differingComponents.map(l => <li key={l} style={{ color: COLORS.warn }}>{l}</li>)}
              </ul>
            </>
          ) : (
            <div style={{ color: COLORS.dim }}>These two candidates use identical components at every compared role -- they differ only in the scalar fields above (if at all).</div>
          )}
          {comparison && <div style={{ marginTop: 8, color: COLORS.dim }}>{winnerLabel} ranks higher: {comparison.summary}</div>}
        </div>
      </div>
    );
  }

  // Phase 6, item 9: DESIGN AUDIT -- a lightweight summary of ALREADY-COMPUTED
  // validation/scoring/assembly/provenance/Registry-comparison output for the
  // recommended candidate. No new checks, no new engine -- every line here is
  // read off fields this project's own pipeline already produces.
  function DesignAuditPanel({ candidate, scored, anchorPart, host, partsById }) {
    const workspaceParts = window.Automatic && window.Automatic.buildWorkspaceParts
      ? window.Automatic.buildWorkspaceParts(candidate, { partsById, anchorPart })
      : [];
    const provenanceCounts = { project_verified: 0, registry_recorded: 0, user_supplied: 0, other: 0 };
    for (const p of workspaceParts) {
      if (p.provenanceStatus === "project_verified") provenanceCounts.project_verified++;
      else if (p.provenanceStatus === "registry_recorded") provenanceCounts.registry_recorded++;
      else if (p.provenanceStatus === "user_supplied") provenanceCounts.user_supplied++;
      else provenanceCounts.other++;
    }
    const ap = candidate.assemblyPlan;
    const anchorEntry = candidate.plan.order.find(o => o.id === (anchorPart ? anchorPart.id : undefined));
    const registryMatches = (scored && scored.registryComparison) || [];
    const uncertainties = [
      ...(candidate.validation.warnings || []),
      ...(registryMatches.length === 0 ? ["No exact Registry/reference construct match was found for this candidate."] : []),
    ];

    const Row = ({ ok, children }) => (
      <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 4 }}>
        <span style={{ color: ok ? COLORS.good : COLORS.warn, marginRight: 6 }}>{ok ? "✓" : "⚠"}</span>{children}
      </div>
    );

    return (
      <div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Constraints</div>
          <Row ok={candidate.validation.valid}>Required roles satisfied</Row>
          <Row ok={!!anchorEntry}>User anchor preserved{anchorPart ? ` (${anchorPart.name})` : ""}</Row>
          <Row ok={candidate.lockedComponentsCompatible !== false}>Locked components preserved{candidate.missingLockedRoles ? ` -- missing: ${candidate.missingLockedRoles.join(", ")}` : ""}</Row>
          <Row ok={!(candidate.validation.reasons || []).some(r => r.includes("host-ineligible"))}>Host checks passed{host ? ` (${host})` : ""}</Row>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Assembly</div>
          <Row ok={!!ap}>Method: {ap ? ap.method : "not computed"}</Row>
          {ap && <Row ok={ap.primerSupport}>Primer design {ap.primerSupport ? "supported for this method" : "not supported for this method (conflict-detection only)"}</Row>}
          {ap && <Row ok={ap.conflicts.length === 0}>{ap.conflicts.length === 0 ? "No restriction-site conflicts" : `${ap.conflicts.length} restriction-site conflict(s)`}</Row>}
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Evidence</div>
          <div style={{ fontSize: 12, color: COLORS.dim, lineHeight: 1.7 }}>
            Project-curated components: <b style={{ color: COLORS.text }}>{provenanceCounts.project_verified}</b><br />
            Registry-recorded components: <b style={{ color: COLORS.text }}>{provenanceCounts.registry_recorded}</b><br />
            User-supplied components: <b style={{ color: COLORS.text }}>{provenanceCounts.user_supplied}</b><br />
            Unknown-evidence components: <b style={{ color: COLORS.text }}>{provenanceCounts.other}</b>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>References</div>
          {registryMatches.length > 0 ? (
            <ul style={{ margin: "0 0 0 16px", padding: 0 }}>
              {registryMatches.slice(0, 3).map(r => (
                <li key={r.referenceId} style={{ fontSize: 12, color: COLORS.dim, marginBottom: 3 }}>{r.referenceId} ({r.title})</li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: COLORS.faint, fontStyle: "italic" }}>No Registry/reference match found for this candidate.</div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Uncertainties</div>
          {uncertainties.length > 0 ? (
            <ul style={{ margin: "0 0 0 16px", padding: 0 }}>
              {uncertainties.map((u, i) => <li key={i} style={{ fontSize: 12, color: COLORS.warn, marginBottom: 4, lineHeight: 1.5 }}>{u}</li>)}
            </ul>
          ) : (
            <div style={{ fontSize: 12, color: COLORS.faint }}>None flagged by validation for this candidate.</div>
          )}
        </div>
      </div>
    );
  }

  function CandidateCard({ c, scored, rank, robust, onUseDesign }) {
    const ok = c.validation.valid;
    return (
      <div style={{ border: `1px solid ${ok ? COLORS.border : "#7f1d1d"}`, borderLeft: `3px solid ${ok ? COLORS.good : COLORS.bad}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: ok ? "transparent" : "#2a0a0a" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.text }}>
            {rank ? `#${rank} ` : ""}{c.templateLabel}{c.variedSlot ? ` — swapped ${c.variedSlot.role}` : " — default"}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {scored && <Badge color={COLORS.accent2}>{scored.overallScore}/100</Badge>}
            {scored && scored.paretoOptimal && <Badge color={COLORS.good}>Pareto-optimal</Badge>}
            {scored && scored.eligibleForRecommendation === false && <Badge color={COLORS.warn}>comparison only</Badge>}
            <Badge color={ok ? COLORS.good : COLORS.bad}>{ok ? "valid" : "rejected"}</Badge>
          </div>
        </div>
        {scored && scored.eligibleForRecommendation === false && (
          <div style={{ fontSize: 10, color: COLORS.warn, marginBottom: 6 }}>
            {c.conflictingFamily && (
              <div>Documented as belonging to a different architecture family ({c.conflictingFamily}) than the one explicitly selected.</div>
            )}
            {c.lockedComponentsCompatible === false && (
              <div>Does not preserve the following locked component(s): {c.missingLockedRoles.join(", ")} -- this template's own default was used instead.</div>
            )}
            <div style={{ color: COLORS.faint, marginTop: 2 }}>Shown for comparison only -- excluded from the recommendation/Pareto/robustness competition.</div>
          </div>
        )}
        {robust && (
          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6 }}>
            Top-rank freq {(robust.topRankFrequency * 100).toFixed(0)}% · mean rank {robust.meanRank} (range {robust.bestRank}–{robust.worstRank})
          </div>
        )}
        <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 6, wordBreak: "break-word" }}>
          {c.plan.order.map(o => o.name).join(" → ") || "(no parts resolved)"}
        </div>
        <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 4 }}>
          {c.plan.totalLength.toLocaleString()} bp · GC {c.plan.gc}% · assembly {c.assembly}
        </div>
        {!ok && (
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
            {c.validation.reasons.map((r, i) => <li key={i} style={{ fontSize: 11, color: "#fca5a5", lineHeight: 1.5 }}>{r}</li>)}
          </ul>
        )}
        {c.validation.warnings.length > 0 && (
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
            {c.validation.warnings.map((w, i) => <li key={i} style={{ fontSize: 11, color: COLORS.warn, lineHeight: 1.5 }}>{w}</li>)}
          </ul>
        )}
        {scored && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
            {Object.keys(scored.breakdown).map(dim => {
              // Phase 4C.1 item 7: never silently show a dimension as if it counted
              // toward the score when its own weight is 0 -- label it as a diagnostic
              // explicitly, driven by the REAL weight value (not hardcoded to one dimension).
              const isWeighted = !scored.weights || scored.weights[dim] > 0;
              const label = (DIM_LABELS[dim] || dim) + (isWeighted ? "" : " (diagnostic, not weighted)");
              return <ScoreBar key={dim} label={label} value={scored.breakdown[dim]} note={scored.notes[dim]} />;
            })}
            {scored.paretoOptimal && scored.strongestIn.length > 0 && (
              <div style={{ fontSize: 10, color: COLORS.good, marginTop: 4 }}>Strongest in: {scored.strongestIn.map(d => DIM_LABELS[d] || d).join(", ")}</div>
            )}
            {!scored.paretoOptimal && scored.dominatedBy.length > 0 && (
              <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 4 }}>Dominated by: {scored.dominatedBy.join(", ")} (matched or worse on every scored dimension)</div>
            )}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Registry comparison</div>
              {scored.registryComparison && scored.registryComparison.length > 0 ? (
                scored.registryComparison.map(r => (
                  <div key={r.referenceId} style={{ fontSize: 10, color: COLORS.dim, marginBottom: 4, lineHeight: 1.5 }}>
                    <b>{r.referenceId}</b> ({r.title}) — role-order similarity {(r.roleOrderSimilarity * 100).toFixed(0)}%, chassis {r.chassisAgreement}
                    {r.sharedExactParts.length > 0 && `, shared: ${r.sharedExactParts.join(", ")}`}
                    {" · "}<a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.accent2 }}>source</a>
                  </div>
                ))
              ) : (
                // Phase 6, item 11: explicit, not hidden, and never implied to be
                // evidence the design is bad -- absence of a Registry match is a
                // provenance fact, not a quality penalty (nothing here affects score).
                <div style={{ fontSize: 10, color: COLORS.faint, fontStyle: "italic" }}>No Registry/reference match found for this candidate.</div>
              )}
            </div>
          </div>
        )}
        {c.validation.valid && onUseDesign && (
          <button onClick={() => onUseDesign(c)}
            style={{ marginTop: 10, width: "100%", padding: "8px", background: "linear-gradient(90deg,#166534,#22c55e)", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            ✅ Use This Design
          </button>
        )}
      </div>
    );
  }

  const MAP_TYPE_COLORS = {
    promoter: "#4ade80", operator: "#22d3ee", rbs: "#fbbf24", cds: "#60a5fa", signal: "#f472b6",
    terminator: "#f87171", marker: "#c084fc", origin: "#fb923c", orit: "#a3e635", other: "#64748b",
  };

  function MapLegend({ segments }) {
    const typesPresent = [...new Set(segments.map(s => s.type))];
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
        {typesPresent.map(t => (
          <div key={t} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.faint }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: MAP_TYPE_COLORS[t] || "#64748b", display: "inline-block" }} />
            {t}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.faint }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px solid #fff", display: "inline-block" }} /> ★ user anchor
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.faint }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", border: `1.5px dashed ${COLORS.accent2}`, display: "inline-block" }} /> locked component
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.faint }}>
          <span style={{ width: 8, height: 8, background: COLORS.bad, display: "inline-block" }} /> restriction-site conflict
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: COLORS.faint }}>
          <span style={{ width: 8, height: 8, background: "#fff", display: "inline-block" }} /> assembly junction
        </div>
      </div>
    );
  }

  // Interactive circular plasmid map -- no visualization library, plain SVG.
  // Segment geometry (bp offsets, type, provenance, registry match, restriction
  // conflicts) comes ENTIRELY from automatic/plasmidMapData.js's
  // computePlasmidMapSegments() (Phase 4B) -- nothing here is recomputed
  // independently, so this component only draws whatever that pure, unit-tested
  // module returns. Every arc is drawn as a forward-pointing (5'->3') arrow
  // because designer.js's assembly model concatenates every part in one
  // forward orientation -- there is no per-part reverse-strand representation
  // anywhere in this codebase's data model, so no orientation is invented here;
  // this IS the actual (simplified) ground truth of how assembly works today.
  // Phase 6, item 4B: greedy angular collision avoidance for outside-the-circle
  // leader-line labels -- assigns each segment a "tier" (0 = closest ring of
  // labels, 1 = next ring out, ...) so two angularly-close small features
  // never render overlapping text. Pure/deterministic: same segment angles
  // always produce the same tier assignment. Does not touch segment geometry
  // (arc start/end) at all -- only where each label's TEXT is drawn.
  function assignLabelTiers(segsWithMid, minGapDeg, maxTiers) {
    const sorted = [...segsWithMid].sort((a, b) => a.mid - b.mid);
    const lastAngleByTier = [];
    const tierOf = new Map();
    for (const s of sorted) {
      let tier = 0;
      while (tier < maxTiers - 1 && lastAngleByTier[tier] !== undefined && Math.abs(s.mid - lastAngleByTier[tier]) < minGapDeg) tier++;
      lastAngleByTier[tier] = s.mid;
      tierOf.set(s.index, tier);
    }
    return tierOf;
  }

  function PlasmidCircularMap({ candidate, scored, partsById, anchorName, anchorPart, assemblyPlan, lockedRoleSet, onLockComponent, onShowAlternatives, centerInfo }) {
    const [active, setActive] = useState(null); // {kind:"part", seg} | {kind:"junction", seg, prevSeg} | null
    const mapData = window.Automatic && window.Automatic.computePlasmidMapSegments
      ? window.Automatic.computePlasmidMapSegments(candidate, { partsById, anchorName, anchorPart, scored })
      : null;
    if (!mapData || !mapData.totalBp || !mapData.segments.length) return <div style={{ fontSize: 11, color: COLORS.faint }}>Nothing to draw yet.</div>;
    const { totalBp: total, segments } = mapData;

    const W = 460, cx = 230, cy = 230, R = 138, r = 88;
    const pt = (radius, deg) => { const rad = (deg - 90) * Math.PI / 180; return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)]; };

    const segs = segments.map(s => ({ ...s, a0: s.angleStart, a1: s.angleEnd, color: MAP_TYPE_COLORS[s.type] || "#64748b" }));
    // Phase 6, item 4B: outside-the-circle labels with leader lines,
    // collision-avoided by angular tier rather than hidden/overlapped.
    const LABEL_TIER_GAP = 15, LABEL_BASE_OFFSET = 16, LABEL_MIN_GAP_DEG = 11, LABEL_MAX_TIERS = 3;
    const labelTierBySegIndex = assignLabelTiers(segs.map(s => ({ index: s.index, mid: s.a0 + (s.a1 - s.a0) / 2 })), LABEL_MIN_GAP_DEG, LABEL_MAX_TIERS);

    return (
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <svg viewBox={`0 0 ${W} ${W}`} style={{ width: 360, flexShrink: 0 }}>
            {segs.map(sg => {
              const sw = sg.a1 - sg.a0;
              const mid = sg.a0 + sw / 2;
              const [x1, y1] = pt(R, sg.a0), [x2, y2] = pt(R, sg.a1);
              const [xi1, yi1] = pt(r, sg.a0), [xi2, yi2] = pt(r, sg.a1);
              const lg = sw > 180 ? 1 : 0;
              const d = `M${x1} ${y1} A${R} ${R} 0 ${lg} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${lg} 0 ${xi1} ${yi1}Z`;
              // Directional (5'->3') chevron notch cut INTO the band near its
              // 3' end -- every segment is forward in this project's own
              // assembly model (see this component's header), so the chevron
              // always points the same rotational direction; no orientation
              // is invented, this only makes the model's own existing
              // "always forward" fact visually legible as an arrow.
              const midR = (R + r) / 2;
              const notchDeg = Math.min(sw * 0.35, 3.2);
              const [ax, ay] = pt(R - 2, sg.a1 - notchDeg);
              const [bx, by] = pt(midR, sg.a1);
              const [cx2, cy2] = pt(R - 2, sg.a1 + notchDeg);
              const [ax2, ay2] = pt(r + 2, sg.a1 - notchDeg);
              const [cx3, cy3] = pt(r + 2, sg.a1 + notchDeg);
              const isActive = active && active.kind === "part" && active.seg.index === sg.index;
              const strokeColor = sg.isAnchor ? "#fff" : (sg.isLocked ? COLORS.accent2 : COLORS.bg);
              const dash = (!sg.isAnchor && sg.isLocked) ? "3,2" : undefined;

              // Phase 6, item 4B: leader-line label OUTSIDE the ring, tiered
              // to avoid collisions with angularly-close neighbors (see
              // assignLabelTiers) -- shown for every segment, never only the
              // "big enough" ones, so nothing is silently unlabeled.
              const tier = labelTierBySegIndex.get(sg.index) || 0;
              const labelR = R + LABEL_BASE_OFFSET + tier * LABEL_TIER_GAP;
              const [lx, ly] = pt(labelR, mid);
              const [leaderOuterX, leaderOuterY] = pt(R + 2, mid);
              const [leaderInnerX, leaderInnerY] = pt(labelR - 6, mid);
              const labelOnRight = lx >= cx;
              const displayName = sg.name.length > 16 ? sg.name.slice(0, 14) + "…" : sg.name;

              return (
                <g key={sg.index}>
                  <g style={{ cursor: "pointer" }} onMouseEnter={() => setActive({ kind: "part", seg: sg })} onClick={() => setActive({ kind: "part", seg: sg })}>
                    <path d={d} fill={sg.color} stroke={strokeColor} strokeWidth={sg.isAnchor || sg.isLocked ? 2.5 : 1.5} strokeDasharray={dash} opacity={isActive ? 1 : sg.isAnchor ? 0.98 : 0.88} />
                    {sw > 4 && <path d={`M${ax} ${ay} L${bx} ${by} L${cx2} ${cy2} L${cx3} ${cy3} L${ax2} ${ay2} Z`} fill={COLORS.bg} opacity="0.55" />}
                    {sg.isAnchor && (() => { const [sx, sy] = pt((R + r) / 2, mid); return <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#fff">★</text>; })()}
                  </g>
                  {/* leader line + outside label, per item 4B -- collision-tiered, never overlapping */}
                  <line x1={leaderOuterX} y1={leaderOuterY} x2={leaderInnerX} y2={leaderInnerY} stroke={COLORS.faint} strokeWidth="0.75" opacity="0.7" />
                  <text x={lx} y={ly} textAnchor={labelOnRight ? "start" : "end"} dominantBaseline="middle" fontSize="8" fill={isActive ? COLORS.accent2 : COLORS.text} fontFamily="system-ui" style={{ cursor: "pointer" }}
                    onMouseEnter={() => setActive({ kind: "part", seg: sg })} onClick={() => setActive({ kind: "part", seg: sg })}>
                    {displayName}{sg.isAnchor ? " (anchor)" : sg.isLocked ? " (locked)" : ""}
                  </text>
                  {/* restriction-site conflict markers -- real positions from plasmidMapData's restrictionConflicts (scanSites(), unmodified) */}
                  {sg.restrictionConflicts.map((c, ci) => {
                    const frac = sg.length ? c.position / sg.length : 0;
                    const [mx, my] = pt(R + 4, sg.a0 + frac * sw);
                    return <circle key={ci} cx={mx} cy={my} r={2.4} fill={COLORS.bad} stroke={COLORS.bg} strokeWidth={0.6} />;
                  })}
                  {/* assembly-junction indicator at this segment's 5' boundary (junction with the previous segment) */}
                  {(() => {
                    const prevSeg = segs[(sg.index - 1 + segs.length) % segs.length];
                    const [jx1, jy1] = pt(r - 2, sg.a0), [jx2, jy2] = pt(R + 2, sg.a0);
                    const isJActive = active && active.kind === "junction" && active.seg.index === sg.index;
                    return (
                      <line x1={jx1} y1={jy1} x2={jx2} y2={jy2} stroke="#fff" strokeWidth={isJActive ? 2 : 1} opacity={isJActive ? 1 : 0.55}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setActive({ kind: "junction", seg: sg, prevSeg })}
                        onClick={() => setActive({ kind: "junction", seg: sg, prevSeg })} />
                    );
                  })()}
                </g>
              );
            })}
            <circle cx={cx} cy={cy} r={r - 1} fill={COLORS.bg} />
            {/* Phase 6, item 4C: compact center summary -- candidate #, bp, host, goal, score */}
            <text x={cx} y={cy - 26} textAnchor="middle" fontSize="12" fontWeight="700" fill={COLORS.text} fontFamily="system-ui">{centerInfo && centerInfo.rank ? `Candidate #${centerInfo.rank}` : mapData.label}</text>
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize="13" fontWeight="700" fill={COLORS.accent2} fontFamily="system-ui">{total.toLocaleString()} bp</text>
            {centerInfo && centerInfo.host && <text x={cx} y={cy + 6} textAnchor="middle" fontSize="10" fill={COLORS.dim} fontFamily="system-ui">{centerInfo.host}</text>}
            {centerInfo && centerInfo.goalLabel && <text x={cx} y={cy + 20} textAnchor="middle" fontSize="9" fill={COLORS.faint} fontFamily="system-ui">{centerInfo.goalLabel}</text>}
            {centerInfo && typeof centerInfo.score === "number" && <text x={cx} y={cy + 34} textAnchor="middle" fontSize="11" fontWeight="700" fill={COLORS.good} fontFamily="system-ui">{centerInfo.score}/100</text>}
          </svg>
          <MapLegend segments={segs} />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          {active && active.kind === "part" ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>
                {active.seg.name}
                {active.seg.isAnchor && <span style={{ marginLeft: 6 }}><Badge color={COLORS.accent2}>USER ANCHOR</Badge></span>}
                {!active.seg.isAnchor && active.seg.isLocked && <span style={{ marginLeft: 6 }}><Badge color={COLORS.accent2}>LOCKED</Badge></span>}
              </div>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 4 }}>Role: <b>{active.seg.role}</b> ({active.seg.type})</div>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 4 }}>bp {active.seg.start.toLocaleString()}–{active.seg.end.toLocaleString()} ({active.seg.length.toLocaleString()} bp)</div>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 4 }}>
                {/* Phase 4C: provenanceStatus (project_verified/registry_recorded/user_supplied/placeholder) is
                    the build-CONFIDENCE axis hard validation actually gates on -- shown as the primary badge.
                    `evidence` (this project's raw catalog verified/placeholder field) and `provenance`
                    (WHICH retrieval tier found this part) are related but separate axes, shown alongside. */}
                Provenance: {active.seg.provenanceStatus
                  ? <Badge color={active.seg.provenanceStatus === "project_verified" ? COLORS.good : active.seg.provenanceStatus === "placeholder" ? COLORS.bad : COLORS.placeholder}>{active.seg.provenanceStatus}</Badge>
                  : <span style={{ color: COLORS.faint }}>no catalog record (gap)</span>}
                {active.seg.provenance && <span style={{ marginLeft: 6, color: COLORS.faint }}>(retrieval: {active.seg.provenance.replace(/_/g, " ")})</span>}
              </div>
              {active.seg.registryMatch && (
                <div style={{ fontSize: 11, color: COLORS.good, marginBottom: 4 }}>Registry exact match: <b>{active.seg.registryMatch.registryId}</b> ({active.seg.registryMatch.registryTitle})</div>
              )}
              {active.seg.restrictionConflicts.length > 0 && (
                <div style={{ fontSize: 11, color: COLORS.bad, marginBottom: 4 }}>
                  {active.seg.restrictionConflicts.length} internal restriction site(s): {active.seg.restrictionConflicts.map(c => `${c.enzyme}@${c.position}`).join(", ")}
                </div>
              )}
              {active.seg.provenanceStatus === "placeholder" && (
                <div style={{ fontSize: 11, color: COLORS.warn, marginTop: 6 }}>⚠️ Not resolved to this project's own verification standard -- hard-rejected if present in a candidate.</div>
              )}
              {active.seg.provenanceStatus === "registry_recorded" && (
                <div style={{ fontSize: 11, color: COLORS.warn, marginTop: 6 }}>ℹ️ Sequence and role come from a real cached iGEM Registry record, not this project's own verification. Registry presence is not biological/wet-lab validation.</div>
              )}
              {active.seg.provenanceStatus === "user_supplied" && (
                <div style={{ fontSize: 11, color: COLORS.warn, marginTop: 6 }}>ℹ️ A syntactically valid DNA sequence was supplied by the user; it has not been independently verified by this project.</div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {onLockComponent && active.seg.id && !active.seg.isAnchor && !active.seg.isLocked && !(lockedRoleSet && lockedRoleSet.has(active.seg.role)) && (
                  <button onClick={() => onLockComponent({ role: active.seg.role, partId: active.seg.id, partName: active.seg.name })}
                    style={{ marginTop: 8, fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${COLORS.accent2}`, background: "transparent", color: COLORS.accent2, cursor: "pointer" }}>
                    🔒 Lock this component for the next run
                  </button>
                )}
                {/* Phase 6, item 4G: only shown when there is a REAL backend
                    capability behind it -- generateCandidates()'s own
                    single-slot-swap search already produces alternative
                    resolutions for a role; this just filters the existing
                    candidate list to them, no new computation. */}
                {onShowAlternatives && (
                  <button onClick={() => onShowAlternatives(active.seg.role)}
                    style={{ marginTop: 8, fontSize: 11, padding: "5px 10px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.dim, cursor: "pointer" }}>
                    🔀 Show alternatives for this role
                  </button>
                )}
              </div>
            </div>
          ) : active && active.kind === "junction" ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>Junction: {active.prevSeg.name} → {active.seg.name}</div>
              {assemblyPlan && assemblyPlan.primerSupport && assemblyPlan.primers[active.seg.index] && assemblyPlan.primers[active.prevSeg.index] ? (() => {
                // The junction between prevSeg and seg is governed by TWO primers (designer.js#gibsonPrimers):
                // seg's own forward primer (anneals into seg, its 5' tail overlaps prevSeg), and prevSeg's own
                // reverse primer (anneals into prevSeg, its 5' tail overlaps seg) -- NOT seg's reverse primer,
                // which instead governs the NEXT junction (with the following segment).
                const fwd = assemblyPlan.primers[active.seg.index];
                const rev = assemblyPlan.primers[active.prevSeg.index];
                return (
                  <div style={{ fontSize: 11, color: COLORS.dim, lineHeight: 1.6 }}>
                    <div>Forward primer (amplifies {active.seg.name}, tail overlaps {active.prevSeg.name}): Tm {fwd.fwd_tm}°C</div>
                    <div>Reverse primer (amplifies {active.prevSeg.name}, tail overlaps {active.seg.name}): Tm {rev.rev_tm}°C</div>
                    <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 9, color: COLORS.faint, wordBreak: "break-all" }}>{fwd.fwd}</div>
                  </div>
                );
              })() : (
                <div style={{ fontSize: 11, color: COLORS.faint }}>
                  {assemblyPlan
                    ? (assemblyPlan.primerSupport
                      ? (assemblyPlan.missingSequenceParts && assemblyPlan.missingSequenceParts.length
                        // Phase 4C.1, item 6: name the EXACT part(s) and reason, not a vague "a resolved part here".
                        ? `No per-junction primer available: ${assemblyPlan.missingSequenceParts.map(m => `"${m.name}" (${m.reason})`).join("; ")}.`
                        : "No per-junction primer available for this junction.")
                      : `No per-junction primer available for method "${assemblyPlan.method}" -- this method has conflict-detection support only, see assembly rationale below.`)
                    : "Assembly plan not computed."}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: COLORS.faint }}>Hover or click a segment for part details, or a white tick for junction/primer details. The user's anchor part is outlined in solid white; other locked components are dashed.</div>
          )}
        </div>
      </div>
    );
  }

  // Phase 5B, item 8: a small, self-contained registration form used both for
  // the primary anchor and (via the "additional locked components" section)
  // for any other custom part -- both call the SAME registerCustomPart(spec)
  // function, so id generation/duplicate detection is shared and consistent
  // no matter which slot a custom part is registered for.
  function CustomPartRegistrationForm({ registry, fixedRole, onRegistered, submitLabel }) {
    const [name, setName] = useState("");
    const [seq, setSeq] = useState("");
    const [role, setRole] = useState(fixedRole || "cds");
    const [sourceTeam, setSourceTeam] = useState("");
    const [description, setDescription] = useState("");
    const [hostNote, setHostNote] = useState("");
    const [errors, setErrors] = useState([]);

    const submit = () => {
      const hosts = hostNote.trim() ? { [hostNote.trim()]: { supported: true, note: "As declared by the user at registration; not independently verified by this project." } } : {};
      const res = registry.registerCustomPart({ name, seq, role, sourceTeam: sourceTeam || undefined, description: description || undefined, hosts });
      if (!res.ok) { setErrors(res.errors); return; }
      setErrors([]);
      onRegistered(res.part);
    };

    return (
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Part name (e.g. MyTeam_PkatA)"
            style={{ flex: "1 1 200px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }} />
          {!fixedRole && (
            <select value={role} onChange={e => setRole(e.target.value)}
              style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }}>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        <textarea value={seq} onChange={e => setSeq(e.target.value)} rows={4} placeholder="Paste this part's DNA sequence (A/C/G/T only)…"
          style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.accent2, fontSize: 11, fontFamily: "monospace", padding: 8, resize: "vertical", outline: "none" }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input value={sourceTeam} onChange={e => setSourceTeam(e.target.value)} placeholder="Source team/label (optional)"
            style={{ flex: "1 1 160px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }} />
          <input value={hostNote} onChange={e => setHostNote(e.target.value)} placeholder="Known host/chassis (optional, not verified)"
            style={{ flex: "1 1 160px", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }} />
        </div>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)"
          style={{ width: "100%", marginTop: 8, background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }} />
        {errors.length > 0 && (
          <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
            {errors.map((e, i) => <li key={i} style={{ color: "#fca5a5", fontSize: 11, lineHeight: 1.5 }}>{e}</li>)}
          </ul>
        )}
        <button onClick={submit} disabled={!name.trim() || !seq.trim()}
          style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, border: "none", fontSize: 12, fontWeight: 700, cursor: name.trim() && seq.trim() ? "pointer" : "default",
            background: name.trim() && seq.trim() ? COLORS.accent : COLORS.border, color: "#fff" }}>
          {submitLabel || "Register & Use as Anchor"}
        </button>
      </div>
    );
  }

  // Compact confirmation card, per the Phase 5B spec's own example format:
  // "MyTeam_PkatA / promoter / 123 bp / user supplied / sequence resolved / locked anchor".
  function CustomPartConfirmationCard({ part, onChange, lockedLabel }) {
    const cls = window.Automatic && window.Automatic.classifyProvenance ? window.Automatic.classifyProvenance(part) : { provenanceStatus: "user_supplied", sequenceStatus: "resolved" };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: COLORS.bg, border: `1px solid ${COLORS.accent2}`, borderRadius: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: COLORS.accent2, fontWeight: 700 }}>{part.name}</span>
        <Badge color={COLORS.accent2}>{part.type}</Badge>
        <span style={{ fontSize: 11, color: COLORS.faint }}>{part.length.toLocaleString()} bp</span>
        <Badge color={COLORS.placeholder}>{cls.provenanceStatus}</Badge>
        <Badge color={COLORS.good}>{cls.sequenceStatus}</Badge>
        <Badge color={COLORS.good}>{lockedLabel || "locked anchor"}</Badge>
        {onChange && <button onClick={onChange} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 11 }}>Change</button>}
      </div>
    );
  }

  function AutomaticModeUI({ db, templates, partsById, onUseDesign }) {
    const { useEffect } = React;
    const [inputKind, setInputKind] = useState("search"); // "search" | "register"
    const [selectedPart, setSelectedPart] = useState(null);
    const [customAnchorPart, setCustomAnchorPart] = useState(null); // Phase 5B: a registerCustomPart() result
    const [host, setHost] = useState("");
    const [goal, setGoal] = useState("");
    const [goalFamily, setGoalFamily] = useState("");
    const [assemblyMethod, setAssemblyMethod] = useState("gibson");
    const [lockedExtras, setLockedExtras] = useState([]); // [{role, partId, partName} | {role, customPart, partName}], Phase 4B Step 4/9, extended Phase 5B item 6
    const [extraRole, setExtraRole] = useState("cds");
    const [extraPart, setExtraPart] = useState(null);
    const [extraKind, setExtraKind] = useState("search"); // "search" | "register" -- Phase 5B item 6
    const [result, setResult] = useState(null);
    const [registryCache, setRegistryCache] = useState(null);
    const [mapCandidateId, setMapCandidateId] = useState(null);
    const [highlightRole, setHighlightRole] = useState(null); // Phase 6, item 4G: "show alternatives for this role"
    const [compareIds, setCompareIds] = useState([]); // Phase 6, item 5: up to 2 candidateIds selected for comparison
    const [showComparison, setShowComparison] = useState(false);
    // One shared session-local custom-part registry (Phase 5B item 7) for BOTH
    // the anchor and any additional locked components, so id generation and
    // duplicate-by-sequence+role detection is consistent across the whole
    // design session -- never written to data/parts.json.
    const customRegistry = useMemo(() => (window.Automatic && window.Automatic.createCustomPartRegistry ? window.Automatic.createCustomPartRegistry() : null), []);

    // Optional: a small curated snapshot of real iGEM Registry records (see
    // data/registry_cache.json's own provenance field). Absent/unfetchable ->
    // registryCache stays null and runAutomaticDesign() falls back to its
    // EMPTY_REGISTRY default (registrySupport simply scores null everywhere),
    // exactly like Template-Guided Mode degrading gracefully on a load error.
    useEffect(() => {
      let cancelled = false;
      fetch("./data/registry_cache.json", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (!cancelled && j) setRegistryCache(j); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, []);

    const hostOptions = useMemo(() => (templates ? [...new Set(templates.map(t => t.host))] : []), [templates]);
    const supportedFamilies = useMemo(() => (host && window.Automatic ? window.Automatic.getSupportedFamiliesForHost(host) : []), [host]);
    const roleOptions = window.Automatic ? window.Automatic.CANONICAL_ROLE_ORDER : ["ori", "rep", "orit", "ori_shuttle", "marker", "promoter", "rbs", "signal", "cds", "reporter", "terminator"];
    const assemblyMethodOptions = window.Automatic ? window.Automatic.SUPPORTED_ASSEMBLY_METHODS : ["gibson", "goldengate"];
    // Mirrors characterizeInput.js's own role resolution so the UI never lets
    // a locked extra collide with whatever role the anchor will actually
    // resolve to. A registered custom part's own declared `type` is always
    // authoritative (Phase 5B) -- never overridden the way a catalog part's
    // type can be by an explicit paste-mode role.
    const primaryRole = inputKind === "search" ? (selectedPart ? selectedPart.type : null) : (customAnchorPart ? customAnchorPart.type : null);
    const lockedRoleSet = useMemo(() => new Set(lockedExtras.map(l => l.role)), [lockedExtras]);

    const run = (extraLocked) => {
      if (!window.Automatic || !templates || !partsById) return;
      const allLocked = extraLocked ? [...lockedExtras, extraLocked] : lockedExtras;
      const opts = {
        host, goal, partsById, templates, maxCandidates: 6, registryCache: registryCache || undefined,
        assemblyMethod, goalFamily: goalFamily || undefined,
        additionalLockedComponents: allLocked.length
          ? allLocked.map(({ role: r, partId, customPart }) => customPart ? { role: r, customPart } : { role: r, partId })
          : undefined,
      };
      if (inputKind === "search" && selectedPart) opts.partId = selectedPart.id;
      else if (inputKind === "register" && customAnchorPart) opts.customPart = customAnchorPart;
      setMapCandidateId(null);
      setResult(window.Automatic.runAutomaticDesign(opts));
      if (extraLocked) setLockedExtras(allLocked);
    };

    const addLockedExtra = () => {
      if (!extraPart || extraRole === primaryRole) return;
      setLockedExtras(prev => [...prev.filter(l => l.role !== extraRole), { role: extraRole, partId: extraPart.id, partName: extraPart.name }]);
      setExtraPart(null);
    };
    const addLockedExtraCustom = (part) => {
      setLockedExtras(prev => [...prev.filter(l => l.role !== part.type), { role: part.type, customPart: part, partName: part.name }]);
    };
    const removeLockedExtra = (r) => setLockedExtras(prev => prev.filter(l => l.role !== r));
    const lockFromMap = ({ role: r, partId, partName }) => {
      if (r === primaryRole) return; // already locked as the primary anchor -- never duplicate
      setLockedExtras(prev => [...prev.filter(l => l.role !== r), { role: r, partId, partName }]);
    };

    // Phase 6, item 3: bundle everything App()'s handoff needs (the
    // candidate itself, the real anchor part object, host, and assembly
    // method) into one payload -- App() does the actual state assignment
    // into Template-Guided's existing parts/host/result/mode state via
    // window.Automatic.buildWorkspaceHandoff(), never reimplemented here.
    const handleUseDesign = (candidate) => {
      if (!onUseDesign || !result) return;
      onUseDesign({
        candidate,
        anchorPart: result.characterized.input.anchorPart,
        host: result.characterized.input.host,
        assemblyMethod,
        partsById,
      });
    };

    // Phase 6, item 12: export the RECOMMENDED candidate. File content is
    // always produced by automatic/exportFormats.js -- this only wires the
    // browser download.
    const exportCandidate = (candidate, kind) => {
      if (!candidate || !window.Automatic || !result) return;
      const ctx = { partsById, anchorPart: result.characterized.input.anchorPart, host: result.characterized.input.host, candidateLabel: candidate.candidateId };
      if (kind === "fasta") downloadText(`${candidate.candidateId}.fasta`, window.Automatic.exportFASTA(candidate, ctx), "text/plain");
      else if (kind === "json") downloadText(`${candidate.candidateId}.json`, JSON.stringify(window.Automatic.exportJSONReport(result, candidate, ctx), null, 2), "application/json");
      else if (kind === "genbank") downloadText(`${candidate.candidateId}.gb`, window.Automatic.exportGenBank(candidate, ctx), "text/plain");
    };

    if (!db || !templates) return <div style={{ color: COLORS.dim, fontSize: 12, padding: 12 }}>Loading catalog…</div>;

    return (
      <div>
        <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Anchor biological part</div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[["search", "Use Project Catalog"], ["register", "Register Custom Part"]].map(([id, label]) => (
              <button key={id} onClick={() => { setInputKind(id); setResult(null); }}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${COLORS.border}`, cursor: "pointer", fontSize: 11,
                  background: inputKind === id ? COLORS.accent : "transparent", color: inputKind === id ? "#fff" : COLORS.dim }}>
                {label}
              </button>
            ))}
          </div>

          {inputKind === "search" && (
            <LocalPartPicker db={db} selected={selectedPart} onPick={p => { setSelectedPart(p); setResult(null); }} onClear={() => setSelectedPart(null)} />
          )}

          {inputKind === "register" && (
            customAnchorPart ? (
              <CustomPartConfirmationCard part={customAnchorPart} onChange={() => { setCustomAnchorPart(null); setResult(null); }} />
            ) : customRegistry ? (
              <CustomPartRegistrationForm registry={customRegistry} onRegistered={p => { setCustomAnchorPart(p); setResult(null); }} />
            ) : (
              <div style={{ fontSize: 11, color: COLORS.bad }}>./automatic/index.js did not load -- custom part registration is unavailable.</div>
            )
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 5 }}>HOST / CHASSIS</div>
              <select value={host} onChange={e => { setHost(e.target.value); setResult(null); }}
                style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }}>
                <option value="">select a host…</option>
                {hostOptions.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 5 }}>DESIGN GOAL / PURPOSE (free text)</div>
              <input value={goal} onChange={e => { setGoal(e.target.value); setResult(null); }} placeholder="e.g. constitutive reporter expression"
                disabled={!!goalFamily}
                style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: goalFamily ? COLORS.faint : COLORS.text, fontSize: 12, padding: 8 }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 5 }}>OR: STRUCTURED DESIGN GOAL (overrides free text; only options this project can actually back for the selected host are listed)</div>
              <select value={goalFamily} onChange={e => { setGoalFamily(e.target.value); setResult(null); }} disabled={!host}
                style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }}>
                <option value="">(use free-text goal above)</option>
                {supportedFamilies.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              {host && supportedFamilies.length === 0 && (
                <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 4 }}>No structured design-goal family is currently backed by project data for {host} — free text only.</div>
              )}
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 5 }}>ASSEMBLY METHOD</div>
              <select value={assemblyMethod} onChange={e => { setAssemblyMethod(e.target.value); setResult(null); }}
                style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 12, padding: 8 }}>
                {assemblyMethodOptions.map(m => <option key={m} value={m}>{m}{m === "goldengate" ? " (conflict-detection only, no primer design — see rationale after running)" : ""}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
            {/* Phase 6, item 7: same underlying additionalLockedComponents mechanism,
                friendlier heading/copy only -- nothing renamed on the backend. */}
            <div style={{ fontSize: 11, color: COLORS.text, fontWeight: 700, marginBottom: 4 }}>
              PARTS THAT MUST STAY FIXED (optional)
            </div>
            <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 8, lineHeight: 1.5 }}>
              Your anchor part is already fixed. Add any other promoter, CDS, marker, origin, terminator, or other component that the design must preserve.
            </div>
            {lockedExtras.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {lockedExtras.map(l => {
                  const resolvedPart = l.customPart || (partsById && partsById[l.partId]) || null;
                  const provenance = resolvedPart && window.Automatic && window.Automatic.classifyProvenance
                    ? window.Automatic.classifyProvenance(resolvedPart).provenanceStatus
                    : null;
                  return (
                    <span key={l.role} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "5px 9px", borderRadius: 20, border: `1px solid ${COLORS.accent2}55`, color: COLORS.accent2, background: `${COLORS.accent2}1a` }}>
                      🔒 {l.partName}
                      <span style={{ color: COLORS.faint }}>/ {l.role}{provenance ? ` / ${provenance.replace(/_/g, " ")}` : ""}</span>
                      <span onClick={() => removeLockedExtra(l.role)} style={{ cursor: "pointer", color: COLORS.faint }} title="Remove">×</span>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[["search", "From catalog"], ["register", "Register custom part"]].map(([id, label]) => (
                <button key={id} onClick={() => { setExtraKind(id); setExtraPart(null); }}
                  style={{ padding: "4px 9px", borderRadius: 5, border: `1px solid ${COLORS.border}`, cursor: "pointer", fontSize: 10,
                    background: extraKind === id ? COLORS.accent : "transparent", color: extraKind === id ? "#fff" : COLORS.faint }}>
                  {label}
                </button>
              ))}
            </div>
            {extraKind === "search" ? (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                <select value={extraRole} onChange={e => setExtraRole(e.target.value)}
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 11, padding: "6px 8px" }}>
                  {roleOptions.filter(r => r !== primaryRole).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <div style={{ flex: "1 1 220px" }}>
                  <LocalPartPicker db={db} selected={extraPart} onPick={setExtraPart} onClear={() => setExtraPart(null)} />
                </div>
                <button onClick={addLockedExtra} disabled={!extraPart}
                  style={{ padding: "7px 12px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: extraPart ? COLORS.accent : "transparent", color: extraPart ? "#fff" : COLORS.faint, fontSize: 11, cursor: extraPart ? "pointer" : "default" }}>
                  🔒 Lock
                </button>
              </div>
            ) : customRegistry ? (
              <CustomPartRegistrationForm registry={customRegistry} onRegistered={addLockedExtraCustom} submitLabel="Register & Lock" />
            ) : null}
          </div>

          <button onClick={() => run()} disabled={!window.Automatic}
            style={{ width: "100%", marginTop: 14, padding: "12px", background: "linear-gradient(90deg,#0369a1,#0ea5e9)", border: "none", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            🧠 Run Automatic Design
          </button>
          {!window.Automatic && <div style={{ fontSize: 11, color: COLORS.bad, marginTop: 8 }}>./automatic/index.js did not load — the page must be served over http, not opened as a file.</div>}
        </div>

        {result && result.stage === "characterizeInput" && (
          <div style={{ background: "#2a0a0a", border: "1px solid #b91c1c", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ color: COLORS.bad, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Input not accepted</div>
            <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
              {result.errors.map((e, i) => <li key={i} style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.6 }}>{e}</li>)}
            </ul>
          </div>
        )}

        {result && result.stage === "selectArchitecture" && (
          <div style={{ background: "#2a0a0a", border: "1px solid #b91c1c", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ color: COLORS.bad, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>No architecture available</div>
            <div style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.6 }}>{result.reason}</div>
            {result.partFirstStatus && (
              <div style={{ color: COLORS.warn, fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>{result.partFirstStatus}</div>
            )}
          </div>
        )}

        {result && result.stage === "needsUserChoice" && (
          <div style={{ background: "#1e2a3a", border: `1px solid ${COLORS.accent2}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ color: COLORS.accent2, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              {result.characterized.input.anchorPart.name} registered and locked -- additional context required
            </div>
            <div style={{ color: COLORS.text, fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>{result.needsUserChoice.reason}</div>
            {result.needsUserChoice.requiredRole ? (
              <div>
                <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Additional component required: {result.needsUserChoice.requiredRole}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {[["search", "Select from catalog"], ["register", "Register another custom part"]].map(([id, label]) => (
                    <button key={id} onClick={() => setExtraKind(id)}
                      style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${COLORS.border}`, cursor: "pointer", fontSize: 10,
                        background: extraKind === id ? COLORS.accent : "transparent", color: extraKind === id ? "#fff" : COLORS.faint }}>
                      {label}
                    </button>
                  ))}
                </div>
                {extraKind === "search" ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 220px" }}>
                      <LocalPartPicker db={db} selected={extraPart} onPick={setExtraPart} onClear={() => setExtraPart(null)} />
                    </div>
                    <button onClick={() => { if (!extraPart) return; const entry = { role: result.needsUserChoice.requiredRole, partId: extraPart.id, partName: extraPart.name }; setExtraPart(null); run(entry); }}
                      disabled={!extraPart}
                      style={{ padding: "7px 12px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: extraPart ? COLORS.accent : "transparent", color: extraPart ? "#fff" : COLORS.faint, fontSize: 11, cursor: extraPart ? "pointer" : "default" }}>
                      🔒 Lock &amp; continue
                    </button>
                  </div>
                ) : customRegistry ? (
                  <CustomPartRegistrationForm registry={customRegistry} fixedRole={result.needsUserChoice.requiredRole}
                    onRegistered={p => run({ role: result.needsUserChoice.requiredRole, customPart: p, partName: p.name })}
                    submitLabel="Register & Continue" />
                ) : null}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: COLORS.faint, lineHeight: 1.6 }}>
                This project's design grammar does not yet define what a complete architecture around this role requires -- no automatic next step to offer.
              </div>
            )}
          </div>
        )}

        {result && result.ok && (
          <div>
            {/* Phase 6, item 2: DESIGN SUMMARY -- the compact decision-relevant
                snapshot at the top, before any implementation detail. Every
                field is read directly from already-computed result data. */}
            {(() => {
              const recScored = result.recommended ? result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId) : null;
              const stability = result.scoring.robustness && result.scoring.robustness.recommended ? result.scoring.robustness.recommended.stabilityLabel : null;
              const familyLabel = result.requirementPlan && result.requirementPlan.family ? result.requirementPlan.family.label : "none matched";
              const SummaryField = ({ label, value }) => (
                <div style={{ minWidth: 120 }}>
                  <div style={{ fontSize: 9, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>{value}</div>
                </div>
              );
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: COLORS.accent2, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Design summary</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                    <SummaryField label="Anchor part" value={result.characterized.input.anchorPart.name} />
                    <SummaryField label="Host" value={result.characterized.input.host} />
                    <SummaryField label="Design goal" value={result.characterized.input.goal || familyLabel} />
                    <SummaryField label="Architecture family" value={familyLabel} />
                    <SummaryField label="Recommended candidate" value={result.recommended ? `Recommended Candidate (${result.recommended.templateLabel})` : "none"} />
                    <SummaryField label="Total bp" value={result.recommended ? result.recommended.plan.totalLength.toLocaleString() : "—"} />
                    <SummaryField label="Score" value={recScored ? `${recScored.overallScore}/100` : "—"} />
                    <SummaryField label="Ranking stability" value={stability || "n/a"} />
                    <SummaryField label="Assembly method" value={result.recommended && result.recommended.assemblyPlan ? result.recommended.assemblyPlan.method : "—"} />
                    <SummaryField label="Hard-valid status" value={result.recommended && result.recommended.validation.valid ? "✓ valid" : "⚠ none valid"} />
                  </div>
                </div>
              );
            })()}

            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 1, padding: "4px 0" }}>Technical model trace (input characterization, requirement plan, template pathway, scoring weights)</summary>
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginTop: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Input characterization</div>
              <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>Mode: <b>{result.characterized.input.mode}</b> — {result.characterized.input.matchNote}</div>
              <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>
                Anchor: <b>{result.characterized.input.anchorPart.name}</b> ({result.characterized.input.anchorPart.length.toLocaleString()} bp){" "}
                {(() => {
                  // Phase 4C.1: show the real provenanceStatus/sequenceStatus model here,
                  // not the raw catalog evidence field -- a user_supplied or registry_recorded
                  // anchor must never display as "placeholder" (that word means genuinely
                  // unresolved/missing, per automatic/provenanceModel.js).
                  const classification = window.Automatic && window.Automatic.classifyProvenance
                    ? window.Automatic.classifyProvenance(result.characterized.input.anchorPart)
                    : { provenanceStatus: result.characterized.input.anchorPart.evidence === "verified" ? "project_verified" : "placeholder", sequenceStatus: "resolved" };
                  const color = classification.provenanceStatus === "project_verified" ? COLORS.good
                    : classification.provenanceStatus === "placeholder" ? COLORS.bad : COLORS.placeholder;
                  return (
                    <>
                      <Badge color={color}>{classification.provenanceStatus}</Badge>{" "}
                      <Badge color={classification.sequenceStatus === "resolved" ? COLORS.good : COLORS.bad}>{classification.sequenceStatus}</Badge>
                    </>
                  );
                })()}
              </div>
              <div style={{ fontSize: 12, color: COLORS.text }}>Role: <b>{result.characterized.input.role}</b> · Host: <b>{result.characterized.input.host}</b> · Goal: <i>{result.characterized.input.goal}</i></div>
              {result.characterized.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: COLORS.warn, marginTop: 6 }}>⚠️ {w}</div>)}
            </div>

            {result.lockedComponents && result.lockedComponents.length > 1 && (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Locked components (never swapped by the search)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.lockedComponents.map(l => (
                    <span key={l.role} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 20, border: `1px solid ${COLORS.accent2}55`, color: COLORS.accent2, background: `${COLORS.accent2}1a` }}>
                      {l.role}: {l.partName}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.requirementPlan ? (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Formal design requirement plan (constraint-based architecture generation)</div>
                <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 4 }}>
                  Architecture family: <b>{result.requirementPlan.family ? result.requirementPlan.family.label : "none matched"}</b>
                </div>
                <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 6, lineHeight: 1.6 }}>{result.requirementPlan.familyStatus}</div>
                <div style={{ fontSize: 11, color: COLORS.text, marginBottom: 4 }}>Required roles: {result.requirementPlan.requiredRoles.join(", ")}</div>
                {result.requirementPlan.optionalRoles.length > 0 && <div style={{ fontSize: 11, color: COLORS.text, marginBottom: 4 }}>Optional roles: {result.requirementPlan.optionalRoles.join(", ")}</div>}
                <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 6, lineHeight: 1.6 }}>{result.requirementPlan.rationale.join(" ")}</div>
                <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 6 }}>{result.generationSummary.beamSearch} candidate(s) generated by constraint-based beam search · {result.generationSummary.templateBased} by template-matching</div>
              </div>
            ) : (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Constraint-based architecture generation</div>
                <div style={{ fontSize: 11, color: COLORS.warn, lineHeight: 1.6 }}>{result.partFirstStatus}</div>
              </div>
            )}

            {result.architecture.ok ? (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Template-matched architecture (Pathway A)</div>
                <div style={{ fontSize: 13, color: COLORS.accent2, fontWeight: 700, marginBottom: 6 }}>{result.architecture.selected.template.label} ({result.architecture.selected.template.id})</div>
                <div style={{ fontSize: 12, color: COLORS.dim, lineHeight: 1.6 }}>{result.architecture.rationale}</div>
              </div>
            ) : (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Template-matched architecture (Pathway A)</div>
                <div style={{ fontSize: 12, color: COLORS.faint, lineHeight: 1.6 }}>None: {result.architecture.reason} (all candidates below came from constraint-based beam search instead.)</div>
              </div>
            )}

            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Scoring model</div>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 6 }}>
                {Object.entries(result.scoring.weights).filter(([, w]) => w > 0).map(([dim, w]) => `${DIM_LABELS[dim] || dim} (${Math.round(w * 100)}%)`).join(" · ")}
              </div>
              <div style={{ fontSize: 10, color: COLORS.faint }}>Registry/reference support: {result.scoring.registryStatus}</div>
            </div>
            </details>

            {result.recommended && (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.accent2, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Recommended — rank #1 by the scoring model</div>
                <div style={{ fontSize: 12, color: COLORS.text, marginBottom: 6, wordBreak: "break-word" }}>
                  {result.recommended.templateLabel} — {result.recommended.plan.order.map(o => o.name).join(" → ")}
                </div>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: result.comparison ? 8 : 0 }}>{result.recommendationNote}</div>
                {result.comparison && (
                  <div style={{ fontSize: 11, color: COLORS.warn, marginTop: 6 }}>Why it outranks #2: {result.comparison.summary}</div>
                )}
                {result.recommended.validation.valid && onUseDesign && (
                  <button onClick={() => handleUseDesign(result.recommended)}
                    style={{ marginTop: 12, width: "100%", padding: "10px", background: "linear-gradient(90deg,#166534,#22c55e)", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    ✅ Use This Design → open in Map / Parts / Sequence / Assembly
                  </button>
                )}
              </div>
            )}

            {/* Phase 6, item 2 (ALTERNATIVES) + item 5 (CANDIDATE COMPARISON MODE) */}
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 1 }}>Alternatives</div>
                <button onClick={() => setShowComparison(s => !s)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${COLORS.accent2}`, background: showComparison ? COLORS.accent2 : "transparent", color: showComparison ? "#04202b" : COLORS.accent2, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  ⚖️ Compare Candidates
                </button>
              </div>
              <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 8 }}>
                {result.candidates.valid.length} valid candidate(s) generated · {result.scoring.ranked.filter(r => r.paretoOptimal).length} Pareto-optimal alternative(s){result.candidates.invalid.length > 0 ? ` · ${result.candidates.invalid.length} rejected` : ""}
              </div>
              {showComparison && (() => {
                const validRanked = result.scoring.ranked.filter(r => r.candidate.validation.valid);
                const idA = compareIds[0] || (validRanked[0] && validRanked[0].candidateId) || "";
                const idB = compareIds[1] || (validRanked[1] && validRanked[1].candidateId) || "";
                const entryA = validRanked.find(r => r.candidateId === idA);
                const entryB = validRanked.find(r => r.candidateId === idB);
                return (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
                    <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                      {[["A", idA, v => setCompareIds([v, idB])], ["B", idB, v => setCompareIds([idA, v])]].map(([label, val, onChange]) => (
                        <div key={label} style={{ flex: "1 1 160px" }}>
                          <div style={{ fontSize: 10, color: COLORS.faint, marginBottom: 4 }}>CANDIDATE {label}</div>
                          <select value={val} onChange={e => onChange(e.target.value)}
                            style={{ width: "100%", background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 11, padding: "6px 8px" }}>
                            {validRanked.map((r, i) => <option key={r.candidateId} value={r.candidateId}>#{i + 1} {r.candidate.templateLabel} ({r.overallScore}/100)</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                    <ComparisonPanel candidateA={entryA && entryA.candidate} candidateB={entryB && entryB.candidate} scoredA={entryA} scoredB={entryB} />
                  </div>
                );
              })()}
            </div>

            {result.recommended && (() => {
              const recommendedScored = result.scoring.ranked.find(r => r.candidateId === result.recommended.candidateId);
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Design audit -- recommended candidate</div>
                  <DesignAuditPanel candidate={result.recommended} scored={recommendedScored}
                    anchorPart={result.characterized.input.anchorPart} host={result.characterized.input.host} partsById={partsById} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
                    <span style={{ fontSize: 10, color: COLORS.faint, alignSelf: "center" }}>EXPORT:</span>
                    {[["fasta", "FASTA"], ["json", "JSON report"], ["genbank", "GenBank"]].map(([kind, label]) => (
                      <button key={kind} onClick={() => exportCandidate(result.recommended, kind)}
                        style={{ padding: "5px 10px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: "transparent", color: COLORS.dim, fontSize: 11, cursor: "pointer" }}>
                        ⬇ {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {result.scoring.robustness && result.scoring.robustness.recommended && (() => {
              const rb = result.scoring.robustness;
              const stabilityColor = rb.recommended.stabilityLabel === "highly stable" ? COLORS.good
                : rb.recommended.stabilityLabel === "moderately stable" ? COLORS.warn : COLORS.bad;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Recommendation robustness</div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                    <div><span style={{ fontSize: 10, color: COLORS.faint }}>Top-rank frequency</span><div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{(rb.recommended.recommendationStability * 100).toFixed(0)}%</div></div>
                    <div><span style={{ fontSize: 10, color: COLORS.faint }}>Mean rank</span><div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{rb.perCandidate[rb.recommended.candidateId].meanRank}</div></div>
                    <div><span style={{ fontSize: 10, color: COLORS.faint }}>Margin over #2</span><div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{rb.recommended.marginToSecond === null ? "n/a (only candidate)" : rb.recommended.marginToSecond}</div></div>
                    <div><span style={{ fontSize: 10, color: COLORS.faint }}>Trials</span><div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{rb.trials.toLocaleString()}</div></div>
                  </div>
                  <Badge color={stabilityColor}>{rb.recommended.stabilityLabel}</Badge>
                  {" "}
                  <span style={{ fontSize: 11, color: COLORS.dim }}>
                    {(() => {
                      // Presentation-only: show rank-based labels ("Candidate #N") instead
                      // of raw internal candidate ids in primary user-facing text.
                      const labelFor = id => { const idx = result.scoring.ranked.findIndex(r => r.candidateId === id); return idx >= 0 ? `Candidate #${idx + 1}` : id; };
                      return <>
                        Pareto status: {rb.recommended.paretoStatus === "pareto_optimal" ? "Pareto-optimal" : rb.recommended.paretoStatus === "dominated" ? `dominated by ${rb.recommended.dominatedBy.map(labelFor).join(", ")}` : "unknown"}
                        {rb.recommended.tradeoffAlternatives.length > 0 && ` · tradeoff alternatives: ${rb.recommended.tradeoffAlternatives.map(t => labelFor(t.candidateId)).join(", ")}`}
                      </>;
                    })()}
                  </span>
                  <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 10, lineHeight: 1.5, fontStyle: "italic" }}>
                    This measures stability of the model's ranking to reasonable scoring-weight changes ({(rb.perturbationFraction * 100).toFixed(0)}% perturbation, {rb.trials.toLocaleString()} trials, seeded/reproducible). It is NOT a probability of experimental success.
                  </div>
                </div>
              );
            })()}

            {result.scoring.ranked.length > 0 && (() => {
              const mapEntry = result.scoring.ranked.find(r => r.candidateId === mapCandidateId) || result.scoring.ranked[0];
              const mapEntryRank = result.scoring.ranked.findIndex(r => r.candidateId === mapEntry.candidateId) + 1;
              return (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 1 }}>Plasmid map</div>
                    <select value={mapEntry.candidateId} onChange={e => setMapCandidateId(e.target.value)}
                      style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, fontSize: 11, padding: "5px 8px" }}>
                      {result.scoring.ranked.map((r, i) => <option key={r.candidateId} value={r.candidateId}>#{i + 1} {r.candidate.templateLabel} ({r.overallScore}/100)</option>)}
                    </select>
                  </div>
                  {highlightRole && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: COLORS.accent2, background: `${COLORS.accent2}14`, border: `1px solid ${COLORS.accent2}44`, borderRadius: 6, padding: "6px 10px", marginBottom: 10 }}>
                      <span>Showing alternatives for role "{highlightRole}" in the candidate list below</span>
                      <button onClick={() => setHighlightRole(null)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }}>×</button>
                    </div>
                  )}
                  <PlasmidCircularMap candidate={mapEntry.candidate} scored={mapEntry} partsById={partsById}
                    anchorName={result.characterized.input.anchorPart.name}
                    anchorPart={result.characterized.input.anchorPart}
                    assemblyPlan={mapEntry.candidate.assemblyPlan}
                    lockedRoleSet={lockedRoleSet}
                    onLockComponent={lockFromMap}
                    onShowAlternatives={setHighlightRole}
                    centerInfo={{
                      rank: mapEntryRank,
                      host: result.characterized.input.host,
                      goalLabel: result.requirementPlan && result.requirementPlan.family ? result.requirementPlan.family.label : null,
                      score: mapEntry.overallScore,
                    }} />
                  {mapEntry.candidate.assemblyPlan && (
                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${COLORS.border}`, fontSize: 10, color: COLORS.faint, lineHeight: 1.6 }}>
                      Assembly ({mapEntry.candidate.assemblyPlan.method}): {mapEntry.candidate.assemblyPlan.feasible ? "feasible" : "NOT feasible"} · {mapEntry.candidate.assemblyPlan.fragmentCount} fragments
                      {mapEntry.candidate.assemblyPlan.conflicts.length > 0 && `, ${mapEntry.candidate.assemblyPlan.conflicts.length} restriction-site conflict(s)`}
                      · {mapEntry.candidate.assemblyPlan.rationale.join(" ")}
                    </div>
                  )}
                </div>
              );
            })()}

            {result.explanation && result.explanation.lines && (
              <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Why this candidate? (traceable to model output only — no generated prose)</div>
                {result.explanation.lines.map((l, i) => typeof l === "string" ? (
                  <div key={i} style={{ fontSize: 12, color: COLORS.dim, marginBottom: 6 }}>{l}</div>
                ) : (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: COLORS.accent2, fontWeight: 700 }}>{l.q}</div>
                    <div style={{ fontSize: 11, color: COLORS.dim, lineHeight: 1.6 }}>{l.a}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                Generated candidates — {result.candidates.valid.length} valid (ranked below), {result.candidates.invalid.length} rejected
              </div>
              {highlightRole && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: COLORS.accent2, background: `${COLORS.accent2}14`, border: `1px solid ${COLORS.accent2}44`, borderRadius: 6, padding: "6px 10px", marginBottom: 10 }}>
                  <span>Filtered to candidates offering a DIFFERENT resolution for role "{highlightRole}"</span>
                  <button onClick={() => setHighlightRole(null)} style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }}>Clear filter ×</button>
                </div>
              )}
              {(() => {
                if (!highlightRole) {
                  return <>
                    {result.scoring.ranked.map((s, i) => (
                      <CandidateCard key={s.candidateId} c={s.candidate} scored={s} rank={i + 1}
                        robust={result.scoring.robustness && result.scoring.robustness.perCandidate[s.candidateId]}
                        onUseDesign={handleUseDesign} />
                    ))}
                    {result.candidates.invalid.map(c => <CandidateCard key={c.candidateId} c={c} />)}
                  </>;
                }
                // Phase 6, item 4G: "show alternatives" reuses the SAME
                // ranked candidate list, filtered to entries that resolve
                // this role differently from the reference (map-selected, or
                // else recommended) candidate -- no new search/computation.
                const refCandidate = (result.scoring.ranked.find(r => r.candidateId === mapCandidateId) || {}).candidate || result.recommended;
                const refEntry = refCandidate ? refCandidate.plan.order.find(o => o.role === highlightRole) : null;
                const alternatives = result.scoring.ranked.filter(s => {
                  const entry = s.candidate.plan.order.find(o => o.role === highlightRole);
                  return entry && (!refEntry || entry.id !== refEntry.id);
                });
                return alternatives.length ? alternatives.map(s => (
                  <CandidateCard key={s.candidateId} c={s.candidate} scored={s} rank={result.scoring.ranked.indexOf(s) + 1}
                    robust={result.scoring.robustness && result.scoring.robustness.perCandidate[s.candidateId]}
                    onUseDesign={handleUseDesign} />
                )) : (
                  <div style={{ fontSize: 12, color: COLORS.faint, padding: "8px 0" }}>No generated candidate resolves role "{highlightRole}" differently -- every candidate uses the same component here.</div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.AutomaticModeUI = AutomaticModeUI;
})();
