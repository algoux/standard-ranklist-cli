import { readFile } from 'node:fs/promises';
import type { PreviewGitContext, PreviewGitStatus } from '../git/status.js';

export interface PreviewTreeEntry {
  type: 'directory' | 'file';
  name: string;
  path: string;
  children?: PreviewTreeEntry[];
  gitStatus?: PreviewGitStatus;
  disabled?: boolean;
}

export interface PreviewRanklistPayload {
  ranklist: unknown | null;
  id: string | null;
  assetBase: string;
  selectedPath: string | null;
}

export interface PreviewPrContext {
  number: number;
  label: string;
  url: string;
}

export interface PreviewInitData extends PreviewRanklistPayload {
  mode: 'single' | 'directory';
  dataSource?: 'inline' | 'http' | 'static';
  dataRoot?: string | null;
  tree: { entries: PreviewTreeEntry[] } | null;
  watch: boolean;
  rootLabel: string | null;
  gitContext: PreviewGitContext | null;
  pageTitle?: string | null;
  prContext?: PreviewPrContext | null;
}

const INIT_PLACEHOLDER = '<!--SRK_PREVIEW_INIT-->';

export async function renderPreviewHtml(init: PreviewInitData): Promise<string> {
  const template = await readTemplate();
  const script = `<script>window.__SRK_PREVIEW_INIT__ = ${serializeForHtmlScript(init)};</script>`;
  if (!template.includes(INIT_PLACEHOLDER)) {
    throw new Error('Preview template is missing the init placeholder.');
  }
  return injectPageTitle(template.replace(INIT_PLACEHOLDER, script), init.pageTitle);
}

export function serializeForHtmlScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

async function readTemplate(): Promise<string> {
  return readFile(getPreviewTemplateUrl(), 'utf8');
}

function injectPageTitle(html: string, pageTitle: string | null | undefined): string {
  if (!pageTitle) {
    return html;
  }
  return html.replace(/<title>.*?<\/title>/isu, `<title>${escapeHtmlText(pageTitle)}</title>`);
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export function getPreviewTemplateUrl(baseUrl: string | URL = import.meta.url): URL {
  const url = typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl;
  return new URL('../../dist/templates/preview.html', url);
}
