-- Case-insensitive email addresses (user.email, invites.email). citext is a trusted extension,
-- so the database owner (the migration user) can create it.
CREATE EXTENSION IF NOT EXISTS citext;
