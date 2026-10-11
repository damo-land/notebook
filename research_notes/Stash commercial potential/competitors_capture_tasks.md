# Competitors: Quick-Capture and Task Apps (relevant to "stash")

Research date: 2026-10-11. Context: stash = macOS global-hotkey capture overlay -> plain markdown in a local Obsidian-compatible folder, tasks view with deadlines + macOS notifications, optional AI (tagging, wiki-links, chat over notes) via user's own Claude subscription or local Ollama. Mac-only, local-only, no sync, no mobile.

Note on Apple OS versions: as of today the current Apple releases are **macOS 27 "Golden Gate" / iOS 27 (shipped 2026-09-14)**, not macOS 26 Tahoe. Tahoe (macOS 26, 2025) findings are kept because the Spotlight actions/Quick Keys changes landed there.

## Q1. What each competitor does: pricing, platforms, sync, mobile, AI, business model, traction

### Takeaway
The field splits into (a) launchers that bolted on notes + AI (Raycast, Alfred, now Apple Spotlight), (b) capture-first inboxes (Drafts, Tot, Antinote, Heynote), (c) Apple-ecosystem notes/tasks with their own sync (Bear, Things, Apple Notes/Reminders), (d) cross-platform SaaS task/notes suites with AI (Todoist, Superlist, NotePlan, Amplenote), and (e) a fresh crop of tiny "hotkey -> Obsidian vault" indie utilities. Paid tiers almost universally monetize **sync + AI**; one-time-price apps (Things, Alfred, Antinote, Tot) monetize the app itself.

### Cited Findings

**Raycast (launcher + Notes + AI) — closest well-funded overlap**
- Pricing (official page, fetched 2026-10-11): Free $0; Pro $10/mo or $96/yr; **Plus $20/mo ($192/yr); Max $50/mo ($480/yr)**; Teams Pro $15/$25/$65 per user/mo; Enterprise custom. — [Raycast Pricing](https://www.raycast.com/pricing)
  - Note: third-party aggregators still describe the older "Pro $8–10 / Pro + Advanced AI $16–20" structure — [costbench](https://costbench.com/software/ai-productivity/raycast/); the official page now shows credit-based Pro/Plus/Max tiers (500 / 3,000 / 7,500 monthly AI credits). Treat the official page as authoritative.
- Free plan: clipboard history (3 months), snippets, window mgmt, extensions, and **only 5 Raycast Notes**. Pro adds Raycast AI (Quick AI, AI Chat, Agents, AI Commands, AI Extensions), **BYOK incl. local models**, **Cloud Sync**, dictation, **unlimited Notes**. — [Raycast Pricing](https://www.raycast.com/pricing)
- iOS app is live (requires iOS 18): AI chat across "dozens of models", Notes, snippets, quicklinks, Whisper dictation, custom keyboard; **syncing of AI chats, Notes, Snippets, Quicklinks across devices requires Raycast Pro**. — [Raycast iOS](https://www.raycast.com/ios)
- Windows version in public beta (per search summary; announced for 2025). — [Neowin](https://www.neowin.net/news/the-popular-macos-productivity-app-raycast-is-coming-to-windows-in-2025/)
- Funding: $30M Series B led by Atomico, Sept 25, 2024 (Accel, Atlassian participating), explicitly to build Windows + iOS. — [Raycast Blog](https://www.raycast.com/blog/series-b); [Tech Startups](https://techstartups.com/2024/09/25/raycast-secures-30m-to-minimize-context-switching-and-expand-its-mac-productivity-app-to-windows-and-ios/)
- Traction: "hundreds of thousands" of (daily active) Mac users and 20,000+ extension developers (2024 claim). — [Tech Startups](https://techstartups.com/2024/09/25/raycast-secures-30m-to-minimize-context-switching-and-expand-its-mac-productivity-app-to-windows-and-ios/)
- Raycast Store has an Obsidian extension (search/create notes in a vault). — [Raycast Store: Obsidian](https://www.raycast.com/marcjulian/obsidian)

**Apple Spotlight (macOS 26 Tahoe -> macOS 27)**
- Tahoe (2025): Spotlight gained an Actions section with 100+ built-in actions plus third-party actions via App Intents; "Quick Keys" let you assign short key combos (e.g. "SM" = send message) and complete the action inside the Spotlight panel without opening the app. — [MacRumors](https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/); [Computerworld](https://www.computerworld.com/article/4041433/spotlight-is-much-better-in-macos-tahoe-heres-whats-new.html); [TechCrunch 2025-06-09](https://techcrunch.com/2025/06/09/apple-updates-spotlight-to-take-actions-on-your-mac/)
- Tahoe also added clipboard history to Spotlight (limited retention; widely called a sherlock of clipboard managers). — [AppleInsider](https://appleinsider.com/articles/25/06/09/apple-has-again-sherlocked-developers-with-clipboard-history)
- macOS 27 Golden Gate (shipped 2026-09-14): Spotlight becomes a "Search or Ask" bar where you converse with **Siri AI**; dedicated Siri app; Siri AI with personal context, on-screen awareness, multi-app actions; type-to-Siri. — [MacRumors release](https://www.macrumors.com/2026/09/14/apple-releases-macos-golden-gate/); [MacRumors 50 features](https://www.macrumors.com/2026/09/17/new-features-changes-macos-27/); [9to5Mac](https://9to5mac.com/2026/09/17/macos-27-golden-gate-siri-ai-top-features-apples-assistant-finally-comes-to-life-video/)
- Siri AI is a **beta**, English-only/certain regions, modern hardware only (per Cultured Code, 2026-09-14). — [Things Blog](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/)
- Pricing: free with the OS; Apple-hardware only.

**Apple Notes (Quick Note) + Apple Reminders**
- macOS 26 / iOS 26: Notes can import/export **Markdown**; audio recording with transcript + Apple Intelligence summaries. — [Apple Newsroom](https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/); [MacRumors 9/2025](https://www.macrumors.com/2025/09/24/all-the-new-macos-tahoe-features/)
- Markdown export was described as new; previously only PDF export. (Notes storage itself remains Apple's proprietary database, synced over iCloud — export is a one-off.) — [MacRumors forum summary](https://forums.macrumors.com/threads/four-new-features-coming-to-apple-reminders-and-notes.2458471/)
- iOS 26 Reminders + Apple Intelligence: "Suggested Reminders" generated from shared content (emails, web pages); auto-generated sections that sort tasks within a list. — [Apple Support](https://support.apple.com/en-gb/guide/iphone/iphcb580b580/ios); [9to5Mac 2025-10-13](https://9to5mac.com/2025/10/13/heres-everything-new-in-reminders-with-ios-26/); [9to5Mac 2025-08-15](https://9to5mac.com/2025/08/15/reminders-in-ios-26-has-a-powerful-new-tool-for-organizing-tasks/)
- macOS 27 Notes adds native drawing tools (no capture-specific change found). — [MacRumors 50 features](https://www.macrumors.com/2026/09/17/new-features-changes-macos-27/)
- Quick Note (hot corner / Fn+Q) exists since macOS Monterey; I found no 2026 change to it. (Gap — not specifically sourced this session.)

**Drafts (Agile Tortoise) — the canonical "capture first, decide later" app**
- Drafts Pro: $1.99/mo or $19.99/yr (7-day trial); Family Sharing; Patron tier $29.99. Free tier exists. — [Drafts Community](https://forums.getdrafts.com/t/drafts-pro-now-only-19-99-usd-per-year/10898); [Drafts Pro docs](https://docs.getdrafts.com/draftspro); [iMore](https://www.imore.com/drafts-pro-now-includes-family-sharing-price-increase-new-customers)
- Platforms: iPhone, iPad, Mac, Watch (App Store). Sync via iCloud. — [App Store (iOS)](https://apps.apple.com/us/app/drafts/id1236254471); [App Store (Mac)](https://apps.apple.com/us/app/drafts/id1435957248?mt=12); [MacStories review](https://www.macstories.net/reviews/drafts-5-mac/)

**Tot (The Iconfactory)**
- Seven colour-coded text "dots"; Mac version free, iOS version one-time $19.99/$20 (per search summary of reviews, 2020–2025). Sync via iCloud. — [MacStories](https://www.macstories.net/reviews/tot-review-collect-and-edit-bits-of-text/); [9to5Mac 2020](https://9to5mac.com/2020/02/29/tot-text-editor-mac-iphone-ipad/); [havn.blog 2025](https://havn.blog/2025/02/06/app-review-tot.html)

**Antinote (Cmd-N Studios) — closest UX analogue (hotkey overlay)**
- $5 one-time, lifetime updates, macOS 14+; global hotkey (default ⌥A) overlay even over fullscreen apps; inline math/currency/unit conversion; OCR from dropped images; one-click export to Apple Notes, Obsidian, or Bear; **local only, no cloud sync, no accounts**; positioned as a temporary scratchpad that complements a real notes system. — [antinote.io](https://antinote.io/); [Today on Mac](https://www.todayonmac.com/antinote-the-three-second-solution-to-lost-thoughts/); [tsamoudakis.com](https://www.tsamoudakis.com/the-simplest-way-to-capture-notes-on-mac-with-antinote/)

**Heynote**
- Free, open-source "dedicated scratchpad for power users"; one persistent buffer divided into blocks; Mac/Windows/Linux. — [heynote.com](https://heynote.com/); [GitHub](https://github.com/heyman/heynote)

**Alfred (Running with Crayons)**
- Free core; Powerpack one-time ~$41 (single) or ~$71 (Mega Supporter, lifetime upgrades) per secondary sources (official pricing is in GBP; not verified); no subscription. — [Capterra](https://www.capterra.com/p/234650/Alfred-Powerpack/); [SMTP Ghost](https://smtpghost.com/blog/alfred-pricing/) (secondary sources; official page not fetched)

**Bear (Shiny Frog)**
- Bear Pro $2.99/mo or $29.99/yr; Pro unlocks iCloud sync across Apple devices; Apple-only. — [costbench](https://costbench.com/software/note-taking/bear/); [Wikipedia](https://en.wikipedia.org/wiki/Bear_(app))

**Things 3 (Cultured Code)**
- One-time purchases per platform (as of 2026-07): Mac $49.99, iPhone/Watch $9.99, iPad $19.99, Vision Pro $29.99. — [ellieplanner](https://ellieplanner.com/productivity-copilot/things-3-pricing) (secondary)
- Things Cloud: free proprietary sync across Mac/iPhone/iPad. Quick Entry window with global shortcut. — [Wikipedia](https://en.wikipedia.org/wiki/Things_(software)); [Things Blog](https://culturedcode.com/things/blog/)
- Things 3.24 (2026-09-14) for OS 27: Siri AI natural-language/conversational to-do creation, save to Things from Siri app, to-dos and projects now appear in Spotlight, better snooze. No built-in LLM; Cultured Code documents third-party AI tools instead. — [Things Blog 2026-09](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/); [Things Support: Third-Party AI](https://culturedcode.com/things/support/articles/5510170/)

**Todoist (Doist)**
- Plans: Beginner free (5 projects), Pro ~$5/mo annual or $7 monthly, Business ~$8/user/mo annual or $10 monthly; prices raised Dec 2025 (first rise since 2022). — [Todoist pricing](https://www.todoist.com/pricing); [morgen.so](https://www.morgen.so/blog-posts/todoist-pricing); [get-alfred.ai](https://get-alfred.ai/blog/todoist-pricing) (exact $ from secondary sources; official page did not render numbers in fetch)
- AI: **Ramble** (voice-to-tasks, launched 2026-01-21) — limited on free (10 sessions/mo reported), unlimited on Pro; Task Assist and Email Assist on paid plans; Smart Quick Add natural-language parsing on all plans. — [Todoist pricing](https://www.todoist.com/pricing); [Asian Efficiency](https://www.asianefficiency.com/task-management/todoist-ai-setup-guide/)
- Traction: Todoist claims "50 million+ people" and "347K+ five-star reviews". Own cloud backend; all platforms incl. web, Windows, Android. — [Todoist pricing](https://www.todoist.com/pricing)

**Superlist**
- Plans (as of 2026-08-31): Free (unlimited tasks/notes, 5 private + 5 shared lists, 500MB); Basic $6/person/mo or $59/yr; Super $25/person/mo or $249/yr; legacy Pro closed to new buyers. — [Superlist Help](https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared)
- AI: voice task capture, meeting notes/chat, content generation, message summarization. — [Superlist Help](https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared); [TechRadar](https://www.techradar.com/pro/superlist-review)
- Funding: €13.5M from Cherry Ventures and EQT (2022); founded by Wunderlist co-founders (Christian Reber); left beta Feb 2024. No public user count found. — [CNBC 2022](https://www.cnbc.com/2022/04/12/wunderlist-co-founder-christian-reber-raises-funding-for-superlist.html)

**NotePlan**
- Markdown-file-based notes + calendar + tasks; ~$99/yr ($8.33/mo) or $12/mo (secondary sources show conflicting "Personal $4.99" tier — unclear). AI incl. "Memo AI" voice-notes-to-structured-insights. Apple platforms; also on Setapp. — [noteplan.co](https://noteplan.co/); [xpay.sh](https://www.xpay.sh/saas-pricing/noteplan-co/); [toolradar](https://toolradar.com/tools/noteplan)

**Amplenote**
- Free Personal; Pro ~$5.84/mo (annual); Unlimited $10/mo (vault encryption, publishing); Founder $20/mo. Own cloud backend, cross-platform. — [costbench](https://costbench.com/software/note-taking/amplenote/); [Capterra](https://www.capterra.com/p/10027015/Amplenote/pricing/)

**New "hotkey -> Obsidian vault" indie micro-apps (most direct functional overlap with stash's capture layer)**
- **Quick Capture (Practical PKM)**: pay-what-you-want Mac menu-bar app; ⌥Space Spotlight-style floating panel; captures thoughts, journal entries, tasks, images into an Obsidian vault even when Obsidian isn't running. — [quickcapture.practicalpkm.com](https://quickcapture.practicalpkm.com/)
- **Capture for Mac**: ⌥C from any app, keyboard-first, ⌘⏎ to save to Obsidian. — [capture.surf](https://www.capture.surf/)
- **Type for Obsidian**: capture with timestamps into the vault's Daily Note. — [usetype.app](https://usetype.app/obsidian-quick-capture)
- **quick-capture-macos** (open source): menu-bar app with Claude Code / Codex chat + screenshot/note capture into Obsidian. — [GitHub](https://github.com/lucasXiaofan/quick-capture-macos)
- **NotesBar**: menu-bar access to Obsidian notes. — [Obsidian Forum](https://forum.obsidian.md/t/notesbar-lightning-fast-access-to-your-obsidian-notes-from-the-macos-menu-bar/101146)
- **VaultCapture** (Windows equivalent, open source). — [GitHub](https://github.com/Austin8Cableguy/VaultCapture)

### Inferences
- Pricing anchors for a capture app: one-time $5 (Antinote) to $20 (Tot iOS); subscriptions $20–30/yr (Drafts, Bear) for capture/notes; $60–100/yr for task/notes suites (Todoist, NotePlan); $96+/yr for Raycast once AI and sync are wanted.
- Sync is the near-universal paywall (Raycast Pro, Bear Pro, Raycast iOS sync). Stash's "your folder, your sync (iCloud Drive/Syncthing/Obsidian Sync)" sidesteps both the cost and the backend, but also forfeits the most common monetization lever.
- BYOK/local-model AI is no longer unique: Raycast Pro already supports BYOK and local models. Stash's differentiator would be AI that writes back into a plain markdown vault (tags, wiki-links), not "AI with your own key" per se.

### Gaps
- App Store ratings counts for Drafts, Bear, Things, Tot, Antinote not retrieved (App Store pages not fetched in this session).
- No public revenue for Raycast, Drafts, Things, Bear, Superlist, NotePlan, Amplenote found. No user counts for Superlist, Drafts, Antinote.
- Alfred and Things prices come from secondary sources; Todoist exact $ amounts from secondary sources.
- Supernotes not researched (budget).
- Product Hunt and Reddit (r/macapps) traction for Antinote and Quick Capture (Practical PKM) not checked.

## Q2. Which is closest to stash, and where is the white space?

### Takeaway
No single product combines all of stash's pieces: global-hotkey overlay + markdown files in an Obsidian folder + tasks with deadlines/notifications + AI tagging/wiki-links/chat with BYO Claude or Ollama. Closest on capture UX: Antinote, Quick Capture (Practical PKM), Capture for Mac. Closest on overall scope: Raycast (Notes + AI + launcher, but a proprietary note store and a 5-note free cap). Closest on "markdown + tasks": NotePlan (subscription, own sync).

### Cited Findings
- Antinote: hotkey overlay, local-only, no accounts, but notes are *temporary* and only *exported* to Obsidian; no tasks/deadlines, no AI. — [antinote.io](https://antinote.io/)
- Quick Capture (Practical PKM): hotkey Spotlight-style panel straight into an Obsidian vault, including tasks, even when Obsidian is closed; pay-what-you-want. AI and a tasks/alerts view are not mentioned on the landing page summary. — [quickcapture.practicalpkm.com](https://quickcapture.practicalpkm.com/)
- Raycast Notes: free tier capped at 5 notes; unlimited notes + sync + AI need Pro ($96/yr+). — [Raycast Pricing](https://www.raycast.com/pricing)
- Things / Todoist / Superlist: strong task capture (Quick Entry, Smart Quick Add, Ramble) but proprietary cloud stores, not plain-markdown files. — [Things Blog](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/); [Todoist pricing](https://www.todoist.com/pricing); [Superlist Help](https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared)
- quick-capture-macos (open source) already pairs Claude Code/Codex chat with Obsidian capture — a free hobby-level overlap with stash's AI angle. — [GitHub](https://github.com/lucasXiaofan/quick-capture-macos)

### Inferences
- White space: (1) **Tasks with real deadlines + native macOS notifications living in plain markdown files** — the Obsidian-capture micro-apps stop at "append text", while task apps don't own markdown. (2) **AI that enriches the vault** (auto-tags, wiki-link suggestions, chat over notes) using a subscription the user already pays for (Claude) or free local Ollama — no extra AI credits, unlike Raycast's credit tiers. (3) Privacy/"no account" positioning, now validated by Antinote's local-only pitch.
- Risk: the capture layer alone is commoditized (several free / pay-what-you-want Obsidian capture apps launched recently; Raycast's Obsidian extension; Spotlight Quick Keys). Defensibility has to come from the tasks + AI layers, not the hotkey panel.
- Lack of mobile is a real gap relative to every paid competitor (Drafts, Bear, Things, Todoist, Raycast iOS). For Obsidian users this is partly mitigated because the vault is readable by Obsidian Mobile if they sync the folder themselves.

### Gaps
- Could not verify whether Quick Capture (Practical PKM) or Capture for Mac support due dates/notifications or AI (landing pages only, via search summary).
- No traction data for the Obsidian capture micro-apps.

## Q3. How do they handle sync and mobile, and what do they charge for it?

### Takeaway
Apple-ecosystem indies use iCloud (Drafts, Bear, Tot) and often gate it behind the subscription; Things runs its own free Things Cloud; Raycast, Todoist, Superlist, Amplenote run their own backends and gate sync/AI on paid tiers. Local-only apps (Antinote, Heynote, Obsidian capture tools) have no sync and no mobile.

### Cited Findings
| App | Sync | Mobile | What's paid |
|---|---|---|---|
| Raycast | Own cloud ("Cloud Sync") | iOS app live; Windows beta | Sync, unlimited notes, AI = Pro $96/yr+ — [pricing](https://www.raycast.com/pricing), [iOS](https://www.raycast.com/ios) |
| Apple Notes/Reminders | iCloud | iOS/iPadOS | Free with hardware — [Apple Newsroom](https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/) |
| Drafts | iCloud | iPhone/iPad/Watch | Pro $19.99/yr for advanced features — [Drafts Pro](https://docs.getdrafts.com/draftspro) |
| Tot | iCloud | iOS | iOS app ~$20 one-time; Mac free — [MacStories](https://www.macstories.net/reviews/tot-review-collect-and-edit-bits-of-text/) |
| Bear | iCloud | iOS/iPadOS | Sync requires Pro $29.99/yr — [costbench](https://costbench.com/software/note-taking/bear/) |
| Things 3 | Things Cloud (free) | iPhone/iPad/Watch/Vision | Each app one-time — [Wikipedia](https://en.wikipedia.org/wiki/Things_(software)), [ellieplanner](https://ellieplanner.com/productivity-copilot/things-3-pricing) |
| Todoist | Own cloud | iOS/Android/web/Win | Free tier syncs; Pro for AI/limits — [Todoist pricing](https://www.todoist.com/pricing) |
| Superlist | Own cloud | Cross-platform | Basic $59/yr, Super $249/yr — [Superlist Help](https://help.superlist.com/en/articles/310866-superlist-pricing-free-basic-and-super-plans-compared) |
| NotePlan | Own sync / iCloud (markdown files) | Apple platforms | ~$99/yr — [xpay.sh](https://www.xpay.sh/saas-pricing/noteplan-co/) |
| Amplenote | Own cloud | Cross-platform | Pro ~$70/yr — [costbench](https://costbench.com/software/note-taking/amplenote/) |
| Antinote | None (local) | None | $5 one-time — [antinote.io](https://antinote.io/) |
| Heynote | None (local file) | None | Free/OSS — [heynote.com](https://heynote.com/) |
| Obsidian capture micro-apps | Whatever syncs the vault | None (Mac) | PWYW / free — [Quick Capture](https://quickcapture.practicalpkm.com/) |

### Inferences
- Stash sits with the local-only cohort (Antinote, Heynote, Obsidian capture tools), where prices are $0–$5 one-time. Moving up to the $20–100/yr band historically requires mobile + sync.
- "Bring your own sync" via an Obsidian folder is a credible middle path that avoids running a backend, and Obsidian Sync/iCloud Drive users already have it.

### Gaps
- NotePlan's exact sync mechanism (iCloud vs. own CloudKit/server) not verified in this session.

## Q4. Has Apple "sherlocked" quick capture? What do reviewers say?

### Takeaway
Partially. Tahoe's Spotlight Actions/Quick Keys and macOS 27's "Search or Ask" Siri AI make the system launcher capable of firing App Intents (e.g. create a reminder or note) from a keyboard panel, and Things/others now plug into it. But reviewers and power users consistently say Spotlight is "good enough" for casual users while Raycast/Alfred remain ahead; nobody frames it as replacing a dedicated markdown capture inbox.

### Cited Findings
- Tahoe Spotlight: 100+ actions, third-party via App Intents, Quick Keys to run actions inline (e.g., send a message from Spotlight). — [MacRumors](https://www.macrumors.com/how-to/do-more-with-spotlight-in-macos-tahoe/); [AppleInsider](https://appleinsider.com/inside/macos-tahoe/tips/spotlight-got-a-huge-upgrade-in-macos-tahoe-heres-how-to-use-it)
- Mac Power Users forum (June 2025, beta 1): "less users will be driven to them because Spotlight will be 'good enough'"; another user found keyword actions buggy and concluded "So far no match for Alfred"; others cite snippets, reliability and complex workflows as Raycast/Alfred advantages. — [MPU Talk](https://talk.macpowerusers.com/t/so-spotlight-in-macos-tahoe-is-almost-raycast-alfred/40947)
- Community called the Tahoe redesign a sherlocking of Raycast; Spotlight clipboard history limited (no pinning, short retention); file search still weaker than Alfred. — [1dot.ai 2026](https://1dot.ai/blog/spotlight-vs-raycast-vs-alfred-2026) (secondary blog)
- TechCrunch on macOS 27 (2026-09-14): Spotlight is "much better than before" but not "as advanced as the highly extensible Mac productivity tool Raycast"; Siri can draft text in any text box. No specific note/task capture feature called out. — [TechCrunch](https://techcrunch.com/2026/09/14/macos-27-new-siri-takes-on-ai-productivity-apps/)
- Things 3.24 integrates Siri AI and Spotlight (2026-09-14): third-party task apps are adopting Apple's capture surface rather than being displaced. — [Things Blog](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/)
- Siri AI is still beta, English-only, limited regions/hardware. — [Things Blog](https://culturedcode.com/things/blog/2026/09/things-for-os-27-and-siri-ai/)
- Apple Notes now exports Markdown, but its store remains Apple's own; Reminders AI auto-sorts and suggests tasks. — [Apple Newsroom](https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/); [9to5Mac](https://9to5mac.com/2025/10/13/heres-everything-new-in-reminders-with-ios-26/)

### Inferences
- The biggest Apple threat to stash is "Spotlight Quick Key -> Apple Reminders/Notes with Siri AI": free, synced, on mobile. Stash's answer has to be the **open-format markdown vault + Obsidian compatibility + BYO-model AI over your own notes**, which Apple doesn't offer.
- Stash could also *ride* Apple's surface: exposing App Intents would put "Add to stash" inside Spotlight/Siri, which is what Things just did.

### Gaps
- No MacStories or The Verge review dedicated to Tahoe/27 Spotlight vs. capture apps found in this session.
- No hard data (downloads/revenue) showing Raycast/Alfred/Drafts decline after Tahoe.
