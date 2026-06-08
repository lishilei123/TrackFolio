export function dateInTimeZone(value: string | Date, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(Date.parse(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function settlementToday(timeZone: string): string {
  return dateInTimeZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
}
