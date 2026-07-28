import { Pool } from 'pg';

// Pool condiviso, agganciato a globalThis per sopravvivere all'HMR in dev.
const globalForDb = globalThis as unknown as { __qsPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.__qsPool) {
    globalForDb.__qsPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgres://costola:costola@localhost:5433/quicksmart',
      max: 10,
    });
  }
  return globalForDb.__qsPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await getPool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}
