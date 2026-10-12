import { HealthDto } from '@nestvault/services';

import { errorResponses, registry } from './registry';

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  operationId: 'getHealth',
  summary: 'Liveness check',
  description: 'No authentication and no data: only tells that the web process is running.',
  tags: ['System'],
  security: [],
  responses: {
    200: {
      description: 'The service is running',
      content: { 'application/json': { schema: HealthDto } },
    },
    ...errorResponses(500),
  },
});
