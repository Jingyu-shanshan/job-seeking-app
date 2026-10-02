-- Up Migration

-- JD 导入与总结（T05）。
-- 发现到的职位和粘贴的职位走同一条路径：职位原文存进不可修改的 job_snapshot，并记下它从哪里来；
-- 模型从快照抽取要求和总结，每一条都引用原文片段并做子串校验；每次模型调用都记录用量、估算费用和结果。

-- 快照记下原文的来源（目录项，如 greenhouse_board、ashby_board，粘贴的是 paste）、链接，以及抓取时
-- 来源给出的标题、公司和地点。job_snapshot 不可修改（T02 的触发器），这些列也一样。
-- 此前没有任何代码写入 job_snapshot，所以新列可以直接 not null。
-- 唯一可以改的是 last_captured_at：再次读到相同的原文时不新增快照（T02 的唯一约束），只更新这个时间，
-- 所以一个职位的当前原文是 last_captured_at 最新的快照，即使原文改回了以前的版本。
alter table job_snapshot
  add column catalog_id text not null check (catalog_id ~ '^[a-z0-9_]+$'),
  add column title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  add column company text check (char_length(company) <= 1000),
  add column location text not null default '' check (char_length(location) <= 5000),
  add column last_captured_at timestamptz not null default now(),
  alter column source_url set not null,
  add constraint job_snapshot_source_url_https
    check (source_url ~ '^https://' and char_length(source_url) <= 2000);

drop trigger job_snapshot_immutable on job_snapshot;
create trigger job_snapshot_immutable before update on job_snapshot
  for each row execute function forbid_rewrite('last_captured_at');

-- 要求：必须项或加分项；由模型抽取或由用户更正时添加。内容不可修改：用户的更正是“移除旧的 + 添加新的”，
-- 这样以后引用某条要求的匹配（T06）不会因为更正而改变含义。只有 removed_at 可以改，行不能删除。
alter table job_requirement
  add column kind text not null check (kind in ('must', 'nice')),
  add column origin text not null check (origin in ('model', 'user')),
  add column removed_at timestamptz;

create trigger job_requirement_immutable before update or delete on job_requirement
  for each row execute function forbid_rewrite('removed_at');

-- 每一次模型调用，成功或失败。用量是供应商报告的 token 数；失败时如果供应商已经回答（例如回答格式不对），
-- 用量和费用照样记录，因为这部分已经计费。费用按代码里的价目表（apps/server/src/model/deepseek.ts）
-- 以高峰时段价格估算，所以不会低于实际计费。failure_reason 为空表示调用成功。
create table model_call (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('job_summary')),
  job_snapshot_id uuid references job_snapshot (id),
  model text not null check (btrim(model) <> '' and char_length(model) <= 200),
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  input_tokens integer check (input_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens between 0 and input_tokens),
  output_tokens integer check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  failure_reason text check (btrim(failure_reason) <> '' and char_length(failure_reason) <= 1000),
  check (num_nulls(input_tokens, cached_input_tokens, output_tokens, cost_usd) in (0, 4))
);

create trigger model_call_immutable before update or delete on model_call
  for each row execute function forbid_rewrite();

-- 一个快照最多一份总结：职责和固定的几个字段（地点、语言等）。每一条都带原文引用和子串校验的结果；
-- 字段为 null 表示原文没有说明。同一次调用抽取的要求在 job_requirement（origin = 'model'）。
-- 总结不可修改，也不能删除。
create table job_summary (
  id uuid primary key default gen_random_uuid(),
  job_snapshot_id uuid not null unique references job_snapshot (id),
  model_call_id uuid not null unique references model_call (id),
  responsibilities jsonb not null check (jsonb_typeof(responsibilities) = 'array'),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  created_at timestamptz not null default now()
);

create trigger job_summary_immutable before update or delete on job_summary
  for each row execute function forbid_rewrite();
