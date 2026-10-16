# Applying reviewed question corrections

`questions:import` is the supported publication path for corrections and expansion.
Raw banks in `database/data/` are candidates, not evidence of academic approval.
Both former question seeders fail before writing and point to this command. Existing
published records remain intact. This implementation neither approves candidates
nor applies the outstanding subject reviews from #119.

## Prepare an approved batch

An academic reviewer verifies statements, images, options, correct answers, sources
and flags against source material. Review near-duplicates manually: automated checks
cover exact text after case/whitespace normalization, not semantic similarity. Keep
unverifiable entries out. The trusted operator records the actual reviewer, time and
evidence; JSON fields are attestations, not authenticated approval signatures. Never
invent or automatically stamp approval while converting a candidate bank.

Use an immutable, globally namespaced `import_key` (maximum 160 characters), e.g.
`real:arqcp:exam-2024:q17`. Do not derive identity from mutable text or array position.
For a published record without a key, include its verified `question_id` on first
import. Future edits target that same DB row by key. If both identities are supplied,
they must agree. Missing IDs, conflicting keys and cross-subject updates block the
whole batch; there is no text-match update fallback. Subjects and matching question
types must already exist.

Illustrative format only: replace all content, identity and approval values with
verified data before use.

```json
{
  "batch_id": "arqcp-reviewed-corrections-2026-10-14-v1",
  "questions": [
    {
      "import_key": "real:arqcp:exam-2024:q17",
      "question_id": 123,
      "subject_id": 7,
      "question_type_id": 8,
      "exam": "arqcp-2024",
      "source": "REAL_EXAM",
      "question": "Full academically verified statement",
      "correct_option": "B",
      "options": [
        { "order": "A", "name": "First option" },
        { "order": "B", "name": "Correct option" }
      ],
      "review": {
        "status": "approved",
        "reviewer": "Actual academic reviewer identity",
        "reviewed_at": "2026-10-14T10:00:00Z",
        "reference": "Actual review record and source material",
        "duplicates_checked": true
      },
      "repeated": false,
      "in_plan": true,
      "ref": "Verified lecture/source reference"
    }
  ]
}
```

For new questions omit `question_id`; retain the same key in later batches. Source
is `REAL_EXAM`, `AI_GENERATED` or `MANUAL`. Each entry needs approved review evidence,
a nonblank reviewer/reference, a valid past ISO timestamp with timezone, and explicit
duplicate review. Options need 2–9 unique nonblank names and unique single uppercase
letter or digit orders (`A`–`Z`, `0`–`9`); `correct_option` must match one. Lowercase
letters are rejected to match exam verification. For raw `answers`/`correct_index` data, map
answers to verified stored orders (normally `1`–`9`), then map the index to that order.
Carry `in_plan`, `repeated` and `ref` without discarding them. Restore full statements
from verified source material instead of retaining previously shortened versions.

Question/option text uses PostgreSQL `text`: over 255 characters stores in full.
`exam`/`image` still have a 255-character limit and fail validation, never silently
skip/truncate. Omitted `image` preserves its value. Omitted `repeated`, `in_plan`,
`ref` preserve stored metadata; explicit `null` clears them. New omitted metadata
is null. Every import requires review evidence.

Existing option orders/count must stay identical. Names and correct answers can
change while question/option IDs, comments, reports and exam references stay intact.
Structural option changes need a separate reviewed history migration; this command
never deletes/recreates options. Notes and subjects are untouched.

## Preview, apply, repeat

After migrations, on an isolated copy first:

```bash
node ace questions:import reviewed-batch.json > dry-run.json
node ace questions:import reviewed-batch.json --apply > applied.json
node ace questions:import reviewed-batch.json > repeat.json
```

Default dry-run writes no questions/options/audit. JSON includes `status`, `counts`
(`insert`, `update`, `unchanged`, `conflict`) and per-entry identity, problems and full
before/after snapshots including metadata. Validation/conflicts exit nonzero; blocked
batches write nothing. Inspect the concrete report before deliberate application.

Apply locks question/option/audit tables, then commits all changes and the audit in
one transaction. Schedule imports to avoid delaying admin writes. Every new applied
batch stores its SHA-256 digest and report in `question_import_batches`; `after`
contains actual resulting IDs. DB audit remains authoritative if output saving fails.
Dry-run is not a reservation: apply replans against current DB state.

Repeat must show zero inserts/updates/conflicts and all entries unchanged, including
metadata. Reapplying the same batch is then a no-op, preserving its original audit.
Reusing a batch ID with different content or replaying it over later corrections is
rejected; obtain a new review and batch ID instead.

Production application requires explicit authorization and a verified backup. No
production migration/import is performed by this implementation. Back up questions,
options, dependent history and audit together; retain input JSON and review evidence.
A merged JSON proves neither application nor academic sign-off.

## Recovering before-state

Export the committed report using the configured schema/search path:

```sql
SELECT batch_id, digest, applied_at, report
FROM question_import_batches
WHERE batch_id = 'the-applied-batch-id';
```

Each update's `before` includes every question/option column, original IDs and
timestamps; `after` identifies published records. Prefer a newly reviewed compensating
batch: copy prior text/image/source/flags/reference/options, keep current immutable
key and question ID, attach fresh academic review, preview, apply and repeat-check.
Keep both audit records. Content is restored with a new review and timestamp.

For exact DB restoration, an authorized maintainer restores saved `before` columns
by original IDs within a transaction and backup recovery plan. Lock the same tables;
verify current rows still match recorded `after`. Abort on intervening changes.
New inserts have no `before`; deleting them can cascade history and requires a
separate reviewed recovery plan. Do not delete the audit. Export it before schema
rollback: the down migration removes import metadata/audit, but deliberately retains
`text` columns to prevent truncation.
