import { z } from 'zod';

import { defineJob } from './define';

/**
 * The job the runtime is exercised with (tests and local development): it logs one line and
 * touches nothing. It is not part of the production registry.
 */
export const samplePing = defineJob({
  name: 'system.ping',
  payload: z.object({ label: z.string().max(40) }).strict(),
  schedule: { cron: '0 * * * *', data: { label: 'hourly' } },
  run: (payload, { log }) => {
    log.info({ label: payload.label }, 'ping');
    return Promise.resolve();
  },
});
