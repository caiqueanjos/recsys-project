import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Store, defaultDatabaseUrl } from '../../apps/store-api/src/db.js';

// A private schema per test keeps the learning dataset untouched.
export async function temporaryStore() {
  const url =
    process.env.STORE_TEST_DATABASE_URL ?? process.env.STORE_DATABASE_URL ?? defaultDatabaseUrl;
  const namespace = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });
  let store: Store | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    store = await Store.open(url, namespace);
    return {
      store,
      async cleanup() {
        await store!.db.close();
        try {
          await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
        } finally {
          await admin.end();
        }
      },
    };
  } catch (error) {
    await store?.db.close();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    } finally {
      await admin.end();
    }
    throw error;
  }
}
