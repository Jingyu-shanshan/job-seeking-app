-- Up Migration

alter table fact
  add column kind text not null check (
    kind in ('experience', 'project', 'education', 'skill', 'language', 'certification', 'statement', 'other')
  );
