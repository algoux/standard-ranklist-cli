<script>
  import { onMount } from 'svelte';
  import { convertToStaticRanklist } from '@algoux/standard-ranklist-renderer-component-core';
  import {
    DefaultSolutionModal,
    DefaultUserModal,
    Ranklist,
  } from '@algoux/standard-ranklist-renderer-component-svelte';
  import { EnumTheme, resolveContributor } from '@algoux/standard-ranklist-utils';
  import { formatPreviewGitSummaryLabel } from '../rendering/git-context';
  import { resolveRanklistRendererProps } from '../rendering/ranklist-renderer-props';
  import { collectI18nLanguages, resolveOptionalText } from '../rendering/text';
  import { formatContestTime } from '../rendering/time';
  import TreeEntry from './TreeEntry.svelte';

  const autoLanguageValue = 'auto';

  export let initialData;

  let mode = initialData.mode;
  let tree = initialData.tree;
  let ranklist = initialData.ranklist;
  let id = initialData.id;
  let assetBase = initialData.assetBase;
  let selectedPath = initialData.selectedPath;
  let dataSource = initialData.dataSource || (mode === 'directory' ? 'http' : 'inline');
  let dataRoot = initialData.dataRoot || 'data';
  let rootLabel = initialData.rootLabel;
  let gitContext = initialData.gitContext;
  let pageTitle = initialData.pageTitle || 'SRK Preview';
  let prContext = initialData.prContext;
  let error = '';
  let activeUserClick = null;
  let activeSolutionClick = null;
  let selectedLanguage = autoLanguageValue;
  const watch = Boolean(initialData.watch);
  let preferredTheme = resolvePreferredTheme();

  $: staticRanklist = ranklist ? convertToStaticRanklist(ranklist) : null;
  $: ranklistRendererProps = resolveRanklistRendererProps(ranklist);
  $: availableLanguages = collectI18nLanguages(ranklist);
  $: if (selectedLanguage !== autoLanguageValue && !availableLanguages.includes(selectedLanguage)) {
    selectedLanguage = autoLanguageValue;
  }
  $: selectedLanguages = selectedLanguage === autoLanguageValue ? undefined : [selectedLanguage];
  $: contestTitle =
    resolveOptionalText(ranklist && ranklist.contest && ranklist.contest.title, selectedLanguages) || 'Untitled Contest';
  $: contestBanner = resolveContestBanner(ranklist && ranklist.contest && ranklist.contest.banner);
  $: contestTime = ranklist && ranklist.contest ? formatContestTime(ranklist.contest) : '';
  $: contributors = (ranklist && ranklist.contributors ? ranklist.contributors : [])
    .map((contributor) => resolveContributor(contributor))
    .filter(Boolean);
  $: refLinks = (ranklist && ranklist.contest && ranklist.contest.refLinks) || [];
  $: remarks = resolveOptionalText(ranklist && ranklist.remarks, selectedLanguages);
  $: gitSummaryLabel = formatPreviewGitSummaryLabel(gitContext && gitContext.summaryLabel);

  async function selectFile(path) {
    try {
      error = '';
      if (dataSource === 'static') {
        const response = await fetch(resolveStaticRanklistUrl(path));
        if (!response.ok) {
          throw new Error(await response.text());
        }
        applyStaticRanklist(path, await response.json());
        return;
      }

      const response = await fetch(`/api/ranklist?path=${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      applyRanklistPayload(await response.json());
    } catch (selectionError) {
      error = selectionError instanceof Error ? selectionError.message : String(selectionError);
    }
  }

  async function refreshTree() {
    if (mode !== 'directory' || dataSource !== 'http') {
      return;
    }
    const response = await fetch('/api/tree');
    if (response.ok) {
      tree = await response.json();
    }
  }

  async function refreshSelectedRanklist() {
    if (!selectedPath) {
      return;
    }
    await selectFile(selectedPath);
  }

  function applyRanklistPayload(payload) {
    ranklist = payload.ranklist;
    id = payload.id;
    assetBase = payload.assetBase;
    selectedPath = payload.selectedPath;
    activeUserClick = null;
    activeSolutionClick = null;
  }

  function applyStaticRanklist(path, staticRanklistData) {
    ranklist = staticRanklistData;
    id = inferRanklistIdFromPath(path);
    selectedPath = path;
    activeUserClick = null;
    activeSolutionClick = null;
  }

  function handleUserClick(event) {
    activeUserClick = event.detail;
    activeSolutionClick = null;
  }

  function handleSolutionClick(event) {
    activeSolutionClick = event.detail;
    activeUserClick = null;
  }

  function formatSrkAssetUrl(url) {
    if (/^(?:https?:|data:)/i.test(url)) {
      return url;
    }
    const normalizedBase = String(assetBase || '').replace(/\/+$/g, '');
    const normalizedUrl = String(url || '').replace(/^\/+/g, '');
    return `${normalizedBase}/${encodeURIComponent(id || 'ranklist')}/${normalizedUrl}`;
  }

  function resolveStaticRanklistUrl(path) {
    const encodedPath = encodeRelativeUrlPath(path);
    if (/^https?:\/\//i.test(dataRoot)) {
      return `${String(dataRoot).replace(/\/+$/g, '')}/${encodedPath}`;
    }
    return `${encodeRelativeUrlPath(dataRoot)}/${encodedPath}`;
  }

  function encodeRelativeUrlPath(path) {
    return String(path || '')
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  function inferRanklistIdFromPath(path) {
    const fileName = String(path || '').split('/').pop() || 'ranklist';
    if (fileName.endsWith('.srk.json')) {
      return fileName.slice(0, -'.srk.json'.length);
    }
    if (fileName.endsWith('.json')) {
      return fileName.slice(0, -'.json'.length);
    }
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  }

  function resolveRefLinkHref(link) {
    return link && (link.link || link.url || link.href || '');
  }

  function resolveRefLinkLabel(link) {
    return resolveOptionalText(link && link.title, selectedLanguages) || resolveRefLinkHref(link);
  }

  function resolveContestBanner(banner) {
    if (!banner) {
      return null;
    }
    if (typeof banner === 'string') {
      return { image: banner, link: null };
    }
    if (typeof banner === 'object' && typeof banner.image === 'string') {
      return {
        image: banner.image,
        link: typeof banner.link === 'string' ? banner.link : null,
      };
    }
    return null;
  }

  function resolvePreferredTheme() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return EnumTheme.light;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? EnumTheme.dark : EnumTheme.light;
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const updatePreferredTheme = () => {
      preferredTheme = themeQuery.matches ? EnumTheme.dark : EnumTheme.light;
    };
    if (typeof themeQuery.addEventListener === 'function') {
      themeQuery.addEventListener('change', updatePreferredTheme);
    } else if (typeof themeQuery.addListener === 'function') {
      themeQuery.addListener(updatePreferredTheme);
    }
  }

  if (typeof document !== 'undefined') {
    document.title = pageTitle;
  }

  onMount(() => {
    if (dataSource === 'static' && mode === 'directory' && selectedPath && !ranklist) {
      void selectFile(selectedPath);
    }
  });

  if (watch && dataSource === 'http' && typeof EventSource !== 'undefined') {
    const events = new EventSource('/api/events');
    events.addEventListener('tree-changed', () => {
      void refreshTree();
    });
    events.addEventListener('ranklist-changed', () => {
      void refreshSelectedRanklist();
    });
  }
</script>

<div
  class:theme-dark={preferredTheme === EnumTheme.dark}
  class:theme-light={preferredTheme === EnumTheme.light}
  class:with-sidebar={mode === 'directory'}
  class="preview-app"
>
  {#if mode === 'directory'}
    <aside class="file-tree" aria-label="SRK files">
      <div class="file-tree-header">
        <div class="file-tree-title-row">
          <h2>SRK EXPLORER</h2>
          {#if watch}
            <span>watching</span>
          {/if}
        </div>
        {#if rootLabel}
          <p class="file-tree-root-path" title={rootLabel}>{rootLabel}</p>
        {/if}
        {#if gitSummaryLabel || prContext}
          <div class="file-tree-git-row">
            {#if gitSummaryLabel}
              <p class="file-tree-git-context" title={gitContext && gitContext.summaryLabel}>{gitSummaryLabel}</p>
            {/if}
            {#if prContext}
              <a class="file-tree-pr-context" href={prContext.url} target="_blank" rel="noreferrer">{prContext.label}</a>
            {/if}
          </div>
        {/if}
      </div>
      <div class="file-tree-scroll">
        {#if tree && tree.entries.length}
          <ul class="tree-root">
            {#each tree.entries as entry (entry.path)}
              <TreeEntry {entry} {selectedPath} onSelect={selectFile} />
            {/each}
          </ul>
        {:else}
          <p class="empty-tree">No *.srk.json files found.</p>
        {/if}
      </div>
    </aside>
  {/if}

  <main class="ranklist-pane">
    {#if error}
      <div class="error-banner">{error}</div>
    {/if}

    {#if ranklist && staticRanklist}
      <header class="ranklist-header">
        <div class="ranklist-heading">
          <div class="ranklist-title-row">
            <p class="ranklist-kicker">{selectedPath || id || 'ranklist'}</p>
            <label
              class="language-switcher"
              class:is-hidden={!availableLanguages.length}
              aria-label="Preview language"
              aria-hidden={!availableLanguages.length}
            >
              <select bind:value={selectedLanguage} disabled={!availableLanguages.length}>
                <option value="auto">语言：自动</option>
                {#each availableLanguages as language}
                  <option value={language}>{language}</option>
                {/each}
              </select>
            </label>
          </div>
          {#if contestBanner}
            <div class="contest-banner">
              {#if contestBanner.link}
                <a href={contestBanner.link} target="_blank" rel="noreferrer">
                  <img
                    class="contest-banner-image"
                    src={formatSrkAssetUrl(contestBanner.image)}
                    alt={contestTitle}
                  />
                </a>
              {:else}
                <img class="contest-banner-image" src={formatSrkAssetUrl(contestBanner.image)} alt={contestTitle} />
              {/if}
            </div>
          {/if}
          <h1>{contestTitle}</h1>
          {#if contestTime}
            <p class="contest-time">{contestTime}</p>
          {/if}
        </div>

        <div class="ranklist-meta">
          {#if contributors.length}
            <p>
              <span>CONTRIBUTORS:</span>{' '}
              {#each contributors as contributor, index}
                {#if index > 0}, {/if}
                {#if contributor.url}
                  <a href={contributor.url} target="_blank" rel="noreferrer">{contributor.name}</a>
                {:else}
                  {contributor.name}
                {/if}
              {/each}
            </p>
          {/if}

          {#if refLinks.length}
            <p>
              <span>LINKS:</span>{' '}
              {#each refLinks as link, index}
                {#if index > 0}, {/if}
                {#if resolveRefLinkHref(link)}
                  <a href={resolveRefLinkHref(link)} target="_blank" rel="noreferrer">{resolveRefLinkLabel(link)}</a>
                {:else}
                  {resolveRefLinkLabel(link)}
                {/if}
              {/each}
            </p>
          {/if}

          {#if remarks}
            <p><span>REMARKS:</span> {remarks}</p>
          {/if}
        </div>
      </header>

      <div class="ranklist-shell">
        <section class="ranklist-table" aria-label="Ranklist table">
          <Ranklist
            data={staticRanklist}
            theme={preferredTheme}
            rowStriped
            showDirtColumn
            showSEColumn
            showProblemStatisticsFooter
            emptyStatusPlaceholder="·"
            languages={selectedLanguages}
            {formatSrkAssetUrl}
            {...ranklistRendererProps}
            on:solutionClick={handleSolutionClick}
            on:userClick={handleUserClick}
          />
        </section>
      </div>

      <DefaultUserModal
        open={!!activeUserClick}
        user={activeUserClick && activeUserClick.user}
        markers={staticRanklist.markers}
        theme={preferredTheme}
        languages={selectedLanguages}
        {formatSrkAssetUrl}
        on:close={() => (activeUserClick = null)}
      />
      <DefaultSolutionModal
        open={!!activeSolutionClick}
        user={activeSolutionClick && activeSolutionClick.user}
        problem={activeSolutionClick && activeSolutionClick.problem}
        problemIndex={(activeSolutionClick && activeSolutionClick.problemIndex) || 0}
        solutions={(activeSolutionClick && activeSolutionClick.solutions) || []}
        languages={selectedLanguages}
        on:close={() => (activeSolutionClick = null)}
      />
    {:else}
      <div class="empty-ranklist">
        <h1>No ranklist selected</h1>
        <p>Select a *.srk.json file from the tree.</p>
      </div>
    {/if}
  </main>
</div>

<style>
  :global(html) {
    font-size: 14px;
    min-width: 1280px;
  }

  :global(body) {
    margin: 0;
    color: #333;
    background: #fff;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif,
      "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      color: rgb(223, 223, 223);
      background: rgb(0, 0, 0);
    }
  }

  :global(*) {
    box-sizing: border-box;
  }

  .preview-app {
    --page-bg: #fff;
    --panel-bg: #fff;
    --panel-border: rgba(127, 127, 127, 0.28);
    --text: #333;
    --heading: #222;
    --muted: #666;
    --subtle: #444;
    --link: #174ea6;
    --link-hover: #0f3f87;
    --tree-hover: rgba(127, 127, 127, 0.08);
    --tree-selected-bg: #dbeafe;
    --tree-selected-text: #174ea6;
    --git-green: #22863a;
    --git-blue: #0969da;
    --git-red: #cf222e;
    --git-badge-bg: rgba(127, 127, 127, 0.1);
    --watching: #246b50;
    --error-border: #f4b4b4;
    --error-bg: #fff1f1;
    --error-text: #981b1b;
    min-height: 100vh;
    color: var(--text);
    background: var(--page-bg);
  }

  .theme-light {
    color-scheme: light;
  }

  .theme-dark {
    color-scheme: dark;
    --page-bg: rgb(0, 0, 0);
    --panel-bg: rgb(0, 0, 0);
    --panel-border: rgba(127, 127, 127, 0.42);
    --text: rgb(223, 223, 223);
    --heading: rgb(240, 240, 240);
    --muted: rgb(178, 178, 178);
    --subtle: rgb(210, 210, 210);
    --link: #8ab4ff;
    --link-hover: #bdd4ff;
    --tree-hover: rgba(255, 255, 255, 0.08);
    --tree-selected-bg: #1f3b63;
    --tree-selected-text: #dbeafe;
    --git-green: #7ee787;
    --git-blue: #79c0ff;
    --git-red: #ff7b72;
    --git-badge-bg: rgba(255, 255, 255, 0.12);
    --watching: #8bd7b1;
    --error-border: #7f1d1d;
    --error-bg: #3f1717;
    --error-text: #fecaca;
  }

  .with-sidebar {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
  }

  .file-tree {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    border-right: 1px solid var(--panel-border);
    background: var(--panel-bg);
  }

  .file-tree-header {
    flex: 0 0 auto;
    border-bottom: 1px solid var(--panel-border);
    padding: 18px 14px 12px;
  }

  .file-tree-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .file-tree-title-row h2 {
    margin: 0;
    font-size: 14px;
    line-height: 1.2;
  }

  .file-tree-title-row span {
    color: var(--watching);
    font-size: 12px;
  }

  .file-tree-root-path {
    margin: 7px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-tree-git-row {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 7px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .file-tree-git-context {
    min-width: 0;
    flex: 1 1 auto;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-tree-pr-context {
    flex: 0 0 auto;
    color: var(--link);
    text-decoration: none;
    white-space: nowrap;
  }

  .file-tree-pr-context:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }

  .file-tree-scroll {
    min-height: 0;
    flex: 1 1 auto;
    overflow: auto;
    padding: 12px 14px 18px;
  }

  .tree-root,
  :global(.tree-children) {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  :global(.tree-children) {
    padding-left: 14px;
  }

  :global(.tree-entry button) {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 7px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    padding: 6px 7px;
    font: inherit;
    font-size: 13px;
    line-height: 1.25;
    text-align: left;
    cursor: pointer;
  }

  :global(.tree-entry button:hover) {
    background: var(--tree-hover);
  }

  :global(.tree-entry button.selected) {
    background: var(--tree-selected-bg);
    color: var(--tree-selected-text);
  }

  :global(.tree-entry button.tree-disabled) {
    cursor: default;
    opacity: 0.62;
  }

  :global(.tree-entry button.tree-disabled:hover) {
    background: transparent;
  }

  :global(.tree-entry button.git-green),
  :global(.tree-entry button.git-green .tree-icon),
  :global(.tree-entry button.git-green .tree-status) {
    color: var(--git-green);
  }

  :global(.tree-entry button.git-blue),
  :global(.tree-entry button.git-blue .tree-icon),
  :global(.tree-entry button.git-blue .tree-status) {
    color: var(--git-blue);
  }

  :global(.tree-entry button.git-red),
  :global(.tree-entry button.git-red .tree-icon),
  :global(.tree-entry button.git-red .tree-status) {
    color: var(--git-red);
  }

  :global(.tree-icon) {
    display: inline-flex;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }

  :global(.tree-svg) {
    display: block;
    width: 16px;
    height: 16px;
  }

  :global(.tree-chevron) {
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  :global(.tree-chevron.expanded) {
    transform: rotate(90deg);
  }

  :global(.tree-name) {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.tree-status) {
    display: inline-flex;
    width: 20px;
    flex: 0 0 20px;
    justify-content: center;
    border-radius: 4px;
    background: var(--git-badge-bg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
  }

  .ranklist-pane {
    min-width: 0;
    padding: 26px;
  }

  .with-sidebar .ranklist-pane {
    padding-right: 0;
    padding-left: 0;
  }

  .with-sidebar .ranklist-header {
    padding-right: 26px;
    padding-left: 26px;
  }

  .with-sidebar .error-banner,
  .with-sidebar .empty-ranklist {
    margin-right: 26px;
    margin-left: 26px;
  }

  .ranklist-header {
    display: grid;
    gap: 10px;
    justify-items: center;
    width: 100%;
    margin: 0 0 22px;
    text-align: center;
  }

  .ranklist-heading {
    display: grid;
    gap: 8px;
    justify-items: center;
    width: 100%;
    max-width: 100%;
  }

  .ranklist-title-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    column-gap: 12px;
    width: 100%;
  }

  .ranklist-title-row .ranklist-kicker {
    grid-column: 2;
    justify-self: center;
  }

  .ranklist-kicker,
  .contest-time {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .contest-banner {
    display: flex;
    justify-content: center;
    width: 100%;
    max-width: 100%;
  }

  .contest-banner a {
    display: flex;
    width: 100%;
    max-width: 100%;
  }

  .contest-banner-image {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }

  .ranklist-header h1 {
    margin: 0;
    color: var(--heading);
    font-size: 28px;
    font-weight: 720;
    line-height: 1.18;
    overflow-wrap: anywhere;
  }

  .ranklist-meta {
    display: grid;
    gap: 4px;
    color: var(--subtle);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
  }

  .ranklist-meta p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .ranklist-meta span {
    color: var(--heading);
    font-weight: 700;
  }

  .ranklist-meta a {
    color: var(--link);
    text-decoration: none;
  }

  .ranklist-meta a:hover {
    color: var(--link-hover);
    text-decoration: underline;
  }

  .ranklist-shell {
    display: block;
    width: max-content;
    min-width: 100%;
  }

  .language-switcher {
    display: block;
    grid-column: 3;
    justify-self: end;
  }

  .language-switcher.is-hidden {
    visibility: hidden;
  }

  .language-switcher select {
    max-width: 180px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    background: var(--panel-bg);
    color: var(--text);
    padding: 6px 28px 6px 10px;
    font: inherit;
    font-size: 13px;
    line-height: 1.2;
  }

  .ranklist-table {
    display: block;
    width: 100%;
    overflow: visible;
  }

  .error-banner {
    margin-bottom: 16px;
    border: 1px solid var(--error-border);
    border-radius: 8px;
    background: var(--error-bg);
    color: var(--error-text);
    padding: 10px 12px;
    font-size: 13px;
  }

  .empty-tree,
  .empty-ranklist {
    color: var(--muted);
  }

  .empty-ranklist {
    padding: 28px;
  }

  .empty-ranklist h1 {
    margin: 0 0 8px;
    color: var(--heading);
    font-size: 22px;
  }

</style>
