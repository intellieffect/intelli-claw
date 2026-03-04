/** Format timestamp to MM-DD-YYYY HH:MM:SS (KST) */
export function formatTime(ts?: string): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const tz = { timeZone: "Asia/Seoul" as const };

    const parts = new Intl.DateTimeFormat("en-US", {
      ...tz,
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const month = get("month");
    const day = get("day");
    const year = get("year");
    const hour = get("hour");
    const minute = get("minute");
    const second = get("second");

    return `${month}-${day}-${year} ${hour}:${minute}:${second}`;
  } catch {
    return null;
  }
}
