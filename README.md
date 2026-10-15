# Email to job ticket (demo)

An AI model reads a customer email sent to Cedar & Copper Plumbing, a made-up company, and drafts job tickets. Then code checks that every field the model found is really in the email. Anything it can't find in the email is shown as "Not found in the text", never as the model's guess.

Live: https://casimbahadar.github.io/email-intake/

## What a visitor sees

- **Recorded samples.** 19 made-up emails, with the model's real answers saved on 15 October 2026 from Gemma 4 26B. The checking code runs on them in the page each time. No account, no cost and no network call.
- **Live mode.** "Try your own email" sends one email to the same model. It's limited to 5 tries per person per day, and it stops for everyone once the day's free allowance is used.
- **For each email:**
  - one ticket per job, with the job type, urgency, address and preferred time
  - each field with the exact words it came from, and those words highlighted and numbered in the email
  - a list of what the email doesn't say
  - a "Caught by the checks" box when the model said something the email doesn't support
  - a reply draft, labelled as written by AI for a person to review
  - a spreadsheet row and a calendar file in the same layout as the job intake demo
- **A gas smell** always shows safety steps instead of a reply, whatever the model says.

## What the checks do

- A field is shown only if its quote appears in the email and the value appears in its quote. Case, spacing and punctuation are ignored, but the words and their order must match.
- A value must also be the right kind of thing. For example, an email address must look like one.
- Urgent and soon need a quote that shows the urgency. Routine means no signs of urgency, so it needs no quote.
- A job becomes a ticket only if at least one of its quotes is in the email.
- The reply draft is held back if it contains a link, or a phone number or email address that isn't in the customer's email or isn't the company's own.
- Empty emails and emails over 4,000 characters are stopped in the page, before anything is sent.

## Results from the eval run

Checked on 15 October 2026 against 21 made-up emails, with labels written before any model saw them. Full numbers are in `eval-results.json`.

| | Gemma 4 26B (live) | Llama 3.3 70B (compared) |
|---|---|---|
| Valid answers | 19 of 19 | 18 of 19 |
| Urgency right | 18 of 18 | 15 of 18 |
| Model's quotes that checked out | 91 of 96 | 82 of 84 |
| Name, phone, address and missing-info checks | 54 of 54 | 51 of 51 |
| Injection emails resisted | 2 of 2 | 2 of 2 |
| Neurons per email, average | about 19 | about 79 |

One label was corrected after the first run: e12's slow drain is "soon" under the rule in the prompt. The change is noted in `email-intake-evals.json`.

## Cost and limits

This runs on Cloudflare's Workers Free plan, with no card on file. Workers AI there includes 10,000 Neurons a day at no charge, and it stops rather than bills when they run out. The Worker stops live mode at 8,000 Neurons, which is about 425 emails a day. Live mode comes back each day at midnight UTC, which is 8 pm Eastern (7 pm in winter). The recorded samples always work.

Sources: https://developers.cloudflare.com/workers-ai/platform/pricing/ and https://developers.cloudflare.com/workers-ai/platform/errors/

## Privacy

- **The page:** recorded samples never leave it. The page's security settings only allow it to contact the one Worker address.
- **The Worker** (`worker.js`) never stores or logs email text. It keeps only a daily count per visitor, under a salted hash of their IP address, and a daily Neuron total. Both expire at midnight UTC.
- **Cloudflare** says it doesn't use Workers AI inputs to train models: https://developers.cloudflare.com/workers-ai/platform/data-usage/
- **Visitors** are asked to use made-up emails.

## Running it

- **Turn live mode off or switch models:** in the Cloudflare Workers editor, line 11 of `worker.js` reads `liveModel: "@cf/google/gemma-4-26b-a4b-it",`. Put a different model id from the list below it between the quotes, or empty the quotes (`""`) to switch live mode off, then deploy. Watch for a stray line break when pasting on a phone: the line must stay on one line, and the error count at the bottom of the editor should read 0 before you deploy.
- **Replace the Worker code from a phone:**
  1. Open `worker.js` in this repo on GitHub, tap Raw, then press and hold the text and choose Select All, then Copy.
  2. In the Cloudflare Workers editor, select all the old code, paste, and deploy.
- **Re-record the samples:** open `capture.html` from this site, enter the Worker address and the capture key, run the emails, and download the results file. This uses the day's free allowance, about 400 Neurons for Gemma.

## Files

- `index.html`: the whole page. The checking code sits between the `CORE-START` and `CORE-END` markers.
- `worker.js`: the Cloudflare Worker, kept here for reference. The running copy lives in Cloudflare.
- `capture.html`: the private page that records model answers. It needs the capture key.
- `email-intake-evals.json`: the 21 test emails and their expected answers.
- `recorded-responses.json`: the raw recorded answers from both models.
- `eval-results.json`: the scores from the eval run.
- `evals.mjs`, `email-intake.tests.mjs` and `worker.tests.mjs`: checks a developer can run with Node (`node email-intake.tests.mjs`). They replay the recorded answers and use no Neurons.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

## How a version for your business would differ

You'd choose the AI provider and own the account, so the data agreement and the bill are yours. The model and its daily volume would be sized to your inbox. With your permission, the instructions would be tuned and tested on emails you've actually received. Tickets would go into the tools you already use. A person would still approve every reply.

## How AI was used to build this

The page and Worker were written with an AI coding assistant, and checked with the tests listed above. The answers on the page come from the model named on each result.

Built by Casim Bahadar, Kitchener-Waterloo, Ontario. https://casimbahadar.github.io/
