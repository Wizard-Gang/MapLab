# MapLab

MapLab is a planned standalone world authoring application. Version `0.1.0` is
unreleased. The product implementation is a static React page
showing the name and planning-stage status, plus governed tooling and documentation.

Use **Node 26.10.0** and **npm 12.1.0**:

```sh
npm ci
npm run check
npm run dev
```

`npm run check` verifies foundation contracts, typechecks, runs tests, builds the
production shell, and inspects the built entry and assets. It is credential-free
and performs no network requests. `npm ci` downloads pinned dependencies unless
already cached; dependency lifecycle scripts are explicitly denied. `npm run dev`
starts a loopback-only Vite development server. `npm run preview` previews the
local build. Neither command publishes or hosts a production service.

The [architecture](docs/ARCHITECTURE.md), [formats](docs/FORMATS.md), and
[physics conformance](docs/PHYSICS-CONFORMANCE.md) documents adopt the supplied
[planning specification](docs/specifications/2026-10-16-maplab.md). Their product
contracts describe future work; no map schema, editor, importer, physics,
navigation, persistence, or engine integration is implemented.

See [the permanent current/future queue](implementation_plan.md),
[contribution rules](CONTRIBUTING.md), and [ML-001 evidence](docs/changes/ML-001.md).
Desired repository protections are committed in
[`config/github-repository-settings.json`](config/github-repository-settings.json).
They are **not evidence of live enforcement**. ML-002 adds the
[delivery gates](docs/DELIVERY-GATES.md), online `npm run security` and
authenticated `npm run policy:check`. MapLab is now public, but its required main/tag rulesets are not yet installed;
ML-002 cannot complete until authenticated administrative application and read-back.

Original code is MIT licensed. See [provenance](docs/PROVENANCE.md) for the separate
CC0 policy for owned numeric fixtures and the status of third-party dependencies.
