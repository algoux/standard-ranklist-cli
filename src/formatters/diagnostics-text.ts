import type {
  DiagnosticSeverity,
  RanklistDiagnosticCheck,
  RanklistDiagnosticCompletenessItem,
  RanklistDiagnosticIssue,
  RanklistDiagnostics,
  RanklistFirstBloodSuggestion,
  RanklistProblemStatisticsSuggestion,
  RanklistSorterSuggestion,
} from '@algoux/standard-ranklist-utils';

interface TextFormatOptions {
  color?: boolean | 'auto';
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

type CategoryColor = 'green' | 'yellow' | 'red';

const trailingCompletenessItemKeys = ['banner', 'userAvatar', 'userPhoto'];

export function formatDiagnosticsText(
  diagnostics: RanklistDiagnostics,
  filePath: string,
  options: TextFormatOptions = {},
): string {
  const lines: string[] = [];
  const issueCounts = countIssuesBySeverity(diagnostics.issues);
  const useColor = shouldUseColor(options);

  lines.push('SRK Diagnostics');
  lines.push(`File: ${filePath}`);
  lines.push(
    `Issues: ${diagnostics.issues.length} (error ${issueCounts.error}, warning ${issueCounts.warning}, info ${issueCounts.info})`,
  );
  lines.push('');

  lines.push('Precision');
  lines.push(`  solutionTime: ${formatPrecision(diagnostics.summary.precision.solutionTime)}`);
  lines.push(`  statusTime:   ${formatPrecision(diagnostics.summary.precision.statusTime)}`);
  lines.push(`  scoreTime:    ${formatPrecision(diagnostics.summary.precision.scoreTime)}`);
  lines.push('');

  lines.push('Completeness');
  const completenessItems = getCompletenessItemsForText(diagnostics);
  const completenessCategoryWidth = getMaxCategoryWidth(completenessItems, (item) => item.level);
  for (const item of completenessItems) {
    const category = formatCategory(item.level, completenessCategoryWidth, completenessItemColor(item), useColor);
    lines.push(`  ${category}${item.label}: ${formatCoverage(item)}`);
  }
  lines.push('');

  lines.push('Correctness');
  const correctnessChecks = Object.values(diagnostics.correctness.checks);
  const correctnessCategoryWidth = getMaxCategoryWidth(correctnessChecks, (check) => check.status);
  for (const check of correctnessChecks) {
    const category = formatCategory(check.status, correctnessCategoryWidth, checkStatusColor(check.status), useColor);
    lines.push(`  ${category}${check.label}: ${formatCheck(check)}`);
  }

  const suggestionLines = formatSuggestions(diagnostics);
  if (suggestionLines.length) {
    lines.push('');
    lines.push('Suggestions');
    lines.push(...suggestionLines.map((line) => `  ${line}`));
  }

  if (diagnostics.issues.length) {
    lines.push('');
    lines.push('Issues');
    const issueCategoryWidth = getMaxCategoryWidth(diagnostics.issues, issueCategory);
    for (const issue of diagnostics.issues) {
      const issueLines = formatIssue(issue, issueCategoryWidth, useColor).split('\n');
      lines.push(`  ${issueLines[0]}`);
      lines.push(...issueLines.slice(1).map((line) => `  ${line}`));
    }
  }

  lines.push('');
  return lines.join('\n');
}

function getCompletenessItemsForText(diagnostics: RanklistDiagnostics): RanklistDiagnosticCompletenessItem[] {
  const items = Object.values(diagnostics.completeness.items);
  const trailingKeys = new Set(trailingCompletenessItemKeys);
  const regularItems = items.filter((item) => !trailingKeys.has(item.key));
  const trailingItems = trailingCompletenessItemKeys
    .map((key) => items.find((item) => item.key === key))
    .filter((item): item is RanklistDiagnosticCompletenessItem => Boolean(item));
  return [...regularItems, ...trailingItems];
}

function getMaxCategoryWidth<T>(items: T[], getCategory: (item: T) => string): number {
  return items.reduce((width, item) => {
    return Math.max(width, bracketCategory(getDisplayCategory(getCategory(item))).length);
  }, 0);
}

function bracketCategory(category: string): string {
  return `[${category}]`;
}

function formatCategory(category: string, width: number, color: CategoryColor | null, useColor: boolean): string {
  const bracketed = bracketCategory(getDisplayCategory(category));
  const padding = ' '.repeat(Math.max(width - bracketed.length + 1, 1));
  return `${colorText(bracketed, color, useColor)}${padding}`;
}

function getDisplayCategory(category: string): string {
  if (category === 'notApplicable') {
    return 'n/a';
  }
  return category === 'warning' ? 'warn' : category;
}

function completenessItemColor(item: RanklistDiagnosticCompletenessItem): CategoryColor | null {
  if (item.level === 'missing' && item.details.optional === true) {
    return null;
  }
  return completenessLevelColor(item.level);
}

function completenessLevelColor(level: RanklistDiagnosticCompletenessItem['level']): CategoryColor {
  switch (level) {
    case 'missing':
      return 'red';
    case 'partial':
    case 'mostly':
      return 'yellow';
    case 'complete':
    case 'notApplicable':
      return 'green';
  }
}

function checkStatusColor(status: RanklistDiagnosticCheck['status']): CategoryColor {
  switch (status) {
    case 'fail':
      return 'red';
    case 'warning':
      return 'yellow';
    case 'pass':
    case 'notApplicable':
      return 'green';
  }
}

function issueSeverityColor(severity: DiagnosticSeverity): CategoryColor {
  switch (severity) {
    case 'error':
      return 'red';
    case 'warning':
      return 'yellow';
    case 'info':
      return 'green';
  }
}

function colorText(text: string, color: CategoryColor | null, useColor: boolean): string {
  if (!useColor || color === null) {
    return text;
  }
  const code = color === 'green' ? 32 : color === 'yellow' ? 33 : 31;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function shouldUseColor(options: TextFormatOptions): boolean {
  if (options.color === true) {
    return true;
  }
  if (options.color === false) {
    return false;
  }

  const env = options.env || process.env;
  if (env.FORCE_COLOR === '0') {
    return false;
  }
  if (env.FORCE_COLOR) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) {
    return false;
  }
  if (env.TERM === 'dumb') {
    return false;
  }
  return typeof options.isTTY === 'boolean' ? options.isTTY : Boolean(process.stdout.isTTY);
}

function formatPrecision(precision: RanklistDiagnostics['summary']['precision']['solutionTime']): string {
  const actual = precision.actualUnit || 'none';
  const declared = precision.declaredUnits.length ? precision.declaredUnits.join(',') : 'none';
  return `${actual} (samples ${precision.sampleCount}, zero ${precision.zeroCount}, invalid ${precision.invalidCount}, declared ${declared})`;
}

function formatCoverage(item: RanklistDiagnosticCompletenessItem): string {
  if (item.totalCount <= 0 || item.ratio === null) {
    return 'n/a';
  }
  return `${item.presentCount}/${item.totalCount} (${formatPercent(item.ratio)})`;
}

function formatCheck(check: RanklistDiagnosticCheck): string {
  if (check.checkedCount <= 0) {
    return check.failedCount > 0 ? `${check.failedCount} issue(s)` : 'n/a';
  }
  return `${check.failedCount}/${check.checkedCount} failed`;
}

function formatSuggestions(diagnostics: RanklistDiagnostics): string[] {
  const lines: string[] = [];
  if (diagnostics.suggestions.firstBlood.length) {
    lines.push('firstBlood:');
    for (const suggestion of diagnostics.suggestions.firstBlood) {
      lines.push(`  - ${formatFirstBloodSuggestion(suggestion)}`);
    }
  }
  if (diagnostics.suggestions.sorter.length) {
    lines.push('sorter:');
    for (const suggestion of diagnostics.suggestions.sorter) {
      lines.push(`  - ${formatSorterSuggestion(suggestion)}`);
    }
  }
  if (diagnostics.suggestions.problemStatistics.length) {
    lines.push('problemStatistics:');
    for (const suggestion of diagnostics.suggestions.problemStatistics) {
      lines.push(`  - ${formatProblemStatisticsSuggestion(suggestion)}`);
    }
  }
  return lines;
}

function formatFirstBloodSuggestion(suggestion: RanklistFirstBloodSuggestion): string {
  const alias = suggestion.problemAlias || `#${suggestion.problemIndex}`;
  return `${alias}: user ${suggestion.userId}, row ${suggestion.rowIndex}, time ${JSON.stringify(suggestion.time)}`;
}

function formatSorterSuggestion(suggestion: RanklistSorterSuggestion): string {
  const resolved = suggestion.resolvedIssues.length ? ` resolves ${suggestion.resolvedIssues.join(',')}` : '';
  return `${JSON.stringify(suggestion.config)} (${suggestion.confidence})${resolved}`;
}

function formatProblemStatisticsSuggestion(suggestion: RanklistProblemStatisticsSuggestion): string {
  const alias = suggestion.problemAlias || `#${suggestion.problemIndex}`;
  return `${alias}: ${JSON.stringify(suggestion.actual)} -> ${JSON.stringify(suggestion.expected)} (${suggestion.confidence})`;
}

function formatIssue(issue: RanklistDiagnosticIssue, categoryWidth: number, useColor: boolean): string {
  const refs = [
    issue.path ? `path=${issue.path}` : null,
    typeof issue.rowIndex === 'number' ? `row=${issue.rowIndex}` : null,
    typeof issue.problemIndex === 'number' ? `problem=${issue.problemIndex}` : null,
    issue.userId ? `user=${issue.userId}` : null,
    issue.item ? `item=${issue.item}` : null,
  ].filter(Boolean);
  const category = formatCategory(issueCategory(issue), categoryWidth, issueSeverityColor(issue.severity), useColor);
  const summary = `${category}${issue.code}: ${issue.message}${refs.length ? ` (${refs.join(', ')})` : ''}`;
  const mismatchLines = formatMismatchIssueDetails(issue);
  return mismatchLines.length ? `${summary}\n${mismatchLines.join('\n')}` : summary;
}

function issueCategory(issue: RanklistDiagnosticIssue): string {
  const severity = issue.severity === 'warning' ? 'warn' : issue.severity;
  return `${severity}/${issue.confidence}`;
}

function formatMismatchIssueDetails(issue: RanklistDiagnosticIssue): string[] {
  if (!issue.code.includes('MISMATCH') || !issue.details) {
    return [];
  }
  const actual = pickDetailValue(issue.details, ['current', 'actual', 'declared']);
  const expected = pickDetailValue(issue.details, ['expected', 'expect']);
  const lines: string[] = [];
  if (actual.found) {
    lines.push(`    actual: ${formatDetailValue(withBriefSolutionsForMismatch(issue, actual.value))}`);
  }
  if (expected.found) {
    lines.push(`    expect: ${formatDetailValue(withBriefSolutionsForMismatch(issue, expected.value))}`);
  }
  return lines;
}

function withBriefSolutionsForMismatch(issue: RanklistDiagnosticIssue, value: unknown): unknown {
  const solutions = issue.details?.solutions;
  if (issue.code !== 'STATUS_SUMMARY_MISMATCH' || !Array.isArray(solutions) || !isPlainObject(value)) {
    return value;
  }
  return {
    ...value,
    solutions,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickDetailValue(details: Record<string, unknown>, keys: string[]): { found: boolean; value: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(details, key)) {
      return { found: true, value: details[key] };
    }
  }
  return { found: false, value: undefined };
}

function formatDetailValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value);
}

function countIssuesBySeverity(issues: RanklistDiagnosticIssue[]): Record<DiagnosticSeverity, number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity]++;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
