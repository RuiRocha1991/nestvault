import { z } from 'zod';

/** `GET /api/v1/health`: liveness only, no data and no dependency checks. */
export const HealthDto = z.object({ status: z.literal('ok') }).strict();
export type HealthDto = z.infer<typeof HealthDto>;
