-- Session tokens rotate every day of use (CBL/LCA DFS guidelines 3.2.6h): when replaced, the old token works until
-- retire_at (5 minutes) so requests already in flight don't fail.
ALTER TABLE sessions ADD COLUMN rotated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN retire_at timestamptz;
