const minuteMs = 60_000
const dayMs = 86_400_000

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsAt(epochMs: number, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs))

  const values = new Map(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  }
}

function localWallMs(epochMs: number, timezone: string): number {
  const p = partsAt(epochMs, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

function offsetMs(epochMs: number, timezone: string): number {
  return localWallMs(epochMs, timezone) - Math.floor(epochMs / 1000) * 1000
}

export function resetMinutes(resetAt: string): number {
  const [hour, minute] = resetAt.split(':').map(Number)
  return (hour ?? 0) * 60 + (minute ?? 0)
}

export function dayKeyAt(
  epochMs: number,
  timezone: string,
  resetAt: string,
): string {
  const shiftedLocalWall =
    localWallMs(epochMs, timezone) - resetMinutes(resetAt) * minuteMs
  const shifted = new Date(shiftedLocalWall)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function nextResetAt(
  epochMs: number,
  timezone: string,
  resetAt: string,
): Date {
  const day = dayKeyAt(epochMs, timezone, resetAt)
  const [year, month, date] = day.split('-').map(Number)
  const minutes = resetMinutes(resetAt)
  const targetWall = Date.UTC(
    year ?? 1970,
    (month ?? 1) - 1,
    date ?? 1,
    Math.floor(minutes / 60),
    minutes % 60,
  )
  let candidate = targetWall - offsetMs(targetWall, timezone)
  // A DST transition can make the first estimate land on the wrong side.
  candidate = targetWall - offsetMs(candidate, timezone)
  if (candidate <= epochMs) candidate += dayMs
  return new Date(candidate)
}
