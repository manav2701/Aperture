import { POSTURE_CATALOGUE, POSTURE_CATALOGUE_VERSION } from './catalogue';
import type {
  CheckResult,
  PostureCheck,
  PostureResult,
  PostureSeverity,
  PostureSnapshot,
  PostureSubject,
  PostureWaiver,
} from './types';

export const SEVERITY_WEIGHTS: Record<PostureSeverity, number> = { critical: 10, high: 5, medium: 2, low: 1 };

export function gradeFor(score: number): PostureResult['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/**
 * Evaluates every check against a snapshot (plan/phases/phase-11 §11.1–11.2). Waivers that
 * haven't expired excuse a whole check or single subjects; waived subjects stay listed. Score =
 * passed weight ÷ applicable weight, where `unknown` counts as failed and `not_applicable` is
 * left out. Deterministic: the same snapshot, waivers, and time always give the same result.
 */
export function evaluatePosture(
  snapshot: PostureSnapshot,
  options: { now: Date; waivers?: readonly PostureWaiver[]; catalogue?: readonly PostureCheck[] },
): PostureResult {
  const catalogue = options.catalogue ?? POSTURE_CATALOGUE;
  const active = (options.waivers ?? []).filter((w) => Date.parse(w.expiresAt) > options.now.getTime());
  let applicable = 0;
  let passed = 0;
  const results: CheckResult[] = catalogue.map((check) => {
    const outcome = check.evaluate(snapshot, options.now);
    const subjects = outcome.subjects ?? [];
    const waivers = active.filter((w) => w.checkId === check.id);
    let status: CheckResult['status'] = outcome.status;
    let remaining: PostureSubject[] = subjects;
    let waivedSubjects: PostureSubject[] = [];
    if (outcome.status === 'fail' && waivers.length > 0) {
      const wholeCheck = waivers.some((w) => w.subjectId === null);
      const waivedIds = new Set(waivers.flatMap((w) => (w.subjectId === null ? [] : [w.subjectId])));
      waivedSubjects = wholeCheck ? subjects : subjects.filter((s) => waivedIds.has(s.id));
      remaining = wholeCheck ? [] : subjects.filter((s) => !waivedIds.has(s.id));
      if (remaining.length === 0) status = 'waived';
    }
    const weight = SEVERITY_WEIGHTS[check.severity];
    if (status !== 'not_applicable') {
      applicable += weight;
      if (status === 'pass' || status === 'waived') passed += weight;
    }
    return {
      id: check.id,
      title: check.title,
      severity: check.severity,
      area: check.area,
      status,
      fixHref: check.fixHref,
      subjects: remaining,
      waivedSubjects,
      detail: outcome.detail ?? null,
    };
  });
  // Integer arithmetic, rounded down, so 99.9% never shows as 100.
  const score = applicable === 0 ? 100 : Math.floor((passed * 100) / applicable);
  return { catalogueVersion: POSTURE_CATALOGUE_VERSION, score, grade: gradeFor(score), results };
}

/** Failures in `current` that weren't failing in `previous` (for regression alerts, §11.2). */
export function newFailures(
  previous: readonly Pick<CheckResult, 'id' | 'status'>[] | undefined,
  current: readonly CheckResult[],
): CheckResult[] {
  const failedBefore = new Set((previous ?? []).filter((r) => r.status === 'fail').map((r) => r.id));
  return current.filter((r) => r.status === 'fail' && !failedBefore.has(r.id));
}

/** Keeps only the subjects a team lead may see; checks without visible subjects keep their status. */
export function resultsForTeam(results: readonly CheckResult[], teamId: string): CheckResult[] {
  const visible = (s: PostureSubject) => s.teamId === teamId;
  return results.map((r) => ({
    ...r,
    subjects: r.subjects.filter(visible),
    waivedSubjects: r.waivedSubjects.filter(visible),
  }));
}
