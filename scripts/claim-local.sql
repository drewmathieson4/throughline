-- Move everything the seed's Dev Teacher owns (or nobody owns) to whoever signed in to the
-- local dev server most recently, so the seed classes show up for a real Google account.
-- `npm run db:claim:local`. Local only: production rows are claimed by hand, once.
UPDATE classes SET owner_id = (SELECT id FROM users WHERE google_sub <> 'dev-google-sub' ORDER BY last_signin_at DESC LIMIT 1)
  WHERE owner_id IS NULL OR owner_id = '00000000-0000-4000-8000-000000000001';
UPDATE notes SET owner_id = (SELECT id FROM users WHERE google_sub <> 'dev-google-sub' ORDER BY last_signin_at DESC LIMIT 1)
  WHERE owner_id IS NULL OR owner_id = '00000000-0000-4000-8000-000000000001';
