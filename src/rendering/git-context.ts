const CHANGE_SUMMARY_PATTERN = /^Changes:\s*(.+)\.\.\.(.+)$/u;
const FULL_SHA_PATTERN = /^[0-9a-f]{40,}$/iu;

export function formatPreviewGitSummaryLabel(label: string | null | undefined): string {
  if (!label) {
    return '';
  }

  const match = label.match(CHANGE_SUMMARY_PATTERN);
  if (!match) {
    return label;
  }

  return `Changes: ${formatPreviewGitRef(match[1])}...${formatPreviewGitRef(match[2])}`;
}

function formatPreviewGitRef(ref: string): string {
  return FULL_SHA_PATTERN.test(ref) ? ref.slice(0, 8) : ref;
}
