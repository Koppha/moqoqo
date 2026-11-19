-- What each bound phone usually looks like (screen, network, carrier, time zone, IP ranges, rough areas), learned
-- from its requests, to flag a bound phone that suddenly differs (CBL/LCA DFS guidelines 3.2.3a/b).
ALTER TABLE bound_devices ADD COLUMN profile jsonb NOT NULL DEFAULT '{}';
