// A pass month is always 30 days, regardless of the calendar month.
export const PASS_MONTH_DAYS = 30;

export function addPassDays(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + months * PASS_MONTH_DAYS));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
}
