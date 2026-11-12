import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";

async function withServer(options, callback) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health reports local-first mode", async () => {
  await withServer({ apiKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.provider, "local");
    assert.equal(payload.privacy, "metadata-only-live-route");
  });
});

test("mapping endpoint returns suggestions from metadata only", async () => {
  await withServer({ apiKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/suggest-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        columns: [
          { name: "Customer Ref", type: "id" },
          { name: "Work Email", type: "email" }
        ]
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.suggestions["Customer Ref"].target, "customer_id");
    assert.equal(payload.suggestions["Work Email"].target, "email");
  });
});

test("mapping endpoint rejects invalid metadata", async () => {
  await withServer({ apiKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/suggest-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columns: [{ name: "", type: "text" }] })
    });
    assert.equal(response.status, 400);
  });
});

test("live provider failure falls back to local mapping", async () => {
  await withServer({
    apiKey: "test-key",
    liveProvider: async () => {
      throw new Error("provider timeout");
    }
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/suggest-mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine: "auto",
        columns: [{ name: "Work Email", type: "email" }]
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.provider, "local");
    assert.equal(payload.suggestions["Work Email"].target, "email");
  });
});
