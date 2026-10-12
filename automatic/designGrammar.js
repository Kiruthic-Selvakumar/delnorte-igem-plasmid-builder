// Automatic Design Mode -- formal design grammar (Phase 4B).
//
// Every biological/design rule this project acts on is represented here as a
// typed, provenanced data object -- never as a scattered if-statement. If a
// rule isn't backed by one of the sourceTypes below, it does not exist here.
//
// sourceType meanings (see each rule's sourceReference for the exact citation):
//   project_template                     -- read directly off one data/templates.json record
//   project_curated_data                 -- read off data/parts.json (a part's own desc/src/note)
//   registry_record                      -- read off a data/registry_cache.json record
//   derived_from_multiple_project_templates -- an intersection/union across >1 template, documented per-rule

export const RULE_TYPES = [
  "role_required", "role_optional", "role_order", "role_requires_role",
  "part_requires_part", "family_requires_roles", "family_permits_roles",
  "role_host_specific", "part_host_eligibility", "incompatibility",
  "assembly_constraint", "anchor_fixed",
];

function rule(r) {
  if (!RULE_TYPES.includes(r.ruleType)) throw new Error(`Unknown ruleType "${r.ruleType}" for rule "${r.id}"`);
  if (!r.sourceType || !r.sourceReference || !r.rationale) throw new Error(`Rule "${r.id}" is missing required provenance (sourceType/sourceReference/rationale)`);
  return r;
}

// --- Universal / cross-host rules -------------------------------------------

export const CANONICAL_ROLE_ORDER = ["ori", "rep", "orit", "ori_shuttle", "marker", "promoter", "rbs", "signal", "cds", "reporter", "terminator"];

export const RULES = [
  rule({
    id: "anchor-fixed", ruleType: "anchor_fixed",
    condition: {}, consequence: { locked: true, mayBeSwappedDuringSearch: false },
    sourceType: "project_curated_data", sourceReference: "Del Norte iGEM design brief (Automatic Design Mode requirement)",
    rationale: "Every user-supplied/locked component is the anchor of the design and must never be replaced by the search.",
  }),
  // PHASE 4C TERMINOLOGY FIX: these roles are NOT a claim that every possible
  // biological plasmid needs an ori/marker/promoter/rbs/terminator -- they are
  // required only because ALL 4 of this project's own current templates
  // happen to declare them required. Renamed from "universal-*-required" to
  // "baseline-*-required" (PROJECT_BASELINE_EXPRESSION_ROLES in
  // designRequirements.js) so nothing here implies a general biological truth
  // beyond what this project's own data actually shows. If a future template
  // (e.g. a non-expression construct) doesn't need one of these, it is not
  // "wrong" -- this rule set would simply no longer apply to it.
  ...["ori", "marker", "promoter", "rbs", "terminator"].map(role => rule({
    id: `baseline-${role}-required`, ruleType: "role_required",
    condition: { role }, consequence: { status: "required" },
    sourceType: "derived_from_multiple_project_templates",
    sourceReference: `data/templates.json: "${role}" is required:true and non-user_supplied in all 4 templates (ecoli_inducible, vnat_broadhost, bsub_secretion, bsub_delnorte) currently in this project's data.`,
    rationale: `A role required by every expression-cassette architecture CURRENTLY documented in this project's own data is treated as a project baseline for a CDS-anchored expression cassette -- not a universal claim about all possible plasmid designs.`,
  })),
  rule({
    id: "role-order-canonical", ruleType: "role_order",
    condition: {}, consequence: { order: CANONICAL_ROLE_ORDER },
    sourceType: "derived_from_multiple_project_templates",
    sourceReference: "data/templates.json: ecoli_inducible, vnat_broadhost, and bsub_secretion all agree on this backbone-then-cassette 5'->3' order; bsub_delnorte's atypical fused-protein order (documented in its own slot notes as an intentional exception) is excluded from this derivation.",
    rationale: "3 of 4 templates independently agree on this order; used as the canonical role order for generated architectures.",
  }),
  rule({
    id: "bsub-signal-required", ruleType: "role_required",
    condition: { role: "signal", host: "B. subtilis" }, consequence: { status: "required" },
    sourceType: "derived_from_multiple_project_templates",
    sourceReference: "data/templates.json: \"signal\" is required:true in BOTH bsub_secretion and bsub_delnorte.",
    rationale: "A role required by every one of a host's own documented templates is host-required.",
  }),
  rule({
    id: "vnat-rep-required", ruleType: "role_required",
    condition: { role: "rep", host: "V. natriegens" }, consequence: { status: "required" },
    sourceType: "project_template",
    sourceReference: "data/templates.json#vnat_broadhost.slots[rep]",
    rationale: "pBBR1 oriV is documented as non-functional without pBBR1 Rep in trans (see the ori->rep dependency rules below); vnat_broadhost's own architecture makes rep required as a consequence.",
  }),
  // Phase 5B, item 4 (single-part design, roles B/C/D/E): a promoter, RBS,
  // terminator, or signal peptide is DEFINED relative to a coding sequence it
  // acts on (what a promoter drives, what an RBS initiates translation of,
  // what a terminator terminates transcription of, what a signal peptide is
  // fused to for secretion) -- this is a structural/definitional fact about
  // what these roles ARE, not a claim inferred from any sequence content.
  // Used ONLY by runAutomaticDesign() to decide when a design is genuinely
  // underdetermined without a companion "cds" (whether that role is the
  // anchor itself, a default-filled baseline role, or anything else) -- never
  // to fabricate a target CDS. The declared but previously-unused
  // "role_requires_role" RULE_TYPE exists in this file precisely for facts of
  // this shape.
  ...["promoter", "rbs", "terminator", "signal"].map(role => rule({
    id: `${role}-requires-cds-target`, ruleType: "role_requires_role",
    condition: { role }, consequence: { requires: "cds" },
    sourceType: "project_curated_data",
    sourceReference: "Del Norte iGEM design brief, Phase 5B item 4 (single-part design, roles B/C/D/E).",
    rationale: `A "${role}" has no defined target without a specified coding sequence; this project has no defensible rule for guessing which gene it should act on, so a companion "cds" must be supplied or registered before a complete architecture can be generated.`,
  })),
  rule({
    id: "ori-requires-rep-pbbr1", ruleType: "part_requires_part",
    condition: { partId: "sg_pBBR1_oriV" }, consequence: { requiresPartId: ["sg_pBBR1_Rep"] },
    sourceType: "project_template", sourceReference: "data/templates.json#vnat_broadhost.slots[ori].requires.sg_pBBR1_oriV",
    rationale: "pBBR1 oriV needs pBBR1 Rep supplied in trans.",
  }),
  rule({
    id: "ori-requires-rep-rsf1010", ruleType: "part_requires_part",
    condition: { partId: "sg_RSF1010_oriV" }, consequence: { requiresPartId: ["sg_RSF1010_RepA", "sg_RSF1010_RepB", "sg_RSF1010_RepC"] },
    sourceType: "project_template", sourceReference: "data/templates.json#vnat_broadhost.slots[ori].requires.sg_RSF1010_oriV",
    rationale: "RSF1010 oriV needs its RepA/B/C proteins supplied in trans.",
  }),
  rule({
    id: "ori-requires-rep-pro1600", ruleType: "part_requires_part",
    condition: { partId: "sg_pRO1600_oriV" }, consequence: { requiresPartId: ["sg_pRO1600_Rep"] },
    sourceType: "project_template", sourceReference: "data/templates.json#vnat_broadhost.slots[ori].requires.sg_pRO1600_oriV",
    rationale: "pRO1600 oriV needs pRO1600 Rep supplied in trans.",
  }),
  rule({
    id: "ori-requires-rep101", ruleType: "part_requires_part",
    condition: { partId: "sg_pSC101_ori" }, consequence: { requiresPartId: ["sg_Rep101"] },
    sourceType: "project_template", sourceReference: "data/templates.json#ecoli_inducible.slots[ori].requires.sg_pSC101_ori",
    rationale: "pSC101 ori needs Rep101 supplied in trans; no template/catalog slot in this project currently supplies sg_Rep101, so any candidate choosing this ori is expected to gap or fail this dependency -- correctly, not a bug (see the Phase 2 report's pSC101 test case).",
  }),
  rule({
    id: "vnat-avoid-ampr", ruleType: "incompatibility",
    condition: { host: "V. natriegens", partId: "sg_AmpR" }, consequence: { incompatible: true },
    sourceType: "project_template",
    sourceReference: "data/templates.json#vnat_broadhost.slots[marker].note: \"avoid AmpR - V. natriegens has reported intrinsic beta-lactamase activity\"",
    rationale: "Quoted directly from the template's own documented caution. Currently unreachable in practice because vnat_broadhost's own marker candidate list never includes sg_AmpR -- implemented as an explicit rule anyway so it stays correct if a future candidate source (e.g. Registry-sourced parts) ever offers it.",
  }),
  rule({
    id: "assembly-gibson-enzymes", ruleType: "assembly_constraint",
    condition: { method: "gibson" }, consequence: { enzymes: [] },
    sourceType: "project_curated_data", sourceReference: "designer.js#design(): assembly==='gibson' -> enzymes=[]",
    rationale: "Gibson assembly uses homology overlaps, not a fixed restriction enzyme set, in this project's own assembly model.",
  }),
  rule({
    id: "assembly-goldengate-enzymes", ruleType: "assembly_constraint",
    condition: { method: "goldengate" }, consequence: { enzymes: ["BsaI", "BsmBI"] },
    sourceType: "project_curated_data", sourceReference: "designer.js#design(): assembly==='goldengate' -> [\"BsaI\",\"BsmBI\"]",
    rationale: "The exact enzyme set designer.js's own design() function already uses for Golden Gate; no template in this project's data currently uses this method (all 4 use gibson), so it is exposed as a constraint but has no real, tested end-to-end example yet -- see the Phase 4B report's assembly-planning limitations.",
  }),
];

export function rulesByType(ruleType) { return RULES.filter(r => r.ruleType === ruleType); }
export function rulesForHost(host) { return RULES.filter(r => !r.condition.host || r.condition.host === host); }

// --- Architecture families ---------------------------------------------------
//
// A family is a higher-level, named design intent (what a structured "design
// goal" dropdown option actually selects) that declares which roles it adds
// beyond the project-baseline set (PROJECT_BASELINE_EXPRESSION_ROLES, see
// designRequirements.js), and for which hosts that's actually backed by
// data. hostAvailability.supported === false is not a placeholder -- it is an
// honest, checked "no" the UI/engine must respect, not silently work around.

function family(f) {
  for (const [host, avail] of Object.entries(f.hostAvailability)) {
    if (avail.supported && (!avail.sourceType || !avail.sourceReference)) {
      throw new Error(`Family "${f.id}" claims support for host "${host}" without provenance`);
    }
  }
  return f;
}

export const ARCHITECTURE_FAMILIES = {
  inducible_regulated_expression: family({
    id: "inducible_regulated_expression",
    label: "Inducible / regulated expression",
    supportedAnchorRoles: ["cds"],
    requiredRoleAdditions: [],
    optionalRoleAdditions: [],
    hostAvailability: {
      "E. coli": { supported: true, sourceType: "project_template", sourceReference: "data/templates.json#ecoli_inducible.slots[promoter]", evidence: "offers araBAD (arabinose-inducible) and lac (IPTG-inducible) promoters", recommendedPartIds: { promoter: ["sg_araBAD_promoter_(2)", "sg_lac_promoter"] } },
      "V. natriegens": { supported: true, sourceType: "project_template", sourceReference: "data/templates.json#vnat_broadhost.slots[promoter].note", evidence: "borrows the same araBAD/lac inducible promoters; template note: \"E. coli sigma-70 promoters transfer to Vibrio (both gamma-proteobacteria)\"", recommendedPartIds: { promoter: ["sg_araBAD_promoter_(2)", "sg_lac_promoter"] } },
      "B. subtilis": { supported: true, sourceType: "project_template", sourceReference: "data/templates.json#bsub_delnorte.slots[promoter].note", evidence: "PkatA promoter documented as \"PerR-repressed, peroxide-inducible\"", recommendedPartIds: { promoter: ["dn_pkata_promoter"] } },
    },
    goalAliases: ["inducible", "induction", "regulated", "controllable", "on demand", "switch", "iptg", "arabinose"],
    rationale: "Every template in this project defaults to some form of regulated (not constitutive) promoter -- this is the best-evidenced family across all 3 hosts.",
  }),
  constitutive_expression: family({
    id: "constitutive_expression",
    label: "Constitutive expression",
    supportedAnchorRoles: ["cds"],
    requiredRoleAdditions: [],
    optionalRoleAdditions: [],
    hostAvailability: {
      "B. subtilis": { supported: true, sourceType: "project_curated_data", sourceReference: "data/parts.json#dn_pveg_promoter.src", evidence: "\"B. subtilis veg gene upstream region (sigma-A, -35/TTGACA -10/TATAAT)\" -- a documented constitutive sigma-A promoter", recommendedPartIds: { promoter: ["dn_pveg_promoter"] } },
      "E. coli": { supported: true, sourceType: "registry_record", sourceReference: "data/registry_cache.json#parts[BBa_J23100]", evidence: "provenanceStatus: registry_recorded (real sequence, real role, real provenance -- see registryClient.getInsertableCandidates); NOT project-verified -- Registry presence is not biological/wet-lab validation, see automatic/provenanceModel.js", recommendedPartIds: { promoter: ["registry:BBa_J23100"] } },
      "V. natriegens": { supported: false, sourceType: null, sourceReference: null, evidence: "No constitutive promoter is documented for V. natriegens in any project template or the cached Registry set." },
    },
    goalAliases: ["constitutive", "always on", "continuous expression", "baseline expression", "unregulated"],
    rationale: "Only offered where a specific constitutive promoter is actually documented -- not inferred from the mere existence of the 'promoter' role.",
  }),
  secretion: family({
    id: "secretion",
    label: "Secretion",
    supportedAnchorRoles: ["cds"],
    requiredRoleAdditions: ["signal"],
    optionalRoleAdditions: [],
    hostAvailability: {
      "B. subtilis": { supported: true, sourceType: "derived_from_multiple_project_templates", sourceReference: "data/templates.json#bsub_secretion.slots[signal].note + bsub_delnorte.slots[signal].note", evidence: "both document \"Sec pathway export\" via an AmyE signal peptide", recommendedPartIds: { signal: ["dn_amye_signal_peptide", "dn_amye_signal_peptide_sp33"] } },
      "E. coli": { supported: false, sourceType: null, sourceReference: null, evidence: "No signal peptide part is documented for E. coli in any project template." },
      "V. natriegens": { supported: false, sourceType: null, sourceReference: null, evidence: "No signal peptide part is documented for V. natriegens in any project template." },
    },
    goalAliases: ["secrete", "secretion", "export", "extracellular", "secreted"],
    rationale: "bsub_secretion/bsub_delnorte's shared signal note.",
  }),
  reporter_expression: family({
    id: "reporter_expression",
    label: "Reporter",
    supportedAnchorRoles: ["cds"],
    requiredRoleAdditions: [],
    optionalRoleAdditions: ["reporter"],
    hostAvailability: {
      "B. subtilis": { supported: true, sourceType: "project_template", sourceReference: "data/templates.json#bsub_delnorte.slots[reporter]", evidence: "optional reporter slot (dn_sfgfp_cds) -- thin precedent, and dn_sfgfp_cds's own catalog record is evidence:placeholder (provenanceStatus: placeholder, per automatic/provenanceModel.js -- unlike registry_recorded/user_supplied, still hard-rejected), so a candidate including it will be hard-rejected until this project independently verifies its sequence", recommendedPartIds: { reporter: ["dn_sfgfp_cds"] } },
      "E. coli": { supported: false, sourceType: null, sourceReference: null, evidence: "No template documents a reporter role for E. coli." },
      "V. natriegens": { supported: false, sourceType: null, sourceReference: null, evidence: "No template documents a reporter role for V. natriegens." },
    },
    goalAliases: ["reporter", "fluorescen", "visualiz", "readout", "gfp", "rfp"],
    rationale: "bsub_delnorte's optional reporter slot is the only documented precedent for this role in this project's data.",
  }),
  conjugation_transfer: family({
    id: "conjugation_transfer",
    label: "Conjugation / transfer",
    supportedAnchorRoles: ["cds"],
    requiredRoleAdditions: [],
    optionalRoleAdditions: ["orit"],
    hostAvailability: {
      "V. natriegens": { supported: true, sourceType: "project_template", sourceReference: "data/templates.json#vnat_broadhost.slots[orit].note", evidence: "optional orit slot, noted \"only if moving the plasmid by conjugation\"", recommendedPartIds: { orit: ["sg_RSF1010_oriT", "sg_oriT"] } },
      "E. coli": { supported: false, sourceType: null, sourceReference: null, evidence: "No template documents an orit role for E. coli." },
      "B. subtilis": { supported: false, sourceType: null, sourceReference: null, evidence: "No template documents an orit role for B. subtilis." },
    },
    goalAliases: ["conjugat", "mobiliz", "transfer between", "horizontal transfer"],
    rationale: "vnat_broadhost's optional orit slot is the only documented precedent for this role in this project's data.",
  }),
};

export function getSupportedFamiliesForHost(host) {
  return Object.values(ARCHITECTURE_FAMILIES).filter(f => f.hostAvailability[host] && f.hostAvailability[host].supported);
}

/** Matches free text to a family via its goalAliases -- the ONLY way free
 * text is ever interpreted; no other inference is attempted. */
export function matchFamilyByGoalText(goalText) {
  const text = String(goalText || "").toLowerCase();
  for (const f of Object.values(ARCHITECTURE_FAMILIES)) {
    const hit = f.goalAliases.find(k => text.includes(k));
    if (hit) return { family: f, matchedKeyword: hit };
  }
  return null;
}
