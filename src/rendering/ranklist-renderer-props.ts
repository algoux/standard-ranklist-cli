export interface RanklistRendererProps {
  statusColorAsText?: true;
}

export function resolveRanklistRendererProps(ranklist: unknown): RanklistRendererProps {
  if (isScoreSorterRanklist(ranklist)) {
    return { statusColorAsText: true };
  }
  return {};
}

function isScoreSorterRanklist(ranklist: unknown): boolean {
  if (!isRecord(ranklist) || !isRecord(ranklist.sorter)) {
    return false;
  }
  return ranklist.sorter.algorithm === 'score';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
