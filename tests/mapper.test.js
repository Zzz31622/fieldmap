import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../public/js/csv.js";
import { sampleCsv } from "../public/js/sample-data.js";
import {
  analyzeDataset,
  inferType,
  profileColumns,
  suggestMapping,
  transformValue,
  validateOverrides
} from "../public/js/mapper.js";

test("CSV parser handles quoted commas and newlines", () => {
  const parsed = parseCsv('id,name,note\n1,"Chen, Maya","line one\nline two"\n');
  assert.deepEqual(parsed.headers, ["id", "name", "note"]);
  assert.equal(parsed.records[0].name, "Chen, Maya");
  assert.equal(parsed.records[0].note, "line one\nline two");
});

test("type inference identifies core onboarding fields", () => {
  assert.equal(inferType(["a@example.com", "b@example.com"], "Work Email"), "email");
  assert.equal(inferType(["+1 415 555 0100", "+44 20 7946 0912"], "Phone"), "phone");
  assert.equal(inferType(["2026-01-02", "2026-03-04"], "Signup Date"), "date");
  assert.equal(inferType(["C-1042", "C-1043"], "Customer Ref"), "id");
  assert.equal(inferType(["Trial", "Active", "Customer"], "Status"), "enum");
});

test("sample dataset maps all source columns to expected canonical fields", () => {
  const result = analyzeDataset(sampleCsv, { datasetName: "northstar_contacts.csv" });
  assert.equal(result.rowCount, 8);
  assert.equal(result.columnCount, 9);
  assert.deepEqual(result.mappings.map((mapping) => mapping.target), [
    "customer_id",
    "full_name",
    "email",
    "company",
    "country",
    "phone",
    "created_at",
    "lifecycle_stage",
    "owner_email"
  ]);
  assert.equal(result.validation.score, 83);
  assert.equal(result.validation.readiness, "review");
  assert.equal(result.validation.invalidEmailCount, 1);
  assert.equal(result.validation.duplicateIdCount, 1);
});

test("transformations normalize privacy-sensitive values", () => {
  assert.equal(transformValue("email", "  MAYA@EXAMPLE.COM "), "maya@example.com");
  assert.equal(transformValue("phone", "+1 (415) 555-0188"), "+14155550188");
  assert.equal(transformValue("created_at", "2026/08/14"), "2026-08-14");
  assert.equal(transformValue("lifecycle_stage", "Active"), "customer");
});

test("manual override changes mapping and validation", () => {
  const profile = profileColumns(["Customer Ref", "Email"], [{ "Customer Ref": "1", Email: "a@example.com" }]);
  assert.equal(suggestMapping(profile[0]).target, "customer_id");
  const result = analyzeDataset("Customer Ref,Email\n1,a@example.com", {
    overrides: { "Customer Ref": "ignore" }
  });
  assert.equal(result.validation.missingRequired.includes("customer_id"), true);
  assert.equal(result.validation.readiness, "blocked");
});

test("mapping override validation rejects unknown fields", () => {
  assert.match(validateOverrides({ Email: "not_real" }), /Unknown destination/);
  assert.equal(validateOverrides({ Email: "email" }), null);
});
