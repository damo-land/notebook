# App Store Connect — stash for iPhone

Copy-paste sheet for creating the app record, shipping TestFlight builds and
(optionally) the public App Store listing. Field limits noted in brackets.

## 1. Register the identifiers (once)

The **Bundle ID** dropdown in "New App" only lists IDs registered on the team.
Easiest: let Xcode do it.

1. `cd ios && xcodegen && open Stash.xcodeproj`
2. Xcode → Settings → Accounts: your Apple ID is signed in with team
   *Damian Kosinski (23Q8MBM5MM)*.
3. Select the **Stash** target → Signing & Capabilities → *Automatically
   manage signing*, Team = Damian Kosinski. Repeat for **StashWidget**.
   Xcode registers `land.damo.stash.ios`, `land.damo.stash.ios.widget` and the
   App Group `group.land.damo.stash`.

Manual alternative (developer.apple.com → Certificates, Identifiers &
Profiles → Identifiers): create App Group `group.land.damo.stash`, then App IDs
`land.damo.stash.ios` and `land.damo.stash.ios.widget`, each with the
**App Groups** capability set to that group.

## 2. "New App" dialog

| Field | Value |
|---|---|
| Platforms | iOS |
| Name [30] | `Stash — Notes & Tasks` — must be unique on the App Store; "Stash" alone is taken. Fallbacks: `Stash Vault`, `stash: notes & tasks`. The home-screen label stays **stash** (set in the app, not here). |
| Primary Language | English (U.K.) |
| Bundle ID | `land.damo.stash.ios` (the app, not `.widget`) |
| SKU | `stash-ios` (internal only, never shown) |
| User Access | Full Access (Limited only matters with other team members) |

## 3. Upload a build → TestFlight

1. Xcode: run destination **Any iOS Device (arm64)** → Product → **Archive**.
2. Organizer → **Distribute App** → **App Store Connect** → Distribute.
   Automatic signing creates the distribution profiles.
3. App Store Connect → TestFlight: the build appears after processing
   (~5–30 min). Encryption is pre-answered (`ITSAppUsesNonExemptEncryption = NO`).
4. **Internal Testing** → create a group, add yourself → install the
   **TestFlight** app on the iPhone → install stash. Internal builds need no
   review.
5. Every later upload needs a higher build number: bump
   `CURRENT_PROJECT_VERSION` in `ios/project.yml`, run `xcodegen`, archive.
   TestFlight builds expire after 90 days.

## 4. Public listing (only if you release on the App Store)

**Subtitle** [30] — `Plain-text notes & tasks`
(alt: `Notes and tasks, offline`)

**Promotional text** [170]

> Your notes and tasks as plain markdown in your own iCloud folder. Due-first tasks, quick capture, a home-screen widget and on-device chat. Offline and private.

**Description** [4000]

> stash is a calm, black-and-white home for your notes, tasks and knowledge — kept as plain markdown files in a folder you own.
>
> PLAIN FILES, YOUR FOLDER
> Pick a folder in iCloud Drive or on your iPhone. Every note is an ordinary .md file you can open in any editor. No account, no server, no lock-in. Using stash on the Mac? Point both at the same iCloud Drive folder and they stay in step.
>
> TASKS FIRST
> Open tasks sorted by what's due, overdue at the top. Tick one off with a tap or a swipe, and undo if you slip. Filter by category, and look back at what you've completed.
>
> CAPTURE IN SECONDS
> One tap on + opens a clean composer: a note, a task or a piece of knowledge. Add a deadline or a category with a single chip.
>
> ASK YOUR NOTES
> Chat with your notes using Apple's on-device model. It searches and reads your notes to answer — it works offline and nothing leaves your iPhone. (Requires iOS 26 and Apple Intelligence on a supported iPhone.)
>
> HOME SCREEN WIDGET
> Small, medium and large widgets show your open tasks — due first or newest first, all of them or one category. Tap + to add a task.
>
> READY FOR THE COMMUTE
> stash downloads your notes to the phone, so they're there with no signal.
>
> PRIVATE BY DESIGN
> No accounts, no analytics, no tracking. Your notes stay in your iCloud Drive and on your devices.

**Keywords** [100] — `notes,tasks,todo,markdown,vault,capture,knowledge,offline,widget,icloud,plain text,second brain`
(no other apps' names — App Review rejects trademarks in keywords)

**What's New** (first version) — `First release.`

| Setting | Value |
|---|---|
| Category | Productivity (secondary: Utilities) |
| Price | Free |
| Age rating | Answer *None / No* throughout → 4+. If asked about AI/assistant features: it answers only from the user's own notes, on device. |
| App Privacy | **Data Not Collected** (no analytics, no server; files live in the user's iCloud Drive) |
| Copyright | `2026 Damian Kosinski` |
| Support URL | `https://github.com/damo-land/notebook` (or a page on damo.land) |
| Privacy Policy URL | Required — host the text below, e.g. `https://damo.land/stash/privacy` |
| Screenshots | 6.9" iPhone, 1320 × 2868 portrait, 3–5 of: Tasks, Knowledge, a note, capture, chat |

**App Review notes**

> stash keeps notes as markdown files in a folder the user chooses; there is no account or login.
> To review: tap "Choose folder", tap "On My iPhone" (or iCloud Drive), create a new folder with the folder icon in the picker, and tap Open. Then use the + button to add notes, tasks and knowledge; tap a task's circle to complete it.
> stash is also a companion to our macOS app, which writes to the same iCloud Drive folder — not needed to use the iPhone app.
> Chat uses Apple's on-device Foundation Models and needs Apple Intelligence (iPhone 15 Pro or later, iOS 26). On other devices it says why it's unavailable.
> The home-screen widget shows open tasks; its + opens the app on a new task.

## 5. Privacy policy text (to host)

> **stash — privacy policy**
>
> stash does not collect, transmit or sell any personal data. There are no accounts, analytics, advertising or tracking.
>
> Your notes are markdown files in a folder you choose (for example in iCloud Drive). stash reads and writes only that folder. iCloud syncing is provided by Apple under your Apple Account.
>
> The optional chat feature uses Apple's on-device model; your questions and notes are processed on your iPhone and are not sent to us or any third party.
>
> Contact: <your support email>
