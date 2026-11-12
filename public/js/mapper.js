import { parseCsv } from "./csv.js";
import {
  canonicalFields,
  getField,
  maskValue,
  normalizeStage,
  requiredFields
} from "./schema.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,24}$/;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;

function normalized(value = "") {
  return String(value).trim().toLowerCase();
}

function headerTokens(value = "") {
  return normalized(value)
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ratio(values, predicate) {
  if (!values.length) return 0;
  return values.filter(predicate).length / values.length;
}

function validDate(value) {
  if (!DATE_PATTERN.test(String(value).trim())) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function inferType(values, header = "") {
  const present = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (!present.length) return "text";
  const normalizedHeader = normalized(header);

  if (ratio(present, (value) => EMAIL_PATTERN.test(value)) >= 0.6) return "email";
  if (ratio(present, validDate) >= 0.7) return "date";
  if (ratio(present, (value) => PHONE_PATTERN.test(value) && /\d{7,}/.test(value.replace(/\D/g, ""))) >= 0.6) return "phone";
  if (/^(is[_ ]|has[_ ])/.test(normalizedHeader) && ratio(present, (value) => /^(true|false|yes|no|0|1)$/i.test(value)) >= 0.7) {
    return "boolean";
  }
  if (
    /(^|\s)(id|ref|number|code)(\s|$)/.test(normalizedHeader)
    || ratio(present, (value) => /^(?:[a-z]{1,5}[-_]?)?\d{3,}$/i.test(value)) >= 0.8
  ) {
    return "id";
  }
  if (ratio(present, (value) => Number.isFinite(Number(value))) >= 0.85) return "number";
  const unique = new Set(present.map(normalized)).size;
  if (/(status|stage|state|type|category)/.test(normalizedHeader) && unique <= 8) return "enum";
  if (unique <= Math.min(5, Math.max(2, Math.ceil(present.length * 0.5)))) return "enum";
  return "text";
}

export function piiTypesForColumn(column) {
  const types = new Set();
  const header = normalized(column.name);
  if (column.type === "email") types.add("Email");
  if (column.type === "phone") types.add("Phone");
  if (/(name|contact|person)/.test(header) && !/(company|org|organization|account|employer)/.test(header)) {
    types.add("Name");
  }
  if (/(address|street|postal|zip)/.test(header)) types.add("Address");
  if (/(ssn|passport|national id)/.test(header)) types.add("Government ID");
  if (/(card|iban|bank|payment)/.test(header)) types.add("Financial");
  for (const sample of column.rawSamples) {
    if (SSN_PATTERN.test(sample)) types.add("Government ID");
    if (IP_PATTERN.test(sample)) types.add("IP address");
    if (CARD_PATTERN.test(sample) && sample.replace(/\D/g, "").length >= 13) types.add("Payment card");
  }
  return [...types];
}

export function profileColumns(headers, records) {
  return headers.map((name, index) => {
    const values = records.map((record) => String(record[name] ?? "").trim());
    const present = values.filter(Boolean);
    const type = inferType(present, name);
    const rawSamples = present.slice(0, 4);
    const column = {
      index,
      name,
      type,
      nonEmpty: present.length,
      total: records.length,
      missingRate: records.length ? 1 - present.length / records.length : 0,
      uniqueCount: new Set(present.map(normalized)).size,
      rawSamples,
      sampleMasked: rawSamples[0] ? maskValue(type, rawSamples[0]) : "—"
    };
    column.piiTypes = piiTypesForColumn(column);
    return column;
  });
}

function aliasScore(header, alias) {
  const normalizedHeader = normalized(header);
  const normalizedAlias = normalized(alias);
  if (normalizedHeader === normalizedAlias) return 1;
  if (normalizedHeader.includes(normalizedAlias) && normalizedAlias.length >= 3) return 0.92;
  if (normalizedAlias.includes(normalizedHeader) && normalizedHeader.length >= 3) return 0.86;

  const headerSet = new Set(headerTokens(header));
  const aliasSet = new Set(headerTokens(alias));
  const overlap = [...headerSet].filter((token) => aliasSet.has(token)).length;
  if (!overlap) return 0;
  return 0.42 + 0.32 * (overlap / Math.max(headerSet.size, aliasSet.size));
}

export function suggestMapping(column) {
  const candidates = canonicalFields.map((field) => {
    const headerScore = Math.max(...field.aliases.map((alias) => aliasScore(column.name, alias)));
    const typeBonus = column.type === field.type ? 0.08 : 0;
    return {
      target: field.key,
      score: Math.min(0.99, headerScore + typeBonus),
      field,
      headerScore
    };
  }).sort((left, right) => right.score - left.score || left.field.label.localeCompare(right.field.label));

  const best = candidates[0];
  if (!best || best.headerScore < 0.34) {
    return {
      source: column.name,
      target: "ignore",
      confidence: 0,
      reason: "No reliable canonical field match.",
      transform: "No transformation",
      piiTypes: column.piiTypes
    };
  }

  const transform = transformLabel(best.field.key);
  const reason = best.headerScore >= 0.99
    ? `Header exactly matches canonical alias for ${best.field.label}.`
    : best.headerScore >= 0.82
      ? `Header strongly matches ${best.field.label} and inferred type ${column.type}.`
      : `Partial header and type match for ${best.field.label}.`;

  return {
    source: column.name,
    target: best.target,
    confidence: Number(best.score.toFixed(2)),
    reason,
    transform,
    piiTypes: column.piiTypes
  };
}

export function generateMappings(profile, overrides = {}, remoteSuggestions = {}) {
  return profile.map((column) => {
    const suggestion = suggestMapping(column);
    const override = overrides[column.name];
    if (Object.hasOwn(overrides, column.name)) {
      return {
        ...suggestion,
        target: override,
        confidence: override === "ignore" ? 0 : 1,
        reason: "Target selected by human reviewer.",
        transform: override === "ignore" ? "No transformation" : transformLabel(override)
      };
    }
    const remote = remoteSuggestions[column.name];
    if (remote?.target) {
      return {
        ...suggestion,
        target: remote.target,
        confidence: Math.max(0, Math.min(1, Number(remote.confidence) || 0)),
        reason: remote.reason || "Suggested by live model using column metadata.",
        transform: remote.target === "ignore" ? "No transformation" : transformLabel(remote.target)
      };
    }
    return suggestion;
  });
}

export function transformLabel(target) {
  const labels = {
    email: "Trim, lowercase, validate email",
    owner_email: "Trim, lowercase, validate email",
    phone: "Preserve prefix, remove formatting",
    created_at: "Convert to ISO date",
    lifecycle_stage: "Normalize lifecycle value",
    full_name: "Trim and title-case",
    customer_id: "Trim and preserve source ID",
    company: "Trim whitespace",
    country: "Trim and standardize spacing"
  };
  return labels[target] || "Direct copy";
}

export function transformValue(target, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (target === "email" || target === "owner_email") return text.toLowerCase();
  if (target === "phone") {
    const digits = text.replace(/\D/g, "");
    if (!digits) return "";
    if (text.startsWith("+")) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${digits}`;
  }
  if (target === "created_at") {
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(text)) {
      const [year, month, day] = text.split(/[-/]/).map(Number);
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(text)) {
      const [month, day, year] = text.split(/[-/]/).map(Number);
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return text;
  }
  if (target === "lifecycle_stage") return normalizeStage(text);
  if (target === "full_name") {
    return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return text.replace(/\s+/g, " ");
}

export function buildPreview(records, mappings, limit = 6) {
  const active = mappings.filter((mapping) => mapping.target !== "ignore");
  return records.slice(0, limit).map((record) =>
    Object.fromEntries(active.map((mapping) => [
      mapping.target,
      transformValue(mapping.target, record[mapping.source])
    ]))
  );
}

export function validateMappings(mappings, profile, records) {
  const active = mappings.filter((mapping) => mapping.target !== "ignore");
  const targets = active.map((mapping) => mapping.target);
  const duplicateTargets = [...new Set(targets.filter((target, index) => targets.indexOf(target) !== index))];
  const mappedTargets = new Set(targets);
  const missingRequired = requiredFields.filter((field) => !mappedTargets.has(field.key));
  const issues = [];

  for (const field of missingRequired) {
    issues.push({
      severity: "high",
      title: `Required field not mapped: ${field.label}`,
      detail: `Map a source column to ${field.key} before handoff.`
    });
  }
  for (const target of duplicateTargets) {
    issues.push({
      severity: "high",
      title: `Duplicate destination: ${getField(target)?.label || target}`,
      detail: "Two source columns map to the same canonical field."
    });
  }

  const emailMapping = active.find((mapping) => mapping.target === "email");
  const invalidEmails = emailMapping
    ? records.filter((record) => {
      const value = transformValue("email", record[emailMapping.source]);
      return value && !EMAIL_PATTERN.test(value);
    })
    : [];
  if (invalidEmails.length) {
    issues.push({
      severity: "medium",
      title: `${invalidEmails.length} invalid work email${invalidEmails.length === 1 ? "" : "s"}`,
      detail: "Normalize or correct malformed email values before loading the CRM."
    });
  }

  const idMapping = active.find((mapping) => mapping.target === "customer_id");
  const ids = idMapping
    ? records.map((record) => String(record[idMapping.source] ?? "").trim()).filter(Boolean)
    : [];
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    issues.push({
      severity: "medium",
      title: `${new Set(duplicateIds).size} duplicate customer ID${new Set(duplicateIds).size === 1 ? "" : "s"}`,
      detail: "Duplicate IDs can merge or overwrite distinct CRM records."
    });
  }

  const missingValues = [];
  for (const field of requiredFields) {
    const mapping = active.find((candidate) => candidate.target === field.key);
    if (!mapping) continue;
    const missing = records.filter((record) => !String(record[mapping.source] ?? "").trim()).length;
    if (missing) missingValues.push(`${field.label}: ${missing}`);
  }
  if (missingValues.length) {
    issues.push({
      severity: "medium",
      title: "Required values are blank",
      detail: missingValues.join(", ")
    });
  }

  const piiFields = profile.filter((column) => column.piiTypes.length);
  let score = 100;
  score -= missingRequired.length * 24;
  score -= duplicateTargets.length * 14;
  score -= invalidEmails.length * 6;
  score -= new Set(duplicateIds).size * 9;
  score -= missingValues.length * 5;
  if (piiFields.length) score -= 2;
  score = Math.max(0, Math.min(100, score));

  const readiness = missingRequired.length || duplicateTargets.length
    ? "blocked"
    : score >= 90
      ? "ready"
      : score >= 68
        ? "review"
        : "blocked";
  const checks = [
    {
      label: "Required schema",
      state: missingRequired.length ? "fail" : "pass",
      detail: missingRequired.length ? `${missingRequired.length} required field missing` : "All required fields mapped"
    },
    {
      label: "Unique mapping",
      state: duplicateTargets.length ? "fail" : "pass",
      detail: duplicateTargets.length ? `${duplicateTargets.length} duplicate target` : "One source per destination"
    },
    {
      label: "Email quality",
      state: invalidEmails.length ? "warn" : "pass",
      detail: invalidEmails.length ? `${invalidEmails.length} malformed value` : "Email format valid"
    },
    {
      label: "Identity quality",
      state: duplicateIds.length ? "warn" : "pass",
      detail: duplicateIds.length ? `${new Set(duplicateIds).size} duplicate ID` : "Customer IDs unique"
    },
    {
      label: "PII visibility",
      state: piiFields.length ? "warn" : "pass",
      detail: piiFields.length ? `${piiFields.length} columns require handling` : "No sensitive fields detected"
    }
  ];

  return {
    score,
    readiness,
    issues,
    checks,
    invalidEmailCount: invalidEmails.length,
    duplicateIdCount: new Set(duplicateIds).size,
    missingRequired: missingRequired.map((field) => field.key),
    duplicateTargets,
    piiFields: piiFields.map((field) => ({ name: field.name, types: field.piiTypes }))
  };
}

function recommendationsFor(validation, mappings) {
  const recommendations = [];
  if (validation.missingRequired.length) {
    recommendations.push("Map every required canonical field before creating the customer import.");
  }
  if (validation.duplicateTargets.length) {
    recommendations.push("Keep exactly one source column for each destination field.");
  }
  if (validation.invalidEmailCount) {
    recommendations.push("Correct malformed email values or route them to a quarantine file.");
  }
  if (validation.duplicateIdCount) {
    recommendations.push("Resolve duplicate customer IDs with the customer before the first sync.");
  }
  if (validation.piiFields.length) {
    recommendations.push("Confirm retention, access, and masking rules for every detected PII field.");
  }
  const ignored = mappings.filter((mapping) => mapping.target === "ignore");
  if (ignored.length) {
    recommendations.push(`Document why ${ignored.length} source column${ignored.length === 1 ? "" : "s"} can be excluded.`);
  }
  if (!recommendations.length) {
    recommendations.push("Run a five-row pilot load and verify record counts before the full import.");
  }
  return recommendations;
}

export function analyzeDataset(csvText, options = {}) {
  const startedAt = performance.now();
  const dataset = parseCsv(csvText);
  const profile = profileColumns(dataset.headers, dataset.records);
  const mappings = generateMappings(profile, options.overrides || {}, options.remoteSuggestions || {});
  const validation = validateMappings(mappings, profile, dataset.records);
  const preview = buildPreview(dataset.records, mappings);
  const mappedFields = new Set(mappings.filter((mapping) => mapping.target !== "ignore").map((mapping) => mapping.target));
  const schemaCoverage = Math.round((mappedFields.size / canonicalFields.length) * 100);
  const latencyMs = Math.max(9, Math.round(performance.now() - startedAt));

  return {
    datasetName: options.datasetName || "customer_import.csv",
    generatedAt: new Date().toISOString(),
    provider: options.provider || "local",
    model: options.model || "deterministic-mapper",
    rowCount: dataset.rowCount,
    columnCount: dataset.headers.length,
    summary: `${dataset.rowCount} rows and ${dataset.headers.length} source columns profiled. ${mappedFields.size} canonical fields mapped with ${schemaCoverage}% schema coverage.`,
    profile,
    mappings,
    validation,
    preview,
    recommendations: recommendationsFor(validation, mappings),
    quality: {
      schemaCoverage,
      readinessScore: validation.score,
      privacyMode: "local-browser",
      rawRowsTransmitted: false,
      latencyMs,
      schemaValid: true
    }
  };
}

export function validateOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Mapping overrides must be an object.";
  const allowed = new Set([...canonicalFields.map((field) => field.key), "ignore"]);
  for (const target of Object.values(value)) {
    if (!allowed.has(target)) return `Unknown destination field: ${target}`;
  }
  return null;
}
