-- Record which models a customer's key can actually reach.
--
-- The catalogue says what a provider publishes. It does not say what one key
-- can call, and the gap is real: a live Groq key reached 13 models where the
-- catalogue listed 15, and the model OpenMind had hard-coded as that provider's
-- default was not among the 13. It was published, it was documented, and it
-- returned "does not exist or you do not have access" on the only account that
-- mattered.
--
-- So discovery runs once, when a provider is connected, using the plaintext key
-- while vault-keys still holds it — GET /v1/models. That single call answers
-- two questions at once:
--
--   does this key work?      → verified_at / verification_error
--   what can it reach?       → models
--
-- verified_at and verification_error already existed and were already READ by
-- worker/credential-directory.ts, which decides eligibility from them. Nothing
-- has ever written them, so every credential has sat in the "unknown" state
-- since those columns were added. This is the writer.

alter table public.provider_keys
  add column if not exists models jsonb;

comment on column public.provider_keys.models is
  'Model ids GET /v1/models returned for this credential, recorded when the provider was connected. Ids only — public, inert, and useless without the key. Null means discovery has not run or the provider does not support listing, which the UI treats as "offer the whole catalogue" rather than "offer nothing".';

-- Readable by the owner, like every other non-secret column here. A model id is
-- not a credential: it is the same string that appears in a public catalogue.
-- ciphertext and iv remain ungranted and unreadable, which is the property this
-- table exists to enforce.
grant select (models) on public.provider_keys to authenticated;
