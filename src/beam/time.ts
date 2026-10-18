// Explicit time zones: due dates are wall-clock times in a named IANA zone.
import { insist } from './core'

export function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0)
    return zone.length <= 64 && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(zone)
  } catch {
    return false
  }
}

function zoneOffset(instant: number, zone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant).map(part => [part.type, part.value]))
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return wall - Math.floor(instant / 1000) * 1000
}

/** The UTC instant of a local date and time in the zone (the later instant if ambiguous). */
export function zonedInstant(date: string, time: string, zone: string): number {
  insist(/^\d{4}-\d{2}-\d{2}$/.test(date), 'invalid_due_date')
  insist(/^([01]\d|2[0-3]):[0-5]\d$/.test(time), 'invalid_due_time')
  insist(validTimezone(zone), 'invalid_timezone')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(wall)
  insist(check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day, 'invalid_due_date')
  let instant = wall - zoneOffset(wall, zone)
  instant = wall - zoneOffset(instant, zone)
  return instant
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function localDate(instant: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

// One time style everywhere people read a time: "9:12 a.m.".
const meridiem = (text: string) => text.replace(/[\s\u202f]?([AP])M\b/g, (_match, half: string) => ` ${half.toLowerCase()}.m.`)

/** Wall-clock date and time in the zone, without naming it: "Oct 16, 2026, 5:00 p.m.". */
export function formatLocal(instant: number, zone: string): string {
  return meridiem(new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(instant))
}

/** A clock time in the zone: "6:05 a.m.". */
export function formatClock(instant: number, zone: string): string {
  return meridiem(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(instant))
}

/** A date with its weekday, as the manager's queues show it: "Fri Oct 16, 2026". */
export function formatWeekday(instant: number, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(instant).replace(/,(?= [A-Z])/, '')
}

/** A zone as people say it: "America/Los_Angeles" is "Los Angeles time". */
export const zoneName = (zone: string) => `${zone.split('/').pop()!.replace(/_/g, ' ')} time`

/** Wall-clock date and time in the zone; the zone is named only when it differs from the business's own. */
export function formatInstant(instant: number, zone: string, home = zone): string {
  return zone === home ? formatLocal(instant, zone) : `${formatLocal(instant, zone)} (${zoneName(zone)})`
}

export function formatDate(instant: number, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, dateStyle: 'medium' }).format(instant)
}

export const DAY = 86_400_000

/** A calendar date (YYYY-MM-DD, no time zone) as people read it: "Mar 24, 2025". */
export function formatDay(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium' }).format(Date.parse(`${date}T00:00:00Z`)) : date
}
