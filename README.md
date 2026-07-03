# Standard Ranklist CLI

[![npm version](https://img.shields.io/npm/v/@algoux/standard-ranklist-cli.svg)](https://www.npmjs.com/package/@algoux/standard-ranklist-cli)
[![npm downloads](https://img.shields.io/npm/dm/@algoux/standard-ranklist-cli.svg)](https://www.npmjs.com/package/@algoux/standard-ranklist-cli)

`srk` is a command-line tool for Standard Ranklist JSON files. It can validate ranklists, diagnose ranklists, apply patch files, convert ranklists, start a browser preview, and render static HTML output.

## Installation

```shell
npm i -g @algoux/standard-ranklist-cli
```

Node.js `>=22` is required.

## Global Commands

```shell
srk --help
srk --version
```

- `--help`: Show command help.
- `-v, --version`: Print the current CLI version.

## `srk validate`

Quickly check whether an SRK JSON file has legal schema fields and field types.

```shell
srk validate ranklist.srk.json
```

Arguments:

- `<srk.json>`: The SRK JSON file to validate.

Notes:

- The command validates JSON syntax, required fields, field types, enum values, tuple lengths, and schema formats.
- Unknown fields inside SRK objects are allowed.
- Validation failures print details and return a non-zero exit code.
- This command does not run semantic diagnostics such as first-blood conflicts or row-order checks.

## `srk diagnose`

Inspect an SRK JSON file and print a diagnostics report.

```shell
srk diagnose ranklist.srk.json
srk diagnose --format json ranklist.srk.json
srk diagnose --patch generated.patch.json ranklist.srk.json
```

Arguments and options:

- `<srk.json>`: The SRK JSON file to inspect.
- `-f, --format <format>`: Output format. Supported values are `text` and `json`. Defaults to `text`.
- `-p, --patch <patch.json>`: Write auto-fixable issues as an `srk-patch` JSON file.

Notes:

- Diagnostics findings do not make the command fail. Only argument, read/write, or JSON parse errors return a non-zero exit code.

## `srk patch`

Apply an `srk-patch` JSON file to an SRK JSON file.

```shell
srk patch ranklist.srk.json fix.patch.json > fixed.srk.json
srk patch -o fixed.srk.json ranklist.srk.json fix.patch.json
srk patch --in-place ranklist.srk.json fix.patch.json
```

Arguments and options:

- `<srk.json>`: The SRK JSON file to patch.
- `<patch.json>`: The `srk-patch` JSON file to apply.
- `-o, --output <fixed.json>`: Write the patched SRK JSON to a file.
- `--in-place`: Overwrite the input SRK JSON file.

Notes:

- Without `-o` or `--in-place`, the patched JSON is written to stdout.
- `--output` and `--in-place` cannot be used together.

## `srk convert`

Convert an SRK JSON file to another ranklist format.

```shell
srk convert excel ranklist.srk.json -o ranklist.xlsx
srk convert vjudge ranklist.srk.json -o replay.xlsx
srk convert gym ranklist.srk.json -o ghost.dat
```

Arguments and options:

- `<format>`: Output format. Supported values are `excel`, `vjudge`, and `gym`.
- `<srk.json>`: The SRK JSON file to convert.
- `-o, --output <output>`: Write the converted output to a file.

Formats:

- `excel`: General Excel workbook.
- `vjudge`: VJudge replay workbook.
- `gym`: Codeforces Gym Ghost DAT file.

Notes:

- The command validates JSON syntax and SRK schema shape before conversion.
- `excel` and `vjudge` outputs must use an `.xlsx` file path.
- This command does not run semantic diagnostics such as first-blood conflicts or row-order checks.

## `srk preview`

Start a local preview server and view one SRK file or an SRK directory in the browser.

```shell
srk preview ranklist.srk.json
srk preview ./ranklists
srk preview -w -p 3003 ./ranklists
srk preview --open --srk-asset-base https://cdn.algoux.cn/srk-storage ./ranklists
srk preview --git-diff-base main --git-diff-head HEAD ./ranklists
```

Arguments and options:

- `<path>`: The SRK JSON file or directory to preview.
- `-w, --watch`: Watch files and refresh the current ranklist and directory tree in the page.
- `-h, --host <host>`: Set the listen host. When omitted, preview listens on available local and LAN addresses.
- `-p, --port <port>`: Set the listen port. Defaults to `3003`.
- `--open`: Open the default browser after the server starts.
- `--srk-asset-base <url>`: Base URL for relative asset URLs. Defaults to `https://cdn.algoux.cn/srk-storage`.
- `--git-diff-base <ref>`: In directory mode, show only SRK files changed in the `<base>...<head>` range.
- `--git-diff-head <ref>`: Used with `--git-diff-base`. Defaults to `HEAD`.

Notes:

- File mode directly renders the selected SRK file.
- Directory mode shows a file tree on the left and only lists directories and `*.srk.json` files.
- Directory mode tries to show Git worktree status. If Git is unavailable, preview silently falls back to a plain tree.
- When the port is not explicitly specified and the default port is occupied, preview tries the next available port. If an explicitly specified port is occupied, preview exits with an error.

## `srk render`

Render an SRK file or directory as static HTML output.

```shell
srk render ranklist.srk.json > ranklist.html
srk render -o ranklist.html ranklist.srk.json
srk render -o ./review-site ./ranklists
srk render -o ./review-site --git-diff-base main --git-diff-head HEAD ./ranklists
srk render -o ./review-site --git-diff-base main --pr-url https://github.com/algoux/example/pull/123 ./ranklists
srk render -o ./review-site --git-diff-base main --git-diff-head HEAD --static-data-root-url https://raw.githubusercontent.com/algoux/example/HEAD/ranklists ./ranklists
```

Arguments and options:

- `<path>`: The SRK JSON file or directory to render.
- `-o, --output <path>`: Output path. For file input, this is the HTML file path. For directory input, this is the output directory.
- `--srk-asset-base <url>`: Base URL for relative asset URLs. Defaults to `https://cdn.algoux.cn/srk-storage`.
- `--git-diff-base <ref>`: In directory mode, render only SRK files changed in the `<base>...<head>` range.
- `--git-diff-head <ref>`: Used with `--git-diff-base`. Defaults to `HEAD`.
- `--pr-url <url>`: Generate a PR Review page. The sidebar shows a PR link, and the page title includes the PR number.
- `--static-data-root-url <url>`: For directory render output, load SRK JSON files from this URL root instead of writing them into `data/`. The rendered page appends the preview tree path to this URL. The CLI still validates the local or git-head SRK JSON before writing `index.html`.

Notes:

- File input produces a single HTML document. Without `-o`, the HTML is written to stdout.
- Directory input requires `-o <out-dir>` and generates `<out-dir>/index.html` plus `<out-dir>/data/`.
- Normal directory mode copies all `*.srk.json` files into `data/` while preserving their relative directory structure.
- Git diff directory mode writes changed SRK files from the target `head` commit into `data/<commit>/`. Deleted files appear in the tree but cannot be selected.
- With `--static-data-root-url`, directory output writes `index.html` without `data/`; serve the JSON files from the supplied URL root.
- `--pr-url` must be used with directory input and `--git-diff-base`.
- Directory render output should be served by a static file server. Opening it directly with `file://` may prevent some browsers from loading JSON files.

## Asset URL Rules

Rendered pages infer the ranklist id from the file name:

```text
icpc2020ecfinal.srk.json -> icpc2020ecfinal
```

Asset URL handling:

- URLs starting with `http:`, `https:`, or `data:` are preserved.
- Other relative URLs become `<assetBase>/<id>/<url>`.

## Development

```shell
pnpm install
pnpm run build

# Run CLI commands from source
pnpm exec tsx src/index.ts ...
```

## Build and Release

- `pnpm run build`: Compile TypeScript, build and inline the preview template, and generate publishable `dist/` output.
- `pnpm run build:template`: Build only the Svelte/Vite preview template.
- `pnpm test`: Build the template, run type checks, and run tests.
- `pnpm run test:release`: Full pre-release verification, including build, tests, and the packed consumer smoke test.
- `pnpm run release:audit`: Check publish metadata, Changesets configuration, and npm Trusted Publishing constraints.
