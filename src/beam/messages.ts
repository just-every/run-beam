// LEARN-017 message catalog: only trusted interface strings go through this function.
// Learner names, employer course text, questions, answers and authored certificate wording are never translated.
import type { Language } from './language'
import type { Actor } from './actor'
const spanish: Record<string, string> = {
 'My learning': 'Mi aprendizaje', 'Menu': 'Menú', 'Main': 'Principal', 'Learner': 'Estudiante',
 'Skills': 'Habilidades', 'Recognition': 'Reconocimiento', 'Certificates': 'Certificados',
 'question': 'pregunta', 'questions': 'preguntas', 'point': 'punto', 'points': 'puntos',
 '{questions} worth {points}.': '{questions} por un total de {points}.',
 'Catalog': 'Catálogo', 'Sessions': 'Sesiones', 'My record': 'Mi expediente', 'Sign out': 'Cerrar sesión',
 'Language': 'Idioma', 'Save language': 'Guardar idioma', 'Use employer default': 'Usar el idioma predeterminado de la empresa',
 'Assigned to me': 'Mis asignaciones', 'Completed': 'Completado', 'Reminders': 'Recordatorios', 'Certificate': 'Certificado',
 'No completions yet.': 'Todavía no hay cursos completados.', 'Nothing is assigned to you right now.': 'No tienes asignaciones en este momento.',
 'Training that is part of your work is done in paid working time.': 'La capacitación que forma parte de tu trabajo se realiza durante el horario de trabajo remunerado.',
 'Lessons': 'Lecciones', 'Quiz': 'Cuestionario', 'Take the quiz': 'Responder el cuestionario', 'Resume': 'Continuar', 'Start': 'Comenzar',
 'Return to the timed quiz': 'Volver al cuestionario con límite de tiempo', 'Available after every lesson is done.': 'Disponible después de completar todas las lecciones.',
 'Passed.': 'Aprobado.', 'Your written answers are waiting for the assessor.': 'Tus respuestas escritas están pendientes de revisión.',
 'Next lesson': 'Siguiente lección', 'Back to course': 'Volver al curso', 'Mark done and continue': 'Marcar como completada y continuar', 'Mark done': 'Marcar como completada',
 'Lesson reading': 'Lectura de la lección', 'Source material': 'Material de referencia', 'Submit answers': 'Enviar respuestas', 'Save answers': 'Guardar respuestas',
 'Your answer': 'Tu respuesta', 'put the items in order': 'ordena los elementos', 'match each item': 'relaciona cada elemento', 'choose all that apply': 'selecciona todas las opciones que correspondan',
 'written answer, {points} points, graded by the assessor': 'respuesta escrita, {points} puntos, calificada por la persona evaluadora',
 'Blank {n}': 'Espacio {n}', 'Position {n}': 'Posición {n}', 'fill in {n} blanks': 'completa {n} espacios',
 'Download PDF': 'Descargar PDF', 'Certificate of completion': 'Certificado de finalización', 'has completed': 'ha completado',
 'This certificate records completion of the issuer’s own training. It is not an accreditation or a statement of competence.': 'Este certificado registra la finalización de la capacitación de la entidad emisora. No es una acreditación ni una declaración de competencia.',
 'Issued by': 'Emitido por', 'on': 'el', 'valid until': 'válido hasta', 'revision': 'revisión', 'Certificate number': 'Número de certificado',
 'lessons': 'lecciones', 'lessons and assessment': 'lecciones y evaluación', 'attested offline training': 'capacitación presencial acreditada',
 'Completion': 'Finalización', 'Practical assessment': 'Evaluación práctica', 'Submit evidence': 'Enviar evidencia',
 'Language fallback': 'Idioma del curso',
 'A reviewed {language} version is not available. This course opens in its original language ({original}).': 'No hay una versión revisada en {language}. Este curso se muestra en su idioma original ({original}).',
 'English': 'inglés', 'Spanish': 'español', 'Open': 'Pendiente', 'Overdue': 'Vencido', 'Expiring': 'Por vencer', 'Canceled': 'Cancelado',
 'Due {date}': 'Fecha límite: {date}', 'Revision {revision}': 'Revisión {revision}', 'Lesson {n} of {total}': 'Lección {n} de {total}',
 '{done} of {total} lessons': '{done} de {total} lecciones',
 'Pass mark {percent}%.': 'Calificación mínima: {percent}%.', '{n} attempts left.': 'Intentos restantes: {n}.',
 'Overdue learning needs attention': 'Tienes una capacitación vencida',
 'Overdue learning: {course}. Training is paid work time. Review the current requirement after signing in: {link}': 'Capacitación vencida: {course}. La capacitación se realiza durante el horario remunerado. Inicia sesión para revisar el requisito actual: {link}',
 'Quiz rules': 'Reglas del cuestionario',
 '{n} questions worth {points} points.': '{n} preguntas por un total de {points} puntos.',
 'Each question earns its points only when every choice, blank, position or pair is right; written answers earn what the assessor awards.': 'Cada pregunta recibe puntos solo si todas las opciones, espacios, posiciones o parejas son correctos; la persona evaluadora califica las respuestas escritas.',
}
export const MESSAGE_CATALOG: Record<Language, Record<string, string>> = { 'en-US': {}, 'es-US': spanish }
export function message(language: Language | undefined, key: string, values: Record<string, string | number> = {}) {
  const catalog = MESSAGE_CATALOG[language ?? 'en-US'], text = catalog[key] ?? key
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => String(values[name] ?? placeholder))
}
export const t = (actor: Pick<Actor, 'locale'> | null, key: string, values: Record<string, string | number> = {}) => message(actor?.locale, key, values)
export const localeNumber = (actor: Pick<Actor, 'locale'>, value: number) => new Intl.NumberFormat(actor.locale ?? 'en-US').format(value)

export function counted(actor: Pick<Actor, 'locale'>, singular: string, plural: string, value: number) {
 return `${localeNumber(actor, value)} ${t(actor, new Intl.PluralRules(actor.locale ?? 'en-US').select(value) === 'one' ? singular : plural)}`
}
