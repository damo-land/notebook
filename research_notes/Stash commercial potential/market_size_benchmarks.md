# Market Size, Willingness to Pay & Indie Revenue Benchmarks for a Solo Mac Quick-Capture Notes+Tasks App ("stash")

Research date: 2026-10-11. Reliability flags used: **[REPORTED]** = disclosed by company/founder or platform first-party data; **[SURVEY]** = vendor/industry survey; **[ESTIMATE]** = third-party modelled estimate (market research firms, Getlatka, aggregators); **[AGGREGATOR]** = secondary site summarising other sources, numbers not independently verified.

## 1. Market size: note-taking apps and personal productivity / task management

### Takeaway
Market-research "TAM" figures for note-taking ($1.35B–$17B in 2025) and task management ($3.9B–$6.6B) disagree by an order of magnitude, are dominated by enterprise/team SaaS, and are not useful for sizing a solo Mac app. Bottom-up sizing from the Mac software market (an estimated $3–6B/yr across ALL third-party Mac software) and from per-app benchmarks is more defensible.

### Cited Findings
- Note-taking app market 2025 estimates per search-result summaries [ESTIMATE, low reliability, paywalled reports, definitions differ]: ~$11.02B (Research and Markets / The Business Research Company); ~$17.19B (Market Research Future); ~$7.91B (Verified Market Research); ~$1.71B (SkyQuest); ~$1.35B (DataIntelo). That is a 12x spread between estimates — [Research and Markets](https://www.researchandmarkets.com/reports/5790688/note-taking-app-market-report); [MRFR](https://www.marketresearchfuture.com/reports/note-taking-app-market-27737); [Verified Market Research](https://www.verifiedmarketresearch.com/product/note-taking-app-market/); [SkyQuest](https://www.skyquestt.com/report/note-taking-app-market); [DataIntelo](https://dataintelo.com/report/global-note-taking-app-market); [TBRC](https://www.thebusinessresearchcompany.com/report/note-taking-app-global-market-report)
- Task management software market 2025 estimates range ~$3.94B to ~$6B across firms. One forecast puts it at $6.56B in 2026 rising to $19.84B by 2034 (14.84% CAGR), with North America at 33.77% share. These numbers come from search summaries and could not be matched to each firm individually [ESTIMATE; mostly B2B/team software, not consumer] — [Fortune Business Insights](https://www.fortunebusinessinsights.com/task-management-software-market-102249); [Grand View Research](https://www.grandviewresearch.com/industry-analysis/task-management-software-market-report); [MRFR](https://www.marketresearchfuture.com/reports/task-management-software-market-11885); [OpenPR summary](https://www.openpr.com/news/4646307/task-management-software-market-outlook-signals-expansion)
- Third-party Mac software market estimated at **$3–6B/yr** (App Store + direct), with the Mac App Store slice at **$1–3B**. Mac software ARPU is estimated at **$20–50/user/yr**. The Mac market is called ~15x smaller than the iOS App Store (~$92B in 2024) [AGGREGATOR/ESTIMATE; cites Apple Newsroom, MacPaw survey, Sensor Tower, dev disclosures] — [macapps.report](https://macapps.report/market)
- The "productivity" category on mobile app stores is dominated by AI: ChatGPT took an estimated ~$879M in 2025 mobile revenue and Canva ~$211M [ESTIMATE, Appfigures] — [Appfigures Dec 2025](https://appfigures.com/resources/insights/most-downloaded-highest-earning-apps-december-2025). Consumer spending on AI apps was $1.4B in 2024, projected at >$2B in 2025 [ESTIMATE] — [Appfigures AI report](https://land.appfigures.com/rise-of-ai-apps-report-2025)

### Inferences
- The figures stash can actually reach are its share of Mac power users who buy capture/notes utilities, not "$11B note-taking". A rough bottom-up check: a ~100M+ Mac base at an estimated $20–50 software ARPU gives the $3–6B whole-Mac-software figure. Notes/tasks/capture is one of many categories in that, and much of it goes to large players (Microsoft, Adobe, Notion, Evernote, ChatGPT).
- Category headline numbers inflated by ChatGPT/Canva say nothing about indie notes apps. Do not use "Productivity category revenue" as a TAM proxy.

### Gaps
- I found no credible consumer/prosumer-only split of note-taking or task-management revenue, and no Mac-only split.
- I could not open the underlying market research reports (paywalled). Figures come from landing pages and search summaries.

## 2. Mac user base, share that buys paid apps, Mac App Store vs direct

### Takeaway
There are 100M+ active Macs, about 13–15% of global desktop OS share and ~30% in the US. Among developers who sell through both channels, direct/web sales now bring in slightly more revenue than the Mac App Store (52% vs 48%). About 95% of MAS listings are free, and Setapp is a meaningful third channel that pays out ~70% of revenue on a usage basis.

### Cited Findings
- Apple passed **100M active Macs** (Oct 2018 earnings disclosure). Apple has not published a Mac-only figure since; its total active device base reached **2.5B** in Jan 2026 [REPORTED] — [AppleInsider 2018](https://appleinsider.com/articles/18/10/30/apple-passes-100m-active-mac-milestone-thanks-to-high-numbers-of-new-users); [AppleInsider 2026](https://appleinsider.com/articles/26/01/29/apple-reaches-25-billion-active-devices-after-record-breaking-quarter)
- macOS has ~13% of global desktop OS share (Dec 2025), ~14.6% (June 2026), and ~29.6% of US desktop share in 2025 [ESTIMATE, StatCounter-derived via aggregators] — [Eltima macOS stats](https://mac.eltima.com/macos-stats-2025/); [CommandLinux](https://commandlinux.com/statistics/macos-market-share-yearly-trends/); [Wikipedia usage share](https://en.wikipedia.org/wiki/Usage_share_of_operating_systems)
- MacPaw/Setapp 2024 Mac Developer Survey (8th annual, published Dec 2024): among developers using both MAS and external channels, **52% of revenue comes from outside the App Store (up from 44% in 2023)**. Only **20%** of Mac devs rely solely on the MAS, **44%** distribute across multiple platforms, **13% fewer** devs than the prior year think MAS benefits are worth Apple's cut, and ~**90%** think Setapp's revenue share is worthwhile [SURVEY, vendor-run, so likely biased toward Setapp] — [Computerworld](https://www.computerworld.com/article/3621224/setapp-survey-reveals-what-mac-developers-are-thinking-about-right-now.html); [Erik Eckel summary](https://erikeckel.com/2025/01/03/setapps-2024-mac-developer-survey-confirms-ai-popularity-casts-shade-on-visionos-demand/)
- ~**95%** of Mac App Store listings are free and ~75% of Mac devs build cross-platform [AGGREGATOR] — [macapps.report](https://macapps.report/market)
- Setapp pays developers ~**70%** of subscription revenue, allocated by app usage, plus up to an extra 20% for users the developer refers (up to 90% total). The catalog has 260+ apps [REPORTED, Setapp docs] — [Setapp developer docs](https://docs.setapp.com/docs/setapp-membership-revenue); [Setapp developers](https://setapp.com/developers)
- macapps.report lists Setapp at "~$1.5M ARR, 1M users". This looks inconsistent with Setapp's scale (1M users × any subscription price ≫ $1.5M). **Treat it as unreliable or a misprint** — [macapps.report](https://macapps.report/market)
- Twelve months after launch, involuntary churn (billing failures) is 14% on the App Store vs 31% on Google Play [REPORTED, RevenueCat] — [RevenueCat 2026 summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)

### Inferences
- A realistic paid-Mac-app buyer pool is far smaller than 100M. I found no hard number for "% of Mac users who buy third-party paid apps". The 95%-free MAS figure and the $20–50 average ARPU (heavily skewed toward a minority of power users) suggest that only a small single-digit-to-low-double-digit % of Mac users regularly buy indie utilities. **This is an inference; there is no source for it.**
- For a solo dev, direct sales (Paddle/LemonSqueezy/Stripe, ~5–10% fees) plus an optional MAS listing for discovery plus Setapp is the common indie pattern, and the survey trend supports leaning toward direct.

### Gaps
- No official current Mac installed-base number (Apple stopped disclosing it). Estimates of 100–150M+ are plausible but unsourced beyond the 2018 figure.
- No reliable data on the share of Mac users who pay for apps, or on Setapp's per-app payouts.

## 3. Revenue benchmarks of indie Mac/iOS productivity apps

### Takeaway
Few notes/tasks apps disclose revenue. Reliable data points cluster at **$1K–$30K MRR for solo/small indie Mac apps** (BoltAI $15–30K/mo, Reflect ~$20–30K MRR, Screen Studio ~$30K/mo early, RocketSim ~$4.5K MRR, DisplayBuddy ~$1.5K MRR, Xnapper ~$4K/mo). Category leaders run into millions (Astropad $2.4–3.4M/yr). Things, Bear, Drafts, Tot, NotePlan, CleanShot and Craft have **not** disclosed revenue. Third-party estimates for them (Getlatka) are unreliable.

### Cited Findings
**Disclosed (founder/company) figures, various years:**
- **Reflect** (notes app, ~4 FT staff, ~$1M crowdfunded): founder Alex MacCaw disclosed "just over $30K MRR" and 2,500+ customers [REPORTED, Starter Story interview, date ~2023]. Another aggregator lists $21.5K MRR [AGGREGATOR]. Reflect announced profitability in Dec 2023 and had 3,000+ customers by Sept 2023, but gave no revenue in that post — [Starter Story](https://www.starterstory.com/stories/reflect-80abf444-ccfc-414a-99d1-4eb23d28d181); [StartZone](https://startzone.club/product/reflect); [Reflect blog](https://reflect.app/blog/reflect-is-profitable)
- **BoltAI** (solo Mac AI client): $15K–$30K/month in 2025 per an Indie Hackers interview [REPORTED via AGGREGATOR] — [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now)
- **Screen Studio** (Mac screen recorder): ~$30K in its first month (2022), ~$30K/month with 8K customers within 9 months (2023) [REPORTED via AGGREGATOR] — [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now); [macapps.report](https://macapps.report/market)
- **Astropad**: ~$2.4M/yr (~$200K/mo, 2020, Starter Story) and $3.4M (2019, company retrospective). The two aggregators give different figures [REPORTED via AGGREGATOR] — [macapps.report](https://macapps.report/market); [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now)
- **Xnapper** (solo, Tony Dinh): ~$4K/month before its 2024 sale [REPORTED via AGGREGATOR] — [stealwhatworks](https://stealwhatworks.com/blogs/news/mac-apps-making-real-money-now)
- **RocketSim**: ~$62K ARR at end of 2023, ~$4.5K MRR in 2024 [REPORTED via AGGREGATOR] — [macapps.report](https://macapps.report/market)
- **DisplayBuddy**: ~$1.5K MRR, 800+ customers (2023). **Sensei**: ~$300K cumulative (2021) [REPORTED via AGGREGATOR] — [macapps.report](https://macapps.report/market)
- **CleanShot X**: in 2019 the founders said it was approaching $100K total revenue. No later figures [REPORTED, old] — search summary of founder interview; see [startupsemail](https://startupsemail.substack.com/p/100000-revenue-with-a-simple-mac)
- Typical ranges (aggregator synthesis): a popular Mac utility makes **$1–8K/month**; a category leader **~$200K–$2.4M/yr** [AGGREGATOR] — [macapps.report](https://macapps.report/market)

**Undisclosed / estimate only (low reliability):**
- **Obsidian**: Getlatka lists $2M ARR and 18 staff. Obsidian has never published revenue, and public estimates range from **$2M to $25M**. It is bootstrapped with no VC [ESTIMATE] — [Getlatka](https://getlatka.com/companies/obsidian.md#team); [OperatorBook](https://www.operatorbook.dev/stories/obsidian-revenue-estimates-2m-to-25m)
- **Bear (Shiny Frog)**: Getlatka says $330K ARR with a 3-person team, while another estimate cited in the same search says ~$5M. These conflict, so treat both as unreliable [ESTIMATE]. Bear Pro costs **$2.99/mo or $29.99/yr**, and the iOS app has 4.7★ from 6.9K ratings and Editors' Choice [REPORTED, App Store] — [Getlatka](https://getlatka.com/companies/bear.app); [App Store](https://apps.apple.com/app/bear-markdown-notes/id1016366447)
- **Tot (Iconfactory)**: free download, **$19.99 one-time** IAP on Mac, and too few Mac ratings to show a score [REPORTED, App Store]. The Iconfactory (6 staff) put some apps up for sale in July 2025, saying people "aren't subscribing in great enough numbers" and that "the cost of everything has increased… while the cost of apps has not". It is keeping Tot [REPORTED] — [App Store](https://apps.apple.com/us/app/tot/id1491071483?mt=12); [TechCrunch](https://techcrunch.com/2025/07/31/design-and-development-shop-the-iconfactory-is-selling-some-apps-and-ai-is-partially-to-blame/)
- **Raycast**: VC-backed, $30M Series B (Sept 2024, Atomico) and ~$47.8M raised in total. It had >100K daily users in 2023. No revenue disclosed [REPORTED funding; user counts via aggregators] — [TechCrunch](https://techcrunch.com/2024/09/25/raycast-raises-30m-to-bring-its-mac-productivity-app-to-windows-and-ios/); [Seedtable](https://seedtable.com/companies/raycast)
- **Things, Drafts, NotePlan, Craft, CleanShot (recent), Superhuman**: I found no disclosed revenue in this research pass.

**Distribution of outcomes (RevenueCat, mostly mobile):**
- Of newly launched subscription apps, **17.3% reach $1K MRR** and **4.6% reach $10K MRR** within a 2-year window (all categories) [REPORTED, RevenueCat SOSA 2026] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- The top 5% of apps earn **400x** what the bottom 25% earn (up from 200x in 2024). Top-quartile apps grew MRR 80%+ YoY while the bottom quartile fell 33%+ [REPORTED] — [RevenueCat blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- One secondary source cites RevenueCat as saying the median indie iOS app earns **< $500/month** [AGGREGATOR, could not verify in primary] — [TechLila](https://www.techlila.com/mac-app-store-vs-direct-downloads-dmg/)

### Inferences
- Realistic solo outcomes for a well-made Mac capture app: **downside** <$500/mo (the median app); **base** $1–5K MRR (in line with RocketSim, DisplayBuddy, Xnapper); **upside** $15–30K MRR (BoltAI, Reflect, Screen Studio, which all had a strong distribution hook or AI angle). Multi-million outcomes (Astropad, Obsidian) took years and/or teams.
- The quick-capture niche specifically (Tot, Drafts) appears modest. Iconfactory's struggles show that even a beloved, well-reviewed capture app does not on its own sustain a small company.

### Gaps
- No verified revenue for Things, Bear, Drafts, Tot, NotePlan, CleanShot X, Craft or Raycast.
- Open-startup dashboards (Baremetrics Open Startups, TrustMRR) were not checked for notes/tasks apps in this pass.

## 4. Funnel numbers: download→paid, freemium conversion, trial conversion, churn

### Takeaway
RevenueCat 2026 benchmarks for Productivity: 5.9% download→trial, $0.50 revenue per install at D60, $24.95 Year-1 LTV per payer, 77% of plans monthly. Across all categories: ~2% download→paid (D35), with hard paywalls converting ~5x better than freemium (10.7% vs 2.1% trial→paid). Annual-plan churn is severe: 72% cancel within year 1. Generic SaaS freemium conversion is 2–5%.

### Cited Findings
- **Productivity download→trial (D30): 5.9% median** (Business 9.1%, Gaming 4.4%) [REPORTED, RevenueCat SOSA 2026] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- **Overall download→paid (D35): 2.0% median** globally, 2.6% in North America, 1.4% in India/SEA [REPORTED] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- **Productivity revenue per install: $0.31 at D14, $0.50 at D60** (overall $0.23 / $0.34) [REPORTED] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- **Productivity realized Year-1 LTV per payer: $24.95 median** (overall $23. North America $32, Western Europe $25) [REPORTED] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- **Productivity plan mix: 77% monthly**, the only major category where monthly dominates. Median monthly price anchors near ~$10 and annual near $30–39.99. These prices come from an AI summary of the page, so verify them in the PDF [REPORTED, extraction uncertain] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps); [RevenueCat 2025 search snippet](https://www.revenuecat.com/state-of-subscription-apps-2025)
- Productivity has the lowest Day-0 trial start rate (78%), meaning 22% of trials start later. This suggests users try the free experience before trialling [REPORTED] — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- **Hard paywall vs freemium**: D35 trial→paid is 10.7% (down from 12.1%) vs 2.1%. D60 revenue per install is $3.09 vs $0.38 [REPORTED] — [RevenueCat blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- **Trial length**: trials of 17–32 days convert at a 42.5% median vs 25.5% for trials of ≤4 days [REPORTED] — [RevenueCat blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- **Churn**: 72% of annual subscriptions are cancelled within year 1 (up from 56% in the 2025 report), and 35% of annual cancellations happen in month 1 [REPORTED] — [RevenueCat blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- **AI apps**: Year-1 realized LTV is 41% higher ($30.16 vs $21.37), but 12-month retention is 36% worse than non-AI apps [REPORTED] — [RevenueCat blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- **SaaS freemium→paid**: typically 2–5% for self-serve. Lenny/OpenView benchmarks call 3–5% good and 6–8% great, and productivity software is cited at 3–7% [SURVEY/AGGREGATOR] — [Artisan Growth](https://www.artisangrowthstrategies.com/blog/freemium-conversion-rate-benchmarks); [Monetizely](https://www.getmonetizely.com/articles/freemium-conversion-rate-the-key-metric-that-drives-saas-growth-3588c)

### Inferences
- Scenario inputs for stash (subscription mode): ~2% of downloads become paying users (range 1–5%), ~$25 Year-1 value per payer, and $0.30–0.50 per download. **Example:** 10K downloads/yr → ~200 payers → ~$5K Year-1 revenue. To reach $5K MRR (~$60K/yr) at these rates you need ~100K+ downloads/yr, or much better conversion (hard paywall / trial-gated, which mobile data suggests converts 5–8x better than freemium).
- RevenueCat data is mostly iOS/Android mobile. Mac direct-download users who come from niche marketing (Product Hunt, MacStories, Reddit) are higher intent, so desktop conversion may be higher. There is no primary data on this, so treat it as an assumption.
- The 77% monthly mix means productivity users resist annual commitment, and monthly plans churn faster. Combined with 72% first-year annual cancellation, retention, not acquisition, is likely to be the binding constraint.
- An optional AI tier could raise ARPU (+41% LTV) but hurt retention. AI also has real marginal cost per user, unlike a pure local app.

### Gaps
- No Mac/desktop-specific funnel benchmarks (RevenueCat is mobile-centric). Paddle/Gumroad-style Mac trial→purchase rates were not found.
- I could not confirm Productivity-specific trial→paid or D35 download→paid from the primary PDF (263 pages, not fully accessible).

## 5. Willingness to pay: subscription fatigue and one-time purchase preference

### Takeaway
Subscription fatigue is well documented in general-consumer surveys (~41% report it, households cutting subscriptions). Indie Mac developers cite it directly (Iconfactory, 2025). Mac notes apps cluster at **$20–50 one-time or ~$20–30/yr**. Subscriptions still produce more lifetime revenue on the App Store, so the evidence points to hybrid pricing rather than pure one-time.

### Cited Findings
- **41%** of consumers report subscription fatigue, and **42%** cancelled a subscription for "not using it enough" [SURVEY via AGGREGATOR] — [Adapty](https://adapty.io/glossary/subscription-fatigue/); [TechRT](https://techrt.com/subscription-fatigue-statistics/)
- A 2025 Self Financial survey found the average US household cut from **4.1 subscriptions (2024) to 2.8 (2025)**. Reasons given: cost of living (34.6%), price rises (32.9%), cutting expenses (26.3%) [SURVEY, general consumer, mostly streaming] — [StudyFinds](https://studyfinds.com/subscription-boom-bursting-streaming-food-delivey-americans-purge/); [WTVM](https://www.wtvm.com/2025/10/07/subscription-fatigue-leading-some-unsubscribe/)
- The Iconfactory (2025): "people aren't subscribing in great enough numbers" and "consumers are tiring of subscriptions" [REPORTED, developer testimony] — [TechCrunch](https://techcrunch.com/2025/07/31/design-and-development-shop-the-iconfactory-is-selling-some-apps-and-ai-is-partially-to-blame/)
- Price anchors in the category: Tot for Mac costs **$19.99 one-time**, and Bear Pro costs **$2.99/mo or $29.99/yr** [REPORTED, App Store] — [Tot App Store](https://apps.apple.com/us/app/tot/id1491071483?mt=12); [Bear App Store](https://apps.apple.com/app/bear-markdown-notes/id1016366447)
- Paid-upfront apps are said to be <10% of App Store revenue, with subscriptions at >44% and earning 2.5–4.5x the LTV of one-time purchases. These are uncited claims [AGGREGATOR, low reliability] — [TechLila](https://www.techlila.com/mac-app-store-vs-direct-downloads-dmg/)

### Inferences
- Mac-native power users (the Things/Tot/Drafts audience) have a reputation for preferring one-time or "paid upgrade" pricing. Things 3 has famously stayed one-time per platform, though I did not verify its current price in this pass. A pragmatic model for stash: a one-time license for the core local app (~$15–30) plus an optional subscription only for AI or sync (which carry ongoing cost). This matches both the fatigue evidence and the higher subscription LTV.
- There is a general fatigue headwind, but the data is mostly about streaming. Direct survey evidence on Mac-utility willingness to pay is thin.

### Gaps
- I found no survey specific to Mac users' preference for one-time vs subscription purchases.
- I did not verify current prices for Things 3, Drafts Pro, NotePlan or Craft in this pass.
