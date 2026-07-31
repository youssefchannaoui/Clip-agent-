import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const serverPath = path.join(repoRoot, 'src', 'server.js');
const cssPath = path.join(repoRoot, 'src', 'public', 'workspace-shell.css');
const jsPath = path.join(repoRoot, 'src', 'public', 'workspace-shell.js');

for (const required of [serverPath, cssPath, jsPath]) {
  if (!fs.existsSync(required)) {
    console.error(`Missing required file: ${required}`);
    process.exit(1);
  }
}

let source = fs.readFileSync(serverPath, 'utf8');
const original = source;

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) {
    console.error(`Could not find the expected ${label} location in src/server.js.`);
    process.exit(1);
  }
  source = source.replace(search, replacement);
}

replaceOnce(
  "const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');\nconst youtubeCookiesFile = path.join(config.dataDir, 'youtube-cookies.txt');",
  "const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');\nconst workspaceShellCss = path.join(config.root, 'src', 'public', 'workspace-shell.css');\nconst workspaceShellJs = path.join(config.root, 'src', 'public', 'workspace-shell.js');\nconst youtubeCookiesFile = path.join(config.dataDir, 'youtube-cookies.txt');",
  'static asset constants'
);

replaceOnce(
  "function json(res, status, value) {",
  "function staticFile(res, file, contentType) {\n  if (!fs.existsSync(file)) return json(res, 404, { error: 'Static file not found.' });\n  const body = fs.readFileSync(file);\n  res.writeHead(200, {\n    'Content-Type': contentType,\n    'Content-Length': body.length,\n    'Cache-Control': 'no-store',\n  });\n  return res.end(body);\n}\n\nfunction json(res, status, value) {",
  'static file helper'
);

replaceOnce(
  "    let html = fs.readFileSync(page, 'utf8');\n    if (!html.includes('/activity-fix.js')) html = html.replace('</body>', '<script src=\"/activity-fix.js\"></script>\\n</body>');",
  "    let html = fs.readFileSync(page, 'utf8');\n    if (!html.includes('/workspace-shell.css')) html = html.replace('</head>', '<link rel=\"stylesheet\" href=\"/workspace-shell.css\">\\n</head>');\n    if (!html.includes('/activity-fix.js')) html = html.replace('</body>', '<script src=\"/activity-fix.js\"></script>\\n</body>');\n    if (!html.includes('/workspace-shell.js')) html = html.replace('</body>', '<script src=\"/workspace-shell.js\"></script>\\n</body>');",
  'HTML asset injection'
);

replaceOnce(
  "  const oauthCallback = pathname.match(/^\\/auth\\/(youtube|meta|tiktok)\\/callback$/);",
  "  if (method === 'GET' && pathname === '/workspace-shell.css') {\n    return staticFile(res, workspaceShellCss, 'text/css; charset=utf-8');\n  }\n  if (method === 'GET' && pathname === '/workspace-shell.js') {\n    return staticFile(res, workspaceShellJs, 'text/javascript; charset=utf-8');\n  }\n\n  const oauthCallback = pathname.match(/^\\/auth\\/(youtube|meta|tiktok)\\/callback$/);",
  'workspace asset routes'
);

if (source === original) {
  console.log('The workspace loader was already installed. No changes were needed.');
  process.exit(0);
}

const backupPath = `${serverPath}.before-workspace-loader`;
if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, original);
fs.writeFileSync(serverPath, source);

console.log('Installed the DeenClipped workspace loader.');
console.log(`Updated: ${serverPath}`);
console.log(`Backup:  ${backupPath}`);
