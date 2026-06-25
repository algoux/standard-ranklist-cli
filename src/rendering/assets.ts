import { basename, parse } from 'node:path';

export const DEFAULT_SRK_ASSET_BASE = 'https://cdn.algoux.cn/srk-storage';

const ABSOLUTE_ASSET_URL_PATTERN = /^(?:https?:|data:)/iu;

export function inferRanklistId(path: string): string {
  const fileName = basename(path);
  if (fileName.endsWith('.srk.json')) {
    return fileName.slice(0, -'.srk.json'.length);
  }
  if (fileName.endsWith('.json')) {
    return fileName.slice(0, -'.json'.length);
  }
  return parse(fileName).name || fileName;
}

export function formatSrkAssetUrl(url: string, ranklistId: string, assetBase: string): string {
  if (ABSOLUTE_ASSET_URL_PATTERN.test(url)) {
    return url;
  }

  const normalizedBase = assetBase.replace(/\/+$/u, '');
  const normalizedUrl = url.replace(/^\/+/u, '');
  return `${normalizedBase}/${encodeURIComponent(ranklistId)}/${normalizedUrl}`;
}
