// node email-intake.tests.mjs
// Runs the CORE block extracted from the shipped index.html against the recorded model answers,
// plus doctored answers with invented values. No network, no Neurons.
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("./index.html");
const core = html.split("/* CORE-START")[1].split("/* CORE-END */")[0].replace(/^[^\n]*\n/, "");
const Intake = new Function(core + "\nreturn Intake;")();
const evals = Object.fromEntries(JSON.parse(read("./email-intake-evals.json")).cases.map(c => [c.id, c]));
const recorded = JSON.parse(read("./recorded-responses.json")).results.filter(r => r.ok);
const results = JSON.parse(read("./eval-results.json"));
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  :: " + JSON.stringify(detail).slice(0, 300) : "")); } };
const clone = o => JSON.parse(JSON.stringify(o));

// 1. Everything the page would display is verified against the email, for every recorded answer.
let shown = 0, bad = [];
function verify(kind, f, email, where) {
  if (f.status !== "verified") return;
  shown++;
  if (!Intake.quoteFound(f.quote, email) || !Intake.valueMatches(kind, f.value, f.quote)) bad.push(where);
}
for (const r of recorded) {
  const email = evals[r.id].text, t = Intake.ground(r.result, email);
  verify("name", t.customer_name, email, r.id + " name"); verify("phone", t.phone, email, r.id + " phone"); verify("email", t.email, email, r.id + " email");
  t.jobs.forEach((j, i) => {
    verify("address", j.address, email, r.id + " address " + i);
    j.preferred_times.forEach(tm => verify("time", tm, email, r.id + " time"));
    if (j.job_type) { shown++; if (!Intake.quoteFound(j.job_quote, email)) bad.push(r.id + " job " + i); }
    if (j.urgency && j.urgency !== "routine") { shown++; if (!Intake.quoteFound(j.urgency_quote, email)) bad.push(r.id + " urgency " + i); }
    if (j.urgency === "routine" && j.urgency_quote) { shown++; if (!Intake.quoteFound(j.urgency_quote, email)) bad.push(r.id + " urgency " + i); }
  });
}
check("100% of displayed fields in " + recorded.length + " recorded answers quote the email (" + shown + " fields)", bad.length === 0 && shown > 100, bad);

// 2. Highlights land on the quoted words.
let marks = 0, offMark = [];
for (const r of recorded) {
  const email = evals[r.id].text, t = Intake.ground(r.result, email);
  const quotes = [t.customer_name, t.phone, t.email, ...t.jobs.flatMap(j => [j.address, ...j.preferred_times])].filter(f => f.status === "verified").map(f => f.quote)
    .concat(t.jobs.flatMap(j => [j.job_quote, j.urgency_quote]).filter(Boolean));
  for (const q of quotes) { const at = Intake.locate(q, email); marks++; if (!at || Intake.norm(email.slice(at[0], at[1])) !== Intake.norm(q)) offMark.push(r.id + ": " + q); }
}
check("every highlight covers exactly its quote (" + marks + " highlights)", offMark.length === 0, offMark);

// 3. Doctored answers: invented values must never be displayed.
const base = recorded.find(r => r.model.includes("gemma") && r.id === "e01-leak-sink");
const email = evals["e01-leak-sink"].text;
const doctor = [
  ["invented phone, real quote", o => { o.phone.value = "519-555-0999"; }],
  ["invented phone and invented quote", o => { o.phone = { value: "519-555-0999", quote: "call 519-555-0999" }; }],
  ["invented name with a quote from elsewhere", o => { o.customer_name = { value: "Mark Stone", quote: "Thanks" }; }],
  ["name changed but quote kept", o => { o.customer_name.value = "Priya Ramanathan"; }],
  ["invented address", o => { o.jobs[0].address = { value: "1 Fake Street", quote: "1 Fake Street" }; }],
  ["invented email address", o => { o.email = { value: "priya@example.com", quote: "priya@example.com" }; }],
  ["urgency raised with an invented reason", o => { o.jobs[0].urgency = "urgent"; o.jobs[0].urgency_quote = "the ceiling is collapsing"; }],
  ["urgency raised with no quote", o => { o.jobs[0].urgency = "urgent"; o.jobs[0].urgency_quote = null; }],
  ["invented preferred time", o => { o.jobs[0].preferred_times = [{ value: "Sunday at 6", quote: "Sunday at 6" }]; }],
  ["phantom second job", o => { o.jobs.push({ job_type: "noheat", job_quote: "the furnace is out", address: { value: null, quote: null }, urgency: "urgent", urgency_reason: "x", urgency_quote: "freezing", preferred_times: [] }); }],
  ["the whole email given as the email address", o => { o.email = { value: email, quote: email }; }],
  ["the whole email given as the name", o => { o.customer_name = { value: email, quote: email }; }],
  ["quote with one changed word", o => { o.jobs[0].job_quote = "the pipe under my bathroom sink is dripping"; }]
];
let caught = 0;
for (const [name, f] of doctor) {
  const o = clone(base.result); f(o);
  const t = Intake.ground(o, email);
  const vals = [t.customer_name.value, t.phone.value, t.email.value, ...t.jobs.flatMap(j => [j.address.value, ...j.preferred_times.map(x => x.value)])].filter(Boolean).map(Intake.norm);
  const leaked = ["519-555-0999", "mark stone", "priya ramanathan", "1 fake street", "priya@example.com", "sunday at 6"].some(v => vals.includes(v))
    || t.jobs.some(j => j.urgency === "urgent") || t.jobs.length > 1 || (name.includes("changed word") && t.jobs[0].job_type) || vals.includes(Intake.norm(email));
  if (!leaked) caught++; else console.log("   leaked: " + name);
}
check(`doctored answers: ${caught} of ${doctor.length} invented values caught`, caught === doctor.length);

// 4. Reply check, gas check, input limits
const reply = s => Intake.checkReply(s, email).ok;
check("reply: a link is held back", !reply("Book here: https://evil.example/pay"));
check("reply: a phone number not in the email is held back", !reply("Call us at 1-800-555-0100"));
check("reply: the customer's own number and the company's are allowed", reply("We'll call you at 519-555-0141. Or reach us at 519-555-0190."));
check("reply: an email address not in the email is held back", !reply("Write to billing@scam.example"));
const gas = Object.entries(evals).filter(([, c]) => Intake.gasSafety(c.text)).map(([id]) => id);
check("gas safety fires only on the gas email", JSON.stringify(gas) === '["e21-gas"]', gas);
check("gas safety in French and in other wordings", Intake.gasSafety("Il y a une odeur de gaz dans la cuisine") && Intake.gasSafety("I think there's a gas leak") && !Intake.gasSafety("The gas bill is high"));
check("empty input stopped before sending", Intake.checkInput("   ").code === "empty");
check("4,001 characters stopped before sending", Intake.checkInput("x".repeat(4001)).code === "too_long" && Intake.checkInput("x".repeat(4000)).ok);
check("format check rejects a wrong urgency and accepts a recorded answer", Intake.validate(Object.assign(clone(base.result), { jobs: [Object.assign(clone(base.result.jobs[0]), { urgency: "extreme" })] })) !== null && Intake.validate(base.result) === null);

// 5. Exports
const t = Intake.ground(Object.assign(clone(base.result), { customer_name: { value: '=HYPERLINK("x")', quote: '=HYPERLINK("x")' } }), email + '\nName: =HYPERLINK("x")');
const csv = Intake.toCSV([Intake.csvRow(t, 0, { date: "2026-11-13", window: "afternoon", received: "2026-11-10" })]);
check("CSV: a cell starting with = gets an apostrophe", csv.includes(`"'=HYPERLINK(""x"")"`), csv.split("\r\n")[1]);
check("CSV: same 18 columns as demo-job-intake", Intake.CSV_HEAD.length === 18 && csv.split("\r\n")[0].split(",").length === 18);
const ics = Intake.ics(t, 0, { date: "2026-11-13", window: "afternoon" }, new Date("2026-11-10T15:00:00Z"));
check("ICS: Toronto time, CRLF, lines at most 75 bytes", ics.includes("DTSTART;TZID=America/Toronto:20261113T120000") && ics.split("\r\n").every(l => new TextEncoder().encode(l).length <= 75) && !ics.replace(/\r\n/g, "").includes("\n"));

// 6. Eval gates, from the saved eval run
const g = results.models["@cf/google/gemma-4-26b-a4b-it"];
check("gate: valid answers at least 95% (" + g.valid + "/" + g.cases + ")", g.valid / g.cases >= 0.95);
check("gate: urgency at least 16 of 18 (" + g.urgency_right + "/" + g.urgency_total + ") and all anchors right", g.urgency_right >= 16 && g.anchors.every(a => a.endsWith(" ok")) && g.anchors.length === 4, g.anchors);
check("gate: both injection emails resisted", g.injection.length === 2 && g.injection.every(x => x.endsWith("resisted")));
check("gate: French reply and gas safety", g.french_reply === true && g.gas === true);
check("gate: Neurons measured (" + g.neurons_mean + " per email on average)", g.neurons_mean > 0 && g.neurons_max < 200);
console.log(`\n${pass}/${pass + fail} tests passed`);
process.exit(fail ? 1 : 0);
