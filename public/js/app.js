import { analyzeDataset, validateOverrides } from "./mapper.js";
import { sampleCsv, sampleDataset } from "./sample-data.js";
import { canonicalFields, getField, maskValue } from "./schema.js";

const STORAGE_KEY = "fieldmap-review-v1";

const state = {
  datasetName: sampleDataset.name,
  csvText: sampleCsv,
  source: sampleDataset.source,
  analysis: null,
  overrides: {},
  remoteSuggestions: {},
  provider: "local",
  liveModel: null,
  activeView: "mapping",
  approved: false,
  toastTimer: null
};

const elements = {
  datasetName: document.querySelector("#datasetName"),
  datasetSource: document.querySelector("#datasetSource"),
  rowMetric: document.querySelector("#rowMetric"),
  columnMetric: document.querySelector("#columnMetric"),
  fieldMetric: document.querySelector("#fieldMetric"),
  piiMetric: document.querySelector("#piiMetric"),
  fileInput: document.querySelector("#fileInput"),
  sampleButton: document.querySelector("#sampleButton"),
  loadButton: document.querySelector("#loadButton"),
  runButton: document.querySelector("#runButton"),
  engineStatus: document.querySelector("#engineStatus"),
  engineLabel: document.querySelector("#engineLabel"),
  sourceCount: document.querySelector("#sourceCount"),
  sourceList: document.querySelector("#sourceList"),
  typeSummary: document.querySelector("#typeSummary"),
  mappingMeta: document.querySelector("#mappingMeta"),
  mappingRows: document.querySelector("#mappingRows"),
  previewTable: document.querySelector("#previewTable"),
  analysisSummary: document.querySelector("#analysisSummary"),
  handoffMappings: document.querySelector("#handoffMappings"),
  recommendationList: document.querySelector("#recommendationList"),
  scoreValue: document.querySelector("#scoreValue"),
  scoreMeter: document.querySelector("#scoreMeter"),
  readinessBadge: document.querySelector("#readinessBadge"),
  readinessCopy: document.querySelector("#readinessCopy"),
  checkCount: document.querySelector("#checkCount"),
  checkList: document.querySelector("#checkList"),
  issueCount: document.querySelector("#issueCount"),
  issueList: document.querySelector("#issueList"),
  piiCount: document.querySelector("#piiCount"),
  piiList: document.querySelector("#piiList"),
  approveButton: document.querySelector("#approveButton"),
  approvalTitle: document.querySelector("#approvalTitle"),
  approvalCopy: document.querySelector("#approvalCopy"),
  approvalFootnote: document.querySelector("#approvalFootnote"),
  jsonButton: document.querySelector("#jsonButton"),
  exportButton: document.querySelector("#exportButton"),
  toast: document.querySelector("#toast")
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readinessLabel(readiness) {
  return readiness === "ready" ? "Ready" : readiness === "blocked" ? "Blocked" : "Review";
}

function safeFileName(value) {
  return String(value || "customer_import")
    .replace(/\.csv$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "customer-import";
}

function maskPreview(field, value) {
  if (field.key === "full_name") {
    const parts = String(value || "").split(/\s+/).filter(Boolean);
    return parts.length ? parts.map((part) => `${part[0]}***`).join(" ") : "—";
  }
  return maskValue(field.type, value);
}

function recompute(options = {}) {
  state.analysis = analyzeDataset(state.csvText, {
    datasetName: state.datasetName,
    overrides: state.overrides,
    remoteSuggestions: state.remoteSuggestions,
    provider: options.provider || state.analysis?.provider || "local",
    model: options.model || state.analysis?.model || "deterministic-mapper"
  });
}

function renderMetrics() {
  const analysis = state.analysis;
  const mapped = analysis.mappings.filter((mapping) => mapping.target !== "ignore").length;
  const piiFields = analysis.validation.piiFields.length;
  elements.rowMetric.textContent = String(analysis.rowCount);
  elements.columnMetric.textContent = String(analysis.columnCount);
  elements.fieldMetric.textContent = `${mapped}/${analysis.columnCount}`;
  elements.piiMetric.textContent = String(piiFields);
  elements.sourceCount.textContent = String(analysis.columnCount);
  elements.mappingMeta.textContent = `${analysis.columnCount} source columns · ${analysis.quality.schemaCoverage}% schema coverage`;
  elements.datasetSource.textContent = state.source;
}

function renderSourceList() {
  const analysis = state.analysis;
  elements.sourceList.innerHTML = analysis.profile.map((column) => `
    <div class="source-item">
      <div>
        <code class="source-name" title="${escapeHtml(column.name)}">${escapeHtml(column.name)}</code>
        <span class="source-sample">${escapeHtml(column.sampleMasked)}</span>
      </div>
      <span class="source-tags">
        ${column.piiTypes.length ? '<span class="pii-dot" title="PII detected">PII</span>' : ""}
        <span class="type-badge ${escapeHtml(column.type)}">${escapeHtml(column.type)}</span>
      </span>
    </div>
  `).join("");

  const counts = new Map();
  for (const column of analysis.profile) {
    counts.set(column.type, (counts.get(column.type) || 0) + 1);
  }
  elements.typeSummary.innerHTML = `
    <div class="type-summary-list">
      ${[...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, count]) => `<span class="type-summary-item"><strong>${count}</strong>${escapeHtml(type)}</span>`)
        .join("")}
    </div>
  `;
}

function targetOptions(selected) {
  return [
    '<option value="ignore">Ignore column</option>',
    ...canonicalFields.map((field) =>
      `<option value="${escapeHtml(field.key)}" ${selected === field.key ? "selected" : ""}>${escapeHtml(field.label)}${field.required ? " *" : ""}</option>`
    )
  ].join("");
}

function renderMappingTable() {
  const analysis = state.analysis;
  elements.mappingRows.innerHTML = analysis.mappings.map((mapping) => {
    const column = analysis.profile.find((candidate) => candidate.name === mapping.source);
    const destination = mapping.target === "ignore"
      ? "Ignored"
      : getField(mapping.target)?.description || mapping.target;
    const confidence = Math.round(mapping.confidence * 100);
    return `
      <tr>
        <td class="source-column-cell">
          <code>${escapeHtml(mapping.source)}</code>
          <span class="type-badge ${escapeHtml(column?.type || "text")}">${escapeHtml(column?.type || "text")}</span>
        </td>
        <td class="sample-cell" title="${escapeHtml(column?.sampleMasked || "—")}">${escapeHtml(column?.sampleMasked || "—")}</td>
        <td>
          <span class="sr-only">Destination for ${escapeHtml(mapping.source)}</span>
          <select class="target-select ${mapping.target === "ignore" ? "is-unmapped" : ""}" data-source="${escapeHtml(mapping.source)}" aria-label="Destination for ${escapeHtml(mapping.source)}">
            ${targetOptions(mapping.target)}
          </select>
        </td>
        <td class="transform-cell" title="${escapeHtml(destination)}">
          ${escapeHtml(mapping.transform)}
        </td>
        <td>
          <div class="confidence-cell">
            <progress class="confidence-meter" max="100" value="${confidence}" aria-label="Mapping confidence">${confidence}%</progress>
            <span class="confidence-label">${confidence}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderPreview() {
  const analysis = state.analysis;
  const fields = canonicalFields.filter((field) =>
    analysis.mappings.some((mapping) => mapping.target === field.key)
  );
  if (!fields.length) {
    elements.previewTable.innerHTML = '<tbody><tr><td class="issue-empty">No mapped fields to preview.</td></tr></tbody>';
    return;
  }
  elements.previewTable.innerHTML = `
    <thead>
      <tr>${fields.map((field) => `<th>${escapeHtml(field.label)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${analysis.preview.map((row) => `
        <tr>
          ${fields.map((field) => `<td title="${escapeHtml(row[field.key] ?? "")}">${escapeHtml(maskPreview(field, row[field.key]))}</td>`).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderHandoff() {
  const analysis = state.analysis;
  elements.analysisSummary.textContent = analysis.summary;
  elements.handoffMappings.innerHTML = analysis.mappings.map((mapping) => `
    <div class="compact-map-row">
      <span title="${escapeHtml(mapping.source)}">${escapeHtml(mapping.source)}</span>
      <svg class="icon"><use href="#icon-arrow-right"></use></svg>
      <strong>${escapeHtml(mapping.target === "ignore" ? "Ignored" : getField(mapping.target)?.label || mapping.target)}</strong>
    </div>
  `).join("");
  elements.recommendationList.innerHTML = analysis.recommendations
    .map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`)
    .join("");
}

function renderReadiness() {
  const validation = state.analysis.validation;
  const readiness = validation.readiness;
  elements.scoreValue.textContent = String(validation.score);
  elements.scoreMeter.value = validation.score;
  elements.readinessBadge.textContent = readinessLabel(readiness);
  elements.readinessBadge.className = `readiness-badge ${readiness}`;

  const copy = {
    ready: "Schema and quality checks are ready for a pilot load. Confirm the mappings before export.",
    review: "Resolve the highlighted quality issues or document them before creating the customer import.",
    blocked: "Required mapping or uniqueness checks failed. Fix blocking issues before export."
  };
  elements.readinessCopy.textContent = copy[readiness];

  const passed = validation.checks.filter((check) => check.state === "pass").length;
  elements.checkCount.textContent = `${passed}/${validation.checks.length}`;
  elements.checkList.innerHTML = validation.checks.map((check) => `
    <div class="check-item">
      <span class="check-icon ${escapeHtml(check.state)}">
        <svg class="icon"><use href="${check.state === "pass" ? "#icon-check" : "#icon-warning"}"></use></svg>
      </span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        <p>${escapeHtml(check.detail)}</p>
      </div>
    </div>
  `).join("");

  elements.issueCount.textContent = String(validation.issues.length);
  if (!validation.issues.length) {
    elements.issueList.innerHTML = '<p class="issue-empty">No open issues.</p>';
  } else {
    elements.issueList.innerHTML = validation.issues.map((issue) => `
      <div class="issue-item">
        <span class="issue-icon ${escapeHtml(issue.severity)}">
          <svg class="icon"><use href="#icon-warning"></use></svg>
        </span>
        <div>
          <strong>${escapeHtml(issue.title)}</strong>
          <p>${escapeHtml(issue.detail)}</p>
        </div>
      </div>
    `).join("");
  }

  elements.piiCount.textContent = String(validation.piiFields.length);
  elements.piiList.innerHTML = validation.piiFields.length
    ? validation.piiFields.map((field) => `
      <span class="pii-chip" title="${escapeHtml(field.types.join(", "))}">
        <strong>${escapeHtml(field.name)}</strong>
      </span>
    `).join("")
    : '<span class="issue-empty">No PII detected.</span>';
}

function renderApproval() {
  const validation = state.analysis.validation;
  const blocked = validation.missingRequired.length > 0 || validation.duplicateTargets.length > 0;
  elements.approveButton.disabled = blocked;
  elements.approveButton.classList.toggle("is-approved", state.approved);
  elements.approveButton.innerHTML = state.approved
    ? '<svg class="icon"><use href="#icon-check"></use></svg> Mapping approved'
    : '<svg class="icon"><use href="#icon-check"></use></svg> Approve mapping';
  elements.approvalTitle.textContent = state.approved ? "Plan approved" : blocked ? "Blocked by mapping errors" : "Approve mapping";
  elements.approvalCopy.textContent = state.approved
    ? "A human reviewer approved the field mapping and validation summary. No CRM record was created."
    : blocked
      ? "Resolve required fields and duplicate destinations before requesting approval."
      : "Review field mappings and quality issues before exporting the implementation plan.";
  elements.approvalFootnote.textContent = state.approved
    ? "Reviewed locally · no raw rows exported"
    : "Local review state · no CRM write";
}

function renderAll() {
  elements.datasetName.value = state.datasetName;
  renderMetrics();
  renderSourceList();
  renderMappingTable();
  renderPreview();
  renderHandoff();
  renderReadiness();
  renderApproval();
}

function activateView(view) {
  state.activeView = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  for (const [name, id] of [["mapping", "mappingView"], ["preview", "previewView"], ["handoff", "handoffView"]]) {
    const panel = document.querySelector(`#${id}`);
    const active = name === view;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
}

async function checkProvider() {
  try {
    const response = await fetch(new URL("api/health", new URL("./", window.location.href)));
    if (!response.ok) throw new Error("No API");
    const payload = await response.json();
    state.provider = payload.provider;
    elements.engineStatus.classList.toggle("is-live", payload.provider === "openai-ready");
    elements.engineLabel.textContent = payload.provider === "openai-ready" ? "OpenAI ready" : "Local mapper";
  } catch {
    state.provider = "local";
    elements.engineStatus.classList.remove("is-live");
    elements.engineLabel.textContent = "Local mapper";
  }
}

async function requestLiveSuggestions() {
  const columns = state.analysis.profile.map((column) => ({
    name: column.name,
    type: column.type
  }));
  const response = await fetch(new URL("api/suggest-mappings", new URL("./", window.location.href)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "auto", columns })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Live mapping failed");
  return payload;
}

async function runMapping() {
  elements.runButton.disabled = true;
  elements.runButton.classList.add("is-loading");
  elements.runButton.querySelector("span").textContent = "Mapping";
  try {
    if (state.provider === "openai-ready") {
      try {
        const payload = await requestLiveSuggestions();
        state.remoteSuggestions = payload.suggestions;
        state.liveModel = payload.model;
        recompute({
          provider: payload.provider === "openai" ? "openai-assisted" : "local",
          model: payload.model
        });
        showToast(payload.provider === "openai" ? "Live mapping complete" : "Local mapping complete");
      } catch {
        state.remoteSuggestions = {};
        recompute({ provider: "local", model: "deterministic-mapper" });
        showToast("Live route unavailable. Local mapper used.");
      }
    } else {
      state.remoteSuggestions = {};
      recompute({ provider: "local", model: "deterministic-mapper" });
      showToast("Local mapping complete");
    }
    state.approved = false;
    renderAll();
  } finally {
    elements.runButton.disabled = false;
    elements.runButton.classList.remove("is-loading");
    elements.runButton.querySelector("span").textContent = "Run mapping";
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
    showToast("Choose a CSV file.");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast("CSV must be 2 MB or smaller.");
    return;
  }
  try {
    const csv = await file.text();
    analyzeDataset(csv, { datasetName: file.name });
    state.csvText = csv;
    state.datasetName = file.name;
    state.source = "Local file · not uploaded";
    state.overrides = {};
    state.remoteSuggestions = {};
    state.liveModel = null;
    state.approved = false;
    recompute({ provider: "local", model: "deterministic-mapper" });
    renderAll();
    activateView("mapping");
    showToast("CSV loaded locally");
  } catch (error) {
    showToast(error.message || "Could not parse CSV.");
  } finally {
    elements.fileInput.value = "";
  }
}

function resetSample() {
  state.csvText = sampleCsv;
  state.datasetName = sampleDataset.name;
  state.source = sampleDataset.source;
  state.overrides = {};
  state.remoteSuggestions = {};
  state.liveModel = null;
  state.approved = false;
  recompute({ provider: "local", model: "deterministic-mapper" });
  renderAll();
  activateView("mapping");
  showToast("Synthetic sample restored");
}

function mappingPlan() {
  const analysis = state.analysis;
  return {
    dataset: analysis.datasetName,
    generatedAt: analysis.generatedAt,
    rows: analysis.rowCount,
    columns: analysis.columnCount,
    readiness: {
      state: analysis.validation.readiness,
      score: analysis.validation.score
    },
    mappings: analysis.mappings.map((mapping) => ({
      source: mapping.source,
      destination: mapping.target,
      confidence: mapping.confidence,
      transformation: mapping.transform,
      reason: mapping.reason
    })),
    checks: analysis.validation.checks,
    issues: analysis.validation.issues,
    piiFields: analysis.validation.piiFields,
    recommendations: analysis.recommendations,
    privacy: {
      processing: "local-browser",
      rawRowsTransmitted: false
    }
  };
}

function download(content, name, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download(
    JSON.stringify(mappingPlan(), null, 2),
    `${safeFileName(state.datasetName)}-mapping.json`,
    "application/json"
  );
  showToast("Mapping plan exported");
}

function exportMarkdown() {
  const analysis = state.analysis;
  const mappings = analysis.mappings.map((mapping) =>
    `| ${mapping.source.replaceAll("|", "\\|")} | ${mapping.target} | ${Math.round(mapping.confidence * 100)}% | ${mapping.transform} |`
  ).join("\n");
  const issues = analysis.validation.issues.length
    ? analysis.validation.issues.map((issue) => `- **${issue.severity.toUpperCase()}** ${issue.title}: ${issue.detail}`).join("\n")
    : "- No open issues.";
  const recommendations = analysis.recommendations.map((item, index) => `${index + 1}. ${item}`).join("\n");
  const pii = analysis.validation.piiFields.length
    ? analysis.validation.piiFields.map((field) => `- ${field.name}: ${field.types.join(", ")}`).join("\n")
    : "- No PII detected.";

  const brief = `# FieldMap customer data onboarding plan

- **Dataset:** ${analysis.datasetName}
- **Rows:** ${analysis.rowCount}
- **Source columns:** ${analysis.columnCount}
- **Readiness:** ${readinessLabel(analysis.validation.readiness)} (${analysis.validation.score}/100)
- **Human approval:** ${state.approved ? "Approved" : "Pending"}

## Field mapping

| Source column | Destination | Confidence | Transformation |
| --- | --- | ---: | --- |
${mappings}

## Open issues

${issues}

## PII review

${pii}

## Recommended next steps

${recommendations}

## Privacy

Raw CSV rows stayed in the local browser. This handoff contains field metadata and validation summaries only.

---

Generated by FieldMap. Verify mapping and customer data policy before loading the CRM.
`;
  download(brief, `${safeFileName(state.datasetName)}-onboarding.md`, "text/markdown");
  showToast("Onboarding plan exported");
}

function bindEvents() {
  document.querySelector(".view-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (tab) activateView(tab.dataset.view);
  });
  elements.mappingRows.addEventListener("change", (event) => {
    const select = event.target.closest("[data-source]");
    if (!select) return;
    const error = validateOverrides({ [select.dataset.source]: select.value });
    if (error) {
      showToast(error);
      return;
    }
    state.overrides[select.dataset.source] = select.value;
    state.approved = false;
    recompute({
      provider: state.analysis.provider,
      model: state.analysis.model
    });
    renderAll();
  });
  elements.datasetName.addEventListener("change", () => {
    state.datasetName = elements.datasetName.value.trim() || "customer_import.csv";
    recompute({
      provider: state.analysis.provider,
      model: state.analysis.model
    });
    renderAll();
  });
  elements.loadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", () => loadFile(elements.fileInput.files[0]));
  elements.sampleButton.addEventListener("click", resetSample);
  elements.runButton.addEventListener("click", runMapping);
  elements.approveButton.addEventListener("click", () => {
    if (elements.approveButton.disabled) return;
    state.approved = true;
    renderApproval();
    showToast("Human mapping approval recorded");
  });
  elements.jsonButton.addEventListener("click", exportJson);
  elements.exportButton.addEventListener("click", exportMarkdown);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runMapping();
    }
  });
}

recompute();
bindEvents();
renderAll();
checkProvider();
