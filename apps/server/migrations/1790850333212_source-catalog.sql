-- Up Migration

-- Job sources and the search scope (T15).
-- The catalog of sites and how each may be accessed lives in code
-- (apps/server/src/sources/catalog.ts), because adding an entry means checking that site's terms
-- first. This table holds the user's choices: which entries they use and, for job boards, which
-- boards. The discovery run (T13) records each source's last result here.

create table source (
  id uuid primary key default gen_random_uuid(),
  -- An entry id from the code catalog. A row whose entry has left the catalog is never requested.
  catalog_id text not null check (catalog_id ~ '^[a-z0-9_]+$'),
  -- The entry's parameter, e.g. a job board name; '' for entries that take none, so that
  -- (catalog_id, param) is unique without an exception for null.
  param text not null default '' check (char_length(param) <= 200),
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_failure_reason text check (char_length(last_failure_reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (catalog_id, param),
  check ((last_failure_at is null) = (last_failure_reason is null))
);

-- The search scope, a single row: the app has one user. The scope only filters discovered jobs;
-- it never changes which sources are used or how they are accessed.
create table search_scope (
  singleton boolean primary key default true check (singleton),
  area text not null default 'helsinki' check (area in ('helsinki', 'finland', 'worldwide')),
  include_remote boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into search_scope default values;
