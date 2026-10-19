// LIVE-001: a session's iCalendar file (RFC 5545). One event per meeting, with a stable UID per meeting and the
// session's sequence, so importing the file again after a reschedule, change or cancellation updates the same events (a
// cancellation is the same events with STATUS:CANCELLED). It is a published file, not an emailed iTIP invitation:
// mailed invitations come with training mail (NOTICE-001).
// Times are UTC instants computed from the session's wall-clock time in its zone (live.ts), so daylight saving is
// already applied; the description repeats the local time and names the zone.
import type { Row } from './core'
import { formatLocal, zoneName } from './time'

const stamp = (instant: number) => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 octets continue on the next line after a space. */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = '', size = 0
  for (const character of line) {
    const length = new TextEncoder().encode(character).length
    if (size + length > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0 }
    current += character; size += length
  }
  return [...parts, current].join('\r\n ')
}

export function sessionCalendar(session: Row, cancelled: boolean, business: string, host: string) {
  const where = session.format === 'virtual' ? [session.location, session.joinUrl].filter(Boolean).join(' · ') : session.location
  const events = (session.meetings as Row[]).flatMap(meeting => [
    'BEGIN:VEVENT',
    `UID:${session.id}-${meeting.position}@${host}`,
    `SEQUENCE:${session.sequence}`,
    `DTSTAMP:${stamp(session.updatedAt)}`,
    `DTSTART:${stamp(meeting.startsAt)}`,
    `DTEND:${stamp(meeting.endsAt)}`,
    `SUMMARY:${text(`${session.title} (${session.courseTitle})`)}`,
    `LOCATION:${text(where)}`,
    `DESCRIPTION:${text([`${formatLocal(meeting.startsAt, session.timezone)} ${zoneName(session.timezone)}`, session.instructorName ? `Instructor: ${session.instructorName}` : '', session.materials ? `Materials: ${session.materials}` : '', cancelled && session.cancelReason ? `Cancelled: ${session.cancelReason}` : ''].filter(Boolean).join('\n'))}`,
    ...(session.joinUrl ? [`URL:${session.joinUrl}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ])
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${text(business)}//Beam live sessions//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR']
  return lines.map(fold).join('\r\n') + '\r\n'
}
