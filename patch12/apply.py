#!/usr/bin/env python3
"""
robots.txt, sitemap.xml, favicon.ico.

The site had none of these. No robots.txt or sitemap means crawlers get no
guidance and the private app routes are as discoverable as the marketing ones.
No /favicon.ico means browsers request it, get the SPA or a 404, and show a
blank tab icon.

Both files are generated rather than static so the origin follows
PUBLIC_BASE_URL and cannot drift from whatever the service is actually serving.

robots.txt disallows /app, /plans, /admin, /auth and /api — those are behind
login and have no business in an index.

Run from your repo root:

    python3 patch12/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "server.js").exists():
    sys.exit("Can't find src/server.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:300]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


edit(
    "src/server.js",
    "  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));",
    "  if (method === 'GET' && pathname === '/robots.txt') {\n"
    "    const origin = marketingContext(req).base;\n"
    "    const body = [\n"
    "      'User-agent: *',\n"
    "      'Allow: /',\n"
    "      // Everything below is behind login. Indexing it wastes crawl budget\n"
    "      // and surfaces endpoints that should not be in search results.\n"
    "      'Disallow: /app',\n"
    "      'Disallow: /plans',\n"
    "      'Disallow: /admin',\n"
    "      'Disallow: /auth/',\n"
    "      'Disallow: /api/',\n"
    "      'Disallow: /billing/',\n"
    "      '',\n"
    "      `Sitemap: ${origin}/sitemap.xml`,\n"
    "      '',\n"
    "    ].join('\\n');\n"
    "    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });\n"
    "    return res.end(body);\n"
    "  }\n"
    "  if (method === 'GET' && pathname === '/sitemap.xml') {\n"
    "    const origin = marketingContext(req).base;\n"
    "    const pages = [\n"
    "      { path: '/', priority: '1.0', freq: 'weekly' },\n"
    "      { path: '/features', priority: '0.8', freq: 'monthly' },\n"
    "      { path: '/pricing', priority: '0.9', freq: 'weekly' },\n"
    "      { path: '/contact', priority: '0.4', freq: 'yearly' },\n"
    "      { path: '/privacy', priority: '0.3', freq: 'yearly' },\n"
    "      { path: '/terms', priority: '0.3', freq: 'yearly' },\n"
    "    ];\n"
    "    const today = new Date().toISOString().slice(0, 10);\n"
    "    const body = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n`\n"
    "      + `<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\\n`\n"
    "      + pages.map(page => `  <url><loc>${origin}${page.path === '/' ? '' : page.path}</loc>`\n"
    "        + `<lastmod>${today}</lastmod><changefreq>${page.freq}</changefreq>`\n"
    "        + `<priority>${page.priority}</priority></url>`).join('\\n')\n"
    "      + `\\n</urlset>\\n`;\n"
    "    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });\n"
    "    return res.end(body);\n"
    "  }\n"
    "  // Browsers request these at the root regardless of what the HTML declares.\n"
    "  if (method === 'GET' && (pathname === '/favicon.ico' || pathname === '/favicon.png')) {\n"
    "    const file = path.resolve(config.root, 'src', 'public', 'marketing-assets', 'favicon-32.png');\n"
    "    if (!fs.existsSync(file)) return json(res, 404, { error: 'Favicon not found.' });\n"
    "    return streamFile(req, res, file, { contentType: 'image/png', cacheControl: 'public, max-age=604800' });\n"
    "  }\n"
    "  if (method === 'GET' && pathname === '/apple-touch-icon.png') {\n"
    "    const file = path.resolve(config.root, 'src', 'public', 'marketing-assets', 'apple-touch-icon.png');\n"
    "    if (!fs.existsSync(file)) return json(res, 404, { error: 'Icon not found.' });\n"
    "    return streamFile(req, res, file, { contentType: 'image/png', cacheControl: 'public, max-age=604800' });\n"
    "  }\n"
    "  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));",
    "routes: robots.txt, sitemap.xml, favicon, apple-touch-icon",
)


print("patch12 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
