import { canonicalFields, getField } from "../public/js/schema.js";
import { transformLabel } from "../public/js/mapper.js";

const mappingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mappings"],
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "target", "confidence", "reason"],
        properties: {
          source: { type: "string" },
          target: { type: "string", enum: [...canonicalFields.map((field) => field.key), "ignore"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" }
        }
      }
    }
  }
};

const instructions = `You map customer onboarding CSV headers to a canonical CRM schema.
Use only the supplied column names and inferred types. Never ask for or infer from raw row values.
Choose one target per source. Use "ignore" when no canonical field fits.
Return a confidence from 0 to 1 and a short technical reason for each source column.`;

function extractText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
}

export function normalizeLiveSuggestions(parsed, columns) {
  const sources = new Set(columns.map((column) => column.name));
  const allowedTargets = new Set([...canonicalFields.map((field) => field.key), "ignore"]);
  if (!Array.isArray(parsed?.mappings)) throw new Error("Model output is missing mappings.");

  return Object.fromEntries(parsed.mappings
    .filter((mapping) => sources.has(mapping.source) && allowedTargets.has(mapping.target))
    .map((mapping) => [
      mapping.source,
      {
        target: mapping.target,
        confidence: Math.max(0, Math.min(1, Number(mapping.confidence) || 0)),
        reason: String(mapping.reason || "").slice(0, 300),
        transform: mapping.target === "ignore" ? "No transformation" : transformLabel(mapping.target)
      }
    ]));
}

export async function suggestWithOpenAI(columns, options = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: options.model || "gpt-4.1-mini",
      instructions,
      input: JSON.stringify({
        columns,
        canonicalFields: canonicalFields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          aliases: field.aliases
        }))
      }),
      text: {
        format: {
          type: "json_schema",
          name: "fieldmap_schema_mapping",
          strict: true,
          schema: mappingSchema
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }
  const payload = await response.json();
  const text = extractText(payload);
  if (!text) throw new Error("OpenAI response contained no output text.");
  const suggestions = normalizeLiveSuggestions(JSON.parse(text), columns);
  if (!Object.keys(suggestions).length) throw new Error("Model returned no usable mappings.");
  return suggestions;
}

export function localSuggestions(columns, suggestMapping) {
  return Object.fromEntries(columns.map((column) => {
    const result = suggestMapping({
      name: column.name,
      type: column.type,
      rawSamples: [],
      piiTypes: []
    });
    return [column.name, {
      target: result.target,
      confidence: result.confidence,
      reason: result.reason,
      transform: result.target === "ignore" ? "No transformation" : transformLabel(result.target)
    }];
  }));
}

export function validateColumnMetadata(columns) {
  if (!Array.isArray(columns) || !columns.length) return "Columns array is required.";
  if (columns.length > 80) return "No more than 80 columns are allowed.";
  for (const column of columns) {
    if (!column || typeof column.name !== "string" || !column.name.trim()) return "Every column needs a name.";
    if (column.name.length > 120) return "Column names must be 120 characters or less.";
    if (!["id", "text", "email", "phone", "date", "enum", "number", "boolean"].includes(column.type)) {
      return `Unsupported column type: ${column.type}`;
    }
  }
  return null;
}

export { getField };
