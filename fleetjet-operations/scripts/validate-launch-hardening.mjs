import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker from "../worker/index.js";

delete globalThis.__deliveryTrackerDb;
const env = { DISPATCHER_USERNAME: "launch-fixture", DISPATCHER_PASSWORD: "fixture-password-only" };
const request = (path, body, headers = {}) => new Request("https://app.floraljet.llc" + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body
});
for (const path of ["/api/auth/login", "/api/auth/logout", "/api/company", "/api/drivers", "/api/my-mileage/consent", "/api/leads"]) {
  const r = await worker.fetch(request(path, "{}", { Origin: "https://evil.example" }), env);
  assert.equal(r.status, 403, path);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
}
assert.equal((await worker.fetch(request("/api/auth/login", "{}", { "Sec-Fetch-Site": "cross-site" }), env)).status, 403);
assert.equal((await worker.fetch(request("/api/auth/login", "{broken", { Origin: "https://app.floraljet.llc" }), env)).status, 400);
const large = await worker.fetch(request("/api/auth/login", JSON.stringify({ value: "x".repeat(1024 * 1024) })), env);
assert.equal(large.status, 413, "unbounded JSON cannot exhaust the worker");
const native = await worker.fetch(request("/api/auth/login", JSON.stringify({ identifier: env.DISPATCHER_USERNAME, password: env.DISPATCHER_PASSWORD })), env);
assert.equal(native.status, 200, "Origin-less native authentication remains supported");
assert.equal(native.headers.get("Cache-Control"), "no-store");
const leads = await worker.fetch(request("/api/leads", JSON.stringify({ website: "honeypot" }), { Origin: "https://floraljet.llc" }), env);
assert.equal(leads.status, 202, "the existing public marketing integration stays usable");
const failedStorage = await worker.fetch(new Request("https://app.floraljet.llc/api/me"), { DB: { prepare() { throw new Error("fixture-secret-must-not-leak"); } } });
assert.equal(failedStorage.status, 500);
assert.ok(!(await failedStorage.text()).includes("fixture-secret"));

const source = fs.readFileSync("public/app.js", "utf8");
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
};
let dirty = false, menu = false, active = null, renders = 0;
const context = { state: { dispatcherView: "operations" }, document: {
  get activeElement() { return active; },
  querySelector(selector) { return selector.includes("data-dirty") ? dirty : selector.includes("[open]") ? menu : null; }
}, render() { renders++; } };
vm.createContext(context);
vm.runInContext(["hasUnsavedForm", "workspaceInteractionOpen", "maybeRender", "markDraftDirty"].map(extract).join("\n"), context);
context.maybeRender(); assert.equal(renders, 1);
menu = true; context.maybeRender(); assert.equal(renders, 1, "live changes cannot close an open menu");
menu = false; dirty = true; context.maybeRender(); assert.equal(renders, 1, "blurred unsaved order edits remain protected");
dirty = false; active = { tagName: "INPUT" }; context.maybeRender(); assert.equal(renders, 1);
active = null; context.maybeRender(); assert.equal(renders, 2);
const editor = { dataset: {} };
context.markDraftDirty({ closest(selector) { return selector === ".order-editor" ? editor : null; } });
assert.equal(editor.dataset.dirty, "true");
assert.match(source, /if \(changed\) maybeRender\(\)/, "unchanged polls do not rebuild dispatch");
assert.match(source, /state\.myMileage = response\.snapshot\.myMileage \|\| null/, "private mileage health follows the authenticated polling response");
assert.doesNotMatch(source, /if \(changed \|\| state.auth\?\.role === "dispatcher"\)/);
console.log("Launch hardening passed: cross-origin write protection, bounded/invalid JSON, private response caching, error redaction, native compatibility, and stable menus/unsaved edits.");
