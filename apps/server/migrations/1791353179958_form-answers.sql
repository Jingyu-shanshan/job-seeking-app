-- Up Migration

-- Form answers (T16). The user's saved answers to application-form questions, the questions of a
-- job's form as the app read them, and the user's answers for one job. Which answer fills which
-- question is computed when a form is read (rules/form-answers.ts) and never stored. Only the
-- user writes answers: nothing here is written by a model or taken from a page.

-- Every item of `items` has text and at most `max_length` characters.
create function texts_filled(items text[], max_length integer) returns boolean
language sql immutable as $$
  select coalesce(bool_and(btrim(item) <> '' and char_length(item) <= max_length), true)
  from unnest(items) as item
$$;

-- A saved answer: the questions it answers, as forms word them (it fills a question whose wording
-- is one of these), the answer (one value, or several options of a multi-select question), and
-- whether it is sensitive (work permits, salary, demographics): a sensitive answer fills an
-- optional question only when the user chooses so for that job. With `places`, it is used only
-- for jobs whose location names one of them; without, for every job.
create table form_answer (
  id uuid primary key default gen_random_uuid(),
  wordings text[] not null check (cardinality(wordings) between 1 and 50 and texts_filled(wordings, 2000)),
  answer text[] not null check (cardinality(answer) between 1 and 50 and texts_filled(answer, 10000)),
  sensitive boolean not null,
  places text[] not null default '{}' check (cardinality(places) <= 20 and texts_filled(places, 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A job's application form as the app read it from its source, in the app's own shape (one
-- object per question). Like a job snapshot it is never changed: reading the same form again only
-- moves `last_captured_at`, so the current form is the one read last.
create table job_form (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references job (id),
  catalog_id text not null check (btrim(catalog_id) <> ''),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and octet_length(questions::text) <= 2097152),
  captured_at timestamptz not null default now(),
  last_captured_at timestamptz not null default now()
);

create unique index job_form_questions on job_form (job_id, md5(questions::text));

create trigger job_form_immutable before update or delete on job_form
  for each row execute function forbid_rewrite('last_captured_at');

-- The user's answer to one question of one job's form, by the form's own field name. `label` is
-- the question as it was asked: the answer counts only while the form still asks that. A null
-- `answer` means: fill this sensitive, optional question with the saved answer that fits it.
create table job_form_answer (
  job_id uuid not null references job (id),
  question_key text not null check (btrim(question_key) <> '' and char_length(question_key) <= 200),
  label text not null check (btrim(label) <> '' and char_length(label) <= 2000),
  answer text[] check (answer is null or (cardinality(answer) between 1 and 50 and texts_filled(answer, 10000))),
  updated_at timestamptz not null default now(),
  primary key (job_id, question_key)
);
