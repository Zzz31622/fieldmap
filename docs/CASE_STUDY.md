# FieldMap Case Study

## Problem

Customer data onboarding is a common forward-deployed engineering task. A customer sends a CSV, but the headers rarely match the product schema. Dates, phone numbers, IDs, lifecycle values, and PII rules all need review.

A simple column mapper is not enough. The delivery team must show:

1. What each source column becomes.
2. Which required fields are missing.
3. Which values will be transformed.
4. Which fields contain sensitive data.
5. Whether the file is safe enough for a pilot import.

## Product Slice

FieldMap covers one complete workflow: customer CSV to reviewed onboarding handoff.

The result contains:

- Source profile and inferred types.
- Canonical field mapping with confidence.
- Human override controls.
- Masked transformation preview.
- Email, identity, schema, and PII checks.
- Readiness score and review queue.
- Markdown and JSON onboarding plans.

The tool stops before writing to a CRM.

## FDE Fit

| FDE activity | Project evidence |
| --- | --- |
| Customer discovery | Readiness issues expose integration assumptions |
| Rapid delivery | Zero-dependency local and static deployment |
| Integration design | Canonical CRM schema and transformation rules |
| Security review | PII detection and metadata-only live model boundary |
| Reliability | Input limits, validation, fallback, and tests |
| Customer handoff | Reviewed Markdown and JSON implementation plans |
| Quality measurement | Eight mapping cases and deterministic transforms |

## Key Design Decisions

### Raw data stays local

The browser parses the file. The optional model receives only column names and types. This makes the privacy boundary visible in both code and interface.

### Deterministic core, optional model

The rule mapper supports a reliable demo and test harness. A live model can improve unusual header matching, but its output is constrained to canonical fields and still passes local validation.

### Readiness over a single score

The score is supported by specific checks and issues. A reviewer sees missing fields, duplicate destinations, malformed email, duplicate IDs, and PII.

### Human approval before export

The approval step records a local review decision. It does not write to a CRM or transmit raw rows.

## Validation

Current deterministic gates:

- 8/8 mapping cases pass.
- 10/10 automated tests pass.
- 100% top-1 mapping accuracy on the synthetic set.
- Raw row transmission to the live model route is disabled by contract.

## Known Limits

- The mapping cases are synthetic and small.
- Deterministic rules cannot understand every unusual header.
- No CRM dry-run connector exists.
- No durable audit log exists.
- The file size limit is intentionally small for a public demo.

## Next Milestone

Build a reversible dry-run loader:

1. Validate customer rows against a versioned schema.
2. Write to a sandbox CRM.
3. Compare expected and actual record counts.
4. Roll back the batch by import ID.
5. Capture reviewer corrections as future evaluation cases.

## Interview Summary

"FieldMap is a customer data onboarding workbench. I chose it because FDE work often fails in the last mile: mapping customer fields to product schema, handling PII, proving transformation quality, and creating a safe handoff. Raw CSV stays in the browser. The deterministic mapper runs without a key, while the optional OpenAI path receives only column metadata. I added manual overrides, readiness checks, PII detection, exports, ten tests, and eight mapping evaluation cases. The next step would be a reversible dry-run CRM loader."
