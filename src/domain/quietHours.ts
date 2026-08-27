export type QuietHours = { startHour: number; endHour: number };

function localHourAndDateParts(at: Date, timezone: string): { hour: number; year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return { hour, year: get('year'), month: get('month'), day: get('day') };
}

// Builds a UTC instant for a given local wall-clock hour on a given local
// calendar date in `timezone`, by searching for the offset. Sufficient
// precision for hour-granularity quiet-hours boundaries.
function localWallClockToUtc(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const observed = formatter.formatToParts(utcGuess);
  const get = (type: string) => Number(observed.find((p) => p.type === type)?.value);
  let observedHour = get('hour');
  if (observedHour === 24) observedHour = 0;
  const observedDay = get('day');
  const deltaHours = hour - observedHour + (day - observedDay) * 24;
  return new Date(utcGuess.getTime() + deltaHours * 3_600_000);
}

export function isWithinQuietHours(at: Date, timezone: string, quietHours: QuietHours): boolean {
  const { hour } = localHourAndDateParts(at, timezone);
  const { startHour, endHour } = quietHours;
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // overnight wrap, e.g. 22 -> 8
  return hour >= startHour || hour < endHour;
}

export function nextAllowedTime(at: Date, timezone: string, quietHours: QuietHours): Date {
  if (!isWithinQuietHours(at, timezone, quietHours)) {
    return at;
  }
  const { hour, year, month, day } = localHourAndDateParts(at, timezone);
  const dayOffset = hour < quietHours.endHour ? 0 : 1;
  return localWallClockToUtc(year, month, day + dayOffset, quietHours.endHour, timezone);
}
