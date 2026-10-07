---
name: api-semver-discipline
description: Apply when the diff changes a public API surface, whether or not it also changes a version (package.json version, OpenAPI info.version, an API version constant, a changelog heading). Flag a breaking change released under a minor or patch bump, or with no bump at all.
type: convention
---
A version number is a promise to the people who upgrade: `MAJOR.MINOR.PATCH`. A
client that takes every minor and patch release automatically (`^2.3.1`) trusts that
none of them breaks it.

**Classify every public change in the diff:**
- MAJOR — any breaking change: a removed or renamed route, field, parameter or
  export, a changed type or format, a new required input, narrower accepted input,
  a changed status code for an existing outcome.
- MINOR — a backwards-compatible addition: a new route, a new optional field or
  parameter, a deprecation marker on something that still works.
- PATCH — a fix that keeps the contract.

**Rules:**
1. The bump must be at least the highest class in the release. One breaking change
   makes the release MAJOR, whatever else it contains.
2. Below `1.0.0` the minor digit acts as the major one: a break in `0.4.2` needs `0.5.0`.
3. A breaking change with no version change at all is the same gap: the release that
   ships it must be MAJOR.
4. A MAJOR release lists its breaking changes in the changelog, with a migration note
   for each.
5. The way out of a MAJOR bump is to make the change compatible: keep the old name
   as an alias, make the new input optional, or add the change under a new route
   version. Name the one that fits.

**Report:** ONE finding per release, not one per breaking change. Cite the version
line when the diff changes it (`"version": "2.4.0"`); otherwise cite the first
breaking line and say the release needs a major bump. List the breaking changes that
force it and suggest the right version (`3.0.0`) or the compatible alternative. The
breaks themselves are reported at their own lines by `api-breaking-change` and
`api-response-schema`.

**Severity:** a breaking change under a minor, patch or missing bump is a WARNING.

**Not a finding:** a bump larger than the change needs, or a version file the diff
leaves alone when every change is compatible.

**Bad** — `1.7.2` → `1.8.0`, while the same diff deletes `GET /v1/payouts/:id/statement`:

```json
{
  "name": "@acme/payouts-api",
  "version": "1.8.0"
}
```

Every client on `^1.7.2` takes this release automatically and starts getting 404s.

**Good** — the release says what it is:

```json
{
  "name": "@acme/payouts-api",
  "version": "2.0.0"
}
```

with a changelog entry such as `## 2.0.0 — Breaking: GET /v1/payouts/:id/statement
removed, use GET /v1/payouts/:id/documents`. Or the route stays, deprecated, and the
release ships as `1.8.0`.
