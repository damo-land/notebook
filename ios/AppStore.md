# App Store Connect: stash for iPhone

What's set up for the iPhone app, and what's left. Live app record:
https://appstoreconnect.apple.com/apps/6831952803

## Done

**Identifiers** (Certificates, Identifiers & Profiles, team 23Q8MBM5MM)
- App Group `group.land.damo.stash`
- App ID `land.damo.stash.ios` (App Groups on, group assigned)
- App ID `land.damo.stash.ios.widget` (App Groups on, group assigned)

**App record**

| Field | Value |
|---|---|
| Name | stash - notes and tasks ("stash" alone is taken) |
| Subtitle | Notes and tasks in plain text |
| Primary language | English (U.K.) |
| Bundle ID | land.damo.stash.ios |
| SKU | stash-ios |
| Category | Productivity, secondary Utilities |
| Version | 1.0 (matches `MARKETING_VERSION` in project.yml) |
| Price | Free, all 175 countries |
| Support / marketing URL | https://damo.land/stash |
| Privacy policy URL | https://damo.land/stash/privacy/index.html |
| Copyright | 2026 Damo |
| App Review | no sign-in, contact = Damian Kosinski, notes below |

**Promotional text**

> Jot it down, find it later. Notes and tasks live as plain markdown in your own iCloud folder, with due tasks first, a home screen widget and chat that stays on device.

**Description**

> Notes pile up. Tasks drift. stash keeps both in one quiet place.
>
> stash is a small app for notes, tasks and things worth keeping. Every note is a plain markdown file in a folder you choose, in iCloud Drive or on your iPhone. No database, no lock-in. Open your notes in any editor, today or in ten years.
>
> Use stash on the Mac too? Point both apps at the same iCloud folder and they stay in step. Jot something down at your desk, read it on the train.
>
> Tasks first
> • Open tasks sorted by what is due, overdue at the top
> • Tap the circle or swipe to tick one off, undo if you slip
> • Filter by category and look back at what you finished
>
> Capture in seconds
> • One tap on + and you are writing
> • Note, task or knowledge, you pick
> • Add a deadline or a category with a single chip
>
> Ask your notes
> Ask a question and stash searches and reads your notes to answer, using Apple's on-device model. It works offline and nothing leaves your iPhone. Needs Apple Intelligence on iOS 26 and a supported iPhone.
>
> Home screen widget
> Small, medium and large. Your open tasks, due first or newest first, all of them or a single category. Tap + to add a task.
>
> What stash is not: a social app, a sync service or another subscription. It reads and writes your files, that is all.
>
> Private by design
> • No account, no server, no analytics
> • Your notes stay in your iCloud Drive and on your devices
> • Works offline, so everything is there on the commute

**Keywords** - `notes,tasks,todo,markdown,plain text,capture,knowledge,offline,widget,icloud,vault,second brain`

**App Review notes**

> stash keeps notes as markdown files in a folder you choose. There is no account or sign in.
>
> To test: tap Choose folder, pick On My iPhone (or iCloud Drive), make a new folder with the folder button in the picker and tap Open. Then use + to add notes, tasks and knowledge. Tap the circle next to a task to complete it.
>
> The app is also a companion to stash for Mac, which writes to the same iCloud Drive folder. You do not need the Mac app to use it.
>
> Chat uses Apple's on-device Foundation Models, so it needs Apple Intelligence (iPhone 15 Pro or later on iOS 26). On other devices the chat screen explains why it is unavailable.
>
> The home screen widget shows open tasks. Its + opens the app on a new task.

## Also done

- Build 1.0 (1) uploaded and attached to version 1.0.
- Screenshots: 6 in the iPhone slot (1206 x 2622, Apple scales them for
  other sizes). Originals in `store/screenshots/`. Made on the iPhone 17 Pro
  simulator from a demo vault with `-demoAnswers` for the chat shot.
- Support and privacy pages written in `../site/stash/` (same Full Stop
  template as 20days).

## Left to do (yours)

- **Publish `site/stash/` to damo.land** so `damo.land/stash` and
  `damo.land/stash/privacy/index.html` load. Both 404 today.
- **Content rights, age rating, App Privacy answers.** These are declarations
  you make. Expected answers: no third-party content; None throughout the age
  rating (4+); App Privacy "Data Not Collected", then Publish.
- **App Availability.** Pick countries (selecting all can add regions with
  extra requirements, e.g. China's ICP filing).
- **Add for Review**, then submit.

## Xcode side: upload a build

1. `cd ios && xcodegen && open Stash.xcodeproj`
2. Stash and StashWidget targets, Signing & Capabilities: automatic signing,
   team Damian Kosinski. The IDs and App Group already exist, so Xcode only
   makes profiles.
3. Destination **Any iOS Device (arm64)**, Product > **Archive**.
4. Organizer > **Distribute App** > **App Store Connect** > Distribute.
5. TestFlight: build shows after processing (5 to 30 min). Internal Testing,
   add yourself, install from the TestFlight app.
6. Each new upload: bump `CURRENT_PROJECT_VERSION` in project.yml, run
   `xcodegen`, archive again.

## Privacy policy text (for damo.land/stash/privacy)

> **stash privacy policy**
>
> stash does not collect, send or sell any personal data. There are no accounts, analytics, ads or tracking.
>
> Your notes are markdown files in a folder you choose, for example in iCloud Drive. stash only reads and writes that folder. iCloud sync is provided by Apple under your Apple Account.
>
> The optional chat uses Apple's on-device model. Your questions and notes are processed on your iPhone and are not sent to us or anyone else.
>
> Contact: <your support email>
