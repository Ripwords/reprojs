-- Opportunistic backfill: users who signed in with GitHub via better-auth
-- get their user_identities row seeded automatically.

INSERT INTO user_identities
  (user_id, provider, external_id, external_handle, linked_at, last_verified_at)
SELECT
  a.user_id,
  'github'::identity_provider,
  a.account_id,
  COALESCE(u.name, a.account_id),
  NOW(),
  NOW()
FROM account a
JOIN "user" u ON u.id = a.user_id
WHERE a.provider_id = 'github'
ON CONFLICT (provider, external_id) DO NOTHING;
