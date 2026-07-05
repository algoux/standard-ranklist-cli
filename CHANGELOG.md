# @algoux/standard-ranklist-cli

## 0.4.2

### Patch Changes

- fe8fe4e: Improve preview and render pages with contest banners, stable language controls, localized text rendering, and centered empty submission placeholders.

## 0.4.1

### Patch Changes

- a3245a2: Fix `srk preview --watch` refreshes for single-file previews.

## 0.4.0

### Minor Changes

- 514a603: Add `srk convert` for exporting SRK files to Excel, VJudge replay, and Codeforces Gym Ghost formats.

## 0.3.4

### Patch Changes

- ea7fef1: Move contest banner, user avatar, and user photo completeness rows to the end of the text diagnostics completeness section.

## 0.3.3

### Patch Changes

- a5cb32f: Add `srk render --static-data-root-url` for static directory previews that load JSON from an external URL root while preserving build-time SRK JSON validation.

## 0.3.2

### Patch Changes

- e3c15e1: Stream git blobs when rendering diff previews so large changed `.srk.json` files no longer hit child-process stdout buffer limits.

## 0.3.1

### Patch Changes

- 104e79a: Optimize preview/render page sidebar style

## 0.3.0

### Minor Changes

- 0734bb2: Add `srk validate` for schema-level SRK validation.

## 0.2.0

### Minor Changes

- 4f3ab53: Add preview and render commands

## 0.1.0

### Minor Changes

- 15507a8: Initial release of the standalone `srk` command-line interface.
