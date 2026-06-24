# Standard Ranklist CLI

Standalone command-line tools for Standard Ranklist JSON files.

## Install

```shell
npm i -g @algoux/standard-ranklist-cli
```

The CLI depends on the published `@algoux/standard-ranklist-utils@0.3.2` structured APIs.

## Usage

```shell
srk diagnose ranklist.json
srk diagnose --format json ranklist.json
srk diagnose --patch patch.json ranklist.json

srk patch ranklist.json patch.json
srk patch -o fixed.json ranklist.json patch.json
srk patch --in-place ranklist.json patch.json
```

## Development

```shell
pnpm install
pnpm test
pnpm run test:release
```

`pnpm run release:audit` checks the publish metadata, Changesets configuration, and trusted publishing workflow
guardrails before the release job publishes to npm.
