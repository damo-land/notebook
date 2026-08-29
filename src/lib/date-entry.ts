// Keyboard date entry: parses short free-text dates into an ISO "YYYY-MM-DD"
// string (local time). Pure function, no deps. Returns null when the input
// isn't recognized — callers show it as unparsed and save without a deadline.
//
// Accepted forms:
//   "2026-09-03"        ISO date (validated: no 2026-02-30)
//   "+3d"               N days from today
//   "fri" / "friday"    next occurrence of that weekday (strictly after today)
//   "today", "tomorrow"

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

export function parseDateEntry(input: string, now: Date = new Date()): string | null {
  const s = input.trim().toLowerCase();
  if (s === "") return null;

  // ISO date, validated by round-trip (rejects e.g. 2026-02-30).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
      ? toIso(date)
      : null;
  }

  // +Nd relative days.
  const rel = /^\+(\d+)d$/.exec(s);
  if (rel) return toIso(addDays(now, Number(rel[1])));

  if (s === "today") return toIso(addDays(now, 0));
  if (s === "tomorrow") return toIso(addDays(now, 1));

  // Weekday name (3-letter prefix or full): next occurrence after today.
  const day = WEEKDAYS.findIndex((w) => w === s || (s.length === 3 && w.startsWith(s)));
  if (day !== -1) {
    const delta = ((day - now.getDay() + 7) % 7) || 7; // today -> +7, strictly future
    return toIso(addDays(now, delta));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Datetime entry (alerts)
// ---------------------------------------------------------------------------
//
// An alert needs a time of day as well as a date. `parseDateTimeEntry` accepts
// everything `parseDateEntry` does, optionally followed by a time, plus a bare
// time meaning "today at that time". Interpreted in LOCAL time, emitted as a
// UTC ISO-8601 datetime "YYYY-MM-DDTHH:MM:SSZ" — the same fixed-width shape the
// Rust scheduler formats "now" in, so the index's `alert <= now` string compare
// stays chronological.
//
// Accepted forms:
//   "fri 9am" / "tomorrow 14:30" / "+1d 08:00" / "2026-09-03 9:30pm"
//   "18:00", "9am"      bare time -> today at that time (never rolls forward)
//   "fri", "+3d"        date only -> DEFAULT_ALERT_HOUR:00 that day
//
// A bare number ("9", "fri 9") is rejected as ambiguous: use "9am" or "09:00".

/** Time of day used when the entry names a date but no time. */
const DEFAULT_ALERT_HOUR = 9;

function parseTimeOfDay(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(s);
  if (!m) return null;
  const suffix = m[3];
  if (m[2] === undefined && !suffix) return null; // bare "9" is ambiguous
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null; // "0pm" / "13pm"
    hour = suffix === "am" ? hour % 12 : (hour % 12) + 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function toUtcIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parseDateTimeEntry(input: string, now: Date = new Date()): string | null {
  // Collapse whitespace, then glue a detached am/pm onto its hour ("9 pm").
  const s = input.trim().toLowerCase().replace(/\s+/g, " ").replace(/ (am|pm)\b/g, "$1");
  if (s === "") return null;

  const parts = s.split(" ");
  if (parts.length > 2) return null;

  let dateIso: string | null;
  let time: { hour: number; minute: number } | null;
  if (parts.length === 1) {
    // One token: a time (today), else a date (default hour).
    time = parseTimeOfDay(parts[0]);
    if (time) {
      dateIso = toIso(addDays(now, 0));
    } else {
      dateIso = parseDateEntry(parts[0], now);
      time = { hour: DEFAULT_ALERT_HOUR, minute: 0 };
    }
  } else {
    dateIso = parseDateEntry(parts[0], now);
    time = parseTimeOfDay(parts[1]);
  }
  if (!dateIso || !time) return null;

  const [y, m, d] = dateIso.split("-").map(Number);
  return toUtcIso(new Date(y, m - 1, d, time.hour, time.minute, 0, 0));
}
