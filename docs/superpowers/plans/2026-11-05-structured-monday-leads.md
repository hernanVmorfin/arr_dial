# Structured Monday Leads Implementation Plan

> **For agentic workers:** Use executing-plans inline. Track checks here.

**Goal:** Put each dial claim's actionable data in dedicated Monday columns, backfill existing records, and provide useful views.
**Architecture:** Retain existing contact and pipeline column IDs. Add optional runtime column mappings for structured claim data. All create/update/admin-sync paths reuse the same structured values; never overwrite team-managed follow-up dates or owners. Retain the full details block and fallback update.
**Tech Stack:** Astro, TypeScript, Monday GraphQL, Webflow Cloud.
**Spec:** User-approved table proposal in this chat, 2026-11-05.

## Global Constraints
- Preserve existing records, item IDs, comments, follow-up state, and unrelated columns.
- Hide unrelated pricing fields rather than delete them.
- Missing customer information stays empty; no inferred consent or delivery success.
- Dates use Chicago calendar dates; expiry is filterable independently of Issued/Redeemed/Void.

## Review Focus
- No mappings: existing integration stays compatible.
- Optional name/address arrive later: structured fields update.
- Admin void/restore/redeem/extend: code status and expiry stay consistent.
- Marketing absent and consent false: no invented data.
- Column failure: lead still exists with details recoverable.

### Task 1: Structured integration
- [ ] Write failing mapping/create/update/sync tests.
- [ ] Add optional JSON mapping MONDAY_DIAL_COLUMNS for gift, code, value, claimed, expires, zip, campaign, landing, smsConsent, property.
- [ ] Keep manual owner/next-follow-up out of automated writes; set item name to first_name or code when structured mapping enabled.
- [ ] Verify full tests, typecheck, build.

### Task 2: Monday board and deployment
- [ ] Inspect exact current columns and create missing typed columns.
- [ ] Rename Quote to Lead details and Status to Follow-up status, preserving IDs.
- [ ] Configure mapping, ship verified code, redeploy and verify build.
- [ ] Backfill exactly three existing claims and preserve their item IDs.

### Task 3: Board views and verification
- [ ] Default follow-up table: actionable columns; hide pricing extras.
- [ ] Marketing & context table: attribution, consent, available property context.
- [ ] Needs follow-up, Expiring soon (next 7 days, issued), Redeemed saved views.
- [ ] Verify rendered columns/values and live integration; document any untested path.

## Execution ledger
- User explicitly approved implementation; proceeding inline without another plan approval.
- Existing checkout has only an unrelated untracked screenshot. Feature branch codex/structured-monday-leads starts from deployed origin/main 983ddab. No worktree created.
