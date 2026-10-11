# Competitive landscape: PKM and AI-native note apps (as relevant to "stash")

Research date: 2026-10-11. Many pricing figures come from third-party aggregators (costbench, toolradar, etc.) rather than official pages; flagged where so. Official pages fetched: obsidian.md/pricing, notion.com/pricing, get.mem.ai blog, MacRumors iOS 26 Notes guide.

## Q1. Player profiles: pricing, sync/mobile, AI pricing model, funding, traction

### Takeaway
The market splits into (a) bootstrapped local-first file tools (Obsidian, Logseq, Anytype) that monetize sync/publish, not AI; (b) VC-funded AI-native apps (Mem, Tana, Heptabase, Reflect, Capacities) that bundle AI into $8-$20/mo subscriptions with cloud sync and mobile; and (c) platform giants (Notion, Google, Apple, Anthropic/OpenAI) that bundle AI-over-your-documents into products people already pay for. Obsidian's community plugins already offer free/BYO-key "AI over the vault" with millions of downloads.

### Cited Findings

**Obsidian**
- Core app free; Sync $4/user/mo annual or $5 monthly; Publish $8/site/mo annual or $10 monthly; Catalyst one-time $25; Commercial license $50/user/yr — [Obsidian pricing](https://obsidian.md/pricing)
- Obsidian describes itself as "100% user-supported, free from investor influence" — [Obsidian pricing](https://obsidian.md/pricing)
- Sync Plus tier: $8/mo annual with 10 GB, expandable to 100 GB at $16/mo annual (aggregator, not confirmed on fetched official page) — [Lindy](https://www.lindy.ai/blog/obsidian-pricing)
- Commercial license became optional on Feb 20, 2025; any business can use Obsidian free — [Lindy](https://www.lindy.ai/blog/obsidian-pricing). Note: OperatorBook says "made free in 2024" — date conflict, Feb 2025 is the more commonly cited — [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m)
- Revenue is undisclosed; estimates span ~$2M ARR (GetLatka Jul 2026, Fueler Oct 2025) to $5-10M (individual LinkedIn estimate, Apr 2026) to ~$25M ARR (viral, unverified April 2026 claim) — [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m); [GetLatka](https://getlatka.com/companies/obsidian.md)
- Users ~1-1.5M+ (unconfirmed); team under 20 (GetLatka says 18) — [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m); [GetLatka](https://getlatka.com/companies/obsidian.md/funding)
- Back-of-envelope Sync estimate: ~36,000 subs (3% of 1.2M users) ≈ $1.7M/yr (estimate, not data) — [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m)
- Plugin ecosystem described as ~1,400+ plugins (aggregator headline) — [Tech-Insider](https://tech-insider.org/obsidian-vs-notion-2026/)

**Obsidian AI plugins (the free/BYO alternative to stash's AI layer)**
- Smart Connections: ~1.2M downloads; local embedding model for semantic search/related notes; "zero setup, no API key"; chat split into a separate Smart Chat plugin — [Obsidian community: Smart Connections](https://community.obsidian.md/plugins/smart-connections)
- Copilot for Obsidian: ~2.4M downloads; chat with vault; can run agents like Claude Code, Codex, OpenCode inside vault; has paid "Plus" tier — [Obsidian community: Copilot](https://community.obsidian.md/plugins/copilot); [Shadow.do](https://www.shadow.do/blog/best-ai-plugins-for-obsidian-2026)
- Other AI plugins commonly recommended: Smart Composer, Text Generator, Local GPT; Ollama integration via multiple plugins — [Shadow.do](https://www.shadow.do/blog/best-ai-plugins-for-obsidian-2026); [LocalAIMaster](https://localaimaster.com/blog/local-ai-obsidian-integration)
- QuickAdd capture plugin: not researched in this pass (gap).

**Notion**
- Plans: Free, Plus, Business (recommended), Enterprise; full Notion AI (chat, doc generation, database autofill, multi-step "Notion Agent", AI Meeting Notes, Enterprise Search beta, Research Mode) only on Business+; Free/Plus get a limited trial — [Notion pricing](https://www.notion.com/pricing)
- Custom Agents on all paid plans: free trial then $10 per 1,000 monthly Notion credits — [Notion pricing](https://www.notion.com/pricing)
- Business is $20/user/mo annual ($24 monthly) in USD — [Carly](https://www.usecarly.com/blog/notion-ai-pricing-change/); UK page shows £16.50/member — [Notion pricing](https://www.notion.com/pricing)
- In May 2025 Notion eliminated the standalone AI add-on (previously ~$10/mo) and folded AI into Business — [Carly](https://www.usecarly.com/blog/notion-ai-pricing-change/)
- Notion Calendar included on all plans; Notion Mail reported on free tier (Mail not on the fetched pricing page) — [Notion pricing](https://www.notion.com/pricing); [get-alfred](https://get-alfred.ai/blog/notion-pricing)

**Mem**
- Nov 2022: $23.5M Series A led by OpenAI Startup Fund at $110M post-money; total raised $29M — [TechCrunch](https://techcrunch.com/2022/11/10/ai-powered-note-taking-app-mem-raises-23-5m-openai/)
- Earlier $5.6M seed from a16z — [Kevin Moody LinkedIn](https://www.linkedin.com/posts/kevinfmoody_note-taking-app-mem-raises-56-million-from-activity-6785313457152634880-wC2u?trk=public_profile_like_view)
- Co-founder Dennis Xu stepped away from Mem in early 2024 (announced Apr 18, 2024) — [Dennis Xu on X](https://x.com/DennisHXu/status/1780769555943743706)
- Mem 2.0 announced Oct 1, 2025 after a ~two-year rebuild; repositioned from notes app to "AI Thought Partner"; features: Voice Mode, agentic Chrome extension, Deep Search, "Heads Up" resurfacing, Agentic Chat that creates/edits notes, full offline support — [Mem blog](https://get.mem.ai/blog/introducing-mem-2-0); [AlternativeTo](https://alternativeto.net/news/2025/10/mem-2-0-relaunches-with-smarter-note-taking-tools-offline-support-and-a-new-agentic-chat)
- Mem 2.0 dropped some features because "focus is on knowledge management, not project management" — [Mem transition guide](https://get.mem.ai/blog/mem-2-dot-0-transition-guide)
- Pricing: Pro ~$12/mo; free tier capped at 25 notes/month (aggregator) — [FahimAI](https://www.fahimai.com/mem-ai)

**Tana**
- Feb 3, 2025: $14M Series A led by Tola Capital (Lightspeed, Northzone, etc.), total $25M; 160,000-person waitlist; positioned as "AI-native workspace" with supertags, AI agents, voice workflows — [Tana blog](https://outliner.tana.inc/blog/tana-raises-usd14m-series-a); [EU-Startups](https://www.eu-startups.com/2025/02/ai-native-workspace-startup-tana-raises-e13-6-million-to-develop-voice-powered-workflow/)

**Heptabase**
- No free plan; Pro $8.99/mo annual ($11.99 monthly) with 100 AI credits/mo; Premium $17.99/mo annual with 1,800 credits; Premium+ $53.99/mo annual with 8,100 credits — bundled credit-metered AI (aggregator) — [SollmannKann](https://www.sollmannkann.com/project-management-and-notes/best-heptabase-review/); [Toolchase](https://toolchase.com/tool/heptabase/)
- Has AI agent and MCP support (aggregator) — [WhatAIDoINeed](https://whataidoineed.com/tool/heptabase)

**Reflect**
- No permanent free tier; 14-day trial; one plan reported at $120/yr — [Costbench](https://costbench.com/software/note-taking/reflect/); another source says from $6/mo — [Otio](https://otio.ai/blog/reflect-note-taking) (conflict; official page 404'd)
- Includes end-to-end encryption and AI features bundled — [Otio](https://otio.ai/blog/reflect-note-taking)

**Capacities**
- Free plan with limits; Pro ~$10/mo or $80/yr (aggregator) — [SollmannKann](https://www.sollmannkann.com/project-management-and-notes/heptabase-vs-capacities/)

**Craft**
- Starting ~$8/mo (aggregator, thin data) — [Toolradar](https://toolradar.com/compare/logseq-vs-anytype)

**Logseq**
- Logseq 2.0 Beta (DB version) shipped Jul 13, 2026: replaces flat markdown files with a SQLite store, adds real-time sync and publishing; 2.0.2 beta Oct 7, 2026 — [Kompozy](https://kompozy.io/news/logseq-2-0-db-version-beta); [GitHub releases](https://github.com/logseq/logseq/releases)
- Commentary frames this as a "DB split" pushing some markdown-file users to alternatives — [Carly](https://www.usecarly.com/blog/logseq-alternatives/)

**Anytype**
- Local-first, E2E encrypted, P2P sync, MIT-licensed protocol; Plus $4/mo annual ($5 monthly) with 1 GB storage — [aiproductivity.ai](https://aiproductivity.ai/vs/anytype-vs-logseq/)

**Local-first AI notes (closest analogues to stash)**
- Reor (local AI PKM: auto-linking, Q&A over notes, semantic search, Ollama) — GitHub repo archived Mar 7, 2026, read-only — [GitHub reor](https://github.com/reorproject/reor)
- Khoj shut down its hosted Khoj Cloud on Apr 15, 2026; now self-host only (open source) — [Khoj](https://app.khoj.dev/)

**Apple Notes**
- iOS 26 Notes: Markdown export (.md), call recording transcripts saved to Notes (transcription requires Apple Intelligence), 3D graphs; no AI organization or chat-over-notes mentioned — [MacRumors](https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/)
- Reports of a Gemini-powered Notes AI overhaul in iOS 26.4 (rumor/secondary, unverified) — [Pocket-lint](https://www.pocket-lint.com/apple-notes-with-google-gemini-ai-upgrade-rumor/); [Gadget Hacks](https://apple.gadgethacks.com/news/apple-notes-gets-major-ai-overhaul-in-ios-264-update/)

**Google NotebookLM**
- Free tier; paid limits folded into Google AI plans after May 2026 I/O restructure: Plus $4.99/mo (cut from $7.99 on Jun 8, 2026), Pro $19.99, Ultra from $99.99; reportedly being rebranded "Gemini Notebook" (aggregators) — [Sourclip](https://www.sourclip.com/blog/notebooklm-pricing); [Elephas](https://elephas.app/blog/notebooklm-plus-worth-it)

**Claude / ChatGPT memory and projects**
- Claude memory introduced Aug 2025 for paid users; made free for all users Mar 2, 2026, plus a tool to import memories from ChatGPT/Gemini — [MacRumors](https://www.macrumors.com/2026/03/02/anthropic-memory-import-tool/); [9to5Mac](https://9to5mac.com/2026/03/02/free-claude-users-can-now-use-memory-and-import-context-from-rivals/)

### Inferences
- Bundling pattern: VC-funded apps bundle AI into the subscription (Heptabase credits, Notion Business, Mem Pro); local-first tools (Obsidian ecosystem, stash) rely on BYO key or local models. Stash's "use your own Claude subscription/Ollama" sits with the plugin ecosystem, where the AI itself is free to the vendor but also hard to charge for.
- Stash's direct functional competitor is not another app but the Obsidian Copilot + Smart Connections + QuickAdd combination, which is free and already has millions of installs.

### Gaps
- No official user/revenue numbers for Obsidian, Mem, Tana, Heptabase, Reflect, Capacities, Craft.
- Official pricing pages for Reflect, Capacities, Craft, Heptabase not fetched (aggregator figures only).
- QuickAdd download stats and Obsidian official plugin count not verified.
- Anytype funding and Craft funding not found in this pass.
- NotebookLM user counts not found.

## Q2. What failed or struggled, and what worked

### Takeaway
The best-documented "AI-native notes" story (Mem) is one of heavy funding, a co-founder exit and a two-year rewrite with a repositioning, not a clear win; small local-first AI-notes projects (Reor, Khoj Cloud) shut down or retreated in 2026. The clear success is Obsidian: bootstrapped, tiny team, free core, monetizing sync/publish rather than AI.

### Cited Findings
- Mem raised ~$29M total by 2022 at $110M valuation on the "AI organizes your notes automatically" pitch — [TechCrunch](https://techcrunch.com/2022/11/10/ai-powered-note-taking-app-mem-raises-23-5m-openai/)
- Co-founder Dennis Xu left in early 2024 — [Dennis Xu on X](https://x.com/DennisHXu/status/1780769555943743706)
- Mem spent ~two years rebuilding; 2.0 (Oct 2025) rebranded as "AI Thought Partner" and cut project-management features; the launch post does not explain 1.0's problems — [Mem blog](https://get.mem.ai/blog/introducing-mem-2-0); [Mem transition guide](https://get.mem.ai/blog/mem-2-dot-0-transition-guide)
- A critical Medium essay frames Mem as a "$40M second brain failure" (opinion piece; could not fetch, 403) — [Medium](https://medium.com/@theo-james/mem-ai-the-40m-second-brain-failure-burning-the-worlds-money-5f3176a34cbd)
- I found no reliable report of Mem layoffs; searches returned none — (gap)
- Reor archived Mar 2026; Khoj Cloud sunset Apr 2026 — [GitHub reor](https://github.com/reorproject/reor); [Khoj](https://app.khoj.dev/)
- Logseq's move from markdown files to a DB caused user churn commentary — [Carly](https://www.usecarly.com/blog/logseq-alternatives/)
- Obsidian: no VC, team under ~20, ~1-1.5M users, revenue estimates $2M-$25M — [Obsidian pricing](https://obsidian.md/pricing); [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m)
- Obsidian made commercial licensing optional in 2025, giving up revenue (community estimate "six figures per year") to increase adoption — [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m); [Lindy](https://www.lindy.ai/blog/obsidian-pricing)
- Tana raised more ($14M Series A, Feb 2025) by pitching AI agents and voice on top of a structured knowledge graph — [Tana blog](https://outliner.tana.inc/blog/tana-raises-usd14m-series-a)

### Inferences
- What works: owning user data/files, a free core, and charging for infrastructure that's hard to do yourself (encrypted sync, hosted publish). What struggles: charging a premium mainly for "AI magic" over notes, especially when cloud AI costs scale with usage.
- Projects without sync or mobile (Reor) found it hard to sustain themselves; stash has the same shape (Mac-only, local-only).

### Gaps
- No primary reporting (The Information, TechCrunch) on Mem's revenue, headcount or layoffs found.
- No data on Reflect's or Capacities' traction or profitability.

## Q3. Is "AI organizes your notes automatically" a paid-for differentiator in 2026?

### Takeaway
Probably not on its own. By 2026 it's bundled by platforms (Notion Business, Google AI plans with NotebookLM, free Claude memory), offered free by Obsidian plugins with local models, and the startup built on it (Mem) had to rebuild and reposition. A better angle is capture UX (instant overlay), privacy/local ownership, and riding the user's existing Claude subscription.

### Cited Findings
- Notion folded AI into Business rather than selling it as an add-on (May 2025) — [Carly](https://www.usecarly.com/blog/notion-ai-pricing-change/)
- NotebookLM paid tier price cut to $4.99/mo and bundled into Google AI plans (Jun 2026) — [Sourclip](https://www.sourclip.com/blog/notebooklm-pricing)
- Claude memory free for all users since Mar 2, 2026 — [MacRumors](https://www.macrumors.com/2026/03/02/anthropic-memory-import-tool/)
- Smart Connections (1.2M downloads) gives local semantic linking with no API key; Copilot (2.4M) gives vault chat and runs coding agents in the vault — [Smart Connections](https://community.obsidian.md/plugins/smart-connections); [Copilot](https://community.obsidian.md/plugins/copilot)
- Apple Notes now exports Markdown, which makes it easier to move notes into vault-based tools — [MacRumors](https://www.macrumors.com/guide/ios-26-notes-app-reminders-app/)

### Inferences
- Auto-tagging and auto-wiki-linking are now table stakes. Free Obsidian plugins and frontier chat apps with memory cover most of "AI over notes" for the Obsidian power users stash targets.
- Possible openings: (1) system-wide quick capture with zero friction (Obsidian's weak spot on macOS); (2) "no extra AI bill" by reusing the user's Claude subscription or Ollama; (3) local-only privacy. Each is narrow, and Obsidian, Raycast-style launchers or plugins can copy them.
- With no sync or mobile, stash can't monetize the way Obsidian does (via sync), so revenue would likely come from a one-time or low-cost Mac app license rather than a subscription.

### Gaps
- No survey data on willingness to pay specifically for AI auto-organization.
- No r/ObsidianMD or r/PKMS sentiment captured in this pass (Reddit not searched directly due to tool-call budget).
