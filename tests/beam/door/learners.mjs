import { randomBytes, randomUUID } from 'node:crypto'
import { file, nativeHttp, requireThat, sessionCookie } from './native.mjs'

// Real no-email directory members use Beam's owner-provisioned frontline door.
// Reuse these live sessions across fresh plans so no synthetic mail lifecycle or
// sign-in-rate bypass is needed for the three-answer privacy boundary.
export async function initializeLearners(context) {
  const http = nativeHttp(context), suffix = randomUUID().slice(0, 8)
  const jobRole = `Packing operator ${suffix}`
  const employeeIds = Array.from({ length: 3 }, (_, index) => `SL-${suffix}-${index + 1}`)
  const roster = 'Employee ID,Name,Role,Employment\n' + employeeIds.map((id, index) => `${id},Packing operator ${index + 1},${jobRole},active`).join('\n')
  const imported = await http.api('people.import', { file: file('sierra-lakes-roster.csv', roster, 'text/csv') })
  requireThat(imported.created.length === 3 && !imported.errors.length && !imported.conflicts.length, 'Native roster did not create its learners')
  await http.api('frontline.policy', { enabled: true, passwordEnabled: true })
  const learners = await Promise.all(imported.created.map(async (id, index) => {
    const username = `sl-${suffix}-${index + 1}`
    const credential = await http.api('frontline.issue', { member: id, username, mode: 'password' })
    const response = await http.fetch('/auth/frontline', {
      method: 'POST', headers: { origin: context.origin, 'content-type': 'application/json', cookie: '' },
      body: JSON.stringify({ username, secret: credential.initialSecret, newPassword: randomBytes(24).toString('hex') }),
    })
    requireThat(response.status === 200, 'Native frontline learner sign-in failed')
    const cookie = sessionCookie(response)
    const person = await nativeHttp({ ...context, cookie }).api('me')
    requireThat(person.id === id && !person.owner && person.roles.includes('learner'), 'Native learner authority was not established')
    return { id, employeeId: employeeIds[index], cookie }
  }))
  const team = await http.api('team.create', { name: `Packing floor ${suffix}` })
  await http.api('team.members', { team: team.id, members: learners.map(person => person.id) })
  return { learners, team: team.id, jobRole }
}
