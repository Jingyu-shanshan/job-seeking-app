-- Up Migration

-- Existing drafts were generated in English. Language is immutable with the rest of the draft.
alter table artifact add column language text not null default 'en'
  check (language in ('en', 'zh', 'fi'));

-- Down Migration

alter table artifact drop column language;
