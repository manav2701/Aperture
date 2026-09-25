import type { TextPrice } from '@aperture/core';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { prices } from './schema';

export interface PriceRow {
  provider: string;
  model: string;
  inputPerMTok: bigint;
  outputPerMTok: bigint;
  cacheReadPerMTok: bigint | null;
  cacheWritePerMTok: bigint | null;
  source: string;
}

/** The catalog price of a model, or undefined when it is unpriced (callers deny or skip, G6). */
export async function lookupPrice(
  db: DbOrTx,
  provider: string,
  normalizedModel: string,
): Promise<TextPrice | undefined> {
  const [row] = await db
    .select()
    .from(prices)
    .where(and(eq(prices.provider, provider), eq(prices.model, normalizedModel)));
  if (!row) return undefined;
  return {
    inputPerMTok: row.inputPerMTok,
    outputPerMTok: row.outputPerMTok,
    ...(row.cacheReadPerMTok === null ? {} : { cacheReadPerMTok: row.cacheReadPerMTok }),
    ...(row.cacheWritePerMTok === null ? {} : { cacheWritePerMTok: row.cacheWritePerMTok }),
  };
}

/** Inserts or updates catalog prices in batches. Returns how many rows were written. */
export async function upsertPrices(db: DbOrTx, rows: readonly PriceRow[]): Promise<number> {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    await db
      .insert(prices)
      .values(batch.map((row) => ({ ...row, updatedAt: new Date() })))
      .onConflictDoUpdate({
        target: [prices.provider, prices.model],
        set: {
          inputPerMTok: sql`excluded.input_per_mtok`,
          outputPerMTok: sql`excluded.output_per_mtok`,
          cacheReadPerMTok: sql`excluded.cache_read_per_mtok`,
          cacheWritePerMTok: sql`excluded.cache_write_per_mtok`,
          source: sql`excluded.source`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return rows.length;
}
