// Refreshes data/registry_cache.json from the official, current iGEM Registry
// API (https://api.registry.igem.org, OpenAPI spec at /docs-json).
//
// This script ONLY fetches by exact, hardcoded Registry ID -- it never writes
// free-text `search=` results into the cache (per the team's explicit
// instruction not to scrape arbitrary search results). Every ID below was
// selected and justified in the Phase 2.5 report; see that report for why each
// one was picked over alternatives.
//
// Fails loudly (non-zero exit, no partial/corrupt cache written) if:
//   - the API is unreachable,
//   - an expected exact Registry ID is not returned,
//   - or a returned record's `name` doesn't exactly equal the requested ID.
//
// Run: node scripts/refresh_registry_cache.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "data", "registry_cache.json");
const API_BASE = "https://api.registry.igem.org";

// mappedLocalRole: how this project's existing role vocabulary (promoter, rbs,
// cds, terminator, marker, origin, signal, operator, orit, other) maps onto
// each Registry record's own documented role. Plasmid Vector -> "origin" is a
// deliberate simplification (a whole backbone bundles an origin + marker; our
// local vocabulary has no separate "backbone" bucket) and is called out again
// in registry_cache.json's own provenance note, not left implicit.
const PARTS = [
  { registryId: "BBa_J23100", mappedLocalRole: "promoter" },
  { registryId: "BBa_B0034", mappedLocalRole: "rbs" },
  { registryId: "BBa_B0032", mappedLocalRole: "rbs" },
  { registryId: "BBa_E0040", mappedLocalRole: "cds" },
  { registryId: "BBa_B0015", mappedLocalRole: "terminator" },
  { registryId: "pSB1C3", mappedLocalRole: "origin" },
  { registryId: "BBa_J31005", mappedLocalRole: "marker" },
];

const CONSTRUCTS = ["BBa_J04450", "BBa_E0840", "BBa_I13521", "BBa_I13522"];

const ESTABLISHED_MIN_AGE_DAYS = 365;
const ESTABLISHED_MIN_USAGE = 5;

async function getJSON(url, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await new Promise(r => setTimeout(r, 1500 * attempt));
    return getJSON(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function findExact(registryId) {
  const url = `${API_BASE}/v1/parts?page=1&pageSize=10&name=${encodeURIComponent(registryId)}&status=published`;
  const body = await getJSON(url);
  const hit = (body.data || []).find(p => p.name === registryId);
  if (!hit) {
    throw new Error(
      `Expected exact Registry ID "${registryId}" was not returned by ${url}. ` +
      `This is a fail-loud stop, not a fallback to a fuzzy match -- update the ID list or investigate the API.`
    );
  }
  return hit;
}

function establishedReference(createdISO, usageCount, fetchedAtISO) {
  const ageDays = (new Date(fetchedAtISO) - new Date(createdISO)) / 86400000;
  return ageDays >= ESTABLISHED_MIN_AGE_DAYS && usageCount >= ESTABLISHED_MIN_USAGE;
}

async function fetchPartRecord(registryId, mappedLocalRole, fetchedAt) {
  const summary = await findExact(registryId);
  const full = await getJSON(`${API_BASE}/v1/parts/${summary.uuid}`);
  const compat = await getJSON(`${API_BASE}/v1/parts/${summary.uuid}/compatibilities`);
  return {
    registryId: full.name,
    uuid: full.uuid,
    slug: full.slug,
    title: full.title,
    role: full.role.label,
    roleSO: full.role.accession,
    mappedLocalRole,
    sequence: full.sequence,
    length: full.sequence.length,
    chassis: full.chassis, // stored exactly as documented: {designedFor, characterisedIn, sourceOrganism} -- empty arrays mean "not documented", not "incompatible"
    compatibility: { rfc10: compat.rfc10, rfc1000: compat.rfc1000 },
    usageCount: full.usageCount,
    createdAt: full.audit.created,
    updatedAt: full.audit.updated,
    sourceUrl: `https://registry.igem.org/parts/${full.slug}`,
    fetchedAt,
    provenanceStatus: "registry_recorded",
    establishedReference: establishedReference(full.audit.created, full.usageCount, fetchedAt),
  };
}

async function fetchConstructRecord(registryId, fetchedAt) {
  const summary = await findExact(registryId);
  const full = await getJSON(`${API_BASE}/v1/parts/${summary.uuid}`);
  const compositionResp = await getJSON(`${API_BASE}/v1/parts/${summary.uuid}/composition`);
  const composition = (compositionResp.data || [])
    .sort((a, b) => a.start - b.start)
    .map(c => ({ componentRegistryId: c.componentName, role: c.role.label, roleSO: c.role.accession, start: c.start, end: c.end, strand: c.strand }));
  return {
    registryId: full.name,
    uuid: full.uuid,
    title: full.title,
    description: full.description || null,
    purpose: (full.description && full.description.trim()) ? full.description.trim() : null,
    sequenceLength: full.sequence ? full.sequence.length : null,
    chassis: full.chassis,
    composition,
    knownParts: composition.map(c => c.componentRegistryId),
    architectureRoles: composition.map(c => c.role),
    sourceUrl: `https://registry.igem.org/parts/${full.slug}`,
    fetchedAt,
  };
}

async function main() {
  const fetchedAt = new Date().toISOString();
  console.log(`Fetching ${PARTS.length} parts + ${CONSTRUCTS.length} constructs from ${API_BASE} at ${fetchedAt}...`);

  const parts = [];
  for (const p of PARTS) {
    console.log(`  part: ${p.registryId}`);
    parts.push(await fetchPartRecord(p.registryId, p.mappedLocalRole, fetchedAt));
  }

  const constructs = [];
  for (const id of CONSTRUCTS) {
    console.log(`  construct: ${id}`);
    constructs.push(await fetchConstructRecord(id, fetchedAt));
  }

  const cache = {
    schema_version: 1,
    provenance: `Curated snapshot fetched by exact Registry ID from the official iGEM Registry API (${API_BASE}) on ${fetchedAt}. ` +
      `Every record is registry_recorded provenance only -- Registry presence, age, or usageCount is NOT treated as biological/experimental verification. ` +
      `"establishedReference" means only: created >= ${ESTABLISHED_MIN_AGE_DAYS} days before fetch AND usageCount >= ${ESTABLISHED_MIN_USAGE} within this Registry's own usage tracking -- a data-provenance signal, not a claim about wet-lab validation. ` +
      `"Plasmid Vector" role records are mapped to this project's local "origin" bucket as a simplification (a whole backbone bundles an origin + marker; the local vocabulary has no separate "backbone" role).`,
    sourceApi: API_BASE,
    fetchedAt,
    parts,
    constructs,
  };

  writeFileSync(OUT_PATH, JSON.stringify(cache, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH} (${parts.length} parts, ${constructs.length} constructs).`);
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
