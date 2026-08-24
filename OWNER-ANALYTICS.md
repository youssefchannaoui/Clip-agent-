# Owner analytics

Operator-only. **`https://deenclipped.online/owner`**

Five tabs of its own: Overview, Money in, Money out, Users, Activity. The tab
is in the URL (`/owner#out`), so a bookmark or a reload comes back where you
left it.

---

## The one thing you have to do

**Four seeded costs have no amount.** Render, Hetzner, Cloudflare R2 and the
domain are listed — they are what this repo demonstrably runs on — but with no
price, because nothing in the codebase records one and a plausible-looking
guess would produce a profit figure that is fiction while looking authoritative.

Open **Money out → Edit** on each, enter the amount and the next payment date.
Every total on the page becomes real at that point. Until then the page says
"understated" everywhere burn or profit appears, rather than showing a
confident zero.

`A$0.00+` on the burn tile means exactly that: at least this, probably more.

---

## Where each number comes from

| Figure | Source | Caveat |
|---|---|---|
| Gross / fees / net in | Stripe balance transactions, live | Fees are only knowable from Stripe |
| MRR / ARR | Stripe active subscriptions, normalised to a month | A yearly plan is a twelfth per month, not a spike |
| Monthly / yearly burn | The cost ledger you maintain | Understated while any cost lacks an amount |
| Due in 60 days | Ledger due dates | Only appears once you set dates |
| Profit | Net in **minus** burn | Net, never gross — the fee is the part that is easy to forget |
| Users, tokens, clips | `admin.analytics()`, which already existed | — |

**Money in had to come from Stripe** because the app never stored a currency
amount. `invoice.paid` arrived and only the fact of it was kept, so there was no
figure anywhere in the product to answer "what came in this month".
`recordRevenue` in `billing.js` now records amounts as webhooks arrive, which is
what the page falls back to when Stripe cannot be read — but that ledger starts
from the day this shipped, so Stripe stays the authority for anything older.

**Money out could not be derived at all.** Nothing in the codebase knows what
Render charges. Hence the ledger.

---

## Things it deliberately refuses to do

- **A missing amount never renders as `0`.** A burn of zero and a burn nobody
  entered look identical in a total, and only one of them means the business is
  free to run.
- **The burn bars on the overview chart are today's figure repeated, and say
  so.** Historic burn was never recorded; drawing today's as if it were history
  would be a lie in a chart.
- **Test mode is stated in the header.** Sandbox revenue looks exactly like real
  money. The badge has three states, not two — `live`, `test`, and
  `not configured` — because "test" on a deployment with no key at all claimed a
  sandbox was reporting when nothing was.
- **Stripe being down degrades the page, never 500s it.** A finance page that
  breaks because a third party is slow is one you cannot use on the morning you
  need it.

---

## Why it is not a tab inside /app

Two reasons, both load-bearing:

1. **The studio's markup is generated.** `src/public/studio-template.generated.js`
   is compiled from `design/studio-dashboard.dc.html` by `scripts/import-design.mjs`,
   and anything hand-added to it is erased by the next `npm run design:import`.
2. **CLAUDE.md's most expensive lesson is that studio layout changes ship broken
   while tests stay green.** The operator's books have no business sharing a
   shell with the page paying customers use.

So `/owner` is standalone: its own HTML, CSS and JS, and its own palette copied
by value from `marketing.css` so a design pull cannot restyle it by accident.

**Not yet done:** there is no link to `/owner` from inside the studio — reaching
it means typing the URL. Adding a nav entry means editing the 305KB design file
and re-importing, which is exactly the class of change CLAUDE.md says to do
carefully and look at, so it was left for a session where the result can be
checked on screen.

---

## Security

Gated by `requireOperator`, which answers **404 rather than 403** — the same
posture as the rest of the operator surface, so the route is indistinguishable
from one that does not exist. The stylesheet and script are gated too, not left
on `'self'`: the shape of an admin page is itself worth not publishing.

The page builds every node with `textContent`, never by interpolating into
`innerHTML`. It renders account names and email addresses, an email is
attacker-supplied, and this product has already shipped one reflected XSS.

The script is external, so `script-src 'self'` covers it and no CSP hash has to
be maintained. There are no inline event handlers, which a test already enforces
across every served page.

`/api/owner/finance?days=` is clamped to 30–365. Unbounded days is an unbounded
number of Stripe pages on a route one request can hold open.

---

## Tests

`test/owner-finance.test.mjs` — 12 tests. The gating ones go over HTTP, because
this repo has already shipped a limiter and a schedule parameter that both
passed unit tests while the route ignored them.

What they pin, and why each one is a bug that would otherwise be silent:

- Every owner route 404s for a creator, **writes included** — a read-only gate
  on a surface that accepts writes is not a gate.
- `19.99` stores as `1999`, not a float cent.
- Cadence normalises weekly by **52/12, not 4** — four-week months lose a
  payment a year, which is how a burn figure comes out under the real one.
- A stale due date rolls forward, except a one-off, which stays overdue rather
  than inventing a next time.
- **One invoice counts once even though Stripe sends two event types for it.**
  `invoice.paid` and `invoice.payment_succeeded` carry different event ids, so
  the existing processed-event guard does not catch the pair, and the money
  would have doubled.
- A missing Stripe key answers 200 and names the gap, rather than 500ing.
