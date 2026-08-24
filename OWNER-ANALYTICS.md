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

### The rail

The page carries a copy of the studio's rail, so the owner surface sits beside
the same navigation rather than replacing it. It is a **copy**, not the real
one: the studio's rail is generated from the design file and lives inside a
shell this page deliberately does not share.

Its links deep-link into the studio (`/app#library`, `/app#schedule`, …), which
`studio-adapter.js` reads once at boot. Without that every link would drop you
on Home, which is worse than having no rail.

Below 900px the rail is hidden — on a phone the analytics are the point, and a
226px column is a third of the screen.

### One currency, or none

Nothing converts between currencies. An FX rate fetched at render time would
make yesterday's burn disagree with today's for no reason a reader could see.

So costs are meant to be entered in a single currency, and `moneyOut.byCurrency`
plus `moneyOut.mixedCurrency` exist to say so loudly when they are not — the
totals still add naively, because they cannot do anything else, and the warning
is what stops that being a silent lie. Converting a foreign bill to AUD is a
decision for whoever enters it, recorded in the note with the rate and date.

### Getting to it from the studio

There is an **Owner** item at the bottom of the SET UP group in the studio rail,
shown only to accounts whose role is `owner` or `admin`.

It is added from `studio-adapter.js`, not from the design file. The adapter is
the half `import-design.mjs` deliberately never overwrites, so the item survives
a design pull; an entry added to `design/studio-dashboard.dc.html` would not.

**Hiding the link is presentation, not access control.** The gate is server
side, where every `/owner` route answers 404 to a signed-in non-operator. If
this check were the only thing between a creator and the books it would be worth
nothing.

One trap that the test suite caught and a browser did not: `DATA` in
studio-adapter.js is a **parameter**, not a module global. `isOperator()` read
it from the outer scope, which works in a browser (where `DATA` happens to be
global) and throws `ReferenceError` everywhere else — 139 tests went red. It
takes `DATA` as an argument now, matching every other helper in that file.

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

---

## Automating the money-out side from Gmail

Asked for on 24 Aug 2026: billing mail should turn into ledger entries by
itself. The write half is built; the read half needs a decision.

### What already exists

`POST /api/owner/spend` takes one payment or a batch, and **drops any entry
whose `externalId` it has already seen** — inside a single batch as well as
across calls. `externalId` is meant to hold the receipt number, or the Gmail
message id. That is the whole reason a feed can be re-run: pointing a sync at
"the last 90 days" every night must not book the same charge ninety times.

This is the same defect the Stripe side already had, where `invoice.paid` and
`invoice.payment_succeeded` carry different event ids for one invoice and would
have doubled the revenue.

### The read half, and the decision in it

Three ways in, and the third is the only real automation:

1. **Paste / manual.** Works today. Not what was asked for.
2. **Claude reads the mailbox during a session and posts a batch.** This is how
   the first twelve Anthropic charges were loaded. Accurate, no new
   credentials, but only happens while somebody is running a session.
3. **The server polls Gmail.** Real automation, and it needs `gmail.readonly`.

**`gmail.readonly` is a Google *restricted* scope.** For a published app,
Google requires a CASA security assessment — paid, and repeated annually.

The way around that is not a trick: an OAuth client left in **Testing** mode may
use restricted scopes for up to 100 test users without verification. This app
has exactly one operator, so that fits.

**It must be a second, separate OAuth client.** The existing one is already
carrying the YouTube scopes and their compliance work; adding a restricted scope
to it would drag the whole app back through verification and put the YouTube
integration at risk. That is the decision: create a new Google Cloud OAuth
client, used only for reading this one mailbox.

### How it should behave once built

**Parsed charges must land as pending, not as costs.** A parser that writes
straight into the books will eventually read a marketing email as a $500 bill,
and a wrong number in a ledger is worse than a missing one — the whole design of
this page is that it refuses to state figures it cannot stand behind. So:

- A sync writes candidates with vendor, amount, currency, date and the message id.
- The dashboard shows them for one-click accept or dismiss.
- Accepting a recurring vendor updates that cost's amount and next due date.
- Accepting a one-off writes it to the spend log.
- A vendor confirmed twice can be marked trusted, and skip review after that.

### Vendors and what identifies them

Established by reading the real mailbox on 24 Aug 2026:

| Vendor | Sender | Shape |
|---|---|---|
| Anthropic | `invoice+statements@mail.anthropic.com` | `Receipt number 2408-2810-0973`, `Total A$5.50` |
| Render | `invoice+statements+acct_…@stripe.com` | Stripe-hosted receipt, USD |
| Lemon Squeezy (SocialKit) | `hello@lemonsqueezy-mail.com` | `Order #: 192843343`, AUD inc GST |
| Hetzner | `noreply@hetzner.com` | Invoice on the 14th, USD |
| GoDaddy | `email@e.godaddy.com` | Yearly renewal |

Anthropic and Lemon Squeezy already bill in AUD. Render and Hetzner bill in USD,
which is why the ledger warns rather than converts.
