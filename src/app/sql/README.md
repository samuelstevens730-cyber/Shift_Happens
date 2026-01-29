# Database Schema (Supabase)

These SQL files reflect the current production schema for Shift Happens.

Run order (top to bottom):
1) 01_schema.sql
2) 02_variance_review.sql
3) 03_app_users.sql
4) 04_store_managers.sql
5) 05_payroll_rpc.sql
6) 06_seed_managers.sql
7) 07_shift_assignments.sql
8) 08_checklists_per_store.sql

Notes:
- These are safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE where possible).
- Seed data is included in 01_schema.sql (stores, profiles, memberships).
- 08_checklists_per_store.sql is only needed when migrating from the legacy checklist templates (no store_id).
