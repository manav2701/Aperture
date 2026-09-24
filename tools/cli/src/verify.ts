import { verifyChain, type ChainRecord } from '@aperture/crypto';
import { z } from 'zod';

const recordSchema = z.object({
  seq: z.number().int().min(1),
  prevHash: z.string().regex(/^[0-9a-f]{64}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  body: z.json(),
});

export type AuditVerification =
  { ok: true; count: number; lastHash: string; hashes: string[] } | { ok: false; where: string; reason: string };

/** Parses and verifies a JSON-lines audit export. Never throws on bad input. */
export function verifyAuditExport(
  text: string,
  options: { startPrevHash?: string; startSeq?: number } = {},
): AuditVerification {
  const records: ChainRecord[] = [];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  for (const [index, line] of lines.entries()) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return { ok: false, where: `line ${String(index + 1)}`, reason: 'not valid JSON' };
    }
    const parsed = recordSchema.safeParse(json);
    if (!parsed.success) return { ok: false, where: `line ${String(index + 1)}`, reason: 'not an audit record' };
    records.push(parsed.data);
  }
  if (records.length === 0) return { ok: false, where: 'file', reason: 'no records' };

  const result = verifyChain(records, options);
  if (!result.ok) return { ok: false, where: `seq ${String(result.seq)}`, reason: result.reason.replaceAll('_', ' ') };
  return { ok: true, count: result.count, lastHash: result.lastHash, hashes: records.map((record) => record.hash) };
}
