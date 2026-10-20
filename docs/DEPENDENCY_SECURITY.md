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
  The exact override `npm:@bleedingdev/braces@3.0.4` replaces the affected
  package used by `micromatch`, and consequently the Adonis build/lint/HMR chains.

## Production exposure and ownership decision

`npm ls braces --omit=dev` on the frozen lockfile resolves this production chain:

```text
@adonisjs/auth@10.1.0
└── @adonisjs/assembler@8.5.2
    └── fast-glob@3.3.3
        └── micromatch@4.0.8
            └── braces@npm:@bleedingdev/braces@3.0.4
```

The Docker runtime stage runs `npm ci --omit=dev` with this same manifest and
lockfile. The derivative therefore reaches the production image; its exposure is
not limited to development/build tools. The direct auth dependency brings the
assembler into the production tree even though assembler is also a dev dependency.

Before merge/release, maintainers must explicitly designate an owner for monitoring
and reviewing this single-maintainer derivative, accept its production supply-chain
exposure, and obtain the outstanding independent artifact comparison/acceptance.
These human decisions remain pending; automated audit, provenance and compatibility
checks do not substitute for acceptance. The proposed maintenance rules below retain
the exact pin, require artifact review on updates, and define upstream removal criteria.

The existing full-tree PR audit gate remains enabled without advisory exclusions.
Maintainers still need to decide audit-policy ownership and exception handling;
changing to a production-only gate or adding scheduled issue publication requires
that separate policy decision.

## Guarded braces derivative

[Source and maintenance pipeline](https://github.com/ultramodernjs/ultramodern.js/tree/main-ultramodern/scripts/ultramodern-supply)
identify the package as an MIT derivative, not an upstream fixed release. The published
npm artifact was compared with installed upstream 3.0.3 runtime sources: the public
entry point is unchanged; parser guards bound brace/parenthesis nesting; compile,
expand and stringify guard each recursive level with a fixed 100-level ceiling.
This ceiling cannot be raised by caller options. Original license and attribution
are retained. The exact artifact and SHA-512 integrity are pinned in
`package-lock.json`; registry signatures and provenance are verified.

GitHub dependency review currently treats npm aliases as their original names.
An earlier reviewed derivative used a prerelease version below upstream 3.0.3 and
was therefore falsely flagged as vulnerable `braces`. This post-patch 3.0.4 release
avoids that version ambiguity while retaining tested protection. No scan or advisory
exclusion was added, and the lockfile retains the derivative's actual package name.

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
