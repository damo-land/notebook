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
