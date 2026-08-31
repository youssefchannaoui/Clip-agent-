# Organic search — what is built, and the four things only you can do

The pages, the sitemap, the tracking and the tests are done and live. What is
left needs an account nobody but you can sign into. None of it takes long, and
until step 1 is done there is no way to see whether any of this is working.

---

## 1. Verify the site in Google Search Console — 5 minutes

**Do this first.** Without it there is no impression data, no query data, and no
way to tell Google the sitemap exists.

1. Go to https://search.google.com/search-console and add a property.
2. Choose **URL prefix** and enter `https://deenclipped.online`.
3. Pick the **HTML tag** verification method. It shows a line like:
   `<meta name="google-site-verification" content="AbC123..." />`
   You only need the part inside `content="..."`.
4. On Render → the DeenClipped web service → Environment, add:
   `GOOGLE_SITE_VERIFICATION` = that content value.
5. Save. Render restarts. Wait for the deploy to finish.
6. Back in Search Console, press **Verify**.

The tag renders on every marketing page automatically, and whitespace around
the value is trimmed — a token pasted into a hosting panel picks up a trailing
newline routinely, and the resulting failure looks identical to using the wrong
token.

**Bing takes 2 more minutes and sends real traffic**: same idea at
https://www.bing.com/webmasters, and the variable is `BING_SITE_VERIFICATION`.
Bing will also offer to import everything from Search Console once Google is
verified, which is faster than doing it twice.

## 2. Submit the sitemap — 1 minute, after step 1

Search Console → Sitemaps → enter `sitemap.xml` → Submit.

It already lists all 21 public pages and is already declared in
`robots.txt`, so Google would find it eventually. Submitting starts the clock
sooner.

## 3. Request indexing for the six pages worth ranking — 10 minutes

New pages are usually crawled within a couple of weeks on their own. These six
are the ones aimed at searches with buying intent, so it is worth asking:

Search Console → URL Inspection → paste the URL → **Request indexing**.

```
https://deenclipped.online/tools/ai-video-clipper
https://deenclipped.online/tools/long-video-to-shorts
https://deenclipped.online/islamic-video-clipper
https://deenclipped.online/islamic-lecture-clipper
https://deenclipped.online/tools/youtube-to-shorts
https://deenclipped.online/how-it-works
```

## 4. The one that actually matters — links

Rankings for anything competitive come from other sites linking to yours. The
pages are built; nothing in this repo can make someone link to them. The
realistic sources, in the order they are likely to work for this product:

- **Your own channels.** The DeenClipped YouTube channel description, and any
  video description, linking to `/islamic-video-clipper`. This is free, it is
  in your control, and it is the single highest-value link you own.
- **Masjid and dawah organisations** you already know. A tools page or a
  resources page listing DeenClipped.
- **Islamic creator communities** — a genuine post about the workflow, not a
  drop-and-run link.
- **Directories that list AI video tools.** Most are low value; the two or
  three that are edited by a person are worth the submission.

---

## How to tell whether any of it is working

**Owner → Traffic → "Pages that earn subscriptions".** The table only appears
once a page has produced at least one sign-up, and it is the only number here
worth acting on: arrivals, sign-ups and subscriptions per landing page.

Read it this way:

- **Arrivals but no sign-ups** — the page attracts the wrong search, or the
  page is fine and the offer is not clear on it. Read the page as a stranger
  would before changing anything else.
- **Sign-ups but no subscriptions** — the page promises something the free
  plan does not deliver, or the product does not follow through. This is worth
  more attention than the traffic number.
- **Neither, after a month of impressions** — the page is not earning its
  place. Rewriting is fine; deleting is also fine.

In Search Console itself, the useful screen is **Performance → Queries**: what
people actually typed. It is routinely different from what the pages were
written for, and it is the best guide to what to write next.

Expect nothing for two to four weeks. New pages on a young domain are slow, and
that is not a sign anything is broken.

---

## What is already done, so nobody redoes it

- 21 public pages from one registry (`src/seo-pages.js`), 15 of them new.
- `sitemap.xml` and `robots.txt` derived from that registry, so a new page
  cannot be added and forgotten by either.
- Every page: unique title under 62 characters, description under 160,
  canonical, one H1, breadcrumbs, FAQ schema built from the visible FAQs, and a
  plain link path from the homepage.
- Landing-page attribution through to subscription, described above.
- `test/seo-architecture.test.mjs` and `test/landing-attribution.test.mjs`
  hold all of it to account on every push.

## What is deliberately NOT done

- **No fabricated proof.** No customer counts, no ratings, no "trusted by",
  no testimonials. A test fails the build if any appears. When there are real
  customers willing to be named, that changes — until then it would be a lie
  that a competitor or a customer could check.
- **No blog or guides section.** Worth doing, but it is ongoing writing rather
  than a build, and a hub of three thin posts is worse than none.
- **No claims about the editor.** It is behind a "coming soon" gate, and
  selling it would be selling something a new customer cannot use.
