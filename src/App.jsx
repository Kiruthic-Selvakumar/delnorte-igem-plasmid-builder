import { useState } from "react";

const FILL = {
  promoter: "#4ade80",
  rbs: "#fbbf24",
  cds: "#60a5fa",
  terminator: "#f87171",
  marker: "#c084fc",
  origin: "#fb923c",
};
const TYPES = ["promoter", "rbs", "cds", "terminator", "marker", "origin"];
let _uid = 0;

const PRESETS = {
  "B. subtilis": [
    { name: "Pveg Promoter", type: "promoter" },
    { name: "B0034 RBS", type: "rbs" },
    { name: "Lysqdvp001 Endolysin", type: "cds" },
    { name: "rrnB T1 Terminator", type: "terminator" },
    { name: "Spectinomycin Resistance (SpcR)", type: "marker" },
    { name: "pUB110 ori", type: "origin" },
  ],
  "V. natrigens": [
    { name: "Ptrc Promoter", type: "promoter" },
    { name: "Consensus RBS", type: "rbs" },
    { name: "Lysqdvp001 Endolysin", type: "cds" },
    { name: "T7 Te Terminator", type: "terminator" },
    { name: "Kanamycin Resistance (KanR)", type: "marker" },
    { name: "pVSV105 ori", type: "origin" },
  ],
};

function PlasmidSVG({ parts, total, host, gc }) {
  if (!parts?.length || !total) return null;
  const W = 320, cx = 160, cy = 160, R = 115, r = 73;
  const pt = (radius, deg) => {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  let a = 0;
  const segs = parts.map((p) => {
    const sw = (p.length / total) * 360;
    const obj = { ...p, s: a, e: a + sw, sw };
    a += sw;
    return obj;
  });
  return (
    <svg viewBox={`0 0 ${W} ${W}`} style={{ width: 260, flexShrink: 0 }}>
      {segs.map((sg, i) => {
        const [x1, y1] = pt(R, sg.s), [x2, y2] = pt(R, sg.e);
        const [xi1, yi1] = pt(r, sg.s), [xi2, yi2] = pt(r, sg.e);
        const lg = sg.sw > 180 ? 1 : 0;
        const d = `M${x1} ${y1} A${R} ${R} 0 ${lg} 1 ${x2} ${y2} L${xi2} ${yi2} A${r} ${r} 0 ${lg} 0 ${xi1} ${yi1}Z`;
        const mid = sg.s + sg.sw / 2;
        const [lx, ly] = pt(R + 22, mid);
        return (
          <g key={i}>
            <path d={d} fill={FILL[sg.type] || "#64748b"} stroke="#0f172a" strokeWidth="1.5" opacity="0.92" />
            {sg.sw > 13 && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="7.5" fill="#e2e8f0" fontFamily="system-ui,sans-serif">
                {sg.name.length > 13 ? sg.name.slice(0, 11) + "…" : sg.name}
              </text>
            )}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r - 1} fill="#0f172a" />
      <text x={cx} y={cy - 12} textAnchor="middle" fontSize="15" fontWeight="700" fill="#f1f5f9" fontFamily="system-ui,sans-serif">
        {(total / 1000).toFixed(2)} kb
      </text>
      <text x={cx} y={cy + 6} textAnchor="middle" fontSize="9" fill="#64748b" fontStyle="italic" fontFamily="system-ui,sans-serif">{host}</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="8" fill="#475569" fontFamily="system-ui,sans-serif">
        GC: {gc?.toFixed(1)}%
      </text>
    </svg>
  );
}

function buildColorMap(seq, parts) {
  const map = new Array(seq.length).fill("#475569");
  let pos = 0;
  parts?.forEach((p) => {
    const end = Math.min(pos + (p.length || 0), seq.length);
    for (let i = pos; i < end; i++) map[i] = FILL[p.type] || "#64748b";
    pos += p.length || 0;
  });
  return map;
}

function colorRuns(str, start, map) {
  const runs = [];
  let col = null, s = "";
  [...str].forEach((c, j) => {
    const nc = map[start + j] || "#475569";
    if (nc !== col) { if (s) runs.push({ s, col }); col = nc; s = c; }
    else s += c;
  });
  if (s) runs.push({ s, col });
  return runs;
}

export default function App() {
  const [host, setHost] = useState("");
  const [parts, setParts] = useState([]);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState("cds");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("map");
  const [copied, setCopied] = useState(false);

  const pickHost = (h) => {
    setHost(h);
    setParts(PRESETS[h].map((p) => ({ ...p, id: ++_uid })));
    setResult(null);
    setError("");
  };

  const addPart = () => {
    if (!addName.trim()) return;
    setParts((p) => [...p, { name: addName.trim(), type: addType, id: ++_uid }]);
    setAddName("");
  };

  const delPart = (id) => setParts((p) => p.filter((x) => x.id !== id));

  const movePart = (id, d) =>
    setParts((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      if (i + d < 0 || i + d >= prev.length) return prev;
      const a = [...prev];
      [a[i], a[i + d]] = [a[i + d], a[i]];
      return a;
    });

  const generate = async () => {
    if (!host || !parts.length) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8000,
          messages: [
            {
              role: "user",
              content: `You are an expert synthetic biologist designing plasmids for an iGEM project. Provide realistic, research-grade sequences based on documented biological parts.

PROJECT: Del Norte iGEM — engineering ${host} to express Lysqdvp001, a phage-derived endolysin that cleaves the MurNAc-L-Ala bond in Vibrio coralliilyticus peptidoglycan, protecting coral reefs from bleaching.

HOST: ${host}
${host === "B. subtilis" ? "Use B. subtilis-compatible parts. Pveg: strong constitutive sigma-A promoter. B0034: BBa_B0034 RBS (AAAGAGGAGAAA). pUB110 ori: Gram-positive rolling-circle ori. SpcR: aad9 aminoglycoside gene (~570bp)." : "Use Vibrio/Gram-negative parts. Ptrc: hybrid tac/trp promoter sequence. KanR: APH(3')-Ia kanamycin resistance gene (~816bp). pVSV105 ori: Vibrio-compatible broad-host-range ori. T7 Te: strong rho-independent terminator."}

PARTS (5'→3'):
${parts.map((p, i) => `${i + 1}. ${p.name} [${p.type}]`).join("\n")}

For Lysqdvp001: generate a realistic ~900bp CDS codon-optimized for ${host} that encodes a modular endolysin with CWBD and catalytic domains. Use realistic codon frequencies for the host. For all other parts, use real documented sequences of appropriate length.

Return ONLY valid JSON, no markdown fences:
{"parts":[{"name":"","type":"","sequence":"UPPERCASE_DNA","length":0,"description":"","source":""}],"assembled_sequence":"FULL_UPPERCASE_SEQ","total_length":0,"gc_content":0.0,"key_features":["","","","",""],"delivery":{"method":"","steps":["","","","","",""],"selection":"","verification":""}}`,
            },
          ],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw = data.content.map((b) => b.text || "").join("").replace(/```(?:json)?|```/g, "").trim();
      const parsed = JSON.parse(raw);
      setResult(parsed);
      setTab("map");
    } catch (e) {
      setError("Assembly failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyFASTA = () => {
    if (!result) return;
    navigator.clipboard.writeText(
      `>plasmid|${host.replace(". ", "_")}|Lysqdvp001|${result.total_length}bp|GC${result.gc_content?.toFixed(1)}%\n${result.assembled_sequence}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stepN = !host ? 1 : !result ? 2 : 3;

  const S = {
    page: { minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", fontFamily: "system-ui,-apple-system,sans-serif" },
    header: { background: "linear-gradient(90deg,#0c4a6e,#0369a1)", padding: "13px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid #0284c7" },
    wrap: { padding: "20px", maxWidth: 860, margin: "0 auto" },
    label: { fontSize: 11, color: "#475569", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.2 },
    card: { background: "#1e293b", border: "1px solid #334155", borderRadius: 12, overflow: "hidden", marginBottom: 16 },
    partRow: (type) => ({
      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 5,
      background: "#0f172a", border: `1px solid ${FILL[type] || "#334155"}22`,
      borderLeft: `3px solid ${FILL[type] || "#334155"}`, borderRadius: 7,
    }),
    chip: (type) => ({
      fontSize: 10, padding: "2px 7px", background: `${FILL[type] || "#64748b"}1a`,
      color: FILL[type] || "#64748b", borderRadius: 20, border: `1px solid ${FILL[type] || "#64748b"}33`,
    }),
    tab: (active) => ({
      flex: 1, padding: "10px 4px", background: "none", border: "none",
      borderBottom: `2px solid ${active ? "#0ea5e9" : "transparent"}`,
      color: active ? "#38bdf8" : "#475569", cursor: "pointer", fontSize: 11, fontWeight: active ? 600 : 400,
    }),
    btn: (primary) => ({
      width: "100%", padding: "13px",
      background: primary ? "linear-gradient(90deg,#0369a1,#0ea5e9)" : "none",
      border: primary ? "none" : "1px solid #334155",
      borderRadius: 9, color: primary ? "#fff" : "#475569",
      fontSize: primary ? 14 : 12, fontWeight: primary ? 700 : 400, cursor: "pointer",
    }),
    iconBtn: { background: "none", border: "none", color: "#475569", cursor: "pointer", padding: "2px 5px", fontSize: 12 },
  };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize: 22 }}>🧬</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Del Norte iGEM · Plasmid Builder</div>
          <div style={{ fontSize: 11, color: "#7dd3fc" }}>AI-assisted assembly for coral reef protection</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          {["Host", "Parts", "Output"].map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                background: stepN > i + 1 ? "#0ea5e9" : stepN === i + 1 ? "#1e40af" : "#1e293b",
                border: `2px solid ${stepN > i + 1 ? "#38bdf8" : stepN === i + 1 ? "#3b82f6" : "#334155"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
                color: stepN > i + 1 ? "#fff" : stepN === i + 1 ? "#93c5fd" : "#475569",
              }}>{i + 1}</div>
              <span style={{ fontSize: 10, color: stepN === i + 1 ? "#93c5fd" : "#334155" }}>{l}</span>
              {i < 2 && <span style={{ color: "#1e3a5f", margin: "0 3px" }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={S.wrap}>

        {/* Step 1: Host */}
        <div style={{ marginBottom: 16 }}>
          <div style={S.label}>01 — Host Organism</div>
          <div style={{ display: "flex", gap: 10 }}>
            {Object.keys(PRESETS).map((h) => (
              <button key={h} onClick={() => pickHost(h)} style={{
                flex: 1, padding: "14px 12px",
                background: host === h ? "#0c4a6e" : "#1e293b",
                border: `2px solid ${host === h ? "#0ea5e9" : "#334155"}`,
                borderRadius: 10, cursor: "pointer", color: "#e2e8f0", textAlign: "left",
              }}>
                <div style={{ fontSize: 20, marginBottom: 3 }}>{h === "B. subtilis" ? "🦠" : "⚡"}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontStyle: "italic", color: host === h ? "#38bdf8" : "#94a3b8" }}>{h}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, lineHeight: 1.5 }}>
                  {h === "B. subtilis"
                    ? "Coral-surface colonizer · Biofilm-forming · GRAS probiotic"
                    : "Marine environment · Ultra-fast growth · High electroporation efficiency"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Parts */}
        {host && (
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>02 — Genetic Parts</div>
            <div style={S.card}>
              {/* Legend */}
              <div style={{ padding: "8px 14px", background: "#0f172a", borderBottom: "1px solid #1e293b", display: "flex", gap: 10, flexWrap: "wrap" }}>
                {TYPES.map((t) => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: FILL[t] }} />
                    <span style={{ color: "#64748b" }}>{t}</span>
                  </div>
                ))}
              </div>

              <div style={{ padding: "12px 14px" }}>
                {parts.map((p, i) => (
                  <div key={p.id} style={S.partRow(p.type)}>
                    <span style={{ color: "#334155", fontSize: 11, minWidth: 16 }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{p.name}</span>
                    <span style={S.chip(p.type)}>{p.type}</span>
                    <button onClick={() => movePart(p.id, -1)} style={S.iconBtn}>▲</button>
                    <button onClick={() => movePart(p.id, 1)} style={S.iconBtn}>▼</button>
                    <button onClick={() => delPart(p.id)} style={{ ...S.iconBtn, fontSize: 16 }}>×</button>
                  </div>
                ))}

                {/* Add row */}
                <div style={{ display: "flex", gap: 8, marginTop: 10, padding: "8px 10px", background: "#0f172a", border: "1px dashed #334155", borderRadius: 7 }}>
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPart()}
                    placeholder="Add part by name (e.g., lacI, sfGFP, pelB signal...)"
                    style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e2e8f0", fontSize: 12 }}
                  />
                  <select
                    value={addType}
                    onChange={(e) => setAddType(e.target.value)}
                    style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 5, color: "#94a3b8", fontSize: 11, padding: "3px 6px" }}
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button
                    onClick={addPart}
                    style={{ background: "#1e3a5f", border: "1px solid #334155", borderRadius: 5, color: "#93c5fd", fontSize: 12, padding: "4px 12px", cursor: "pointer" }}
                  >+ Add</button>
                </div>
              </div>

              <div style={{ padding: "0 14px 14px" }}>
                <button
                  onClick={generate}
                  disabled={loading || !parts.length}
                  style={{ ...S.btn(true), opacity: !parts.length ? 0.5 : 1, cursor: loading || !parts.length ? "not-allowed" : "pointer" }}
                >
                  {loading ? "⚙️  Assembling plasmid — this may take ~30s…" : "⚗️  Generate Plasmid"}
                </button>
                {error && (
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#450a0a", border: "1px solid #b91c1c", borderRadius: 7, color: "#fca5a5", fontSize: 12 }}>
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {result && (
          <div>
            <div style={S.label}>03 — Assembly Output</div>
            <div style={S.card}>

              {/* Stats bar */}
              <div style={{ display: "flex", background: "#0f172a", borderBottom: "1px solid #1e293b" }}>
                {[
                  { v: `${(result.total_length / 1000).toFixed(2)} kb`, l: "Plasmid size" },
                  { v: `${result.gc_content?.toFixed(1)}%`, l: "GC content" },
                  { v: result.parts?.length, l: "Parts" },
                  { v: host.split(" ")[1] || host, l: "Host" },
                ].map((s, i) => (
                  <div key={i} style={{ flex: 1, padding: "12px 6px", textAlign: "center", borderRight: i < 3 ? "1px solid #1e293b" : "none" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#38bdf8" }}>{s.v}</div>
                    <div style={{ fontSize: 10, color: "#475569" }}>{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", background: "#0f172a", borderBottom: "1px solid #1e293b" }}>
                {[["map", "🗺 Map"], ["parts", "🧩 Parts"], ["sequence", "🔤 Sequence"], ["delivery", "📋 Delivery"]].map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)} style={S.tab(tab === id)}>{label}</button>
                ))}
              </div>

              <div style={{ padding: "18px 16px" }}>

                {/* Map tab */}
                {tab === "map" && (
                  <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <PlasmidSVG parts={result.parts} total={result.total_length} host={host} gc={result.gc_content} />
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>KEY FEATURES</div>
                      {result.key_features?.map((f, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                          <span style={{ color: "#0ea5e9", flexShrink: 0 }}>◆</span>
                          <span style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{f}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #1e293b" }}>
                        <div style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>LEGEND</div>
                        {TYPES.filter((t) => result.parts?.some((p) => p.type === t)).map((t) => (
                          <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: FILL[t] }} />
                            <span style={{ fontSize: 11, color: "#64748b" }}>{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Parts tab */}
                {tab === "parts" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {result.parts?.map((p, i) => (
                      <div key={i} style={{
                        border: `1px solid ${FILL[p.type] || "#334155"}33`,
                        borderLeft: `3px solid ${FILL[p.type] || "#334155"}`,
                        background: `${FILL[p.type] || "#64748b"}0a`, borderRadius: 8, padding: "12px 14px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, color: FILL[p.type] || "#94a3b8", fontSize: 13 }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: "#475569" }}>{p.length?.toLocaleString()} bp</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 3 }}>{p.description}</div>
                        <div style={{ fontSize: 11, color: "#475569" }}>📚 {p.source}</div>
                        <div style={{
                          marginTop: 8, fontFamily: "monospace", fontSize: 10, color: "#334155",
                          background: "#070f1a", borderRadius: 4, padding: "6px 8px", wordBreak: "break-all",
                        }}>
                          {p.sequence?.slice(0, 100)}{p.sequence?.length > 100 ? "…" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Sequence tab */}
                {tab === "sequence" && (() => {
                  const seq = result.assembled_sequence || "";
                  const cmap = buildColorMap(seq, result.parts);
                  const WRAP = 60;
                  const lines = [];
                  for (let i = 0; i < seq.length; i += WRAP) lines.push({ n: i + 1, s: seq.slice(i, i + WRAP) });
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{seq.length.toLocaleString()} nt · color-coded by part type</span>
                        <button onClick={copyFASTA} style={{ background: "#0369a1", border: "none", borderRadius: 6, color: "#fff", fontSize: 12, padding: "6px 14px", cursor: "pointer" }}>
                          {copied ? "✓ Copied!" : "Copy FASTA"}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, padding: "6px 10px", background: "#0c1424", borderRadius: 6, border: "1px solid #1e3a5f" }}>
                        ⚠️ AI-generated sequences — verify with BLAST and wet-lab validation before use.
                      </div>
                      <div style={{ maxHeight: 320, overflowY: "auto", background: "#070f1a", borderRadius: 8, padding: "10px 12px", fontFamily: "monospace" }}>
                        {lines.map(({ n, s }) => (
                          <div key={n} style={{ display: "flex", gap: 8, marginBottom: 1 }}>
                            <span style={{ color: "#1e3a5f", fontSize: 10, minWidth: 46, textAlign: "right", flexShrink: 0 }}>{n}</span>
                            <span style={{ fontSize: 10, lineHeight: 1.7 }}>
                              {colorRuns(s, n - 1, cmap).map((r, i) => (
                                <span key={i} style={{ color: r.col }}>{r.s}</span>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Delivery tab */}
                {tab === "delivery" && result.delivery && (
                  <div>
                    <div style={{ background: "#0c4a6e", border: "1px solid #0369a1", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, color: "#38bdf8", fontSize: 14 }}>{result.delivery.method}</div>
                      <div style={{ fontSize: 12, color: "#7dd3fc", fontStyle: "italic", marginTop: 2 }}>{host}</div>
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 10, letterSpacing: 0.5 }}>PROTOCOL</div>
                    {result.delivery.steps?.map((s, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
                        <div style={{
                          minWidth: 24, height: 24, borderRadius: "50%", background: "#1e3a5f",
                          border: "2px solid #0369a1", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, color: "#38bdf8", flexShrink: 0,
                        }}>{i + 1}</div>
                        <span style={{ fontSize: 13, color: "#cbd5e1", paddingTop: 2, lineHeight: 1.5 }}>
                          {s.replace(/^Step\s*\d+[:.]\s*/i, "")}
                        </span>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
                      <div style={{ background: "#0f172a", border: "1px solid #166534", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 10, color: "#4ade80", marginBottom: 4 }}>SELECTION</div>
                        <div style={{ fontSize: 12, color: "#cbd5e1" }}>{result.delivery.selection}</div>
                      </div>
                      <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 10, color: "#60a5fa", marginBottom: 4 }}>VERIFICATION</div>
                        <div style={{ fontSize: 12, color: "#cbd5e1" }}>{result.delivery.verification}</div>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Reset */}
              <div style={{ padding: "0 16px 14px" }}>
                <button onClick={() => { setResult(null); setTab("map"); }} style={{ ...S.btn(false), marginTop: 4 }}>
                  ↩ New design
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
