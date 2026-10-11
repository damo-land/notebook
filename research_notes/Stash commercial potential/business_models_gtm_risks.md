# Stash: Business Models, Pricing, Go-to-Market and Strategic Risks (as of 2026-10-11)

Scope note: research was capped at about 25 tool calls. Most numbers below come from vendor pages, founder disclosures that others compiled, and secondary review or aggregator sites. Where a figure comes from an aggregator rather than a primary source, that is flagged.

## 1. Business models used by comparable indie Mac apps, and how they turned out

### Takeaway
Small quick-capture and scratchpad Mac apps almost always sell as a cheap one-time purchase or are free or pay-what-you-want. Recurring revenue in this space comes from a service layered on top: sync, cloud, or AI. Examples are Obsidian Sync, CleanShot Cloud and Raycast Pro. Setapp can add a parallel income stream, but past developer reports put it anywhere from a minor boost to about 20% of revenue. It is not a primary business.

### Cited Findings
**One-time purchase (direct sales)**
- Antinote, a scratchpad that sits next to Obsidian, Bear or Apple Notes: $5 one-time with lifetime updates, sold directly from its website, macOS 14+, iOS app targeted for October 2026. The developer frames it as "an independent app, not a venture-funded one — which is why it's $5 once instead of a subscription." — [antinote.io](https://antinote.io/)
- Capture (capture.surf), an Obsidian quick-capture app on ⌥C: $7.99 one-time after a 7-day trial. One license covers 5 Macs with lifetime updates. It has a beta "AI Answers" feature that queries the vault with citations, native Swift, about 8 MB, no telemetry. — [capture.surf](https://www.capture.surf/)
- Quick Capture by Practical PKM (Mike Schmitz), an Obsidian menu-bar capture app on ⌥Space: pay-what-you-want (free download). It writes to Daily Notes, Journal, Inbox or Tasks and works with Obsidian closed. — [quickcapture.practicalpkm.com](https://quickcapture.practicalpkm.com/)
- Tot (Iconfactory): the Mac app is free and the iOS app is $20 upfront. It first launched as a Patreon-supporter preview and has run 30–50% off promotions. — [Macworld](https://www.macworld.com/article/233920/tot-pocket-review.html); [Iconfactory blog](https://blog.iconfactory.com/2024/06/tot-summer-sale/)
- MacWhisper (a Whisper wrapper) made about $100,000 total on lifetime licenses through Gumroad, with 57,574 downloads. The guidance quoted was to "enable users to use their own OpenAI keys." — [Startups email (Substack)](https://startupsemail.substack.com/p/100000-revenue-with-a-simple-mac)
- Founder-disclosed figures compiled by a secondary source: Screen Studio made about $30k in its first month ($108/yr subscription). BoltAI made $15–30k/month in 2025 on perpetual licenses. Xnapper made about $4k/month before it was acquired. Sensei reached $300k cumulative by 2021 ($29/yr). RocketSim reached $62k ARR at the end of 2023. — [stealwhatworks.com](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now) (compilation, not primary)

**One-time purchase plus subscription for a service ("hybrid")**
- CleanShot X: about $29–35 one-time for the app plus 1 year of updates (renewals reported at about $19/yr), with a separate CleanShot Cloud/Pro subscription at about $8–10 per user per month. — [stackscored](https://www.stackscored.com/pricing/screen-recording/cleanshot-x/); [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now). The reviewers conflict on exact prices ($29 vs $35).
- Raycast: free core, Pro at $10/mo ($8 annual), Pro+ at $20/mo. In September 2026 it moved AI from rate limits to usage-based "AI Credits." The free plan includes 50 AI messages and 5 Notes, and Pro has unlimited Notes. — [costbench](https://costbench.com/software/ai-productivity/raycast/); [note.com (Masui)](https://note.com/masuipeo/n/na95ad4f9cb22?hl=en) (secondary)

**Open-core / free app plus paid sync (the Obsidian model)**
- The Obsidian core app is free. Revenue comes from Sync ($4/mo annual, $5 monthly, 1 GB; Plus at $8/mo for 10 GB), Publish ($8–10/mo per site) and a $50/user/yr commercial license. — [lindy.ai](https://www.lindy.ai/blog/obsidian-pricing); [stackscored](https://www.stackscored.com/pricing/note-taking/obsidian/) (secondary summaries of obsidian.md/pricing)

**Setapp**
- Membership payouts: 70% of each user's fee is distributed across the apps that user opened, weighted by usage and app price tier. Developers get an extra 20% partner fee for users they refer, so up to 90% in total. An app earns as long as it is launched at least once that month. — [Setapp docs](https://docs.setapp.com/docs/setapp-membership-revenue); [setapp.com/developers](https://setapp.com/developers)
- New in March 2026: Setapp Marketplace sells individual apps (monthly, yearly or one-time) alongside the Membership of 300+ apps. Setapp takes 15% on subscription sales and 25% on one-time sales. In May 2026 Setapp launched an "AI Gateway," a unified API across OpenAI, Anthropic, Google and local models, billed through MacPaw Wallet. — [Setapp news](https://setapp.com/news/company-updates); [Setapp developers](https://setapp.com/developers)
- Historical developer experience: early on, one developer said Setapp added less than 1% to revenue and another said about 5%. Later accounts put it at about one-fifth of revenue, or "regular and steadily growing recurring revenue." — [TidBITS 2017](https://tidbits.com/2017/06/29/setapp-at-5-months-10000-users-and-better-app-discovery/); [AppleInsider 2022](https://appleinsider.com/articles/22/06/17/how-setapps-app-service-is-building-value-for-developers-and-users)
- Setapp's Membership price is reported as $9.99/mo for 230+ apps. Many CleanShot reviews come from Setapp users, which hides the app's real price. — [efficient.app](https://efficient.app/apps/cleanshot) (secondary)

**Mac App Store vs direct sales**
- A survey cited in the compilation found only 20% of Mac developers used the Mac App Store exclusively. Developers who sold both through Apple and outside it earned 52% of their revenue outside the App Store. — [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now). The original survey was not located.
- Merchant-of-record fees: Paddle and Lemon Squeezy both charge 5% + $0.50. Paddle absorbs chargebacks and refund fees and adds no international surcharge. Lemon Squeezy passes on $15 chargebacks, keeps its fee on refunds, and charges about 7% + $0.50 on international subscriptions. — [swell.is](https://www.swell.is/content/lemon-squeezy-pricing); [stilllater](https://stilllater.com/dev-tools/lemonsqueezy-vs-stripe-vs-paddle/); [buildmvpfast](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026)
- Apple's commission is 15–30%. Apps that run on-device with no backend have no other per-user costs. Apps that call cloud AI APIs pay per user and must price accordingly. — [byoklist / search compilation](https://byoklist.com/); [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now)

### Inferences
- The direct competitors set the price anchor at $0–8 one-time (Quick Capture PWYW, Antinote $5, Capture $7.99). A capture-only app is very unlikely to support a subscription. A subscription would need a recurring-cost service behind it: hosted AI, sync, or a mobile companion.
- The model that best fits the evidence is a one-time license for the local app (roughly $10–25 if it is clearly better than the $5–8 competitors, with paid major upgrades or a CleanShot-style "1 year of updates" license). Add either bring-your-own-key AI (no margin risk) or an optional hosted-AI subscription. Setapp can be layered on as a secondary channel. Direct sales via Paddle are a better fit than the Mac App Store for a global-hotkey overlay that writes to arbitrary vault folders (sandboxing is likely to add friction; not verified here).
- Setapp's new AI Gateway could let a developer offer hosted AI without running their own billing for AI usage. This is worth checking.

### Gaps
- No revenue figures were found for Antinote, Capture, Quick Capture or Tot.
- The Anytype and Logseq business models were not researched in this pass. Logseq's sync pricing and Anytype's membership tiers need checking.
- No concrete per-app Setapp payout numbers ($ per active user) were found in public docs.
- Mac App Store sandbox limits on global hotkeys or arbitrary folder writes for this kind of app were not verified.

## 2. Pricing benchmarks and how users feel about subscriptions

### Takeaway
Quick-capture and scratchpad tools sell for $0–8 one-time. Broad "AI notes" and launcher suites sell for $8–20/month. Users in the Mac utility space dislike subscriptions, and indie developers advertise "one-time" as a selling point.

### Cited Findings
- Capture tools: Quick Capture is PWYW, Antinote $5, Capture $7.99, Tot free on Mac and $20 on iOS. — [practicalpkm](https://quickcapture.practicalpkm.com/); [antinote.io](https://antinote.io/); [capture.surf](https://www.capture.surf/); [Macworld](https://www.macworld.com/article/233920/tot-pocket-review.html)
- Sync and AI add-ons: Obsidian Sync $4–5/mo. Raycast Pro (unlimited notes and AI) $8–10/mo, Pro+ $16–20/mo. — [lindy.ai](https://www.lindy.ai/blog/obsidian-pricing); [costbench](https://costbench.com/software/ai-productivity/raycast/)
- AI Mac apps sold as perpetual licenses with bring-your-own-key: BoltAI $79/$99/$199, RewriteBar $29/$59, MacWhisper Pro €64. — [trymacapps / search compilation](https://www.trymacapps.com/blog/best-ai-mac-apps); [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now)
- Subscription fatigue: mainstream press complains about apps "ditching one-time payments for subscriptions." Setapp was created to address "the pain of paying for 20 different subscriptions." — [Tom's Guide](https://www.tomsguide.com/phones/most-of-my-favorite-apps-are-ditching-one-time-payments-for-subscriptions-this-is-a-problem); [Wikipedia: Setapp](https://en.wikipedia.org/wiki/Setapp)
- Some screenshot-app competitors now market themselves as "No Subscription Required" alternatives to CleanShot, which suggests no-subscription is a selling point in Mac utilities. — [screensnap.pro](https://www.screensnap.pro/blog/best-cleanshot-x-alternative-in-2026-plus-4-more-options-for-mac-users)

### Inferences
- Bring-your-own-key AI is accepted by technical users but is a barrier for non-technical ones. Non-technical users are more likely to need a bundled-AI tier, roughly $3–8/mo or credit packs, priced well under Raycast Pro.

### Gaps
- No direct r/macapps sentiment threads were retrieved. The search tool did not return Reddit pages.
- No 2026 survey data on willingness to pay for AI note add-ons was found.

## 3. Go-to-market channels that worked

### Takeaway
Press and newsletter coverage (The Verge Installer, Digital Trends, Lifehacker) and word of mouth on Reddit drove Antinote's adoption. Product Hunt is widely described as no longer working for indie makers in 2026. Ongoing content and niche communities beat a single launch day.

### Cited Findings
- Antinote was named one of The Verge's "Top 10 Favorite Things of 2025," praised by Lifehacker and Digital Trends ("I've never made a more satisfying software purchase in my life"), and got "strong grassroots adoption" with positive Reddit testimonials. — [antinote.io](https://antinote.io/); [Digital Trends](https://www.digitaltrends.com/computing/i-tried-a-5-scratchpad-app-for-the-mac-ill-never-go-back-to-apple-notes/); [AI CERTs news](https://www.aicerts.ai/news/antinote-app-earns-verge-top-10-spot-amid-rapid-adoption/)
- Product Hunt in 2026: "4 out of 5 places are taken by extremely large companies… Anthropic, Google, Cloudflare and Vercel… A true indy project has little hope." The author expects discovery to fragment across YouTube, blogs and niche communities. — [molodtsov.me (Apr 2026)](https://molodtsov.me/2026/04/we-need-a-new-product-hunt/); see also HN discussion "[Product Hunt is dead](https://news.ycombinator.com/item?id=45362569)"
- An indie Mac app developer who launched on Product Hunt said it "has never been my biggest traffic source… a useful launch platform, not a sustained growth channel" and "Launch day is one day. Content is forever." Their advice was to launch Tuesday–Thursday at 12:01 AM PST with real screenshots. — [dev.to (HiyokoAutoSync)](https://dev.to/hiyoyok/product-hunt-launch-for-an-indie-mac-app-what-i-did-and-what-happened-5d6f)
- Tot was first released to the developer's Patreon supporters, then got coverage from MacStories, Daring Fireball and 512 Pixels. — [Macworld](https://www.macworld.com/article/233920/tot-pocket-review.html); [MacStories](https://www.macstories.net/reviews/tot-review-collect-and-edit-bits-of-text/); [Daring Fireball](https://daringfireball.net/2020/02/tot)
- Practical PKM, a PKM education brand by Mike Schmitz, distributes its Quick Capture app to its existing Obsidian audience. This is an example of creator-led distribution. — [practicalpkm](https://quickcapture.practicalpkm.com/)
- Setapp markets itself to developers as access to "tens of thousands of engaged users." — [Setapp news](https://setapp.com/news/company-updates)
- Mac utility roundups (Creativerly "Tiny macOS utility apps") are a discovery channel where Antinote appeared. — [Creativerly](https://www.creativerly.com/tiny-macos-utility-apps-part-7/)

### Inferences
- The best channels for Stash appear to be: (1) Mac newsletters and press (The Verge Installer, MacStories, Creativerly), (2) Obsidian community spaces (forum Share & Showcase, r/ObsidianMD, PKM YouTubers such as Practical PKM), (3) a Show HN aimed at the local-first and markdown angle, and (4) r/macapps. Product Hunt is optional.
- Partnering with or sponsoring PKM creators may work better than paid ads, since the creators already ship competing tools.

### Gaps
- No verified Raycast or CleanShot launch case studies were retrieved. No TikTok evidence for Mac utilities was found.
- A claim that Hacker News brings 3–10x more traffic than Product Hunt appeared in search snippets without a clear primary source, so it is excluded.

## 4. Strategic risks

### Takeaway
The biggest risks are commoditization and a crowded niche. Several near-identical Obsidian capture apps already exist at $0–8. Apple's Spotlight in macOS 26 adds quick-key actions such as "add reminder." Raycast bundles Notes and AI. Stash's capture core is a feature. It needs AI enrichment or a workflow moat to be a product.

### Cited Findings
- macOS 26 Tahoe Spotlight adds Actions (100+ built-in, expandable through third-party App Intents) and Quick Keys. For example, "ar" adds a reminder and "sm" sends a message, all from Cmd+Space. — [MacRumors](https://www.macrumors.com/2025/06/09/apple-supercharges-spotlight-in-macos-tahoe-with-quick-keys-and-more/); [TechCrunch](https://techcrunch.com/2025/06/09/apple-updates-spotlight-to-take-actions-on-your-mac/)
- Apple Notes in macOS 26/iOS 26 can import and export Markdown (basic syntax only; tables and footnotes are unreliable; folder hierarchy is not preserved). — [AppleInsider](https://appleinsider.com/inside/macos-26/tips/how-to-import-export-markdown-with-apple-notes-in-macos-tahoe); [MacRumors](https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/)
- Raycast includes Notes (5 on the free plan, unlimited on Pro) plus AI in the same $8–10/mo plan, and moved to usage-based AI credits in September 2026. — [costbench](https://costbench.com/software/ai-productivity/raycast/); [note.com](https://note.com/masuipeo/n/na95ad4f9cb22?hl=en)
- Crowded direct competition, all Obsidian-focused quick-capture apps or plugins: Quick Capture (PWYW), Capture ($7.99, with AI vault Q&A), Collector (open-source), Quick Draft for Obsidian (App Store), Quickly plugin (global hotkeys), Raycast Obsidian Smart Capture extension, quick-capture-macos (open source, with Claude/Codex chat). — [practicalpkm](https://quickcapture.practicalpkm.com/); [capture.surf](https://www.capture.surf/); [GitHub Collector](https://github.com/juliandeans/Collector); [App Store Quick Draft](https://apps.apple.com/us/app/-/id6748142801); [obsidianstats Quickly](https://www.obsidianstats.com/plugins/quickly); [Raycast Store](https://www.raycast.com/millin_gabani/obsidian-smart-capture); [GitHub quick-capture-macos](https://github.com/lucasXiaofan/quick-capture-macos)
- AI cost margin: apps that call cloud AI pay per user and must charge enough to cover the calls. Bring-your-own-key shifts that cost to the user. Raycast itself moved to usage-based credits. — [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now); [note.com](https://note.com/masuipeo/n/na95ad4f9cb22?hl=en)

### Inferences
- Apple Spotlight's "add reminder" and "add note" quick keys cover the simplest capture use case for non-technical users at zero cost. That makes the standalone consumer positioning risky.
- The risk that Obsidian ships its own capture is real but unconfirmed. The forum requests (section 5) show the gap is still open.
- A one-time price combined with hosted AI is a margin trap. Hosted AI should be metered or put behind a subscription.

### Gaps
- No reliable sources were retrieved on Apple Intelligence note features, or on ChatGPT, Claude or Gemini memory and notes features competing with capture. This needs a separate search.
- No evidence was found that Notion or Obsidian has announced a native global quick-capture feature.

## 5. Positioning: Obsidian companion vs standalone consumer app vs privacy-first local AI

### Takeaway
There is clear, ongoing demand for Obsidian quick capture: forum feature requests and at least 6–7 tools built to fill the gap. But that demand is already being met cheaply, and paying users there expect $0–8. Antinote shows a second viable niche, a delightful, polished scratchpad that complements Obsidian and appeals to non-specialists through press. Privacy-first local AI is a differentiator. Capture already markets "no telemetry" and local notes, so it is not unique.

### Cited Findings
- Obsidian forum feature requests: "Quick capture prompt" (Obsidian "lacks in the quick capture department," with a proposed global-hotkey scratch buffer) and "Global shortcut with prompt." The QuickAdd plugin has an issue asking to hide Obsidian after a global-hotkey capture. — [Obsidian forum: Quick capture prompt](https://forum.obsidian.md/t/quick-capture-prompt/43424); [Obsidian forum: Global shortcut with prompt](https://forum.obsidian.md/t/global-shortcut-with-prompt/90842); [QuickAdd issue #238](https://github.com/chhoumann/quickadd/issues/238)
- Workarounds people use: AutoHotkey scripts and the Global Hotkeys plus QuickAdd plugins. — [Obsidian forum showcase](https://forum.obsidian.md/t/global-hotkey-to-launch-obsidian-and-open-quickadd-capture-window-using-autohotkey-script/22626); [Obsidian Rocks](https://obsidian.rocks/obsidian-quick-capture/)
- Antinote positions itself as a complement to Obsidian, Bear and Apple Notes ("already have somewhere to put their permanent notes, and need somewhere to put everything else") and exports to them in one click. Press reception was strong. — [antinote.io](https://antinote.io/)
- Capture already combines Obsidian capture with AI Q&A over the vault, local storage and no telemetry, for $7.99. — [capture.surf](https://www.capture.surf/)

### Inferences
- The Obsidian-companion niche has proven demand but is a low-price, crowded space. Stash would need clear differentiation, such as AI enrichment (auto-tagging, linking, task extraction into Obsidian Tasks format) and chat over the vault, and should price at the top of the band ($10–20) or add an AI subscription.
- For non-technical users, "Obsidian-compatible markdown" is not a selling point. They would compare Stash with Apple Notes, Spotlight quick keys and Antinote. That path depends on press, polish and delight, which is harder for a solo developer to guarantee.
- A practical sequence: launch as an Obsidian companion, where the audience is reachable and has shown demand, with a free or cheap core. Monetize through an AI tier, either bring-your-own-key for power users or metered hosted AI. Use the "local markdown, privacy-first" message to broaden toward consumers later.

### Gaps
- No download or install counts were found for the Quickly plugin, Quick Capture, or Capture to size the niche. The obsidianstats.com plugin page was not fetched.
