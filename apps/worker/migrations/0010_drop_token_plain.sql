-- Drop the plaintext copy of API tokens.
--
-- tokens.token_plain held every token in the clear so an admin could reveal it
-- later. That made the column a complete credential dump: anyone who read the
-- database could use every token without cracking anything.
--
-- Tokens are now shown once at creation and only their SHA-256 digest is
-- stored. Existing rows keep working — key_hash is what authentication
-- compares against — but their plaintext can no longer be recovered, so a user
-- who lost a token has to create a new one.

ALTER TABLE tokens DROP COLUMN token_plain;
