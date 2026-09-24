import { ROLES } from '@aperture/core';
import { z } from '@hono/zod-openapi';

const ErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  })
  .openapi('Error');

/** Standard error responses; routes spread these into `responses`. */
export const errorResponses = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'Not allowed', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: ErrorSchema } } },
} as const;

export const json = <T extends z.ZodType>(schema: T, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
});

export const OrgParams = z.object({ orgId: z.uuid().openapi({ param: { name: 'orgId', in: 'path' } }) });
export const RoleSchema = z.enum(ROLES).openapi('Role');
/** USD amounts travel as decimal strings ("12.50") so no precision is lost in JSON. */
export const UsdSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'a USD amount such as "12.50"')
  .openapi('Usd');
export const Timestamp = z.string().openapi({ format: 'date-time' });
