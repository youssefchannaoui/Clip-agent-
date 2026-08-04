import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import {
  state, save, log, logFor, clipSettings, setClipSettings, musicSettings, setMusicSettings,
  automationSettings, setAutomationSettings, publishingSettings, setPublishingSettings,
} from './store.js';
import { ownedBy, findOwned } from './tenancy.js';
import * as audio from './audio.js';
import * as templates from './templates.js';
import { wordsForClip, silenceSpans } from './captions.js';
import * as agent from './agent.js';
import * as social from './social.js';
import { formatLocal } from './slots.js';
import { checkFfmpeg } from './ffmpeg.js';
import * as auth from './auth.js';
import * as billing from './billing.js';

const page = path.join(config.root, 'src', 'public', 'index.html');
const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');
const youtubeCookiesFile = path.join(config.dataDir, 'youtube-cookies.txt');

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }

function redirectWithCookies(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers); res.end();
}
function html(res, status, value) {
  const body = Buffer.from(String(value));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function hEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'deenclipped.online').split(',')[0].trim() || 'deenclipped.online';
  return (config.publicBaseUrl || `${proto}://${host}`).replace(/\/+$/, '');
}

function appLink(req, pathValue = '/app') {
  const user = userRecordForRequest(req);
  if (auth.enabled() && !user) return `/login?returnTo=${encodeURIComponent(pathValue)}`;
  return pathValue;
}

function marketingLayout(req, { title = 'DeenClipped', description = 'DeenClipped helps users create, edit and publish short-form clips from long videos.', body = '', canonicalPath = '/', active = '' }) {
  const base = publicBase(req);
  const canonical = `${base}${canonicalPath === '/' ? '' : canonicalPath}`;
  const currentUser = userRecordForRequest(req);
  const dashboardHref = appLink(req, '/app');
  const authActions = currentUser
    ? `<a class="dc-nav-cta" href="${dashboardHref}">My dashboard</a>`
    : `<a class="dc-nav-link" href="/login?returnTo=${encodeURIComponent('/app')}">Sign in</a><a class="dc-nav-cta" href="/login?returnTo=${encodeURIComponent('/app')}">Get started</a>`;
  const nav = [
    ['Features', '/features', 'features'],
    ['Pricing', '/pricing', 'pricing'],
    ['Contact', '/contact', 'contact'],
  ].map(([label, href, key]) => `<a class="dc-nav-link ${active === key ? 'active' : ''}" href="${href}">${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${hEsc(title)}</title>
  <meta name="description" content="${hEsc(description)}">
  <link rel="canonical" href="${hEsc(canonical)}">
  <meta property="og:title" content="${hEsc(title)}">
  <meta property="og:description" content="${hEsc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${hEsc(canonical)}">
  <meta name="theme-color" content="#070707">
  <style>
    :root{
      color-scheme:dark;
      --bg:#050505;--bg2:#09090b;--panel:#111113;--panel2:#171717;--panel3:#201b13;
      --line:rgba(255,255,255,.11);--line2:rgba(227,189,117,.24);
      --text:#f9f5ef;--muted:#a9a29a;--soft:#706a63;
      --gold:#d9b478;--gold2:#f1d49a;--gold3:#9f7640;--green:#48d597;--blue:#8dd6ff;
      --shadow:0 28px 120px rgba(0,0,0,.48);--radius:30px;--max:1180px;
      --font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    }
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}a{color:inherit;text-decoration:none}button,input{font:inherit}.dc-bg{position:fixed;inset:0;z-index:-2;background:radial-gradient(circle at 14% -5%,rgba(217,180,120,.22),transparent 32%),radial-gradient(circle at 85% 8%,rgba(141,214,255,.11),transparent 30%),linear-gradient(180deg,#050505,#08080a 46%,#050505)}.dc-bg:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.9),transparent 70%)}.dc-container{width:min(var(--max),calc(100% - 36px));margin:0 auto}.dc-nav{position:sticky;top:0;z-index:20;background:rgba(5,5,6,.70);backdrop-filter:blur(22px);border-bottom:1px solid rgba(255,255,255,.07)}.dc-nav-inner{height:84px;display:flex;align-items:center;justify-content:space-between;gap:18px}.dc-brand{display:flex;align-items:center;gap:12px;font-weight:900;letter-spacing:-.03em;font-size:22px}.dc-logo{width:42px;height:42px;border-radius:16px;background:linear-gradient(135deg,var(--gold2),var(--gold));box-shadow:0 18px 55px rgba(217,180,120,.26);display:grid;place-items:center}.dc-logo i{display:block;width:19px;height:19px;border-radius:7px;background:#060606;clip-path:polygon(50% 0,95% 24%,95% 76%,50% 100%,5% 76%,5% 24%)}.dc-nav-links{display:flex;align-items:center;gap:10px}.dc-nav-link,.dc-nav-cta{display:inline-flex;align-items:center;justify-content:center;min-height:42px;border-radius:999px;padding:0 16px;color:var(--muted);font-size:14px;font-weight:700}.dc-nav-link:hover,.dc-nav-link.active{color:var(--text);background:rgba(255,255,255,.055)}.dc-nav-cta{color:#100b04;background:linear-gradient(135deg,var(--gold2),var(--gold));box-shadow:0 10px 40px rgba(217,180,120,.18)}.dc-menu{display:none}.dc-hero{padding:76px 0 34px;display:grid;grid-template-columns:1.04fr .96fr;gap:44px;align-items:center}.dc-badge{display:inline-flex;align-items:center;gap:9px;min-height:34px;padding:0 13px;border-radius:999px;border:1px solid var(--line2);background:rgba(217,180,120,.08);color:var(--gold2);font-size:12px;font-weight:900;letter-spacing:.095em;text-transform:uppercase}.dc-dot{width:8px;height:8px;border-radius:99px;background:var(--green);box-shadow:0 0 20px var(--green)}.dc-hero h1{margin:20px 0 12px;font-size:20px;line-height:1;letter-spacing:.02em;color:var(--gold2);font-weight:900}.dc-hero h2{margin:0;font-size:clamp(46px,7.8vw,92px);line-height:.93;letter-spacing:-.082em;max-width:850px}.dc-lead{font-size:clamp(18px,2vw,22px);color:var(--muted);max-width:720px;margin:22px 0 30px}.dc-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.dc-btn{min-height:54px;display:inline-flex;align-items:center;justify-content:center;gap:10px;border-radius:999px;padding:0 22px;border:1px solid var(--line);background:rgba(255,255,255,.045);color:var(--text);font-weight:850}.dc-btn.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#100b04;border-color:rgba(217,180,120,.55)}.dc-btn:hover,.dc-nav-cta:hover{transform:translateY(-1px)}.dc-mini{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px;color:var(--soft);font-size:13px}.dc-mini span{display:inline-flex;gap:7px;align-items:center}.dc-mini span:before{content:"";width:6px;height:6px;border-radius:99px;background:rgba(217,180,120,.75)}.dc-visual{border:1px solid rgba(255,255,255,.10);border-radius:36px;background:linear-gradient(145deg,rgba(255,255,255,.09),rgba(255,255,255,.025));box-shadow:var(--shadow);padding:18px;position:relative;overflow:hidden}.dc-visual:before{content:"";position:absolute;inset:-60px;background:radial-gradient(circle at 70% 10%,rgba(217,180,120,.18),transparent 38%),radial-gradient(circle at 25% 80%,rgba(72,213,151,.13),transparent 32%);filter:blur(8px)}.dc-window{position:relative;border:1px solid rgba(255,255,255,.10);border-radius:26px;background:#080809;padding:16px}.dc-window-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;color:var(--soft);font-size:12px}.dc-dots{display:flex;gap:7px}.dc-dots i{width:8px;height:8px;border-radius:99px;background:rgba(255,255,255,.22)}.dc-import{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:999px;background:#111113;padding:10px 12px;margin-bottom:14px}.dc-import span{color:var(--muted);font-size:14px}.dc-import b{margin-left:auto;background:var(--gold);color:#100b04;border-radius:999px;padding:8px 12px;font-size:12px}.dc-flow{display:grid;grid-template-columns:1fr .7fr;gap:12px}.dc-player{border-radius:22px;background:linear-gradient(135deg,#2a2218,#101012);min-height:308px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.08)}.dc-player:before{content:"LONG LECTURE";position:absolute;left:18px;top:18px;font-size:11px;color:var(--gold2);letter-spacing:.13em;font-weight:900}.dc-play{position:absolute;inset:0;display:grid;place-items:center}.dc-play i{width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.16);box-shadow:0 22px 55px rgba(0,0,0,.28);position:relative}.dc-play i:after{content:"";position:absolute;left:32px;top:24px;border-left:23px solid white;border-top:15px solid transparent;border-bottom:15px solid transparent}.dc-timeline{position:absolute;left:18px;right:18px;bottom:20px;height:10px;border-radius:999px;background:rgba(255,255,255,.13);overflow:hidden}.dc-timeline:after{content:"";display:block;width:62%;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--gold),var(--gold2))}.dc-clips{display:grid;gap:12px}.dc-clip{min-height:92px;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:linear-gradient(135deg,#19191c,#0d0d0f);padding:14px}.dc-clip b{font-size:12px;color:var(--gold2);text-transform:uppercase;letter-spacing:.1em}.dc-clip span{display:block;margin-top:8px;color:var(--muted);font-size:13px}.dc-clip.good{box-shadow:inset 0 0 0 1px rgba(72,213,151,.22)}.dc-section{padding:78px 0}.dc-section-head{text-align:center;max-width:760px;margin:0 auto 34px}.dc-kicker{color:var(--gold2);font-size:12px;font-weight:900;letter-spacing:.13em;text-transform:uppercase;margin-bottom:10px}.dc-section h2{font-size:clamp(34px,5vw,58px);line-height:1;letter-spacing:-.06em;margin:0}.dc-section p{color:var(--muted)}.dc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.dc-card{border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));padding:24px;position:relative;overflow:hidden}.dc-card:after{content:"";position:absolute;right:-44px;top:-44px;width:120px;height:120px;border-radius:50%;background:rgba(217,180,120,.055)}.dc-icon{width:46px;height:46px;border-radius:17px;background:rgba(217,180,120,.10);border:1px solid rgba(217,180,120,.22);display:grid;place-items:center;color:var(--gold2);font-weight:900;margin-bottom:16px}.dc-card h3{font-size:22px;letter-spacing:-.035em;margin:0 0 8px}.dc-card p{margin:0}.dc-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.dc-step{padding:18px;border:1px solid var(--line);border-radius:24px;background:rgba(255,255,255,.035)}.dc-step b{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:14px;background:var(--gold);color:#100b04;margin-bottom:14px}.dc-workflow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:14px}.dc-stage{min-height:220px;border-radius:30px;border:1px solid var(--line);background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.025));padding:24px}.dc-stage strong{font-size:24px;display:block;margin-bottom:10px}.dc-arrow{color:var(--gold);font-size:28px}.dc-pricing{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.dc-price{border:1px solid var(--line);border-radius:28px;padding:24px;background:rgba(255,255,255,.04)}.dc-price.featured{border-color:rgba(217,180,120,.45);box-shadow:0 0 0 1px rgba(217,180,120,.12) inset,0 30px 90px rgba(217,180,120,.07)}.dc-price h3{margin:0;font-size:22px}.dc-tokens{font-size:42px;letter-spacing:-.06em;font-weight:950;margin:14px 0 2px}.dc-tokens small{font-size:13px;color:var(--muted);letter-spacing:0}.dc-price ul{margin:18px 0 0;padding:0;list-style:none;color:var(--muted);font-size:14px}.dc-price li{margin:9px 0}.dc-price li:before{content:"✓";color:var(--green);font-weight:900;margin-right:8px}.dc-faq{max-width:880px;margin:0 auto}.dc-faq details{border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.035);padding:18px 20px;margin-bottom:12px}.dc-faq summary{cursor:pointer;font-weight:850}.dc-cta{border:1px solid rgba(217,180,120,.28);border-radius:34px;background:radial-gradient(circle at 25% 5%,rgba(217,180,120,.18),transparent 36%),linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025));padding:42px;text-align:center;box-shadow:var(--shadow)}.dc-cta h2{margin-bottom:14px}.dc-footer{border-top:1px solid var(--line);padding:34px 0;color:var(--muted)}.dc-footer-inner{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap}.dc-footer a{color:var(--muted);margin-left:14px}.dc-page{padding:60px 0 84px}.dc-page-hero{max-width:840px;margin-bottom:28px}.dc-page-hero h1{font-size:clamp(40px,6vw,72px);line-height:.95;letter-spacing:-.07em;margin:14px 0}.dc-page-card{border:1px solid var(--line);border-radius:30px;background:rgba(255,255,255,.04);padding:30px;max-width:920px}.dc-page-card h2{margin:28px 0 8px;font-size:24px}.dc-page-card h2:first-child{margin-top:0}.dc-page-card p,.dc-page-card li{color:var(--muted)}.dc-contact{display:grid;grid-template-columns:1fr 1fr;gap:16px}.dc-contact .dc-card{min-height:210px}.reveal{animation:rise .8s ease both}.reveal:nth-child(2){animation-delay:.08s}.reveal:nth-child(3){animation-delay:.16s}@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@media(max-width:980px){.dc-nav-inner{height:auto;padding:16px 0;align-items:flex-start}.dc-nav-links{flex-wrap:wrap;justify-content:flex-end}.dc-hero{grid-template-columns:1fr;padding-top:42px}.dc-grid,.dc-pricing{grid-template-columns:1fr 1fr}.dc-steps,.dc-workflow{grid-template-columns:1fr}.dc-arrow{display:none}.dc-flow{grid-template-columns:1fr}.dc-contact{grid-template-columns:1fr}}@media(max-width:640px){.dc-container{width:min(100% - 24px,var(--max))}.dc-brand{font-size:18px}.dc-logo{width:36px;height:36px;border-radius:14px}.dc-nav-links{gap:6px}.dc-nav-link{display:none}.dc-nav-link.active{display:inline-flex}.dc-nav-cta{padding:0 12px}.dc-grid,.dc-pricing{grid-template-columns:1fr}.dc-hero h2{font-size:46px}.dc-visual{padding:10px;border-radius:26px}.dc-player{min-height:230px}.dc-cta{padding:28px}.dc-footer a{display:inline-block;margin:7px 12px 0 0}}
  </style>
</head>
<body>
  <div class="dc-bg" aria-hidden="true"></div>
  <header class="dc-nav"><div class="dc-container dc-nav-inner"><a class="dc-brand" href="/"><span class="dc-logo"><i></i></span><span>DeenClipped</span></a><nav class="dc-nav-links" aria-label="Main navigation">${nav}${authActions}</nav></div></header>
  ${body}
  <footer class="dc-footer"><div class="dc-container dc-footer-inner"><div><strong>DeenClipped</strong><br><span>DeenClipped helps users create, edit, and publish short-form clips from long videos.</span></div><nav><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></nav></div></footer>
</body>
</html>`;
}

function marketingHome(req) {
  const startHref = appLink(req, '/app');
  return marketingLayout(req, {
    title: 'DeenClipped',
    description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.',
    canonicalPath: '/', active: 'home',
    body: `<main><section class="dc-container dc-hero"><div class="reveal"><span class="dc-badge"><i class="dc-dot"></i>AI video clipping for Islamic content</span><h1>DeenClipped</h1><h2>Turn long Islamic lectures into short, ready-to-post clips.</h2><p class="dc-lead">DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos. Paste a video link or upload a lecture, choose the source range, generate clips, review them, and publish faster.</p><div class="dc-actions"><a class="dc-btn primary" href="${startHref}">Get started</a><a class="dc-btn" href="/pricing">View pricing</a></div><div class="dc-mini"><span>No customer cookies</span><span>Your own social accounts</span><span>Templates and captions included</span></div></div><aside class="dc-visual reveal"><div class="dc-window"><div class="dc-window-top"><div class="dc-dots"><i></i><i></i><i></i></div><span>DeenClipped workflow</span></div><div class="dc-import"><span>Paste a video link or upload a lecture</span><b>Create clips</b></div><div class="dc-flow"><div class="dc-player"><div class="dc-play"><i></i></div><div class="dc-timeline"></div></div><div class="dc-clips"><div class="dc-clip good"><b>Clip 01</b><span>Strong hook detected · 94/100</span></div><div class="dc-clip"><b>Caption style</b><span>Modern Minimal template applied</span></div><div class="dc-clip"><b>Publish</b><span>YouTube Shorts ready</span></div></div></div></div></aside></section>${workflowSection()}${featuresPreview()}${whySection()}${pricingPreview(req)}${faqSection()}${finalCta(req)}</main>`
  });
}

function workflowSection() {
  const steps = [
    ['1', 'Import video', 'Paste a YouTube link or upload your own lecture file.'],
    ['2', 'Choose range', 'Select the exact source window before tokens are used.'],
    ['3', 'Generate clips', 'AI finds strong reminders, hooks and short-form moments.'],
    ['4', 'Review/edit', 'Approve clips, adjust captions and keep templates consistent.'],
    ['5', 'Publish', 'Connect your own accounts and post or schedule clips.'],
  ];
  return `<section class="dc-container dc-section"><div class="dc-section-head"><div class="dc-kicker">How it works</div><h2>From one lecture to a week of clips.</h2><p>DeenClipped keeps the workflow simple: import, trim, generate, review, publish.</p></div><div class="dc-steps">${steps.map(([num, title, copy]) => `<article class="dc-step reveal"><b>${num}</b><h3>${title}</h3><p>${copy}</p></article>`).join('')}</div></section>`;
}

function featuresPreview() {
  const items = [
    ['AI', 'AI clip detection', 'Find the strongest moments without scrubbing through the entire lecture.'],
    ['CC', 'Auto captions', 'Generate vertical captions and highlight spoken words for short-form retention.'],
    ['9:16', 'Smart reframing', 'Format clips for YouTube Shorts, Reels and TikTok-style vertical video.'],
    ['TMP', 'Templates', 'Use saved styles so every clip looks consistent and branded.'],
    ['✓', 'Clip review', 'Approve, edit, shorten, lengthen or delete clips before publishing.'],
    ['↗', 'Publishing', 'Connect your own channel and publish or schedule approved clips.'],
  ];
  return `<section class="dc-container dc-section" id="features"><div class="dc-section-head"><div class="dc-kicker">Features</div><h2>Everything needed to clip, polish and post.</h2><p>Built for creators who want a clean workflow without becoming full-time editors.</p></div><div class="dc-grid">${items.map(([icon, title, copy]) => `<article class="dc-card reveal"><div class="dc-icon">${icon}</div><h3>${title}</h3><p>${copy}</p></article>`).join('')}</div></section>`;
}

function whySection() {
  return `<section class="dc-container dc-section"><div class="dc-workflow"><article class="dc-stage"><strong>Long lecture</strong><p>Start with a full talk, podcast or reminder. Use source range control to choose the part that should be analysed.</p></article><div class="dc-arrow">→</div><article class="dc-stage"><strong>AI clips</strong><p>DeenClipped creates short clips with captions, titles, templates and review tools.</p></article><div class="dc-arrow">→</div><article class="dc-stage"><strong>Ready to publish</strong><p>Connect each user’s own YouTube/social account and keep every workspace separate.</p></article></div></section><section class="dc-container dc-section"><div class="dc-section-head"><div class="dc-kicker">Why DeenClipped</div><h2>Made for Islamic reminders and lecture clipping.</h2><p>DeenClipped focuses on clean, respectful short-form clips: no messy workflow, no public customer cookie setup, no shared publishing account, and no editing experience needed.</p></div></section>`;
}

function pricingPreview(req) {
  const plans = [
    ['Free', String(config.tokensFree || 40), 'starter tokens', ['Try the workflow', 'Generate first clips', 'Upgrade when ready']],
    ['Weekly', String(config.tokensWeekly || 120), 'tokens / week', ['Good for light posting', '7-day trial on paid plans', 'Template rerenders stay free']],
    ['Monthly', String(config.tokensMonthly || 650), 'tokens / month', ['Best for regular creators', 'More source minutes', 'Publishing workflow included']],
    ['Yearly', String(config.tokensYearly || 9000), 'tokens / year', ['Built for serious posting', 'Largest allowance', 'Best long-term value']],
  ];
  return `<section class="dc-container dc-section"><div class="dc-section-head"><div class="dc-kicker">Pricing</div><h2>Tokens based on source video time.</h2><p>DeenClipped charges around ${hEsc(config.tokensPerMinute || 1)} token per selected source minute. Template rerenders stay free.</p></div><div class="dc-pricing">${plans.map(([name, tokens, label, bullets], index) => `<article class="dc-price ${index === 2 ? 'featured' : ''}"><h3>${name}</h3><div class="dc-tokens">${tokens}<small> ${label}</small></div><ul>${bullets.map(item => `<li>${item}</li>`).join('')}</ul></article>`).join('')}</div><div class="dc-actions" style="justify-content:center;margin-top:24px"><a class="dc-btn primary" href="${appLink(req, '/plans?returnTo=/app')}">Choose a plan</a><a class="dc-btn" href="/pricing">Full pricing</a></div></section>`;
}

function faqSection() {
  const items = [
    ['Can I upload videos?', 'Yes. Uploading your own video file is the most reliable way to process content you own or have permission to use.'],
    ['Can I paste YouTube links?', 'Yes, DeenClipped can try to import supported public links. If a platform blocks import, upload the video file instead.'],
    ['Do customers need to upload cookies?', 'No. Normal customers should never upload cookies. Any import fallback should happen on the backend or show a clean upload fallback.'],
    ['Do clips publish to my own account?', 'Yes. Each user connects their own YouTube/social account, and publishing uses that user’s connection.'],
    ['Do I need editing experience?', 'No. DeenClipped generates clips, captions and templates, then lets you review and polish before posting.'],
  ];
  return `<section class="dc-container dc-section"><div class="dc-section-head"><div class="dc-kicker">FAQ</div><h2>Got questions?</h2></div><div class="dc-faq">${items.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div></section>`;
}

function finalCta(req) {
  return `<section class="dc-container dc-section"><div class="dc-cta"><div class="dc-kicker">Start clipping</div><h2>Build your short-form reminder workflow today.</h2><p>Import a lecture, choose a template, generate clips and review everything before posting.</p><div class="dc-actions" style="justify-content:center"><a class="dc-btn primary" href="${appLink(req, '/app')}">Open DeenClipped</a><a class="dc-btn" href="/contact">Contact</a></div></div></section>`;
}

function featuresPage(req) {
  return marketingLayout(req, {
    title: 'Features — DeenClipped', active: 'features', canonicalPath: '/features',
    description: 'Explore DeenClipped features for AI clipping, captions, templates, review, publishing and scheduling.',
    body: `<main class="dc-container dc-page"><section class="dc-page-hero"><span class="dc-badge">Features</span><h1>AI clipping tools for a complete creator workflow.</h1><p class="dc-lead">DeenClipped helps users create, edit, and publish short-form clips from long videos with source range control, captions, templates, review tools and social connections.</p></section>${featuresPreview()}${workflowSection()}${finalCta(req)}</main>`
  });
}

function pricingPage(req) {
  return marketingLayout(req, {
    title: 'Pricing — DeenClipped', active: 'pricing', canonicalPath: '/pricing',
    description: 'DeenClipped pricing plans and token usage for creating clips from long videos.',
    body: `<main>${pricingPreview(req)}<section class="dc-container dc-section"><article class="dc-page-card"><h2>How tokens work</h2><p>Tokens are based on selected source video time. For example, selecting a shorter part of a lecture reduces the source minutes DeenClipped needs to process. Template-only rerenders do not cost tokens.</p><h2>Free trial</h2><p>Paid plans can include a trial when Stripe is configured. The app shows exact plan availability inside DeenClipped before checkout.</p></article></section>${faqSection()}</main>`
  });
}

function contactPage(req) {
  return marketingLayout(req, {
    title: 'Contact — DeenClipped', active: 'contact', canonicalPath: '/contact',
    description: 'Contact DeenClipped support.',
    body: `<main class="dc-container dc-page"><section class="dc-page-hero"><span class="dc-badge">Contact</span><h1>Contact DeenClipped.</h1><p class="dc-lead">Need help with your account, publishing, billing or Google verification? Contact support.</p></section><section class="dc-contact"><article class="dc-card"><div class="dc-icon">@</div><h3>Email support</h3><p>Send questions to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article><article class="dc-card"><div class="dc-icon">?</div><h3>Creator help</h3><p>Ask about uploading videos, connecting YouTube, plans, tokens or publishing settings.</p></article></section></main>`
  });
}

function privacyPage(req) {
  return marketingLayout(req, {
    title: 'Privacy Policy — DeenClipped',
    description: 'Privacy Policy for DeenClipped.',
    canonicalPath: '/privacy',
    body: `<main class="dc-container dc-page"><article class="dc-page-card"><h1>Privacy Policy</h1><p>Last updated: 4 August 2026</p><p>DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos. This Privacy Policy explains what information DeenClipped collects and how it is used.</p><h2>Information we collect</h2><p>We may collect account information such as your name, email address and profile picture when you sign in. We may also store videos, links, generated clips, captions, templates, publishing settings, billing status and connected social account information needed to provide the service.</p><h2>Connected accounts</h2><p>When you connect a platform such as YouTube, DeenClipped stores the connection for your own account so clips can be published to the channel you choose. Tokens are used only to provide requested publishing features and are not sold.</p><h2>How we use information</h2><p>We use information to operate DeenClipped, process videos, generate clips, show projects in your library, provide billing/token features, connect publishing platforms, prevent abuse and improve reliability.</p><h2>Sharing</h2><p>We do not sell personal information. We may share information with service providers used to operate the app, such as hosting, payment processing, authentication and social publishing APIs, only as needed to provide the service.</p><h2>Data security</h2><p>We use reasonable technical measures to protect user data. No online service can guarantee absolute security.</p><h2>Your choices</h2><p>You can disconnect social accounts, delete generated content where available, or contact support about account data.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></main>`
  });
}

function termsPage(req) {
  return marketingLayout(req, {
    title: 'Terms of Service — DeenClipped',
    description: 'Terms of Service for DeenClipped.',
    canonicalPath: '/terms',
    body: `<main class="dc-container dc-page"><article class="dc-page-card"><h1>Terms of Service</h1><p>Last updated: 4 August 2026</p><p>These Terms govern use of DeenClipped, a web application for creating, editing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions for the content you process.</p><h2>Connected platforms</h2><p>When you connect YouTube or another platform, DeenClipped publishes only using the connected account permissions you grant. You remain responsible for complying with each platform's rules.</p><h2>Billing and tokens</h2><p>Some features may require tokens, subscriptions or paid plans. Token usage may be based on selected source video time and other plan rules shown in the app.</p><h2>Service availability</h2><p>DeenClipped may change, pause or remove features over time. We do not guarantee uninterrupted access.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></main>`
  });
}

function formBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { const params = new URLSearchParams(raw); const body = {}; for (const [key, value] of params.entries()) body[key] = value; resolve(body); });
    req.on('error', reject);
  });
}
function userRecordForRequest(req) { return auth.currentUser(req); }
/*
 * Record lookup is scoped to the signed-in account, always.
 *
 * These previously found the record first and checked permission second, and
 * answered 403 when the check failed — which told a stranger that a clip id
 * exists and belongs to someone else. Now a record owned by another account is
 * simply not found, and the response is identical to a genuinely missing id.
 */
function assertCanAccessClip(user, clipId) {
  const clip = findOwned(state.clips, clipId, user?.id);
  if (!clip) throw Object.assign(new Error('Clip not found.'), { statusCode: 404 });
  return clip;
}
function assertCanAccessProject(user, projectId) {
  const project = findOwned(state.projects, projectId, user?.id);
  if (!project) throw Object.assign(new Error('Project not found.'), { statusCode: 404 });
  return project;
}
function requireOperator(user) {
  if (user?.role !== 'owner') throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  return user;
}

function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // Only the acting account's clips. This used to sweep `state.clips`, so one
  // customer saving a template queued a re-render of every other customer's
  // work onto their own template.
  for (const clip of ownedBy(state.clips, user?.id)) {
    if (clip.status === 'posted' || clip.variantOf) { skipped += 1; continue; }
    try {
      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false });
      queued += 1;
    } catch (error) {
      skipped += 1;
      errors.push({ clipId: clip.id, error: error.message });
    }
  }
  log(`Template "${template.name}" queued for ${queued} unposted clips after ${reason}; ${skipped} skipped.`, 'info', user?.id);
  return { queued, skipped, errors: errors.slice(0, 20) };
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
function authed(req, url) { return !config.password || sameSecret(req.headers['x-app-password'] || url.searchParams.get('pw') || '', config.password); }
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body was not valid JSON.')); } });
    req.on('error', reject);
  });
}

function readRawBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function streamFile(req, res, file, { downloadName = '', contentType = '', cacheControl = 'private, no-store' } = {}) {
  if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'File not found.' });
  const stat = fs.statSync(file); const range = req.headers.range;
  const headers = { 'Content-Type': contentType || (path.extname(file).toLowerCase() === '.jpg' ? 'image/jpeg' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0; const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      const finalEnd = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${finalEnd}/${stat.size}`, 'Content-Length': finalEnd - start + 1 });
      return fs.createReadStream(file, { start, end: finalEnd }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size }); return fs.createReadStream(file).pipe(res);
}

function latestRerender(clipId) { return state.rerenderJobs.find(job => job.clipId === clipId) || null; }
function publicClip(clip) {
  const currentTemplate = templates.templateById(clip.templateId);
  const rerender = latestRerender(clip.id);
  return {
    id: clip.id, projectId: clip.projectId, projectTitle: clip.projectTitle,
    title: clip.title, description: clip.description, hashtags: clip.hashtags, transcript: clip.transcript,
    score: clip.score, scoreReasons: clip.scoreReasons || [], quality: clip.quality || null,
    reviewRequired: Boolean(clip.reviewRequired), startSec: clip.startSec, endSec: clip.endSec, durationMs: clip.durationMs,
    status: clip.status, approvedBy: clip.approvedBy || null,
    scheduledAt: clip.scheduledAt, scheduledLabel: clip.scheduledAt ? formatLocal(clip.scheduledAt) : null,
    readyAt: clip.readyAt || null, postedAt: clip.postedAt,
    musicName: clip.musicName, musicVerified: Boolean(clip.musicVerified),
    templateId: clip.templateId, templateName: clip.templateName, templateVersion: clip.templateVersion || 1,
    templateOutdated: Boolean(currentTemplate && Number(currentTemplate.version || 1) > Number(clip.templateVersion || 1)),
    renderVersion: clip.renderVersion || 1, renderVerified: Boolean(clip.renderVerified),
    renderedWidth: clip.renderedWidth || null, renderedHeight: clip.renderedHeight || null,
    variantOf: clip.variantOf || null, addedAt: clip.addedAt,
    targets: (clip.targets || []).map(social.targetPublic),
    rerender: rerender ? { id: rerender.id, status: rerender.status, stage: rerender.stage, progress: rerender.progress, error: rerender.error || null, asVariant: rerender.asVariant } : null,
    videoUrl: `/api/clips/${encodeURIComponent(clip.id)}/video`, thumbUrl: `/api/clips/${encodeURIComponent(clip.id)}/thumb`,
  };
}

function appState(user = null) {
  // Everything below is scoped to one account: its records, its settings, its
  // templates, its music, its connected platforms and its activity feed.
  if (!user?.id) return { engine: 'self-hosted', user: null, auth: auth.publicConfig(), projects: [], clips: [], log: [] };
  const readiness = agent.engine.readiness(user);
  const projectsForUser = ownedBy(state.projects, user.id);
  const projectIdsForUser = new Set(projectsForUser.map(project => project.id));
  const clipsForUser = ownedBy(state.clips, user.id).filter(clip => projectIdsForUser.has(clip.projectId));
  return {
    engine: 'self-hosted', user: auth.userPublic(user), auth: auth.publicConfig(), readiness, clipSettings: clipSettings(user), musicSettings: musicSettings(user), automationSettings: automationSettings(user),
    selectedTemplate: templates.selectedTemplate(user), templates: templates.listTemplates(user), templateDraft: templates.defaultTemplateDraft(),
    tracks: audio.listNasheeds(user),
    projects: projectsForUser.map(project => ({
      id: project.id, title: project.title, url: project.url, engine: project.engine, status: project.status,
      stage: project.stage, progress: project.progress || 0, error: project.error || null,
      submittedAt: project.submittedAt, completedAt: project.completedAt || null, clipCount: project.clipCount || 0,
      durationSec: project.durationSec || project.sourceDurationSec || null, sourceDurationSec: project.sourceDurationSec || null, sourceThumbUrl: project.sourceThumbUrl || null, sourceTitle: project.sourceTitle || null, templateIdUsed: project.templateIdUsed,
      templateNameUsed: project.templateNameUsed, templateVersionUsed: project.templateVersionUsed || 1, musicRequired: true,
      sourceReusable: Boolean(project.sourceFile && fs.existsSync(project.sourceFile) && project.transcriptFile && fs.existsSync(project.transcriptFile)),
      moreJob: project.moreJob ? {
        id: project.moreJob.id, status: project.moreJob.status, stage: project.moreJob.stage,
        progress: project.moreJob.progress || 0, error: project.moreJob.error || null,
        requestedCount: project.moreJob.requestedCount || 0, importedCount: project.moreJob.importedCount || 0,
        createdAt: project.moreJob.createdAt || null, startedAt: project.moreJob.startedAt || null,
        completedAt: project.moreJob.completedAt || null, updatedAt: project.moreJob.updatedAt || null,
        reusedSource: true, reusedTranscript: true,
      } : null,
    })),
    clips: clipsForUser.map(publicClip),
    rerenderJobs: ownedBy(state.rerenderJobs, user.id).filter(job => clipsForUser.some(clip => clip.id === job.clipId)).slice(0, 30),
    postTimes: config.postTimes, timezone: config.timezone, activeJobs: agent.engine.activeJobCount(),
    log: logFor(user, 60), directPublishingEnabled: config.socialPublishEnabled,
    publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),
  };
}

function runDoctor() {
  return new Promise(resolve => {
    const child = spawn(config.pythonBin, [config.workerScript, '--doctor'], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => { clearTimeout(timer); let details = null; try { details = JSON.parse(stdout.trim()); } catch {} resolve({ ok: code === 0, details, error: stderr.trim() || (!details ? stdout.trim() : '') }); });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
  });
}

async function route(req, res, url) {
  const { pathname } = url; const method = req.method || 'GET';
  if (pathname === '/healthz') return json(res, 200, { ok: true, engine: 'self-hosted' });
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    try {
      const raw = await readRawBody(req, 5_000_000);
      const event = billing.verifyStripeSignature(raw, req.headers['stripe-signature'] || '');
      billing.handleWebhookEvent(event);
      return json(res, 200, { received: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const currentUser = userRecordForRequest(req);
  if (method === 'GET' && pathname === '/login') {
    if (currentUser && auth.enabled()) return redirect(res, billing.postLoginRedirect(currentUser, url.searchParams.get('returnTo') || '/app'));
    return html(res, 200, auth.loginPage({ error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'GET' && pathname === '/plans') {
    if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent(pathname + url.search)}`);
    return html(res, 200, billing.plansPage(currentUser, { error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'POST' && pathname === '/billing/continue-free') {
    try { const body = await formBody(req); billing.markPlansSeen(currentUser); return redirect(res, body.returnTo || '/app'); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/billing/checkout') {
    try { const body = await formBody(req); const session = await billing.createCheckoutSession(currentUser, String(body.plan || '')); return redirect(res, session.url); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  const authStart = pathname.match(/^\/auth\/(google|apple)\/start$/);
  if (method === 'GET' && authStart) {
    try { return redirect(res, auth.oauthStart(authStart[1], req, url.searchParams.get('returnTo') || '/app')); }
    catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'GET' && pathname === '/auth/google/callback') {
    try {
      const result = await auth.completeGoogle(req, url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      const session = auth.createSession(result.user, { provider: 'google' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/apple/callback') {
    try {
      const body = await formBody(req);
      const result = await auth.completeApple(req, body);
      const session = auth.createSession(result.user, { provider: 'apple' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/email') {
    try {
      const body = await formBody(req);
      const user = auth.emailLogin(body.email || '', body.password || '', body.name || '');
      const session = auth.createSession(user, { provider: 'email' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/password') {
    try {
      const body = await formBody(req);
      const user = auth.passwordLogin(body.password || '');
      const session = auth.createSession(user, { provider: 'password' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/logout') {
    auth.destroySession(req);
    return redirectWithCookies(res, '/', auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) return html(res, 200, marketingHome(req));
  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));
  if (method === 'GET' && pathname === '/pricing') return html(res, 200, pricingPage(req));
  if (method === 'GET' && pathname === '/contact') return html(res, 200, contactPage(req));
  if (method === 'GET' && pathname === '/privacy') return html(res, 200, privacyPage(req));
  if (method === 'GET' && pathname === '/terms') return html(res, 200, termsPage(req));
  if (method === 'GET' && pathname === '/dashboard') return redirect(res, '/app');
  if (method === 'GET' && (pathname === '/app' || pathname === '/app/')) {
    if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent(pathname + url.search)}`);
    if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + url.search)}`);
    let html = fs.readFileSync(page, 'utf8');
    if (!html.includes('/activity-fix.js')) html = html.replace('</body>', '<script src="/activity-fix.js"></script>\n</body>');
    const body = Buffer.from(html);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (method === 'GET' && pathname === '/activity-fix.js') {
    if (!fs.existsSync(activityFixPage)) return json(res, 404, { error: 'Activity UI script not found.' });
    const body = fs.readFileSync(activityFixPage);
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  const oauthCallback = pathname.match(/^\/auth\/(youtube|meta|tiktok)\/callback$/);
  if (method === 'GET' && oauthCallback) {
    const provider = oauthCallback[1];
    try {
      // The account comes from the signed OAuth state, not from whoever holds
      // a session cookie when the callback lands.
      await social.completeOAuth(provider, url);
      return redirect(res, `/app?social=connected&provider=${encodeURIComponent(provider)}`);
    } catch (error) {
      console.error(error);
      return redirect(res, `/app?social=error&provider=${encodeURIComponent(provider)}&message=${encodeURIComponent(error.message)}`);
    }
  }
  const socialMedia = pathname.match(/^\/media\/social\/([^/]+)\.mp4$/);
  if (method === 'GET' && socialMedia) {
    const clipId = decodeURIComponent(socialMedia[1]);
    let allowed = false;
    try { allowed = social.verifyMediaSignature(clipId, url.searchParams.get('exp'), url.searchParams.get('sig')); } catch {}
    if (!allowed) return json(res, 403, { error: 'This media link is invalid or expired.' });
    const file = agent.engine.clipFilePath(clipId, 'video');
    return streamFile(req, res, file, { cacheControl: 'public, max-age=3600, immutable' });
  }
  // Serve TikTok's root verification text file before the non-API 404.
  // This supports TikTok-generated verification filenames without hard-coding one token.
  if (method === 'GET') {
    const verificationMatch = pathname.match(/^\/([A-Za-z0-9._-]+\.txt)$/);
    if (verificationMatch) {
      const verificationFile = path.resolve(config.root, verificationMatch[1]);
      const rootPrefix = path.resolve(config.root) + path.sep;

      if (
        verificationFile.startsWith(rootPrefix) &&
        fs.existsSync(verificationFile) &&
        fs.statSync(verificationFile).isFile()
      ) {
        const body = fs.readFileSync(verificationFile);
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        return res.end(body);
      }
    }
  }

  // TikTok URL-prefix verification files are uploaded to the repository root.
  // Serve only root-level TikTok .txt verification files publicly.
  if (method === 'GET' && /^\/tiktok[^/]*\.txt$/i.test(pathname)) {
    const verificationName = path.basename(decodeURIComponent(pathname));
    const verificationFile = path.join(config.root, verificationName);
    if (!fs.existsSync(verificationFile) || !fs.statSync(verificationFile).isFile()) {
      return json(res, 404, { error: 'TikTok verification file not found.' });
    }
    const body = fs.readFileSync(verificationFile);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  if (!pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
  if (auth.enabled() && !currentUser) return json(res, 401, { error: 'Sign in to continue.', loginRequired: true });
  if (!auth.enabled() && !authed(req, url)) return json(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: auth.userPublic(currentUser), auth: auth.publicConfig() });
  if (method === 'GET' && pathname === '/api/state') return json(res, 200, appState(currentUser));
  if (method === 'GET' && pathname === '/api/billing') return json(res, 200, billing.publicBilling(currentUser));
  if (method === 'POST' && pathname === '/api/billing/estimate') {
    const body = await readBody(req);
    try { return json(res, 200, billing.estimateTokenCharge(currentUser, Number(body.minutes || body.sourceMinutes || 0))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createCheckoutSession(currentUser, String(body.plan || ''))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/portal') {
    try { return json(res, 200, await billing.createPortalSession(currentUser)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  const socialConnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/connect$/);
  if (method === 'POST' && socialConnect) {
    try { return json(res, 200, { url: social.oauthStartUrl(socialConnect[1], currentUser?.id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialDisconnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/disconnect$/);
  if (method === 'POST' && socialDisconnect) {
    try { social.disconnect(socialDisconnect[1], currentUser); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialTest = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/test$/);
  if (method === 'POST' && socialTest) {
    const body = await readBody(req);
    try { return json(res, 200, { ok: true, result: await social.testConnection(socialTest[1], String(body.accountId || ''), currentUser), social: social.connectionStatus(currentUser) }); }
    catch (error) { return json(res, 400, { error: error.message, social: social.connectionStatus(currentUser) }); }
  }
  if (method === 'POST' && pathname === '/api/publishing-settings') {
    const body = await readBody(req);
    try {
      const current = publishingSettings(currentUser);
      const next = {
        enabled: Boolean(body.enabled),
        youtube: { ...current.youtube, ...(body.youtube || {}), enabled: Boolean(body.youtube?.enabled) },
        instagram: { ...current.instagram, ...(body.instagram || {}), enabled: Boolean(body.instagram?.enabled), shareToFeed: body.instagram?.shareToFeed !== false },
        facebook: { ...current.facebook, ...(body.facebook || {}), enabled: Boolean(body.facebook?.enabled) },
        tiktok: {
          ...current.tiktok, ...(body.tiktok || {}), enabled: Boolean(body.tiktok?.enabled),
          allowComments: body.tiktok?.allowComments !== false,
          allowDuet: Boolean(body.tiktok?.allowDuet), allowStitch: Boolean(body.tiktok?.allowStitch),
        },
      };
      social.validatePublishingSettings(next, currentUser);
      if (next.facebook.enabled && clipSettings(currentUser).clipMaxSeconds > 60) {
        throw new Error('Facebook Reels currently requires clips of 60 seconds or less. Set Maximum seconds to 60 before enabling Facebook.');
      }
      setPublishingSettings(currentUser, next);
      log(`Automatic publishing ${next.enabled ? 'enabled' : 'paused'} for ${['youtube','instagram','facebook','tiktok'].filter(provider => next[provider].enabled).join(', ') || 'no destinations'}.`, 'info', currentUser.id);
      agent.tick().catch(() => {});
      return json(res, 200, { ok: true, settings: publishingSettings(currentUser), social: social.connectionStatus(currentUser) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/source-info') {
    const body = await readBody(req);
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    const sources = [];
    for (const source of urls.slice(0, 8)) {
      try { sources.push(await agent.sourceInfo(source)); }
      catch (error) { sources.push({ url: source, title: source, durationSec: null, thumbnail: '', error: error.message }); }
    }
    const durations = sources.map(item => Number(item.durationSec)).filter(value => Number.isFinite(value) && value > 0);
    return json(res, 200, {
      ok: true,
      sources,
      known: durations.length === sources.length,
      totalDurationSec: durations.reduce((sum, value) => sum + value, 0),
    });
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req); const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    const sourceStartSeconds = Math.max(0, Math.round(Number(body.sourceStartSeconds || 0)));
    const sourceEndRaw = Number(body.sourceEndSeconds);
    const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
    if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) return json(res, 400, { error: 'Choose at least 30 seconds of source video.' });
    const sourceRange = { startSec: sourceStartSeconds, endSec: sourceEndSeconds };
    const sourceMeta = Array.isArray(body.sourceMeta) ? body.sourceMeta : [];
    const results = [];
    for (const source of urls) {
      try { results.push({ url: source, ok: true, projectId: await agent.submitVideo(source, body.title || '', currentUser.id, { sourceRange, sourceMeta }) }); }
      catch (error) { results.push({ url: source, error: error.message }); }
    }
    return json(res, 200, { results, sourceRange });
  }

  const projectRetry = pathname.match(/^\/api\/projects\/([^/]+)\/retry$/);
  if (method === 'POST' && projectRetry) {
    try { const id = decodeURIComponent(projectRetry[1]); assertCanAccessProject(currentUser, id); return json(res, 200, { ok: true, project: agent.engine.retryProject(id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMore = pathname.match(/^\/api\/projects\/([^/]+)\/more-clips$/);
  if (method === 'POST' && projectMore) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(projectMore[1]); assertCanAccessProject(currentUser, id);
      const job = agent.engine.queueMoreClips(id, Number(body.count || 8));
      return json(res, 202, { ok: true, job });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === 'DELETE' && projectMatch) {
    try { const id = decodeURIComponent(projectMatch[1]); assertCanAccessProject(currentUser, id); agent.engine.deleteProject(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/templates') return json(res, 200, { templates: templates.listTemplates(currentUser), selectedTemplate: templates.selectedTemplate(currentUser), draft: templates.defaultTemplateDraft() });
  if (method === 'POST' && pathname === '/api/templates') {
    const body = await readBody(req);
    try {
      const template = templates.createTemplate(currentUser, body.template || body);
      const selected = body.select !== false;
      if (selected) templates.setSelectedTemplate(currentUser, template.id);
      const propagation = selected ? queueTemplateForEveryUnpostedClip(template, currentUser, 'creating and selecting it') : { queued: 0, skipped: 0, errors: [] };
      log(`Created template "${template.name}". It is ready for automated renders.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const duplicateTemplate = pathname.match(/^\/api\/templates\/([^/]+)\/duplicate$/);
  if (method === 'POST' && duplicateTemplate) {
    const body = await readBody(req);
    try {
      const template = templates.duplicateTemplate(currentUser, decodeURIComponent(duplicateTemplate[1]), body.name);
      templates.setSelectedTemplate(currentUser, template.id);
      return json(res, 200, { ok: true, template });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (method === 'PUT' && templateMatch) {
    const body = await readBody(req);
    try {
      const template = templates.updateTemplate(currentUser, decodeURIComponent(templateMatch[1]), body.template || body);
      const selected = templates.selectedTemplate(currentUser);
      const propagation = selected?.id === template.id
        ? queueTemplateForEveryUnpostedClip(template, currentUser, 'saving the active template')
        : { queued: 0, skipped: 0, errors: [] };
      log(`Saved template "${template.name}" version ${template.version}. New renders use it automatically.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'DELETE' && templateMatch) {
    try { templates.deleteTemplate(currentUser, decodeURIComponent(templateMatch[1])); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/templates/apply-all') {
    const body = await readBody(req);
    const template = templates.templateById(String(body.templateId || ''), currentUser) || templates.selectedTemplate(currentUser);
    if (!template?.id) return json(res, 400, { error: 'Choose a valid saved template.' });
    let queued = 0; let skipped = 0; const errors = [];
    for (const clip of ownedBy(state.clips, currentUser.id)) {
      if (clip.variantOf) { skipped += 1; continue; }
      try {
        agent.engine.queueClipRerender(clip.id, template.id, { asVariant: clip.status === 'posted' });
        queued += 1;
      } catch (error) {
        skipped += 1; errors.push({ clipId: clip.id, error: error.message });
      }
    }
    log(`Applied template "${template.name}" to ${queued} existing clips; ${skipped} skipped.`, 'info', currentUser.id);
    return json(res, 202, { ok: true, queued, skipped, errors: errors.slice(0, 20), template });
  }

  if (method === 'POST' && pathname === '/api/template') {
    const body = await readBody(req);
    try {
      const template = templates.setSelectedTemplate(currentUser, String(body.id || ''));
      const propagation = queueTemplateForEveryUnpostedClip(template, currentUser, 'selecting it as the default');
      log(`Automation template set to "${template.name}". Every new and unposted clip is locked to this saved version.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/clip-settings') {
    const body = await readBody(req); const count = Math.round(Number(body.clipsPerVideo));
    const minimum = Math.round(Number(body.clipMinSeconds)); const maximum = Math.round(Number(body.clipMaxSeconds));
    if (!Number.isFinite(count) || count < 1 || count > 30) return json(res, 400, { error: 'Clips per video must be between 1 and 30.' });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 3 || maximum > 180 || minimum >= maximum) return json(res, 400, { error: 'Choose a valid clip range between 3 and 180 seconds.' });
    setClipSettings(currentUser, { clipsPerVideo: count, clipMinSeconds: minimum, clipMaxSeconds: maximum });
    return json(res, 200, { ok: true, clipSettings: clipSettings(currentUser) });
  }
  if (method === 'POST' && pathname === '/api/automation-settings') {
    const body = await readBody(req);
    const clean = {
      enabled: Boolean(body.enabled), minimumScore: Math.round(Number(body.minimumScore)), minimumQuality: Math.round(Number(body.minimumQuality)),
      maxPerProject: Math.round(Number(body.maxPerProject)), skipReviewRequired: body.skipReviewRequired !== false,
    };
    if (!Number.isFinite(clean.minimumScore) || clean.minimumScore < 1 || clean.minimumScore > 100) return json(res, 400, { error: 'Minimum score must be 1–100.' });
    if (!Number.isFinite(clean.minimumQuality) || clean.minimumQuality < 1 || clean.minimumQuality > 100) return json(res, 400, { error: 'Minimum quality must be 1–100.' });
    if (!Number.isFinite(clean.maxPerProject) || clean.maxPerProject < 1 || clean.maxPerProject > 20) return json(res, 400, { error: 'Automatic clips per source must be 1–20.' });
    setAutomationSettings(currentUser, clean); log(`Automation ${clean.enabled ? 'enabled' : 'paused'}: score ${clean.minimumScore}+, quality ${clean.minimumQuality}+, up to ${clean.maxPerProject} per source.`, 'info', currentUser.id);
    agent.tick().catch(() => {});
    return json(res, 200, { ok: true, settings: automationSettings(currentUser) });
  }

  if (method === 'GET' && pathname === '/api/music') return json(res, 200, { tracks: audio.listNasheeds(currentUser), settings: musicSettings(currentUser) });
  if (method === 'POST' && pathname === '/api/music') {
    const body = await readBody(req, 60 * 1024 * 1024);
    try { const track = await audio.saveNasheed(currentUser, body.name, body.data, body.mimeType); log(`Added "${track.name}". The renderer can rotate it across clips.`, 'info', currentUser.id); return json(res, 200, { ok: true, track }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/music-settings') {
    const body = await readBody(req); const volumePercent = Math.round(Number(body.volumePercent));
    if (!Number.isFinite(volumePercent) || volumePercent < 1 || volumePercent > 50) return json(res, 400, { error: 'Background music volume must be between 1% and 50%.' });
    setMusicSettings(currentUser, { volumePercent, required: true, shuffle: true }); return json(res, 200, { ok: true, settings: musicSettings(currentUser) });
  }
  const musicAudio = pathname.match(/^\/api\/music\/([^/]+)\/audio$/);
  if (method === 'GET' && musicAudio) {
    const found = audio.nasheedFilePath(currentUser, decodeURIComponent(musicAudio[1])); if (!found) return json(res, 404, { error: 'Track not found.' });
    const extension = path.extname(found.file).toLowerCase(); const contentType = extension === '.wav' ? 'audio/wav' : extension === '.ogg' ? 'audio/ogg' : extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    return streamFile(req, res, found.file, { contentType });
  }
  const musicDelete = pathname.match(/^\/api\/music\/([^/]+)$/);
  if (method === 'DELETE' && musicDelete) return audio.deleteNasheed(currentUser, decodeURIComponent(musicDelete[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Track not found.' });

  // The downloader cookies are a deployment-wide credential belonging to the
  // operator, not a per-account setting. Any signed-in customer could read,
  // replace or delete them before this check existed.
  if (pathname === '/api/admin/youtube-cookies' || pathname === '/api/diagnostics') {
    try { requireOperator(currentUser); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/admin/youtube-cookies') {
    return json(res, 200, { connected: fs.existsSync(youtubeCookiesFile) });
  }
  if (method === 'POST' && pathname === '/api/admin/youtube-cookies') {
    const body = await readBody(req, 5 * 1024 * 1024);
    const contents = String(body.contents || '');
    const headerValid = contents.includes('# Netscape HTTP Cookie File') || contents.includes('# HTTP Cookie File');
    if (!headerValid) return json(res, 400, { error: 'Upload a valid Netscape-format cookies.txt file.' });
    if (!/(^|\n)(?:#HttpOnly_)?\.?youtube\.com\t/im.test(contents) && !contents.includes('.youtube.com')) {
      return json(res, 400, { error: 'The file does not contain YouTube cookies.' });
    }
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(youtubeCookiesFile, contents, { encoding: 'utf8', mode: 0o600 });
    log('YouTube downloader cookies were updated through the admin panel.');
    return json(res, 200, { ok: true, connected: true });
  }
  if (method === 'DELETE' && pathname === '/api/admin/youtube-cookies') {
    try { fs.unlinkSync(youtubeCookiesFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    log('YouTube downloader cookies were removed.');
    return json(res, 200, { ok: true, connected: false });
  }

  if (method === 'GET' && pathname === '/api/diagnostics') {
    const [ffmpeg, worker] = await Promise.all([checkFfmpeg(), runDoctor()]);
    return json(res, 200, { ok: ffmpeg.ok && worker.ok, ffmpeg, worker, readiness: agent.engine.readiness(currentUser), python: config.pythonBin, model: config.aiModel, note: 'The first real transcription downloads the selected Whisper model once.' });
  }

  if (method === 'POST' && pathname === '/api/clips/schedule-selected') {
    const body = await readBody(req);
    try {
      for (const id of (Array.isArray(body.ids) ? body.ids : [])) assertCanAccessClip(currentUser, String(id));
      const summary = agent.scheduleSelected(body.ids);
      return json(res, 200, { ok: summary.failed === 0, ...summary });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  const sourcePreview = pathname.match(/^\/api\/clips\/([^/]+)\/source-preview$/);
  if (method === 'GET' && sourcePreview) {
    let clip; try { clip = assertCanAccessClip(currentUser, decodeURIComponent(sourcePreview[1])); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const project = clip ? state.projects.find(item => item.id === clip.projectId) : null;
    if (!clip || !project?.sourceFile || !fs.existsSync(project.sourceFile)) return json(res, 404, { error: 'Original source video is unavailable.' });
    return streamFile(req, res, project.sourceFile, { contentType: 'video/mp4' });
  }

  const clipVideo = pathname.match(/^\/api\/clips\/([^/]+)\/(video|download|thumb)$/);
  if (method === 'GET' && clipVideo) {
    const id = decodeURIComponent(clipVideo[1]); const kind = clipVideo[2];
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const file = agent.engine.clipFilePath(id, kind === 'thumb' ? 'thumb' : 'video'); if (!file) return json(res, 404, { error: 'Rendered file not found.' });
    if (kind === 'thumb') return streamFile(req, res, file, { contentType: 'image/jpeg' });
    const filename = `${(clip?.title || 'deenclipped').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'deenclipped'}.mp4`;
    return streamFile(req, res, file, kind === 'download' ? { downloadName: filename } : {});
  }

  const rerenderClip = pathname.match(/^\/api\/clips\/([^/]+)\/rerender$/);
  if (method === 'POST' && rerenderClip) {
    const body = await readBody(req);
    try { const id = decodeURIComponent(rerenderClip[1]); assertCanAccessClip(currentUser, id); return json(res, 202, { ok: true, job: agent.engine.queueClipRerender(id, String(body.templateId || ''), { asVariant: Boolean(body.asVariant) }) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPublish = pathname.match(/^\/api\/clips\/([^/]+)\/publish$/);
  if (method === 'POST' && clipPublish) {
    try { const id = decodeURIComponent(clipPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(await agent.publishNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipRetryPublish = pathname.match(/^\/api\/clips\/([^/]+)\/retry-publish$/);
  if (method === 'POST' && clipRetryPublish) {
    const body = await readBody(req);
    try { const id = decodeURIComponent(clipRetryPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.retryPublishing(id, String(body.provider || ''))) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipReady = pathname.match(/^\/api\/clips\/([^/]+)\/ready$/);
  if (method === 'POST' && clipReady) {
    try { const id = decodeURIComponent(clipReady[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.readyNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPosted = pathname.match(/^\/api\/clips\/([^/]+)\/posted$/);
  if (method === 'POST' && clipPosted) {
    try { const id = decodeURIComponent(clipPosted[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.markPosted(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  // Real speech timing for one clip.
  //
  // The editor requests this to place captions on actual spoken words. When
  // it was missing the request 404'd, the editor fell back to
  // approximateWords(), and captions were spread evenly across the whole
  // clip at a fixed cadence — appearing during silence and drifting out of
  // sync with speech. The worker already stores exact word-level timings
  // from Faster-Whisper in the project transcript, in absolute source time;
  // this converts them to clip-relative time for the clip in question.
  const clipCaptions = pathname.match(/^\/api\/clips\/([^/]+)\/captions$/);
  if (method === 'GET' && clipCaptions) {
    const id = decodeURIComponent(clipCaptions[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }

    const project = state.projects.find(item => item.id === clip.projectId);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    let words = [];
    let exact = false;
    if (project?.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        words = wordsForClip(segments, clipStart, clipEnd);
        exact = words.length > 0;
      } catch {
        words = [];
      }
    }

    return json(res, 200, {
      words,
      exact,
      synced: exact,
      edited: false,
      transcript: clip.transcript || '',
      durationSec: duration,
      silence: silenceSpans(words, duration),
    });
  }

  // Re-derive caption timing from the original Whisper transcript.
  // Backs the editor's "Auto-sync" button, which 404'd before this existed.
  const clipResync = pathname.match(/^\/api\/clips\/([^/]+)\/captions\/resync$/);
  if (method === 'POST' && clipResync) {
    const id = decodeURIComponent(clipResync[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if (!project?.transcriptFile || !fs.existsSync(project.transcriptFile)) {
      return json(res, 400, { error: 'No transcript is stored for this lecture, so speech timing cannot be recovered.' });
    }
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    try {
      const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
      const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
      const words = wordsForClip(segments, clipStart, clipEnd);
      if (!words.length) return json(res, 400, { error: 'No speech was found inside this clip.' });
      return json(res, 200, {
        words, exact: true, synced: true,
        transcript: words.map(w => w.word).join(' '),
        silence: silenceSpans(words, Math.max(0, clipEnd - clipStart)),
      });
    } catch (error) {
      return json(res, 400, { error: `The transcript could not be read: ${error.message}` });
    }
  }

  // Active-speaker framing analysis. The editor calls this to preview where
  // the AI crop will sit over time; it 404'd before this existed, which is
  // why smart framing reported "Not found".
  const clipFraming = pathname.match(/^\/api\/clips\/([^/]+)\/framing-preview$/);
  if (method === 'POST' && clipFraming) {
    const id = decodeURIComponent(clipFraming[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if (!project?.sourceFile || !fs.existsSync(project.sourceFile)) {
      return json(res, 200, { plan: { available: false, reason: 'The original video is no longer stored, so framing cannot be analysed.' } });
    }

    const body = await readBody(req);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    // Give the tracker the real speech spans so it holds position during
    // silence instead of chasing detector noise when nobody is talking.
    let speechSpans = [];
    if (project.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        speechSpans = wordsForClip(segments, clipStart, clipEnd).map(w => [w.start, w.end]);
      } catch { speechSpans = []; }
    }

    const requestFile = path.join(config.dataDir, `framing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(requestFile, JSON.stringify({
      source: project.sourceFile, ffprobe: config.ffprobePath || 'ffprobe',
      start: clipStart, duration,
      width: Number(body.width) || 1080, height: Number(body.height) || 1920,
      bias: String(body.bias || 'auto'), padding: Number(body.padding ?? 0.18),
      zoom: Number(body.zoom ?? 1), smoothing: Number(body.smoothing ?? 0.82),
      speechSpans,
    }));

    try {
      const plan = await new Promise((resolve) => {
        const child = spawn(config.pythonBin, [config.workerScript, '--framing', requestFile], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ available: false, reason: 'Framing analysis took too long and was stopped.' }); }, 120000);
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('error', e => { clearTimeout(timer); resolve({ available: false, reason: `The analyser could not start: ${e.message}` }); });
        child.on('close', () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(out).plan); }
          catch { resolve({ available: false, reason: (err.trim().split('\n').pop() || 'The analyser returned no result.').slice(0, 300) }); }
        });
      });
      return json(res, 200, { plan });
    } finally {
      try { fs.unlinkSync(requestFile); } catch {}
    }
  }

  const clipMatch = pathname.match(/^\/api\/clips\/([^/]+)$/);
  if (clipMatch && method === 'PATCH') {
    const id = decodeURIComponent(clipMatch[1]); const body = await readBody(req);
    try {
      assertCanAccessClip(currentUser, id);
      agent.updateClip(id, body); let clip;
      if (body.status === 'approved') clip = agent.approveClip(id); else if (body.status === 'waiting') clip = agent.pullBack(id); else clip = state.clips.find(item => item.id === id);
      return json(res, 200, { ok: true, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (clipMatch && method === 'DELETE') {
    try { const id = decodeURIComponent(clipMatch[1]); assertCanAccessClip(currentUser, id); agent.deleteClip(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'Not found.' });
}

export const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { error: 'Bad request.' }); }
  route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected server error.' }); });
});
server.listen(config.port, () => { console.log(`DeenClipped self-hosted engine listening on http://localhost:${config.port}`); agent.start(); });
