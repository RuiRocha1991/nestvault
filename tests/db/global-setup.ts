import { prepareTestDatabases } from './harness';

export async function setup(): Promise<void> {
  await prepareTestDatabases();
}
