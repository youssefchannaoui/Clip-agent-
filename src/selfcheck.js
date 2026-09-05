/**
 * The break detector.
 *
 * Youssef, 4 Sept 2026: "can you make a automated code break detector or issue
 * dector that fixes alone when something happens or notfiys".
 *
 * WHAT THIS IS FOR, and it is a narrow thing on purpose. CI already catches
 * code that does not compile or fails a test. What has actually broken this
 * product in production is a different shape entirely -- a condition that is
 * SILENT: the app renders and never boots, a stylesheet 404s and the theme
 * dies with nothing in any log, a player is handed a rate-limited URL, the
 * worker sits on old code for weeks. Every one of those is recorded in
 * CLAUDE.md, every one was found by a person opening the app, and not one of
 * them raises an error anywhere.
 *
 * So each check below answers a question nothing else asks, and the bar for
 * adding one is: it fails silently today, and a person is the only detector.
 *
 * WHAT "FIXES ALONE" MEANS HERE. A check may carry a `heal`, and it may only
 * ever be something this codebase ALREADY does somewhere else, bounded and
 * reversible -- `healPartialPublishes` at boot and the interrupted-job
 * recovery are the precedents. A detector that rewrites production on its own
 * judgement is not one of the things being asked for, and it is not built:
 * everything else NOTIFIES, through the same `alerts.report` ledger the
 * billing checks use, which dedupes on a 12-hour window and survives a
 * restart (v3.27.0 -- an alert channel that cries wolf is one nobody reads).
 *
 * WHAT IT CANNOT DO, said plainly rather than implied: this runs INSIDE the
 * app, so it cannot detect the app being down. That is what
 * .github/workflows/watch-live.yml is for -- an external prober on a schedule.
 * The two halves are deliberately separate and neither replaces the other.
 *
 * Pure and dependency-injected: no imports, so the server, the tests and
 * anything added later can read it without an import cycle -- the same
 * arrangement as help.js beside its machinery.
 */

/** A stylesheet or script that is routed but not on disk 404s in silence. */
function assetsOnDisk({ assets, readSize }) {
  const missing = [];
  for (const [route, file] of Object.entries(assets || {})) {
    let size = -1;
    try { size = readSize(file); } catch { size = -1; }
    if (size <= 0) missing.push(`${route} (${size === 0 ? 'empty' : 'missing'})`);
  }
  return {
    key: 'assets',
    ok: !missing.length,
    detail: missing.length
      ? `${missing.length} served asset(s) are not on disk: ${missing.join(', ')}. `
        + 'Each one 404s with nothing in any log -- a missing stylesheet is a dead theme, '
        + 'a missing sw.js is push that silently never arrives.'
      : `all ${Object.keys(assets || {}).length} served assets are present`,
  };
}

/**
 * THE ONE THAT KILLS THE WHOLE APP, and it has shipped five times.
 *
 * script-src allows the page's own inline block BY SHA256, computed once at
 * startup from the file on disk. An inline block the policy does not cover is
 * refused by the browser with no page error at all: the shell renders, boot
 * never runs, and the app falls back to the password gate. The hashes are
 * recomputed from the SERVED bytes here and compared against what the policy
 * actually allows, so a deploy that ships a page the policy does not cover
 * says so instead of being discovered by a customer.
 */
function inlineScriptCovered({ page, allowed, sha256 }) {
  const blocks = [...String(page || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  const have = new Set(allowed || []);
  const uncovered = blocks.filter(m => !have.has(`'sha256-${sha256(m[1])}'`));
  return {
    key: 'inline-script',
    ok: !uncovered.length,
    detail: uncovered.length
      ? `${uncovered.length} of ${blocks.length} inline <script> block(s) on the studio page are not covered by the CSP. `
        + 'The browser refuses them with NO page error: the shell renders and the app never boots. '
        + 'Restart the service so the hashes are recomputed from the deployed file.'
      : `all ${blocks.length} inline script block(s) are covered`,
  };
}

/**
 * r2.dev is R2's RATE-LIMITED dev endpoint -- it returned five straight GET
 * 503s in one editor session, and CLAUDE.md's rule is that it must never be
 * handed to a player again. The exits rewrite stored URLs through
 * MEDIA_PUBLIC_BASE, so a stored r2.dev URL is harmless WHILE that is set and
 * a live fault the moment it is not. This checks the configuration, which is
 * the thing that can actually go missing.
 */
function mediaDomain({ mediaPublicBase, storedSample }) {
  const stored = (storedSample || []).filter(u => /\.r2\.dev/i.test(String(u || '')));
  const ok = !stored.length || Boolean(mediaPublicBase);
  return {
    key: 'media-domain',
    ok,
    detail: ok
      ? (stored.length ? `${stored.length} stored r2.dev URL(s), rewritten at the exits` : 'no r2.dev URLs stored')
      : `${stored.length} rendered clip(s) are stored on r2.dev and MEDIA_PUBLIC_BASE is not set, `
        + 'so players are being handed the rate-limited dev endpoint directly. '
        + 'Set MEDIA_PUBLIC_BASE on Render to the custom domain bound to the bucket.',
  };
}

/**
 * The box has sat on old code for weeks with every change pushed, green and
 * not running. Owner -> Health has shown this since v3.26.0 and nothing has
 * ever ALERTED on it, so it is only ever seen by somebody who goes looking.
 *
 * THE COMPARISON IS AGAINST `workerRelease`, NOT `appVersion`, and that is the
 * whole correctness of this check. The web service ships several times a day
 * without touching worker/, so a bare version mismatch is the normal state of
 * a perfectly current box -- comparing against appVersion made this alert fire
 * on nearly every web deploy (v3.129.1), which is the crying-wolf failure
 * v3.27.0 exists to prevent and would have MASKED a genuinely stale box.
 * `worker/RELEASE` is the version at which worker/ last changed; the box is
 * current whenever it reports that version or anything later.
 *
 * A worker too old to report a version at all still reads as behind, which is
 * the honest answer -- that is exactly what a box predating v3.26.0 is.
 */
function newerOrSame(have, need) {
  const parts = value => String(value).split('.').map(n => Number(n) || 0);
  const a = parts(have);
  const b = parts(need);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

function workerCurrent({ workerRelease, workerVersion, remote }) {
  if (!remote) return { key: 'worker-version', ok: true, detail: 'not a remote deployment' };
  // No stamp means no question can be asked. Saying nothing beats inventing a
  // verdict from the app's own version, which is what this used to do.
  if (!workerRelease) {
    return { key: 'worker-version', ok: true, detail: 'worker/RELEASE is missing, so nothing can be compared' };
  }
  const ok = Boolean(workerVersion) && newerOrSame(workerVersion, workerRelease);
  return {
    key: 'worker-version',
    ok,
    detail: ok
      ? `the running worker is ${workerVersion}, at or past the ${workerRelease} worker release`
      : `worker/ last changed at ${workerRelease} and the box reports `
        + `${workerVersion || 'no version at all'}, so worker changes are NOT live. `
        + '`deploy-worker.yml` deploys it; its newest successful run names the commit on the box.',
  };
}

/**
 * Every check, in the order they are reported. Dependencies are passed in
 * rather than imported so this module stays pure and testable -- calling it
 * needs no server, no disk and no network.
 */
export function checks(deps = {}) {
  return [
    assetsOnDisk(deps),
    inlineScriptCovered(deps),
    mediaDomain(deps),
    workerCurrent(deps),
  ];
}

/**
 * Run them and report. `report` is alerts.report, which is called on EVERY
 * check and not only on failures: knowing something recovered is half the
 * value, and it is what lets the next failure alert at all.
 *
 * A check that throws is reported as failing rather than taken as passing --
 * a monitor that goes quiet when it breaks is worse than no monitor.
 */
export async function run(deps = {}, report = async () => {}) {
  let results;
  try {
    results = checks(deps);
  } catch (error) {
    await report('selfcheck', true, `The self-check itself failed to run: ${error.message}`);
    return [];
  }
  for (const result of results) {
    try {
      await report(`selfcheck:${result.key}`, !result.ok, result.detail);
    } catch { /* an alert that cannot go out must never stall the sweep */ }
  }
  return results;
}
