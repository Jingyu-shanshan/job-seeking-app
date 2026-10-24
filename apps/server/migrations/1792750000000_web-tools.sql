-- Up Migration
create table tool_call (
  id uuid primary key,
  tool text not null check (tool in ('search','fetch')),
  input text not null check (length(input) between 1 and 2000),
  reserved_usd numeric not null check (reserved_usd >= 0),
  cost_usd numeric check (cost_usd >= 0),
  result jsonb,
  message text not null default 'Outcome unconfirmed; the estimated fee is reserved. Do not automatically retry.',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create trigger tool_call_immutable before update or delete on tool_call
  for each row execute function forbid_rewrite('cost_usd','result','message','finished_at');
