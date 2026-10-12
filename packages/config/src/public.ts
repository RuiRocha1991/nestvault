// Values the browser may know. This is an explicit allow-list: add a key here only if it is not a
// secret. No `server-only`, and it must stay free of imports from ./schema (secret names).

export interface PublicEnv {
  readonly appName: string;
}

const DEFAULT_APP_NAME = 'Cofre Familiar';
const MAX_APP_NAME_LENGTH = 60;

export function loadPublicEnv(source: Readonly<Record<string, string | undefined>>): PublicEnv {
  const raw = source.NEXT_PUBLIC_APP_NAME?.trim();
  if (raw === undefined || raw === '') return Object.freeze({ appName: DEFAULT_APP_NAME });
  if (raw.length > MAX_APP_NAME_LENGTH) {
    throw new Error(`Invalid environment variable NEXT_PUBLIC_APP_NAME: is too long`);
  }
  return Object.freeze({ appName: raw });
}

// The literal `process.env.NEXT_PUBLIC_*` access is what lets Next inline the value into the bundle.
export const publicEnv: PublicEnv = loadPublicEnv({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
