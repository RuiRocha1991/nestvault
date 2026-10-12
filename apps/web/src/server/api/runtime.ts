/**
 * Swagger UI and the OpenAPI document are served only when `ENABLE_API_DOCS=true` and the process
 * is not in production mode. Two switches, so exposing them is a conscious choice (a shared box
 * started with NODE_ENV=development stays closed until someone turns the flag on).
 */
export async function apiDocsEnabled(): Promise<boolean> {
  const { env } = await import('@nestvault/config');
  return env.NODE_ENV !== 'production' && env.ENABLE_API_DOCS;
}
