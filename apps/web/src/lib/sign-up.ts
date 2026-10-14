import { PASSWORD_MAX_LENGTH } from '@nestvault/services/password-policy';
import { z } from 'zod';

import './zod-csp';

/** Sign-up body. The password rules are the server's; the form only guides (see `checkPassword`). */
export const signUpSchema = z
  .object({
    name: z.string().min(1).max(120),
    email: z.email().max(254),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
