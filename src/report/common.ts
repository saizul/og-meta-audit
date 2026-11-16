import { atLeast } from '../rules/index.js';
import type { AuditReport, Finding, Severity } from '../types.js';

export interface ReportOptions {
  /** Hide findings below this severity. Default `info` (show everything). */
  minSeverity?: Severity;
}

export function visible(findings: Finding[], min: Severity = 'info'): Finding[] {
  return findings.filter((f) => atLeast(f.severity, min));
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function headline(report: AuditReport): string {
  const s = report.summary;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(s.pages, 'page')}, ${plural(s.errors, 'error')}, ${plural(s.warnings, 'warning')}, ${s.infos} info`;
}
