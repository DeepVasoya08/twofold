-- What someone a library is shared with may do.
--
-- `access` is 'view' (see and download, nothing else) or 'edit' (also add, change and delete
-- photos and albums). The server enforces it on every request made with the member's token,
-- and the owner can change it at any time. People a library was shared with before this kept
-- the access they had, which was 'edit'. Album-scoped members are view-only whatever this says.

ALTER TABLE members ADD COLUMN access TEXT NOT NULL DEFAULT 'edit' CHECK (access IN ('view', 'edit'));
