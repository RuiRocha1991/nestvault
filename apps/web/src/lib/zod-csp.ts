import { z } from 'zod';

// zod 4 probes `new Function('')` to enable its fast path. The strict CSP forbids eval, so the
// probe is reported as a violation even though zod catches it. Import this from client code that
// uses zod: `jitless` skips the probe (validation is identical, only the fast path is off).
z.config({ jitless: true });
