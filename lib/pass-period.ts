// A pass month is 30 days, with the start date counted as day one.
export const PASS_MONTH_DAYS = 30;

export function addPassDays(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + months * PASS_MONTH_DAYS - 1));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
}

export function correctedLegacyPassEnd(pass: {
  start: string;
  end?: string;
  months: number;
  holds?: { start: string; end?: string }[];
}): string | undefined {
  if (!pass.end) return undefined;
  const completedHoldDays = (pass.holds ?? []).reduce((days, hold) => {
    if (!hold.end) return days;
    return days + Math.round((Date.parse(hold.end) - Date.parse(hold.start)) / 86400000);
  }, 0);
  const [year, month, day] = addPassDays(pass.start, pass.months).split("-").map(Number);
  const legacyEnd = new Date(Date.UTC(year, month - 1, day + completedHoldDays + 1));
  if (legacyEnd.toISOString().slice(0, 10) !== pass.end) return undefined;
  legacyEnd.setUTCDate(legacyEnd.getUTCDate() - 1);
  return legacyEnd.toISOString().slice(0, 10);
}
