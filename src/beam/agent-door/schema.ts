import type { JsonSchema, JsonSchemaObject } from '../../modules/agent-door/index.ts'

export const text = (maxLength = 200, minLength = 1): JsonSchema => ({ type: 'string', minLength, maxLength })
export const integer = (minimum: number, maximum: number): JsonSchema => ({ type: 'integer', minimum, maximum })
export const choice = (...values: string[]): JsonSchema => ({ type: 'string', enum: values })
export const array = (items: JsonSchema, maxItems = 200, minItems = 0): JsonSchema => ({ type: 'array', items, minItems, maxItems })
export const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchemaObject => ({ type: 'object', properties, required, additionalProperties: false })
export const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] })
export const id = text(200)
export const date: JsonSchema = { type: 'string', format: 'date' }
export const time: JsonSchema = { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' }
export const flag: JsonSchema = { type: 'boolean' }
export const draftVersion = integer(1, 1_000_000)
export const editing = { course: id, draftVersion }
export const recordOutput: JsonSchema = { type: 'object', additionalProperties: true }
export const listOutput: JsonSchema = { type: 'array', items: recordOutput }
