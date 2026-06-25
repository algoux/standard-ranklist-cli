import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const buildDir = new URL('../dist/.preview-template-build/', import.meta.url);
const assetsDir = new URL('assets/', buildDir);
const outputFile = new URL('../dist/templates/preview.html', import.meta.url);

let html = await readFile(new URL('index.html', buildDir), 'utf8');

html = await inlineStyles(html);
html = await inlineScripts(html);

await mkdir(new URL('.', outputFile), { recursive: true });
await writeFile(outputFile, html, 'utf8');
await rm(buildDir, { recursive: true, force: true });

async function inlineStyles(source) {
  return replaceAsync(
    source,
    /<link\s+rel="stylesheet"\s+href="\/?assets\/([^"]+)"\s*\/?>/gu,
    async (_tag, fileName) => {
      const css = await readFile(new URL(fileName, assetsDir), 'utf8');
      return `<style>${css}</style>`;
    },
  );
}

async function inlineScripts(source) {
  const scripts = [];
  const html = await replaceAsync(
    source,
    /<script\s+type="module"\s+crossorigin\s+src="\/?assets\/([^"]+)"><\/script>/gu,
    async (_tag, fileName) => {
      const js = await readFile(new URL(fileName, assetsDir), 'utf8');
      scripts.push(`<script>${js}</script>`);
      return '';
    },
  );

  const inlineScript = scripts.join('\n');
  if (!inlineScript) {
    return html;
  }

  return html.includes('</body>') ? html.replace('</body>', () => `${inlineScript}\n  </body>`) : `${html}\n${inlineScript}`;
}

async function replaceAsync(source, pattern, replacer) {
  const matches = [...source.matchAll(pattern)];
  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    result += source.slice(lastIndex, match.index);
    result += await replacer(...match);
    lastIndex = match.index + match[0].length;
  }

  result += source.slice(lastIndex);
  return result;
}
