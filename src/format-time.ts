function getFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: process.env.TZ ?? "UTC",
  })
}

export function formatLocalTime(date: Date): string {
  return getFormatter().format(date)
}
