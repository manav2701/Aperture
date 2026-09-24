import { readFileSync } from 'node:fs';
import { evaluatePolicy, parseUsd } from '@aperture/core';
import { GENESIS_HASH, chainHash, type JsonValue } from '@aperture/crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseLimit, scenarioSchema } from './scenario';
import { verifyAuditExport } from './verify';

function exportOf(bodies: JsonValue[]): string {
  let prevHash = GENESIS_HASH;
  return bodies
    .map((body, index) => {
      const hash = chainHash(prevHash, body);
      const line = JSON.stringify({ seq: index + 1, prevHash, hash, body });
      prevHash = hash;
      return line;
    })
    .join('\n');
}

describe('verifyAuditExport', () => {
  const file = exportOf([{ action: 'a' }, { action: 'b' }, { action: 'c' }]);

  it('accepts an intact export', () => {
    expect(verifyAuditExport(file)).toMatchObject({ ok: true, count: 3 });
  });

  it('pinpoints the first edited event', () => {
    const edited = file.replace('"action":"b"', '"action":"B"');
    expect(verifyAuditExport(edited)).toEqual({ ok: false, where: 'seq 2', reason: 'hash mismatch' });
  });

  it('detects deleted lines', () => {
    const lines = file.split('\n');
    expect(verifyAuditExport([lines[0], lines[2]].join('\n'))).toMatchObject({ ok: false, where: 'seq 3' });
  });

  it('fuzz: never throws and never reports an arbitrary file as valid', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(verifyAuditExport(text).ok).toBe(false);
      }),
      { numRuns: 1_000 },
    );
  });

  it('fuzz: any single-character change to a valid export is detected or rejected', () => {
    fc.assert(
      fc.property(fc.nat(), fc.string({ minLength: 1, maxLength: 1 }), (position, replacement) => {
        const index = position % file.length;
        fc.pre(file[index] !== replacement && file[index] !== '\n' && replacement !== '\n');
        const mutated = file.slice(0, index) + replacement + file.slice(index + 1);
        const result = verifyAuditExport(mutated);
        // A change inside JSON whitespace-insensitive positions can't exist here (compact JSON),
        // so every mutation must be caught.
        expect(result.ok).toBe(false);
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('scenario files', () => {
  it('the bundled example is valid', () => {
    const text = readFileSync(new URL('../scenarios/two-teams.yaml', import.meta.url), 'utf8');
    const result = scenarioSchema.safeParse(parseYaml(text));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('keeps policies in stored form so the engine can validate them (regression)', () => {
    const text = readFileSync(new URL('../scenarios/two-teams.yaml', import.meta.url), 'utf8');
    const scenario = scenarioSchema.parse(parseYaml(text));
    const decision = evaluatePolicy({
      action: { rail: 'gateway', amount: parseUsd('1'), provider: 'openrouter', model: 'openai/gpt-4o-mini' },
      at: new Date(),
      timeZone: 'Asia/Dubai',
      layers: [
        {
          level: 'principal',
          scopeId: 'research-bot',
          version: 1,
          document: scenario.policies.principals['research-bot'],
        },
      ],
    });
    expect(decision.outcome).toBe('allow');
  });

  it('reports unknown references', () => {
    const result = scenarioSchema.safeParse({
      org: { name: 'x' },
      principals: [{ id: 'a', kind: 'agent', name: 'a' }],
      budgets: [
        { id: 'b', parent: 'missing', name: 'b', scope: 'principal', principal: 'ghost', period: 'day', limit: '1' },
      ],
      steps: [{ title: 't', spend: { principal: 'nobody', amount: '1' } }],
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages).toEqual([
      'unknown budget "missing"',
      'principal budgets need a known principal',
      'unknown principal "nobody"',
    ]);
  });

  it('parses money limits as USD and count limits as whole numbers', () => {
    expect(parseLimit({ unit: 'micros' }, '2.5')).toBe(2_500_000n);
    expect(parseLimit({ unit: 'count' }, '3')).toBe(3n);
    expect(() => parseLimit({ unit: 'count' }, '2.5')).toThrow();
  });
});
