-- API speed and errors, per hour and area (portal: Performance). The server adds to the current hour about once a minute.
-- buckets: how many requests finished within each bound of LATENCY_BOUNDS_MS (services/metrics.ts), plus one for slower.
CREATE TABLE api_metrics (
  hour           timestamptz NOT NULL,
  area           text NOT NULL,
  requests       integer NOT NULL DEFAULT 0,
  client_errors  integer NOT NULL DEFAULT 0,
  server_errors  integer NOT NULL DEFAULT 0,
  total_ms       double precision NOT NULL DEFAULT 0,
  buckets        integer[] NOT NULL,
  PRIMARY KEY (hour, area)
);
