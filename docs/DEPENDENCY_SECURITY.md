# Dependency advisory remediation

## Upstream packages and local braces patch

`brace-expansion` 5.0.12 and `fast-copy` 4.2.0 retain the upstream fixes for
nested-brace parsing and bounded deep copying. No third-party `braces` alias or
publisher is used. The lockfile installs upstream `braces` 3.0.3 with its registry
integrity, then `npm ci` runs `scripts/patch_braces.mjs` in development and production.

The reviewable replacements in `patches/braces-3.0.3.json` add a fixed 100-level
limit to brace/parenthesis parsing and recursive compile/expand/stringify traversal,
including direct AST callers. Each file records SHA-256 hashes of its original and
patched source. Installation checks the upstream package name/version and all file
hashes before writing; unexpected artifacts or patch results fail installation.
Repeated application is safe. No patching dependency or new publisher is needed.

The patch and installer are copied before the Docker builder's frozen install and
included in the compiled application for the runtime `npm ci --omit=dev`. Do not
use `--ignore-scripts` for application installs: it skips this security patch.
Installed-artifact regressions exercise malicious strings/ASTs, ordinary globs,
consumer resolution, idempotence and unexpected-source/version rejection. Runtime
image verification must exercise the installed patch, not merely the builder.

## Production exposure and audit results

`npm ls braces --omit=dev` resolves the upstream package through:

```text
@adonisjs/auth → @adonisjs/assembler → fast-glob → micromatch → braces@3.0.3
```

The parser ships in production even though its consumers are build/tooling APIs.
Application request handlers do not import glob APIs or accept user glob patterns.
This bounds the currently identified attack surface; the local patch supplies depth
limits rather than relying only on that observation. It does not bound every
expansion cardinality or malformed cyclic object.

The registry advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
still identifies upstream 3.0.3 as affected: npm cannot recognize a local patch.
Audits therefore report this high-severity advisory and its dependent packages
(currently 20 high findings, zero critical); do not claim a clean audit or suppress
the report. Patch regression results establish the tested mitigation separately.

## Audit policy and maintenance

PR CI retains the existing `dev` policy: `npm audit --omit=dev --audit-level=critical`.
It reports production advisories and fails on critical findings. This PR does not
introduce the proposed full-tree hard gate or a new advisory allowlist.
The separate shared security workflow remains unchanged.

`.github/workflows/dependency-audit.yml` runs a full-tree audit weekly and manually.
On findings or registry audit errors it opens or updates one `security` tracking
issue, including the revision, run link and advisory list. Repository CODEOWNERS
are the existing triage owners; the workflow does not invent a sign-off or silently
close an issue after a clean run. Scheduled runs start only once the workflow is
on the default branch, following the normal `dev` → `main` release process.

Repository CODEOWNERS maintain the local patch. Review it by **2026-11-20** and on
every upstream release/advisory change; record that review in the tracking issue.
This is a patch review deadline, not an accepted unpatched advisory exception.
Remove the installer, patch, Docker/meta-file copying and related instructions only
when an upstream fix passes the same security and compatibility regressions.
Changing audit thresholds or exception policy needs an explicit maintainer decision;
no acceptance of the removed fork is claimed.
