# MapLab

MapLab is a standalone side-view platformer world authoring application, in
development. Version `0.1.0` is unreleased. Since ML-009 it opens a library folder
through the dev server: New map, Open, Save, Save As/Duplicate and Revert, with
torn-save recovery and browser drafts. There is no painting or viewport yet.

Use **Node 26.10.0** and **npm 12.1.0**:

```sh
npm start
```

`npm start` (`scripts/dev.mjs`) stops any MapLab dev server on its port, clears
`dist/` and the Vite cache, runs `npm ci` when `node_modules/` is older than the
lockfile, builds, starts Vite on `http://127.0.0.1:5182/` and opens the browser.
`MAPLAB_PORT` picks another port, `MAPLAB_NO_OPEN=1` skips the browser, and
`MAPLAB_LIBRARY` names the library folder. Without it MapLab uses
`~/Documents/MapLab/` when that folder holds `maplab.project.json`, else the
read-only `placeholder-library/` (the R1 forest example). Agents working in a
worktree use another port and a scratch copy of a library, never the owner's.

Saves go only to the dev server's loopback `/__maplab/` endpoints. They refuse
other hosts and origins, refuse a file that changed since it was opened, validate
the whole library, back up what they replace and write `maplab.project.json` last.
Unsaved edits are journaled to IndexedDB as drafts only.

```sh
npm ci
npm run check
npx playwright install chromium webkit
npm run test:browser
```

`npm run check` verifies foundation contracts, typechecks, runs tests, builds the
production shell, and inspects the built entry and assets. It is credential-free
and performs no network requests. `npm ci` downloads pinned dependencies unless
already cached; dependency lifecycle scripts are explicitly denied. Browser
binaries for the WebKit and Chromium tests come from `npx playwright install`,
never from npm. `npm run dev` starts a bare loopback-only Vite server, and
`npm run preview` previews the static build, which has no library server. Neither
command publishes or hosts a production service.

The [architecture](docs/ARCHITECTURE.md), [formats](docs/FORMATS.md), and
[physics conformance](docs/PHYSICS-CONFORMANCE.md) documents adopt the supplied
[planning specification](docs/specifications/2026-10-16-maplab.md). Their product
contracts describe future work. ML-003–007 added the bounded `src/contracts/` parser,
schemas and an independent reader, ML-008 the document model and history, and ML-009
the library folder; no renderer, tools, importer, physics, navigation, export or
engine integration is implemented yet.
The owner-approved [R1 revision](docs/specifications/2026-10-17-maplab-r1/README.md)
amends that specification (1/16 WU quantum, ±131,072 WU range, 60 Hz ticks).

See [the permanent current/future queue](implementation_plan.md),
[contribution rules](CONTRIBUTING.md), and [ML-001 evidence](docs/changes/ML-001.md).
Desired repository protections are committed in
[`config/github-repository-settings.json`](config/github-repository-settings.json).
They are **not evidence of live enforcement**. ML-002 adds the
[delivery gates](docs/DELIVERY-GATES.md), online `npm run security` and
authenticated `npm run policy:check`. MapLab is public, and ML-002 applied and read back
its required main/tag rulesets before its protected squash delivery.

Original code is MIT licensed. See [provenance](docs/PROVENANCE.md) for the separate
CC0 policy for owned numeric fixtures and the status of third-party dependencies.
