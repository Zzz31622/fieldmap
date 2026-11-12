import { readFile } from "node:fs/promises";
import { suggestMapping } from "../public/js/mapper.js";

const cases = JSON.parse(
  await readFile(new URL("../evals/cases.json", import.meta.url), "utf8")
);

const rows = cases.map((item) => {
  const actual = item.columns.map(([name, type]) =>
    suggestMapping({ name, type, rawSamples: [], piiTypes: [] }).target
  );
  const matched = actual.filter((target, index) => target === item.expected[index]).length;
  return {
    id: item.id,
    matched: `${matched}/${item.expected.length}`,
    accuracy: matched / item.expected.length,
    pass: matched === item.expected.length ? "PASS" : "FAIL",
    actual: actual.join(", ")
  };
});

console.table(rows);
const accuracy = rows.reduce((sum, row) => sum + row.accuracy, 0) / rows.length;
const allPassed = rows.every((row) => row.pass === "PASS");
console.log(`\nTop-1 mapping accuracy: ${(accuracy * 100).toFixed(1)}%`);

if (!allPassed) {
  console.error("Mapping evaluation gates failed.");
  process.exitCode = 1;
} else {
  console.log("All mapping evaluation gates passed.");
}
