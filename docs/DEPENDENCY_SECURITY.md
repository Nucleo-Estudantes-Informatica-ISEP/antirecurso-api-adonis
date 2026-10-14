# Dependency advisory remediation

The dependency tree is checked with both `npm audit` (including development) and
`npm audit --omit=dev` (production). CI rejects advisories in the full tree; no
advisory is ignored or suppressed.

## October 2026 fixes

- `brace-expansion` 5.0.9 → 5.0.12 fixes nested-brace stack exhaustion, recursive
  comma parsing and repeated-rewrite denial of service (GHSA-qhr7-859c-m2p7,
  GHSA-6j4f-fj2g-mc7p, GHSA-q2hr-2g5m-vwhr).
- `fast-copy` 4.0.2 → 4.2.0 includes bounded copy depth for
  [GHSA-jggr-w7fw-pc2j](https://github.com/advisories/GHSA-jggr-w7fw-pc2j).
- Upstream `braces` 3.0.3 has no patched release for
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  The exact override `npm:@dieub/braces-depth-guard@3.0.3-pn.3` replaces the affected
  package used by `micromatch`, and consequently the Adonis build/lint/HMR chains.

## Guarded braces derivative

[Source and maintenance notes](https://github.com/dieub/braces-depth-guard) identify
the package as an MIT derivative of upstream 3.0.3, not an upstream fixed release.
The published npm artifact was compared with installed upstream runtime sources:
the public entry point is unchanged; parsing tracks brace/parenthesis nesting;
compile/expand/stringify enforce a maximum 100-level traversal; expansion detects
parent-chain cycles; limit helpers prevent invalid options from bypassing the bounds.
Original license and attribution are retained. The exact artifact and SHA-512 integrity
are pinned in `package-lock.json`; registry signatures and provenance are available.

Regression coverage exercises the installed derivative through its actual `micromatch`
resolution, rejects malicious nested strings and direct ASTs, and checks ordinary
expansion/compilation and real Adonis file-glob consumers. Separate tests cover the
fixed `brace-expansion` and `fast-copy` behavior. The full build, lint, tests and Docker
checks validate the application/tooling compatibility; a renamed package and empty
audit alone would not establish remediation.

The fork introduces another maintainer and intentionally rejects nesting beyond
100 levels. It does not promise bounds on every expansion cardinality or malformed
JavaScript object. Keep the override exact, review new artifacts before updating,
and remove it only when a reviewed upstream fixed release is available and the
same security/compatibility regressions pass. Framework and direct dependency
major versions remain unchanged.
