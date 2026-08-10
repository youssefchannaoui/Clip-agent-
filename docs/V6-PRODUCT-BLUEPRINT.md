# DeenClipped Studio V6

V6 is a product-system release, not a theme pass. It keeps the dark DeenClipped identity and warm gold actions, but makes every screen follow the same workflow, account state and quality language.

## Seven-step release programme

1. **Product and competitor audit** — map the real workflow, provider constraints, account entitlements and useful patterns from leading clip tools without copying their branding.
2. **Experience architecture** — one navigation system, one visual system and one authoritative account mode for free trial, expired/free browse-only, Premium trial, Premium active, empty wallet, canceling, past-due and owner/admin.
3. **Workspace rebuild** — Home, Projects, Review, Editor, Publishing, Channels, Clip Styles, Brand Kit, AI Director, Quality Center, Audio, Insights, Settings, Subscription and Admin all use the same component and status language.
4. **Creator intelligence** — explainable clip scoring, grounded titles/descriptions, multilingual captions, silence-aware timing, active-speaker framing, growth packs and quality preflight.
5. **Reliability and safety** — server-enforced entitlements, tenant isolation, protected worker callbacks, object-storage verification, bounded concurrent jobs, recovery, billing gates and explicit publishing approval.
6. **Release validation** — syntax, unit/integration suites, UI contract checks, desktop/mobile browser review, account-mode review, simultaneous-job checks and production smoke checks.
7. **Production rollout** — publish `deenclipped-v2-2`, deploy the web service, rebuild the Hetzner worker and verify live health. Provider reviews and credentials are recorded as external launch gates rather than hidden as product bugs.

## Account experiences

| Mode | Create | Edit/download | Publish | Product emphasis |
| --- | --- | --- | --- | --- |
| Free trial | Within trial time and tokens | Yes, with DeenClipped watermark | No | Guided first-project path and transparent Premium preview |
| Free expired / empty | No | Existing work remains available | No | Calm browse-only workspace with a clear next step |
| Premium trial | Yes | Clean exports and Premium tools | Yes, with connected providers | Full studio with trial continuity |
| Premium active | Yes | Full creator workflow | Yes | Quality, growth and throughput—not repeated upsells |
| Premium empty | Paused until top-up/renewal | Existing work remains available | Paused | Add-token path without losing the workspace |
| Premium canceling | Yes until period end | Yes | Yes | Exact access-end date and billing controls |
| Premium past due | Paused | Existing work remains available | Paused | Restore billing without fear of data loss |
| Owner/admin | Unlimited | Unlimited | Yes | Creator workspace plus protected operations |

## Product principles

- Nothing posts without the creator's workflow and provider-required confirmation.
- AI suggestions are grounded in the transcript; uncertainty is visible.
- A high score never hides caption, quotation, render or publishing warnings.
- Free users can experience the real editor; watermark and publishing rules are enforced on the server.
- Progress updates patch in place instead of reloading the whole screen.
- Existing projects and clips survive subscription changes.
- “Pro” labels always correspond to a real entitlement, never decoration alone.

## Differentiating features

- **AI Director:** explainable retention dimensions, a ranked seven-post lineup, topic coverage, content gaps and platform-ready growth packs.
- **Quality Center:** one preflight for caption timing, transcript confidence, render/audio verification, active-speaker framing, human-review warnings and channel readiness.
- **Grounded growth copy:** transcript-based title alternatives and platform metadata with claim-safety rules.
- **Approval-to-slot publishing:** project clips move into Review first; Review owns Post now and Schedule; approved clips fill the next open slot.
- **Account-aware workspace:** Home, navigation and calls-to-action change for the person's real access state while retaining the same core layout.

## External launch gates

- TikTok Direct Post production approval and creator-facing demo/review materials.
- Meta app review and production permissions for Instagram/Facebook publishing.
- Reconnect any expired YouTube OAuth account.
- Rebuild the Hetzner worker after the final branch is published, then verify worker lanes, caption model, cgroup memory and simultaneous-job behaviour.
- Complete a real Stripe checkout/portal/webhook smoke test with the intended products and prices.

