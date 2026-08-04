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

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'deenclipped.online').split(',')[0].trim() || 'deenclipped.online';
  return (config.publicBaseUrl || `${proto}://${host}`).replace(/\/+$/, '');
}
function marketingAuthLinks(req) {
  const currentUser = auth.currentUser(req);
  if (currentUser && auth.enabled()) {
    return '<a class="navButton dashboard" href="/app">My dashboard</a>';
  }
  return '<a class="navLink" href="/login?returnTo=/app">Sign in</a><a class="navButton" href="/login?returnTo=/app">Get started</a>';
}

function marketingLayout(req, { title = 'DeenClipped', description = 'DeenClipped helps users create, edit, and publish short-form clips from long videos.', body = '', canonicalPath = '/', active = '' }) {
  const base = publicBase(req);
  const canonical = `${base}${canonicalPath === '/' ? '' : canonicalPath}`;
  const year = new Date().getFullYear();
  const nav = marketingAuthLinks(req);
  const navClass = name => `navLink${active === name ? ' active' : ''}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <style>
    :root{color-scheme:dark;--bg:#050505;--bg2:#0a0a0b;--panel:#121214;--panel2:#1a1714;--soft:#242120;--text:#fffaf2;--muted:#aaa6a2;--faint:#716b66;--line:rgba(255,255,255,.12);--line2:rgba(227,189,117,.22);--gold:#e3bd75;--gold2:#ffd88f;--green:#38e28c;--cyan:#35d9ff;--purple:#8a65ff;--red:#ff5c5c;--shadow:0 30px 120px rgba(0,0,0,.62);--radius:30px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#040404;color:var(--text);line-height:1.5;overflow-x:hidden}body:before{content:"";position:fixed;inset:-20%;z-index:-2;background:radial-gradient(circle at 16% 2%,rgba(227,189,117,.18),transparent 28%),radial-gradient(circle at 86% 8%,rgba(53,217,255,.10),transparent 25%),radial-gradient(circle at 52% 78%,rgba(138,101,255,.09),transparent 28%),linear-gradient(180deg,#020202,#090909 44%,#050505)}body:after{content:"";position:fixed;inset:0;z-index:-1;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.026) 1px,transparent 1px);background-size:82px 82px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.75),transparent 55%);pointer-events:none}a{color:inherit}.site{width:min(1220px,calc(100% - 44px));margin:0 auto}.navWrap{position:sticky;top:0;z-index:20;background:linear-gradient(180deg,rgba(4,4,4,.92),rgba(4,4,4,.62));backdrop-filter:blur(22px);border-bottom:1px solid rgba(255,255,255,.075)}.nav{height:82px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:900;font-size:20px;letter-spacing:-.04em}.mark{width:38px;height:38px;border-radius:14px;background:linear-gradient(145deg,var(--gold2),var(--gold));box-shadow:0 18px 70px rgba(227,189,117,.22);position:relative}.mark:before{content:"";position:absolute;inset:9px;border-radius:9px;background:#050505}.mark:after{content:"";position:absolute;inset:15px;border-radius:4px;background:var(--gold2);opacity:.95}.navlinks{display:flex;align-items:center;gap:7px}.navLink,.navButton{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;border-radius:999px;text-decoration:none;font-size:14px;color:var(--muted);border:1px solid transparent;transition:.2s ease}.navLink:hover,.navLink.active{color:#fff;background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.08)}.navButton{padding:0 18px;font-weight:800;color:#090705;background:linear-gradient(135deg,var(--gold2),var(--gold));box-shadow:0 14px 40px rgba(227,189,117,.16)}.navButton.dashboard{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.15);box-shadow:none}.mobileOnly{display:none}.hero{position:relative;padding:82px 0 72px;text-align:center}.eyebrow{display:inline-flex;align-items:center;gap:9px;border:1px solid rgba(227,189,117,.28);background:rgba(227,189,117,.08);color:var(--gold2);border-radius:999px;padding:9px 14px;font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 28px var(--green)}h1{font-size:clamp(46px,9vw,100px);line-height:.9;letter-spacing:-.085em;margin:22px 0 12px}.heroTitle{font-size:clamp(36px,6.2vw,84px);line-height:.95;letter-spacing:-.078em;margin:0 auto 18px;max-width:1040px}.goldText{background:linear-gradient(135deg,#fff,var(--gold2) 62%,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}.lead{font-size:clamp(17px,2vw,22px);color:var(--muted);max-width:830px;margin:0 auto 30px}.purposeLine{max-width:850px;margin:0 auto 30px;color:#ddd7d0;font-size:16px}.heroCtas{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin:26px 0 30px}.pillInput{width:min(560px,100%);height:64px;border-radius:999px;padding:8px 8px 8px 22px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 24px 80px rgba(0,0,0,.35)}.pillInput span{color:#bbb5af;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 22px;border-radius:999px;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.055);color:#fff;text-decoration:none;font-weight:800;transition:.22s ease}.btn:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.09)}.btn.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#0b0905;border-color:rgba(227,189,117,.62);box-shadow:0 18px 55px rgba(227,189,117,.18)}.btn.green{background:linear-gradient(135deg,#72ffad,var(--green));color:#021207;border:0}.miniActions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:13px}.miniActions span{border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);border-radius:999px;padding:9px 12px}.heroMock{margin:58px auto 0;position:relative;min-height:560px}.stage{position:relative;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(255,255,255,.09),rgba(255,255,255,.035));border-radius:42px;box-shadow:var(--shadow);overflow:hidden;min-height:520px;padding:34px;text-align:left}.stage:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 20% 5%,rgba(227,189,117,.16),transparent 36%),radial-gradient(circle at 80% 28%,rgba(53,217,255,.13),transparent 32%);pointer-events:none}.browserBar{position:relative;display:flex;gap:7px;margin-bottom:24px}.browserBar i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.25)}.workflowHero{position:relative;display:grid;grid-template-columns:1fr 1.06fr 1fr;gap:22px;align-items:center}.sourceCard,.clipStack,.publishCard,.editorDemo,.frameDemo,.scheduleDemo,.card{position:relative;border-radius:28px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(145deg,rgba(18,18,20,.92),rgba(10,10,12,.78));box-shadow:0 20px 80px rgba(0,0,0,.36);overflow:hidden}.sourceCard{height:260px;padding:20px}.thumbLandscape{height:130px;border-radius:20px;background:linear-gradient(135deg,#5c4530,#1a1c1f);position:relative;overflow:hidden}.thumbLandscape:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 33% 34%,#f7d7a4 0 10%,transparent 11%),radial-gradient(circle at 61% 38%,#b98c58 0 9%,transparent 10%),linear-gradient(135deg,transparent 0 58%,rgba(227,189,117,.28) 59% 100%)}.sourceMeta{display:grid;gap:10px;margin-top:17px}.skeleton{height:12px;border-radius:99px;background:rgba(255,255,255,.12)}.skeleton.w70{width:70%}.skeleton.w45{width:45%}.clipStack{height:330px;display:flex;align-items:center;justify-content:center;padding:20px}.phone{width:160px;height:285px;border-radius:30px;background:#111;border:1px solid rgba(255,255,255,.15);box-shadow:0 20px 80px rgba(0,0,0,.55);position:absolute;overflow:hidden}.phone.one{transform:translateX(-78px) rotate(-7deg);opacity:.58}.phone.two{z-index:2;transform:translateY(-10px)}.phone.three{transform:translateX(78px) rotate(7deg);opacity:.58}.phone:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#31514a,#0e1111 60%,#090909)}.phone:after{content:"MAKE IT COUNT";position:absolute;left:18px;right:18px;bottom:82px;text-align:center;color:white;font-size:21px;line-height:.95;font-weight:1000;text-shadow:0 3px 0 #000}.captionChip{position:absolute;left:24px;right:24px;bottom:46px;height:22px;border-radius:6px;background:linear-gradient(90deg,var(--gold2),#fff);z-index:3}.publishCard{height:260px;padding:22px}.publishRow{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);padding:13px 0;color:#ddd}.socialDots{display:flex;gap:8px}.socialDots i,.platforms i{width:30px;height:30px;display:grid;place-items:center;border-radius:50%;font-style:normal;font-weight:900;font-size:12px}.yt{background:#ff0033}.ig{background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)}.tt{background:#111;border:1px solid rgba(255,255,255,.2)}.fb{background:#1877f2}.li{background:#0a66c2}.x{background:#111}.arrowFlow{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:26%;pointer-events:none;color:rgba(255,255,255,.36);font-size:32px}.trusted{padding:16px 0 48px;text-align:center;color:var(--faint)}.logoRow{display:flex;justify-content:center;gap:28px;flex-wrap:wrap;margin-top:18px;color:#d8d3ce;font-weight:850;opacity:.65}.section{padding:78px 0}.sectionHead{text-align:center;max-width:850px;margin:0 auto 36px}.sectionLabel{display:inline-block;color:var(--gold2);font-size:12px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px}.section h2{font-size:clamp(34px,5vw,62px);line-height:1;letter-spacing:-.06em;margin:0 0 14px}.section p{color:var(--muted);font-size:17px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}.step,.featureCard,.priceCard,.faqItem,.policyCard,.contactCard{border:1px solid rgba(255,255,255,.11);background:linear-gradient(145deg,rgba(255,255,255,.065),rgba(255,255,255,.025));border-radius:28px;padding:24px;box-shadow:0 18px 70px rgba(0,0,0,.24)}.stepIcon,.featureIcon{width:50px;height:50px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#090705;font-weight:1000;margin-bottom:18px}.step h3,.featureCard h3,.priceCard h3{margin:0 0 8px;font-size:22px;letter-spacing:-.03em}.step p,.featureCard p,.priceCard p,.faqItem p,.policyCard p,.policyCard li,.contactCard p{margin:0;color:var(--muted)}.visualBand{border:1px solid rgba(255,255,255,.11);background:radial-gradient(circle at 20% 0,rgba(227,189,117,.18),transparent 32%),linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.025));border-radius:42px;padding:28px;box-shadow:var(--shadow);overflow:hidden}.editorDemo{min-height:360px;padding:22px;display:grid;grid-template-columns:1fr 230px;gap:22px}.transcript{border-right:1px solid rgba(255,255,255,.1);padding-right:20px;color:#dfd9d2}.transcript p{font-size:15px}.highlight{color:var(--gold2);font-weight:800}.miniTimeline{height:62px;border-radius:18px;background:linear-gradient(90deg,rgba(227,189,117,.25),rgba(138,101,255,.55));position:relative;margin-top:22px;overflow:hidden}.miniTimeline:after{content:"";position:absolute;left:28%;top:8px;bottom:8px;width:28%;border:2px solid var(--gold2);border-radius:10px;background:rgba(255,255,255,.12)}.editPhone{height:315px;border-radius:30px;background:linear-gradient(180deg,#2e413e,#070707);position:relative;box-shadow:0 20px 80px rgba(0,0,0,.4)}.editPhone:after{content:"NEXT REMINDER\A IN 30 SECONDS";white-space:pre;position:absolute;left:22px;right:22px;bottom:80px;text-align:center;font-size:23px;line-height:.95;font-weight:1000;text-shadow:0 4px 0 #000}.frameDemo{min-height:360px;padding:28px;display:flex;align-items:center;justify-content:space-around;gap:20px}.landscapeMini{width:230px;height:136px;border-radius:22px;background:linear-gradient(135deg,#71624d,#262a2d);position:relative;box-shadow:0 18px 60px rgba(0,0,0,.38)}.landscapeMini:after{content:"";position:absolute;left:91px;top:18px;width:48px;height:96px;border:3px solid var(--green);border-radius:14px}.dots{display:flex;gap:10px}.dots i{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.7)}.verticalMini{width:170px;height:300px;border-radius:30px;background:linear-gradient(180deg,#6a563a,#161616);position:relative;box-shadow:0 20px 70px rgba(0,0,0,.45)}.verticalMini:after{content:"9:16";position:absolute;right:18px;bottom:14px;color:white;font-weight:900}.workflowPanel{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:stretch}.workflowPanel .card{padding:24px;min-height:230px}.largeNumber{font-size:56px;font-weight:1000;line-height:1;color:var(--gold2);letter-spacing:-.06em}.platforms{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.pricingGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.price{font-size:36px;font-weight:1000;letter-spacing:-.05em;margin:14px 0}.price small{font-size:14px;color:var(--muted);font-weight:700}.priceCard.featured{border-color:rgba(227,189,117,.45);background:linear-gradient(145deg,rgba(227,189,117,.13),rgba(255,255,255,.035))}.priceCard ul{padding-left:18px;color:var(--muted);min-height:120px}.faqGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.faqItem h3{margin:0 0 8px}.ctaFinal{text-align:center;border:1px solid rgba(227,189,117,.22);border-radius:42px;background:radial-gradient(circle at 50% 0,rgba(227,189,117,.22),transparent 42%),linear-gradient(145deg,rgba(255,255,255,.07),rgba(255,255,255,.025));padding:52px 24px;box-shadow:var(--shadow)}.ctaFinal h2{margin-bottom:14px}.footer{border-top:1px solid rgba(255,255,255,.1);padding:34px 0 42px;color:var(--muted)}.footerGrid{display:grid;grid-template-columns:1.5fr repeat(3,1fr);gap:22px}.footer a{display:block;text-decoration:none;color:var(--muted);margin:8px 0}.footer b{color:#fff}.pageHero{padding:66px 0 24px}.pageHero h1{font-size:clamp(42px,6vw,76px);max-width:900px}.policyCard{max-width:900px;margin:0 auto 24px}.policyCard h2{font-size:24px;margin:26px 0 10px}.contactGrid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.contactCard a{color:var(--gold2)}@media(max-width:980px){.workflowHero,.grid3,.grid2,.workflowPanel,.pricingGrid,.footerGrid,.contactGrid{grid-template-columns:1fr}.heroMock{min-height:auto}.stage{min-height:auto}.arrowFlow{display:none}.navlinks{display:none}.mobileOnly{display:flex}.editorDemo{grid-template-columns:1fr}.transcript{border-right:0;border-bottom:1px solid rgba(255,255,255,.1);padding:0 0 20px}.hero{padding-top:52px}.stage{padding:22px}.workflowHero{gap:16px}.publishCard,.sourceCard{height:auto}.clipStack{min-height:310px}.faqGrid{grid-template-columns:1fr}}@media(max-width:560px){.site{width:min(100% - 28px,1220px)}.pillInput{height:auto;border-radius:28px;align-items:stretch;flex-direction:column;padding:16px}.pillInput .btn{width:100%}.heroTitle{font-size:42px}.footerGrid{gap:10px}.nav{height:72px}.brand{font-size:18px}.stage{border-radius:28px}.workflowPanel .card,.featureCard,.step,.priceCard,.faqItem{border-radius:22px}}
  </style>
</head>
<body>
  <div class="navWrap"><header class="site nav"><a class="brand" href="/"><span class="mark"></span><span>DeenClipped</span></a><nav class="navlinks"><a class="${navClass('features')}" href="/features">Features</a><a class="${navClass('pricing')}" href="/pricing">Pricing</a><a class="${navClass('contact')}" href="/contact">Contact</a>${nav}</nav><nav class="mobileOnly">${nav}</nav></header></div>
  ${body}
  <footer class="footer"><div class="site footerGrid"><div><a class="brand" href="/"><span class="mark"></span><span>DeenClipped</span></a><p>DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.</p><p>© ${year} DeenClipped. All rights reserved.</p></div><div><b>Product</b><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/app">Dashboard</a></div><div><b>Company</b><a href="/contact">Contact</a><a href="mailto:support@deenclipped.online">support@deenclipped.online</a></div><div><b>Legal</b><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div></div></footer>
</body>
</html>`;
}

function marketingHome(req) {
  return marketingLayout(req, {
    title: 'DeenClipped',
    description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.',
    canonicalPath: '/',
    active: 'home',
    body: `<main class="hero"><div class="site"><span class="eyebrow">Official DeenClipped website</span><h1>DeenClipped</h1><h2 class="heroTitle">Turn long Islamic lectures into <span class="goldText">ready-to-post short clips</span></h2><p class="lead">Paste a video link or upload a lecture. DeenClipped finds the strongest moments, adds captions, formats clips for Shorts, Reels and TikTok, then helps you publish faster.</p><p class="purposeLine"><strong>DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.</strong></p><div class="heroCtas"><div class="pillInput"><span>Paste a video link or upload a lecture</span><a class="btn primary" href="/login?returnTo=/app">Get clips</a></div><a class="btn" href="/pricing">View pricing</a></div><div class="miniActions"><span>Upload files</span><span>YouTube links</span><span>Source range control</span><span>No customer cookies</span></div><div class="heroMock"><div class="stage"><div class="browserBar"><i></i><i></i><i></i></div><div class="workflowHero"><div class="sourceCard"><div class="thumbLandscape"></div><div class="sourceMeta"><div class="skeleton w70"></div><div class="skeleton w45"></div><div class="skeleton"></div></div></div><div class="clipStack"><div class="phone one"><i class="captionChip"></i></div><div class="phone two"><i class="captionChip"></i></div><div class="phone three"><i class="captionChip"></i></div></div><div class="publishCard"><div class="publishRow"><b>Connected channels</b><span class="socialDots"><i class="yt">YT</i><i class="ig">IG</i><i class="tt">TT</i></span></div><div class="publishRow"><span>Title</span><b>Generated</b></div><div class="publishRow"><span>Schedule</span><b>Ready</b></div><div class="heroCtas" style="justify-content:flex-start;margin:24px 0 0"><a class="btn primary" href="/login?returnTo=/app">Publish clips</a></div></div><div class="arrowFlow">→ →</div></div></div></div></div></main><section class="trusted"><div class="site"><p>Built for creators, Islamic reminders, educators, podcasts and teams</p><div class="logoRow"><span>YouTube Shorts</span><span>Instagram Reels</span><span>TikTok</span><span>Facebook Reels</span><span>Scheduling</span><span>Templates</span></div></div></section><section class="site section"><div class="sectionHead"><span class="sectionLabel">How it works</span><h2>From long lecture to posted clips in one workflow</h2><p>DeenClipped keeps the process simple: import, choose range, generate, review and publish.</p></div><div class="grid3"><article class="step"><div class="stepIcon">1</div><h3>Import</h3><p>Paste a public video link or upload your own file. DeenClipped reads the title, thumbnail and duration where available.</p></article><article class="step"><div class="stepIcon">2</div><h3>Generate</h3><p>Choose the source window, template, clip length and count. Tokens are estimated from the selected source time.</p></article><article class="step"><div class="stepIcon">3</div><h3>Publish</h3><p>Review clips, edit captions and titles, then publish or schedule to your own connected channels.</p></article></div></section><section class="site section"><div class="sectionHead"><span class="sectionLabel">AI editor</span><h2>AI that edits with you, not just for you</h2><p>Inspired by premium clipper workflows: transcript review, smart reframing, captions, templates and scheduling in one place.</p></div><div class="grid2"><div class="visualBand"><div class="editorDemo"><div class="transcript"><b>Transcript-based review</b><p>Find the best reminder, remove weak parts, regenerate titles and keep <span class="highlight">the strongest moment</span> before posting.</p><p>Auto captions, hooks, hashtags and platform descriptions are generated with every clip.</p><div class="miniTimeline"></div></div><div class="editPhone"></div></div></div><div class="visualBand"><div class="frameDemo"><div class="landscapeMini"></div><div class="dots"><i></i><i></i><i></i></div><div class="verticalMini"></div></div></div></div></section><section class="site section"><div class="sectionHead"><span class="sectionLabel">Features</span><h2>Everything needed to create short-form reminders</h2></div><div class="grid3"><article class="featureCard"><div class="featureIcon">✦</div><h3>AI clip detection</h3><p>Finds the parts most likely to hold attention and become clean short clips.</p></article><article class="featureCard"><div class="featureIcon">CC</div><h3>Captions and hooks</h3><p>Auto captions, title ideas, hashtags and opening hooks for social platforms.</p></article><article class="featureCard"><div class="featureIcon">9:16</div><h3>Smart reframing</h3><p>Formats long videos into vertical layouts for Shorts, Reels and TikTok.</p></article><article class="featureCard"><div class="featureIcon">▣</div><h3>Templates</h3><p>Save styles for captions, colors and layout so every clip looks consistent.</p></article><article class="featureCard"><div class="featureIcon">✓</div><h3>Review before posting</h3><p>Approve, edit, delete, shorten or extend clips before anything goes live.</p></article><article class="featureCard"><div class="featureIcon">↗</div><h3>Social publishing</h3><p>Customers connect their own channels. Clips publish to their accounts, not a shared account.</p></article></div></section><section class="site section"><div class="visualBand"><div class="workflowPanel"><article class="card"><div class="largeNumber">01</div><h3>Auto import</h3><p>Bring in source content with upload-first reliability and YouTube-link convenience.</p></article><article class="card"><div class="largeNumber">02</div><h3>Auto editing</h3><p>Generate short clips, captions, reframes and titles while keeping manual review available.</p></article><article class="card"><div class="largeNumber">03</div><h3>Auto scheduling</h3><p>Connect platforms and plan content ahead with publishing workflows built into the app.</p><div class="platforms"><i class="yt">YT</i><i class="ig">IG</i><i class="tt">TT</i><i class="fb">FB</i><i class="x">X</i></div></article></div></div></section><section class="site section"><div class="sectionHead"><span class="sectionLabel">Pricing</span><h2>Start free, upgrade when you need more clips</h2><p>Tokens are based on selected source video minutes. Template rerenders stay free.</p></div><div class="pricingGrid"><article class="priceCard"><h3>Free</h3><div class="price">40 <small>tokens</small></div><p>Try the workflow and generate your first clips.</p><ul><li>Basic trial tokens</li><li>Upload or link import</li><li>Clip review</li></ul><a class="btn" href="/login?returnTo=/app">Start free</a></article><article class="priceCard"><h3>Weekly</h3><div class="price">120 <small>/ week</small></div><p>Good for testing weekly content.</p><ul><li>Weekly tokens</li><li>Templates</li><li>Publishing tools</li></ul><a class="btn" href="/pricing">View plan</a></article><article class="priceCard featured"><h3>Monthly</h3><div class="price">650 <small>/ month</small></div><p>Best for creators posting consistently.</p><ul><li>More source minutes</li><li>Clip review workflow</li><li>Scheduling</li></ul><a class="btn primary" href="/pricing">View plan</a></article><article class="priceCard"><h3>Yearly</h3><div class="price">9000 <small>/ year</small></div><p>For serious publishing workflows.</p><ul><li>Highest token value</li><li>Long-term content planning</li><li>Best value</li></ul><a class="btn" href="/pricing">View plan</a></article></div></section><section class="site section"><div class="sectionHead"><span class="sectionLabel">FAQ</span><h2>Got questions?</h2></div><div class="faqGrid"><article class="faqItem"><h3>Can I upload videos?</h3><p>Yes. Uploading your own video file is the most reliable way to process content.</p></article><article class="faqItem"><h3>Can I paste YouTube links?</h3><p>Yes. DeenClipped can try public YouTube links, and falls back to upload if YouTube blocks import.</p></article><article class="faqItem"><h3>Do customers need cookies?</h3><p>No. Customers should never upload cookies. Import handling stays on the backend, with upload fallback.</p></article><article class="faqItem"><h3>Are clips posted to my own account?</h3><p>Yes. Each user connects their own YouTube and social channels for publishing.</p></article></div></section><section class="site section"><div class="ctaFinal"><span class="sectionLabel">Start creating</span><h2>Turn your next long video into clips</h2><p>Open DeenClipped, import your lecture, choose a source range and generate clips ready to review.</p><div class="heroCtas"><a class="btn primary" href="/login?returnTo=/app">Get started</a><a class="btn" href="/features">See features</a></div></div></section>`
  });
}

function featuresPage(req) {
  return marketingLayout(req, {
    title: 'Features — DeenClipped',
    description: 'Explore DeenClipped features for AI clipping, captions, smart reframing, templates, review and social publishing.',
    canonicalPath: '/features',
    active: 'features',
    body: `<main class="site pageHero"><span class="eyebrow">Features</span><h1>DeenClipped features</h1><p class="lead" style="margin-left:0">Create short-form clips from long videos with AI-assisted detection, captions, reframing, templates and publishing workflows.</p></main><section class="site section"><div class="grid3"><article class="featureCard"><div class="featureIcon">✦</div><h3>AI clipping</h3><p>Detect strong moments from lectures, podcasts and long-form videos.</p></article><article class="featureCard"><div class="featureIcon">⌁</div><h3>Source range control</h3><p>Select the exact beginning and end of the source video before rendering so token usage is clear.</p></article><article class="featureCard"><div class="featureIcon">CC</div><h3>Captions</h3><p>Generate readable captions and stylised templates for social videos.</p></article><article class="featureCard"><div class="featureIcon">9:16</div><h3>Smart reframing</h3><p>Turn landscape content into vertical formats for Shorts, Reels and TikTok.</p></article><article class="featureCard"><div class="featureIcon">✓</div><h3>Clip review</h3><p>Approve, delete, edit titles, regenerate captions and adjust style before posting.</p></article><article class="featureCard"><div class="featureIcon">↗</div><h3>Publishing</h3><p>Connect social accounts per user so clips publish to the correct channel.</p></article></div></section><section class="site section"><div class="visualBand"><div class="editorDemo"><div class="transcript"><h2>Review like a real editor</h2><p>DeenClipped keeps AI speed while giving you control. Review transcripts, pick winners, adjust templates and publish only what is ready.</p><div class="miniTimeline"></div></div><div class="editPhone"></div></div></div></section>`
  });
}

function pricingPage(req) {
  return marketingLayout(req, {
    title: 'Pricing — DeenClipped',
    description: 'DeenClipped pricing plans and token usage for clipping long videos into short-form content.',
    canonicalPath: '/pricing',
    active: 'pricing',
    body: `<main class="site pageHero"><span class="eyebrow">Pricing</span><h1>Simple token plans</h1><p class="lead" style="margin-left:0">DeenClipped uses tokens based on selected source video minutes. Full video is selected by default, and shortening the source range reduces estimated usage.</p></main><section class="site section"><div class="pricingGrid"><article class="priceCard"><h3>Free</h3><div class="price">40 <small>tokens</small></div><p>Start testing DeenClipped.</p><ul><li>Basic free tokens</li><li>Generate first clips</li><li>Review workflow</li></ul><a class="btn" href="/login?returnTo=/app">Start free</a></article><article class="priceCard"><h3>Weekly</h3><div class="price">120 <small>/ week</small></div><p>For light weekly use.</p><ul><li>Weekly token allowance</li><li>Templates</li><li>Publishing tools</li></ul><a class="btn" href="/login?returnTo=/app">Choose weekly</a></article><article class="priceCard featured"><h3>Monthly</h3><div class="price">650 <small>/ month</small></div><p>Best for consistent creators.</p><ul><li>Monthly allowance</li><li>Clip review</li><li>Scheduling</li></ul><a class="btn primary" href="/login?returnTo=/app">Choose monthly</a></article><article class="priceCard"><h3>Yearly</h3><div class="price">9000 <small>/ year</small></div><p>Best value for serious workflows.</p><ul><li>Yearly allowance</li><li>Long-term planning</li><li>Best token value</li></ul><a class="btn" href="/login?returnTo=/app">Choose yearly</a></article></div><div class="policyCard" style="margin-top:22px"><h2>How tokens work</h2><p>One token is currently estimated per selected source video minute. DeenClipped estimates usage before rendering and charges after the worker confirms the selected source duration. Template rerenders stay free.</p></div></section>`
  });
}

function contactPage(req) {
  return marketingLayout(req, {
    title: 'Contact — DeenClipped',
    description: 'Contact DeenClipped support.',
    canonicalPath: '/contact',
    active: 'contact',
    body: `<main class="site pageHero"><span class="eyebrow">Contact</span><h1>Contact DeenClipped</h1><p class="lead" style="margin-left:0">Need help with your account, publishing, billing or verification? Reach out below.</p></main><section class="site section"><div class="contactGrid"><article class="contactCard"><h2>Email support</h2><p>Send support requests to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article><article class="contactCard"><h2>App access</h2><p>Already have an account? Open your dashboard and manage projects, platforms, billing and settings.</p><p style="margin-top:18px"><a class="btn primary" href="/app">Open dashboard</a></p></article></div></section>`
  });
}

function privacyPage(req) {
  return marketingLayout(req, {
    title: 'Privacy Policy — DeenClipped',
    description: 'Privacy Policy for DeenClipped.',
    canonicalPath: '/privacy',
    body: `<main class="site pageHero"><span class="eyebrow">Legal</span><h1>Privacy Policy</h1><p class="lead" style="margin-left:0">This Privacy Policy explains how DeenClipped handles information used to create, edit and publish short-form clips from long videos.</p></main><section class="site section"><article class="policyCard"><p>Last updated: 4 August 2026</p><h2>About DeenClipped</h2><p>DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.</p><h2>Information we collect</h2><p>We may collect account information such as your name, email address and profile picture when you sign in. We may also store videos, links, generated clips, captions, templates, publishing settings, billing status and connected social account information needed to provide the service.</p><h2>Connected accounts</h2><p>When you connect a platform such as YouTube, DeenClipped stores the connection for your own account so clips can be published to the channel you choose. Tokens are used only to provide requested publishing features and are not sold.</p><h2>How we use information</h2><p>We use information to operate DeenClipped, process videos, generate clips, show projects in your library, provide billing/token features, connect publishing platforms, prevent abuse and improve reliability.</p><h2>Sharing</h2><p>We do not sell personal information. We may share information with service providers used to operate the app, such as hosting, payment processing, authentication and social publishing APIs, only as needed to provide the service.</p><h2>Data security</h2><p>We use reasonable technical measures to protect user data. No online service can guarantee absolute security.</p><h2>Your choices</h2><p>You can disconnect social accounts, delete generated content where available, or contact support about account data.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section>`
  });
}

function termsPage(req) {
  return marketingLayout(req, {
    title: 'Terms of Service — DeenClipped',
    description: 'Terms of Service for DeenClipped.',
    canonicalPath: '/terms',
    body: `<main class="site pageHero"><span class="eyebrow">Legal</span><h1>Terms of Service</h1><p class="lead" style="margin-left:0">These terms govern use of DeenClipped, a web application for creating, editing and publishing short-form clips from long videos.</p></main><section class="site section"><article class="policyCard"><p>Last updated: 4 August 2026</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions for the content you process.</p><h2>Connected platforms</h2><p>When you connect YouTube or another platform, DeenClipped publishes only using the connected account permissions you grant. You remain responsible for complying with each platform's rules.</p><h2>Billing and tokens</h2><p>Some features may require tokens, subscriptions or paid plans. Token usage may be based on selected source video time and other plan rules shown in the app.</p><h2>Service availability</h2><p>DeenClipped may change, pause or remove features over time. We do not guarantee uninterrupted access.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section>`
  });
}

function serveAppShell(req, res, url, currentUser) {
  if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  let html = fs.readFileSync(page, 'utf8');
  if (!html.includes('/activity-fix.js')) html = html.replace('</body>', '<script src="/activity-fix.js"></script>\n</body>');
  const body = Buffer.from(html);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  return res.end(body);
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
    return redirectWithCookies(res, '/?signedOut=1', auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));
  if (method === 'GET' && pathname === '/pricing') return html(res, 200, pricingPage(req));
  if (method === 'GET' && pathname === '/contact') return html(res, 200, contactPage(req));
  if (method === 'GET' && pathname === '/privacy') return html(res, 200, privacyPage(req));
  if (method === 'GET' && pathname === '/terms') return html(res, 200, termsPage(req));
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    // Google OAuth verification must always see a public homepage here.
    // The logged-in product is served from /app so / is never hidden behind auth.
    return html(res, 200, marketingHome(req));
  }
  if (method === 'GET' && (pathname === '/app' || pathname === '/dashboard')) {
    return serveAppShell(req, res, url, currentUser);
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
