export interface PreviewTreeNameLike {
  type: string;
  name: string;
}

export function formatPreviewTreeEntryName(entry: PreviewTreeNameLike): string {
  if (entry.type !== 'file') {
    return entry.name;
  }
  return entry.name.replace(/\.srk\.json$/i, '');
}
