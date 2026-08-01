import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Average Derivative Lab shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Average Derivative Lab — Locally centered EDR<\/title>/i);
  assert.match(html, /modified, locally centered single-index EDR procedure/i);
  assert.match(html, /Preparing the locally centered simulation/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("includes the manuscript data-fit statistic in computation and display", async () => {
  const [page, simulation, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/simulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /◇ₖ data fit/);
  assert.match(page, /row\.dataFit/);
  assert.match(simulation, /dataFit:\s*number/);
  assert.match(simulation, /localResponseMeans/);
  assert.match(simulation, /residual \* residual \* weight/);
  assert.match(css, /grid-template-columns:repeat\(5,1fr\)/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
