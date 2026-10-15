// Tests for worker.js with a fake AI binding and a fake KV. No Cloudflare account or Neurons needed.
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
writeFileSync("/tmp/worker-under-test.mjs", src + "\nexport { CONFIG, validateTicket, classify };\n");
const mod = await import("/tmp/worker-under-test.mjs?" + Date.now());
const worker = mod.default, { CONFIG, validateTicket } = mod;

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  :: " + JSON.stringify(detail).slice(0, 400) : "")); } };
const ORIGIN = "https://casimbahadar.github.io";
const GOOD = {
  is_job_request: true, not_request_reason: null,
  customer_name: { value: "Tom Nguyen", quote: "Tom Nguyen" }, phone: { value: "519-555-0142", quote: "Cell 519-555-0142" }, email: { value: null, quote: null },
  jobs: [{ job_type: "leak", job_quote: "water is pouring through my living room ceiling", address: { value: "88 Weber St N, Waterloo", quote: "88 Weber St N, Waterloo" },
    urgency: "urgent", urgency_reason: "Water is coming through the ceiling now.", urgency_quote: "water is pouring through my living room ceiling", preferred_times: [], extra_key: "dropped" }],
  missing: ["email"], reply_language: "en", reply_draft: "Hi Tom, we understand water is coming through your ceiling. Cedar & Copper Plumbing", injected: "<script>"
};
function kv() {
  const m = new Map(), puts = [];
  return { m, puts, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v, o) { puts.push({ k, v, o }); m.set(k, v); } };
}
function env(aiImpl, extra) {
  const calls = [];
  return Object.assign({ calls, AI: { run: async (model, input) => { calls.push({ model, input }); return aiImpl(model, input, calls.length); } }, COUNTS: kv(), IP_SALT: "test-salt", CAPTURE_KEY: "capture-secret-123" }, extra || {});
}
const llamaOK = () => ({ response: GOOD, usage: { prompt_tokens: 1000, completion_tokens: 400 } });
const gemmaOK = () => ({ choices: [{ message: { content: JSON.stringify(GOOD) } }], usage: { prompt_tokens: 1000, completion_tokens: 400 } });
function req(body, opts = {}) {
  const headers = Object.assign({ "Origin": ORIGIN, "Content-Type": "application/json", "X-Requested-With": "email-intake", "CF-Connecting-IP": "203.0.113.7" }, opts.headers || {});
  for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
  return new Request("https://w.example.workers.dev" + (opts.path || "/"), { method: opts.method || "POST", headers, body: opts.method === "GET" || opts.method === "OPTIONS" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
}
const logs = []; const orig = { log: console.log, error: console.error, warn: console.warn };
const quiet = () => { console.log = (...a) => logs.push(a); console.error = (...a) => logs.push(a); console.warn = (...a) => logs.push(a); };
const loud = () => Object.assign(console, orig);

CONFIG.liveModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
quiet();
// origin, method, headers
let e = env(llamaOK), r;
r = await worker.fetch(req(null, { method: "OPTIONS" }), e);
const pre = [r.status, r.headers.get("Access-Control-Allow-Origin")];
r = await worker.fetch(req(null, { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), e);
const preBad = [r.status, r.headers.get("Access-Control-Allow-Origin")];
r = await worker.fetch(req({ text: "hi" }, { headers: { Origin: "https://evil.example" } }), e);
const postBad = [r.status, r.headers.get("Access-Control-Allow-Origin")];
r = await worker.fetch(req(null, { method: "GET" }), e);
const getStatus = r.status;
r = await worker.fetch(req({ text: "hi there" }, { headers: { "X-Requested-With": null } }), e);
const noHeader = [r.status, (await r.json()).error];
loud();
check("preflight from the site gets CORS for that origin only", pre[0] === 204 && pre[1] === ORIGIN, pre);
check("preflight from another origin is refused with no CORS header", preBad[0] === 403 && preBad[1] === null, preBad);
check("POST from another origin is refused with no CORS header", postBad[0] === 403 && postBad[1] === null, postBad);
check("GET is refused", getStatus === 405);
check("missing X-Requested-With header is refused", noHeader[0] === 400 && noHeader[1] === "bad_request", noHeader);
check("no model call for any refused request", e.calls.length === 0, e.calls.length);

// input limits
quiet(); e = env(llamaOK);
const empty = await (await worker.fetch(req({ text: "   " }), e)).json();
const long = await (await worker.fetch(req({ text: "x".repeat(4001) }), e)).json();
const huge = await worker.fetch(req("x".repeat(25000)), e);
loud();
check("empty email: bad_input/empty, no model call", empty.error === "bad_input" && empty.detail === "empty" && e.calls.length === 0, empty);
check("4,001 characters: bad_input/too_long", long.error === "bad_input" && long.detail === "too_long", long);
check("body over 20,000 bytes: 413", huge.status === 413);

// happy path, both response shapes, key stripping
for (const [name, impl, model] of [["Llama shape", llamaOK, "@cf/meta/llama-3.3-70b-instruct-fp8-fast"], ["Gemma shape", gemmaOK, "@cf/google/gemma-4-26b-a4b-it"]]) {
  CONFIG.liveModel = model; quiet(); e = env(impl);
  r = await worker.fetch(req({ text: "Water is pouring through my ceiling" }), e); const j = await r.json(); loud();
  check(name + ": 200 with validated result", r.status === 200 && j.ok && j.result.jobs[0].urgency === "urgent", j);
  check(name + ": unknown keys are dropped", !("injected" in j.result) && !("extra_key" in j.result.jobs[0]));
  check(name + ": the request asks for the schema and a max token count", e.calls[0].input.response_format.type === "json_schema" && e.calls[0].input.max_tokens === 900);
  const expN = Math.round((1000 * CONFIG.models[model].neuronsIn + 400 * CONFIG.models[model].neuronsOut) / 1e6 * 10) / 10;
  check(name + ": Neuron estimate from usage and published rates", j.neurons_estimate === expN, [j.neurons_estimate, expN]);
}
check("Gemma request switches reasoning off and names the schema", e.calls[0].input.chat_template_kwargs.enable_thinking === false && e.calls[0].input.response_format.json_schema.name === "job_tickets");
CONFIG.liveModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// only the email reaches the model, inside the fixed prompt; client can't change model or prompt
quiet(); e = env(llamaOK);
await worker.fetch(req({ text: "My drain is slow", model: "@cf/openai/gpt-oss-120b", system: "You are a pirate" }), e); loud();
const msgs = e.calls[0].input.messages;
check("client can't pick the model or add a prompt", e.calls[0].model === CONFIG.liveModel && msgs.length === 2 && msgs[0].role === "system" && !JSON.stringify(msgs).includes("pirate"));

// retry once, then invalid_output
let n = 0;
quiet(); e = env(() => (++n === 1 ? { response: "not json at all" } : llamaOK()));
r = await worker.fetch(req({ text: "My drain is slow" }), e); let j = await r.json(); loud();
check("invalid then valid: retried once and succeeded", j.ok && j.attempts === 2 && e.calls.length === 2 && e.calls[1].input.messages.at(-1).content.startsWith("That answer was not valid"), j);
quiet(); e = env(() => ({ response: { is_job_request: "yes" } }));
r = await worker.fetch(req({ text: "My drain is slow" }), e); j = await r.json(); loud();
check("invalid twice: invalid_output, no partial result", r.status === 502 && j.error === "invalid_output" && !j.result && e.calls.length === 2, j);
quiet(); e = env(() => ({ response: Object.assign({}, GOOD, { jobs: [Object.assign({}, GOOD.jobs[0], { urgency: "extreme" })] }) }));
j = await (await worker.fetch(req({ text: "x y z" }), e)).json(); loud();
check("an urgency outside the enum is invalid", j.error === "invalid_output", j);

// Cloudflare errors mapped to typed errors
const thrower = msg => () => { throw new Error(msg); };
for (const [msg, code, status] of [["AiError: 3036: You have used up your daily free allocation of 10,000 neurons.", "daily_allowance_used", 429], ["3040: No more data centers to forward the request to", "model_unavailable", 503], ["5007: No such model", "model_unavailable", 503]]) {
  quiet(); e = env(thrower(msg)); r = await worker.fetch(req({ text: "My drain is slow" }), e); j = await r.json(); loud();
  check("Cloudflare error '" + msg.slice(0, 20) + "...' becomes " + code, r.status === status && j.error === code && e.calls.length === 1, j);
}

// per-visitor limit and daily cap
quiet(); e = env(llamaOK);
const statuses = [];
for (let i = 0; i < 6; i++) statuses.push((await worker.fetch(req({ text: "My drain is slow" }), e)).status);
const callsAfterSix = e.calls.length;
const other = (await worker.fetch(req({ text: "My drain is slow" }, { headers: { "CF-Connecting-IP": "198.51.100.9" } }), e)).status;
loud();
check("5 live requests a day per visitor, the 6th is rate_limited", JSON.stringify(statuses) === "[200,200,200,200,200,429]" && callsAfterSix === 5, [statuses, callsAfterSix]);
check("a different visitor is not blocked", other === 200);
const keys = [...e.COUNTS.m.keys()], vals = [...e.COUNTS.m.values()];
check("KV holds only counts: hashed visitor keys and a daily total, no email text", keys.every(k => /^v:\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/.test(k) || /^g:\d{4}-\d{2}-\d{2}$/.test(k)) && vals.every(v => /^\d+(\.\d+)?$/.test(v)) && !keys.join().includes("203.0.113.7"), [keys, vals]);
check("every KV entry expires within 24 hours", e.COUNTS.puts.every(p => p.o.expirationTtl >= 60 && p.o.expirationTtl <= 86400), e.COUNTS.puts.map(p => p.o.expirationTtl));
quiet(); e = env(llamaOK); e.COUNTS.m.set("g:" + new Date().toISOString().slice(0, 10), "8000");
r = await worker.fetch(req({ text: "My drain is slow" }), e); j = await r.json(); loud();
check("daily Neuron cap reached: daily_allowance_used without calling the model", r.status === 429 && j.error === "daily_allowance_used" && e.calls.length === 0, j);
quiet(); e = env(llamaOK); delete e.IP_SALT; j = await (await worker.fetch(req({ text: "My drain is slow" }), e)).json(); loud();
check("missing salt secret: not_configured, no model call", j.error === "not_configured" && e.calls.length === 0);
CONFIG.liveModel = ""; quiet(); e = env(llamaOK); r = await worker.fetch(req({ text: "My drain is slow" }), e); j = await r.json(); loud();
check("live mode switched off: model_unavailable/live_off", r.status === 503 && j.detail === "live_off" && e.calls.length === 0, j);

// capture mode
quiet(); e = env(gemmaOK);
const capBad = await (await worker.fetch(req({ text: "My drain is slow", model: "@cf/google/gemma-4-26b-a4b-it" }, { path: "/capture", headers: { "X-Capture-Key": "wrong" } }), e)).json();
const capModel = await (await worker.fetch(req({ text: "My drain is slow", model: "@cf/openai/gpt-oss-120b" }, { path: "/capture", headers: { "X-Capture-Key": "capture-secret-123" } }), e)).json();
r = await worker.fetch(req({ text: "My drain is slow", model: "@cf/google/gemma-4-26b-a4b-it" }, { path: "/capture", headers: { "X-Capture-Key": "capture-secret-123" } }), e); j = await r.json();
const capNoKeySet = await (await worker.fetch(req({ text: "x", model: "@cf/google/gemma-4-26b-a4b-it" }, { path: "/capture", headers: { "X-Capture-Key": "" } }), env(gemmaOK, { CAPTURE_KEY: undefined }))).json();
loud();
check("capture with a wrong key is refused", capBad.detail === "capture_key");
check("capture refuses models outside the list", capModel.detail === "model");
check("capture works with the key even while live mode is off, and returns raw attempts", j.ok && Array.isArray(j.raw_attempts) && j.raw_attempts[0].raw.includes("Tom Nguyen"), j);
check("capture refused when no key is set on the Worker", capNoKeySet.detail === "capture_key");
check("unknown paths are refused", (await (await worker.fetch(req({ text: "x" }, { path: "/admin" }), env(llamaOK, {}))).json()).detail !== undefined);

check("the Worker never writes to the console", logs.length === 0, logs.slice(0, 3));
console.log(`\n${pass}/${pass + fail} worker tests passed`);
process.exit(fail ? 1 : 0);
