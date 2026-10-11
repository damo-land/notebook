# User Expectations and Build Cost for a Mainstream "stash" (sync, iOS, zero-setup AI)

Context: stash is today a Mac-only Tauri v2 (Rust + React/TS) app storing plain markdown in a local folder, with a Node sidecar for AI. The AI uses either the user's Claude subscription via `claude setup-token` or local Ollama. There is no sync and no mobile app. Research date: 2026-10-11. Dev-effort figures in the Inferences sections are my own estimates for one experienced developer. No source supports them directly.

## 1. What do non-technical users expect, and why do they leave Obsidian-like local-first apps?

### Takeaway
Mainstream users compare a notes app with Apple Notes. That means capture with almost no friction, from the Lock Screen, Siri and the share sheet, and sync they never have to configure. The most common complaints about Obsidian-style apps are paying for sync or setting it up yourself (iCloud, Syncthing, git), and a mobile app that feels like a shrunken desktop app.

### Cited Findings
- Apple Notes is called the lowest-friction option: "the gap between 'I need to write something down' and 'I've written it down'" is shorter than in any other app tested. It is built into the OS: Lock Screen capture, Siri dictation, document scanning, and sharing to Notes from almost any app — [XDA / search summary](https://www.xda-developers.com/stopped-using-obsidian-for-quick-notes-and-vault-got-more-useful/); [Medium: Apple Notes vs Obsidian](https://medium.com/@mohameddosou/apple-notes-vs-obsidian-be9db1db24d2)
- Obsidian Sync is a paid add-on ($4–5/mo). Users say every free workaround (iCloud, Syncthing) is "a lot more effort than it's worth for quick captures" and feels unreliable when they switch devices constantly — [Medium: Why I switched from Obsidian to Apple Notes](https://oscarlagrosen.medium.com/why-i-switched-from-obsidian-to-apple-notes-5e53088eb879); [cote.io](https://cote.io/2025/01/10/why-i-use-apple-notes.html)
- Obsidian mobile is described as "a desktop app shrunk down — without native gestures, system-level integrations, or offline-first confidence". Search takes several taps to reach — [Medium: markdown app built for the phone](https://wyuhuan.medium.com/why-i-left-obsidian-and-notion-for-a-markdown-note-taking-app-built-for-the-phone-not-around-it-d1e679f4a6f2)
- Tutorials for free Obsidian sync are "too technical, to the point of relying upon using the Terminal and using scripts in Keyboard Maestro" — [Productive Matters: Obsidian is too complicated](https://productivematters.substack.com/p/obsidian-is-too-complicated)
- Free community sync options (Syncthing, a Google Drive plugin, the Remotely Save plugin for S3/Dropbox/WebDAV) all ask the user to install or configure something — [obsidian-gdrive-sync](https://github.com/stravo1/obsidian-gdrive-sync); [remotely-save](https://github.com/clombt/remotely-save)
- iCloud Drive with file-based vaults: with "Optimize Mac Storage" on, macOS evicts local copies and leaves placeholders, so search and backlinks silently miss notes. Concurrent offline edits create "Note 2.md" duplicates, and iCloud "doesn't merge and it doesn't prompt". Obsidian's own docs tell users to turn off Optimize Mac Storage — [Stephan Miller: Obsidian iCloud Sync 2026](https://www.stephanmiller.com/obsidian-icloud-sync-windows/); [Eira: Why iCloud creates Obsidian sync conflicts](https://eirasync.app/blog/why-icloud-creates-obsidian-sync-conflicts); [Obsidian Forum: iCloud and optimized storage](https://forum.obsidian.md/t/about-icloud-sync-and-mac-optimized-storage/43282)

### Inferences
- Table stakes for non-technical users are:
  - Sign in once (Sign in with Apple), and notes appear on the other device.
  - No folder picker on first run. The app picks a default location, and choosing a folder is an "advanced" option.
  - No API keys or terminal commands.
  - Capture from the iOS share sheet, a widget or Lock Screen control, and Shortcuts/Siri.
- stash's current AI setup (`claude setup-token` or installing Ollama) disqualifies it for this audience. So does its current "choose a markdown folder" first-run step.

### Gaps
- I found no quantitative survey or churn data (for example, % of Obsidian users who quit because of sync). The evidence is anecdotal blog posts and forums. Obsidian does not publish churn figures.

## 2. Sync options and per-user infrastructure cost

### Takeaway
1. **CloudKit private database:** $0 infrastructure for the developer, but Apple-only.
2. **Simple custom backend** (Cloudflare Durable Objects or Supabase): about $5–25/mo flat for the first several thousand text-only users, under $0.01/user/mo.
3. **Managed sync engines** (PowerSync, Electric, Zero): $30–300/mo floors that are oversized for a markdown-notes app.

iCloud Drive file sync is the cheapest to build but brings eviction and duplicate-conflict bugs that non-technical users cannot diagnose. Obsidian Sync ($4–5/mo, E2E encrypted) sets the price users expect to pay.

### Cited Findings
- **Obsidian Sync (reference price):** $4/mo billed yearly or $5/mo billed monthly, with E2E encryption (AES-256), version history and shared vaults. Publish is $8–10/mo per site — [Obsidian pricing](https://obsidian.md/pricing)
- **CloudKit private database:** usage counts against the user's own iCloud quota (5 GB free), and "you will never be billed for usage of a user's private database". Per-user quotas cited on Apple's forums: 10 GB assets, 100 MB data, 2 GB transfer, 40 req/s. The public DB has small free per-active-user limits — [Apple Developer Forums 665612](https://developer.apple.com/forums/thread/665612); [Apple Developer Forums 93336](https://developer.apple.com/forums/thread/93336); [Apple Developer Forums 35633](https://developer.apple.com/forums/thread/35633)
- **Cloudflare Workers Paid + Durable Objects (SQLite):**
  - About $5/mo minimum.
  - Requests: 1M included, then $0.15/M.
  - Duration: 400k GB-s included, then $12.50/M GB-s.
  - SQLite rows: 25B reads/mo included; 50M writes/mo included, then $1/M.
  - Storage: 5 GB-month included, then $0.20/GB-month.
  - SQLite storage billing started January 2026.

  — [Cloudflare DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- **Supabase Pro:** $25/mo for 100k MAU, 8 GB DB, 250 GB egress and 100 GB file storage. Egress beyond that is $0.09/GB — [UI Bakery: Supabase pricing 2026](https://uibakery.io/blog/supabase-pricing); [MakerKit](https://makerkit.dev/blog/saas/supabase-pricing)
- **PowerSync:** free tier with 2 GB synced/mo, 500 MB hosted and 50 peak concurrent clients. Pro from $49/mo (30 GB synced, 10 GB hosted, 1,000 peak concurrent clients). Team from $599/mo — [PowerSync pricing](https://powersync.com/pricing)
- **ElectricSQL Cloud:** $1 per million writes ($3/M for Postgres Sync), with bills under $5 waived. Pro $249/mo and Scale $1,999/mo. The software is MIT-licensed — [Kanopy Labs comparison](https://kanopylabs.com/blog/electric-sql-vs-powersync-vs-livestore-local-first); [trybuildpilot](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026)
- **Zero (Rocicorp) managed:** Hobby $30/mo, Professional $300/mo, BYOC $1,000+/mo — [trybuildpilot](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026). These are aggregator figures; I did not verify them against Rocicorp's own pricing page.
- **iCloud Drive file sync failure modes** (eviction placeholders, "Note 2.md" duplicates, no merge) — see Q1 sources. [Stephan Miller](https://www.stephanmiller.com/obsidian-icloud-sync-windows/)

### Inferences
Assumptions: a typical notes user has about 1,000 notes of about 5 KB each (about 5 MB) and makes a few thousand edits/syncs a month. With those numbers:

- **Cloudflare DO (one DO per user, SQLite holding note text plus a change log):** 1,000 users is about 5 GB, which fits in the included storage. About 3M row-writes fits in the 50M included. So roughly $5/mo total up to around 1–5k users, then cents per user. Infra is about $0.001–0.01/user/mo. Attachments in R2 would add cost.
- **Supabase:** a flat $25/mo until the 8 GB DB fills (over 1,000 text-only users), so about $0.01–0.03/user/mo at small scale.
- **CloudKit private DB:** $0 for the developer. But it locks users into Apple, which conflicts with any future Windows or Android plans. From Rust/Tauri it also needs a Swift bridge, either a Tauri plugin or a Swift sidecar.
- **Managed sync engines:** their floors ($30–300/mo) and relational focus are poorly suited to "a folder of markdown files". A CRDT library (Automerge or Yjs) over a dumb relay (DO or Supabase) is the closest fit if real-time merge is needed. Simpler still: last-writer-wins per file, with conflict copies shown in the UI.
- **Dev effort (estimates):**
  - CloudKit sync via a Swift plugin: about 3–6 weeks.
  - Custom auth plus a Cloudflare/Supabase sync service with per-file versioning and conflict UI: about 4–8 weeks.
  - Adding E2E encryption (client-side keys, recovery-key UX): about 2–4 weeks more.
  - CRDT-per-note merge: about 2–4 weeks more.
  - Plus ongoing on-call and support burden.
- Infra is therefore not the main cost; development and support are. A sync add-on at $3–5/mo would carry over 95% gross margin before payment fees.
- **E2E encryption:** Obsidian Sync advertises E2E, so privacy-minded note users will expect it. Mainstream users probably care less, but "your notes are private" is marketing table stakes.

### Gaps
- I did not fetch the Automerge, Yjs, Replicache or Ditto docs. I have no Ditto pricing (it is enterprise-oriented and not public in the search results).
- CloudKit per-user quotas come from developer-forum posts, not from a current official Apple page.
- I did not verify how to access CloudKit or NSFileCoordinator/ubiquity containers from Tauri v2.

## 3. iOS companion app: Tauri v2 mobile vs SwiftUI vs React Native/Expo

### Takeaway
Tauri v2 can ship to the iOS App Store and would reuse stash's React UI. But the iOS-native features that matter most for capture (share extension, widgets, Lock Screen controls, App Intents/Shortcuts) still need native Swift targets, and the Tauri tooling around them is immature. A small SwiftUI companion focused on capture, with a shared sync backend, is likely the lower-risk route.

### Cited Findings
- Tauri 2.0 went stable on 2 Oct 2024 with iOS and Android support. Releases continued through 2.12.0 (September 2026). App Store distribution is documented — [Tauri 2.0 stable](https://v2.tauri.app/blog/tauri-20/); [Tauri App Store docs](https://v2.tauri.app/distribute/app-store/); [Wikipedia: Tauri](https://en.wikipedia.org/wiki/Tauri_(software_framework))
- A Rust-heavy Tauri 2 app (flow-like.com) has shipped on the iOS App Store — [Medium: shipping a Rust-heavy app to iOS with Tauri 2](https://medium.com/@trivajay259/what-happens-when-you-ship-a-rust-heavy-app-to-the-ios-app-store-with-tauri-2-ddea0584bae7)
- Developer feedback on Tauri 2 iOS (July 2024, so possibly outdated):
  - A circular tauri→xcode build loop.
  - Minimal iOS config, forcing undocumented edits to `project.yml`.
  - Simulator deployment broke once a share extension was added.
  - Out-of-date docs and uneven plugin coverage.
  - The author called it "worst developer experience in years".

  — [tauri-apps Discussion #10197](https://github.com/orgs/tauri-apps/discussions/10197)
- `tauri-plugin-widget` supports only Android, and iOS widget support is an open feature request. A share extension needs a separate Xcode target plus an App Group container. A community tool, `tauri-apple-extensions`, uses XcodeGen to add iOS/macOS extensions to Tauri projects — [Tauri issue #9766](https://github.com/tauri-apps/tauri/issues/9766); [Discussion #14555](https://github.com/orgs/tauri-apps/discussions/14555); [tauri-apple-extensions](https://github.com/Choochmeque/tauri-apple-extensions); [tauri-plugin-share docs](https://docs.rs/crate/tauri-plugin-share/latest)
- Apple Notes' Lock Screen, Siri and share-sheet integration is what users compare against (see Q1) — [XDA](https://www.xda-developers.com/stopped-using-obsidian-for-quick-notes-and-vault-got-more-useful/)

### Inferences
Dev-effort estimates for one developer:

- **Tauri v2 iOS (reusing the React UI):**
  - About 4–8 weeks for a usable app.
  - Plus about 2–4 weeks to bolt on Swift share-extension, widget and App Intents targets and to debug the build tooling.
  - Risk: the WebView-based editor feels non-native, the same complaint users make about Obsidian mobile.
- **SwiftUI native companion (capture, list, search, edit markdown, share extension, widget, App Intents):**
  - About 6–10 weeks if the developer knows Swift.
  - Gives the best native feel and direct access to Foundation Models, CloudKit and WidgetKit.
  - Costs a second UI codebase.
- **React Native/Expo:** shares the React/TS skills, but extensions still need native targets (Expo config plugins). Effort is similar to Tauri, with a more mature mobile ecosystem.
- **Ongoing costs:** the Apple Developer Program ($99/yr, see Q5), plus about 1–3 days/month of maintenance for yearly iOS releases and App Review.

### Gaps
- I found no 2026-dated, first-hand assessment of Tauri iOS maturity. The main critical source is from 2024, and the 2026 sources are generic tutorials or aggregators.
- I found no source on React Native/Expo extension support or on Expo effort.

## 4. Bundled zero-setup AI: cost per user, add-on pricing, and Anthropic's policy on subscription tokens

### Takeaway
stash's current "bring your Claude subscription via `claude setup-token`" design is not permitted for a distributed third-party product. Anthropic's terms explicitly bar routing requests through Free/Pro/Max credentials on behalf of a product's users; developers must use API keys. Bundled AI is cheap at 2026 prices:

- Roughly $0.05–1/user/mo for typical use on a small model.
- $0 for on-device Apple Foundation Models, which have a 4,096-token context and require Apple Intelligence.

Competitors charge $8–20/mo for AI tiers, so an AI tier has room for margin, provided per-user usage caps limit abuse.

### Cited Findings
- **Anthropic policy (Claude Code Legal & Compliance page, current as of fetch):** "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens." Developers building products "should use API key authentication". OAuth is "designed to support ordinary use of Claude Code and other native Anthropic applications". Anthropic may enforce "without prior notice" — [Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- The same page carves out a narrow exception for hosting an *unmodified* Claude Code binary, where each end user signs in with their own credentials and the company does not intermediate. Using it requires the Commercial Terms — [Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Timeline:
  - Enforcement against third-party clients using Max OAuth began on 9 Jan 2026.
  - Docs were updated on 18–19 Feb 2026 to say that subscription OAuth tokens in other products, including the Agent SDK, violate the Consumer Terms.
  - The section was rewritten on 7 Oct 2026.

  — [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546); [WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/); [GIGAZINE](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/)
- **Claude API prices (per MTok, input/output), from the official page:**
  - Haiku 5.5: $0.10/$0.50 for prompts up to 100k tokens; $0.50/$2.50 above that.
  - Haiku 4.5: $1/$5.
  - Sonnet 5.5: $2/$10.
  - Sonnet 4.6: $3/$15.
  - Opus 5.5: $4/$20.
  - The Batch API gives 50% off, and cache hits cost about 10% of the input price.

  — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **OpenAI prices (per MTok, input/output):**
  - GPT-5 mini: $0.25/$2.00.
  - GPT-5 nano: $0.05/$0.40.
  - GPT-5.4-mini: $0.75/$4.50.
  - GPT-5.4-nano: $0.20/$1.25.

  These are aggregator figures, not taken from openai.com directly — [spendlint](https://spendlint.dev/pricing/openai-api); [CloudZero](https://www.cloudzero.com/blog/openai-pricing/)
- **Apple Foundation Models:**
  - An on-device model of about 3B parameters, available to developers at no cost and with no network calls.
  - Requires Apple silicon with Apple Intelligence enabled on macOS 26, iOS 26 and the other Apple platforms.
  - The context limit is fixed at 4,096 tokens, shared between input and output. iOS 26.4 added `contextSize` and `tokenCount(for:)`.

  — [Apple Developer Forums 806542](https://developer.apple.com/forums/thread/806542); [InfoQ](https://infoq.com/news/2026/03/apple-foundation-models-context); [AppCoda](https://www.appcoda.com/foundation-models/); [Apple Meet with Apple video](https://developer.apple.com/videos/play/meet-with-apple/205/)
- **AI add-on price benchmarks:**
  - Notion folded full AI into Business at $20/user/mo and retired the standalone add-on in early 2026. Free and Plus get only a capped trial.
  - Raycast Pro is $8/mo annual or $10/mo monthly, with 500 AI credits/mo.

  — [eesel: Notion pricing 2026](https://www.eesel.ai/blog/notion-pricing); [Raycast Pro](https://www.raycast.com/pro); [Raycast blog: changing AI pricing](https://www.raycast.com/blog/changing-how-raycast-ai-is-priced)
- Raycast moved to credit-based AI pricing, an example of usage-capping to protect margin — [Raycast blog](https://www.raycast.com/blog/changing-how-raycast-ai-is-priced)

### Inferences
- **Per-user AI cost (my arithmetic from the list prices above).** Assumptions:
  - Typical user: 100 AI actions/mo × (2k input + 500 output tokens) = 0.2 MTok in, 0.05 MTok out.
  - Heavy user: 10× that.

  | Model | Typical user | Heavy user |
  |---|---|---|
  | Haiku 5.5 | ~$0.05/mo | ~$0.45/mo |
  | Haiku 4.5 | ~$0.45/mo | ~$4.50/mo |
  | Sonnet 5.5 | ~$0.90/mo | ~$9/mo |
  | GPT-5 mini | ~$0.15/mo | ~$1.50/mo |
  | GPT-5 nano | ~$0.03/mo | ~$0.30/mo |
  | Apple Foundation Models | $0 | $0 |

  An agentic "chat with all my notes" feature with large contexts could cost 10–100× more per action, so it needs caps.
- **Recommended tiering:**
  - Free: on-device Foundation Models for summarise, tag, rewrite and extract-tasks on short notes. This fits within 4k tokens.
  - Paid (about $5–10/mo): a hosted small model behind a proxy on Cloudflare Workers, holding the developer's API key, with per-user monthly credit caps.
  - Keep BYO API key and Ollama as power-user options.
- **Abuse and margin risk:**
  - A hosted proxy without per-account rate limits can be scripted into a free LLM endpoint.
  - Mitigations: require sign-in, set hard monthly token budgets, restrict to a small model by default, and keep system prompts server-side.
- **What to change in stash:**
  - Replace the `claude setup-token` path, which falls under "route requests through... plan credentials on behalf of their users".
  - A BYO *API key* path remains allowed, because usage is billed to the key owner.
  - The only sanctioned way to use a user's own Claude subscription is to have them run the unmodified Claude Code binary and sign in through Anthropic's own flow. Even that carve-out is written for "hosting Claude Code", not for a notes app's AI features.

### Gaps
- I did not fetch openai.com/api/pricing directly, so the OpenAI prices come from aggregators.
- Foundation Models quality, latency and language coverage for note tasks are not quantified here.
- The share of Macs with Apple Intelligence eligible and enabled is unknown, which matters for the free on-device tier.

## 5. Distribution: notarization, App Store vs direct, and the Mac App Store sandbox for a global-hotkey/overlay app

### Takeaway
Both direct distribution (Developer ID plus notarization) and the App Store need the $99/yr Apple Developer Program. The App Store takes a 15% commission under the Small Business Program. The sandbox allows global hotkeys through Carbon `RegisterEventHotKey` without any permission prompt. It blocks the Accessibility API and synthetic keystrokes, so auto-paste into other apps is impossible. A Node.js sidecar and arbitrary folder access are further sandbox friction points.

### Cited Findings
- The Apple Developer Program costs $99/yr and is needed for App Store distribution. Mac apps can also ship outside the Mac App Store with Developer ID signing plus notarization — [Apple Developer Program cost guide](https://appbuilder24.com/blog/apple-developer-account-needed); [groovyweb](https://www.groovyweb.co/blog/how-much-does-it-cost-app-store)
- The Small Business Program charges 15% commission for developers earning up to $1M/yr, on paid apps and in-app purchases — [Apple Developer: Small Business Program](https://developer.apple.com/app-store/small-business-program/); [Apple Newsroom](https://www.apple.com/newsroom/2020/11/apple-announces-app-store-small-business-program/)
- `RegisterEventHotKey` works in the sandbox and needs no Accessibility or Input Monitoring permission. It is the recommended API for user-customisable global shortcuts in sandboxed apps — [Michael Tsai blog](https://mjtsai.com/blog/2012/05/17/hotkeys-and-the-mac-app-store/); [Quicopy: sandbox shortcuts](https://www.quicopy.com/blog/macos-sandbox-keyboard-shortcuts); [Apple Developer Forums 790771](https://developer.apple.com/forums/thread/790771)
- The Accessibility API (AXUIElement) and posting CGEvents into other processes are not allowed in the sandbox, so auto-paste into the frontmost app does not work there — [DEV: clipboard manager in the MAS sandbox](https://dev.to/eduardo_revillavaquero_0/i-shipped-a-clipboard-manager-inside-the-macos-app-store-sandbox-heres-what-works-and-what-5a30)
- Many of the most useful Mac utilities ship outside the App Store because of sandbox limits — [Alin Panaitiu: Why aren't the most useful Mac apps on the App Store?](https://alinpanaitiu.com/blog/apps-outside-app-store/)
- On macOS 15, hotkeys that use only Option or Option+Shift stopped firing (FB15168205). This was later reported fixed — [feedback-assistant #552](https://github.com/feedback-assistant/reports/issues/552)

### Inferences
- **Mac recommendation:** ship direct with Developer ID and notarization, plus Paddle or Lemon Squeezy, or Stripe. This keeps the global overlay, a user-chosen markdown folder and the Node sidecar simple.
- **iOS:** must go through the App Store, so subscriptions bought on iOS pay 15% to Apple.
- **For a Mac App Store version:**
  - A user-chosen folder needs security-scoped bookmarks.
  - A bundled Node sidecar must be signed and sandboxed with inherited entitlements.
  - Ollama access over localhost needs the network-client entitlement.

  These are standard requirements, but I did not verify them against a source in this session.
- **Fixed costs:** $99/yr Apple fee. Effort for signing and notarization CI (for example, GitHub Actions with the `tauri-action` notarization step) is about 1–3 days, as an estimate.

### Gaps
- I did not verify how Tauri's sidecar (Node binary) behaves under the Mac App Store sandbox or how App Review treats it.
- I did not collect EU DMA alternative-distribution details for iOS.
