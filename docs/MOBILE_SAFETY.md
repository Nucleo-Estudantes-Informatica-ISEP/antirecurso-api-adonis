# Account deletion and comment safety

These authenticated contracts support the mobile app while preserving the shared AuthNEI identity. They do not call provider account deletion or change global NEI roles. Actor, reporter, reviewer and blocker identity always come from validated claims.

## Delete AntiRecurso data

`DELETE /user` requires a resolved account and `{ "confirmation": "DELETE_ANTIRECURSO_DATA" }`. Additional actor/owner IDs are ignored. Success is `204`; missing confirmation is `422`. It deletes the local profile, owned answers/question answers, scores, cloud states, comments/reports, likes, notes and tracked uploads. Foreign-key cascades remove owned attempt snapshots when exam-recovery PR #158 is installed. Other users and shared canonical questions remain intact. Pending legacy identities must resolve ownership first.

Uploads and note publication/update/removal serialize with account deletion across API workers. A waiting request rechecks that its actor still exists before writing files, preventing a late upload from recreating an orphan after deletion. This currently serializes all note-file mutations; move to coordinated per-asset locks if upload throughput requires it. Uploaded/distributed note objects are removed before the SQL deletion commits. Unavailable storage returns `503` and retains account/asset metadata for retry; partial object cleanup is idempotent but cannot roll back with SQL. Files referenced by another account cause `409` and require an administrator to resolve ownership, rather than deleting somebody else's content. Backup copies and old untracked orphan uploads require the storage operator's retention/cleanup process; the API cannot retrospectively infer their owners.

The API retains only a SHA-256 hash of issuer/subject and an issued-at cutoff to reject tokens issued at or before deletion (`401`), including tokens without a usable issued-at claim. Authentication and deletion serialize on that hash. A newly issued token can create an empty local profile; deleted history cannot return. This cutoff remains enforced after rejoining. Its retention must be coordinated with provider token lifetimes; no provider revocation or retention period is inferred. The mobile client clears local private data/credentials and attempts ordinary provider logout after confirmed deletion. Network failure must not be presented as successful deletion.

New `/upload` grants record their authenticated owner in `note_uploads`. `PUT /uploads/:id` requires both the valid signed capability and that owner. Short-lived grants issued before this migration have no owner record and must be regenerated; drain their five-minute lifetime or communicate retry during rollout. Existing published note metadata still identifies assets. An upload later referenced by another account is protected by the shared-file check above.

## Report and block comments

- `POST /comments/:id/report`, body `{ reason }` (trimmed, 1–2000 characters): `201 { id, status }`, or `200` for the same reporter/comment retry. Missing, hidden or blocked comments return `404`. A report alone does not hide content globally.
- `PUT /user/blocks/:id`: block that author for the current viewer; `204`, including retries. Self-block is `422`; unknown author is `404`.
- `GET /user/blocks?page=1`: own blocked people, `{ data: [{ id, name }], meta }`, 20 per page with camelCase pagination metadata.
- `DELETE /user/blocks/:id`: idempotent unblock, `204`.

Every comment representation includes `user_id`. Hidden comments and the viewer's blocked authors are excluded from `/comments`, `/comments/:id`, and nested owned `/exams/:id` review. Another viewer's reads are unaffected by a personal block. The mobile app removes blocked authors from cached reviews immediately and provides unblock controls in the profile.

## Admin moderation

`GET /comment-reports?page=1` requires the existing AuthNEI admin role and returns the pending queue, oldest first, 20 per page. Each item contains report/reporter IDs, reason, timestamp and comment/author/question IDs and text. `POST /comment-reports/:id/review`, body `{ action: "dismiss" | "remove" }`, is admin-only and mutation-throttled. It returns `204`, `404` if missing, or `409` for a conflicting completed decision. Matching retries return `204`.

Dismissal retains the comment. Removal sets `hidden_at` and resolves all pending reports for that comment. The server records reviewer ID, decision and review time; submitted reviewer IDs are ignored. Author/reporter deletion removes their content/report rows; reviewer deletion clears only reviewer attribution. This is an authenticated API workflow, not a new native admin UI.

Before release, assign operational ownership of this queue, publish a support/contact and content policy, choose monitoring/response expectations, and verify removal/block/deletion against authorized staged identities and actual storage. No moderator availability, response SLA, provider acceptance or store approval is implied by tests.
