import { v7 } from 'uuid';

/** A new UUID v7 (time-ordered). All primary keys are generated in application code. */
export function newId(): string {
  return v7();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True for a UUID v7 (RFC 9562), the only version this project generates. */
export function isUuidV7(value: string): boolean {
  return UUID_V7.test(value);
}
