-- Up Migration

-- User corrections stay separate from captured source data.
create table job_details (
  job_id uuid primary key references job (id),
  title text not null check (btrim(title) <> '' and char_length(title) <= 1000),
  company text check (char_length(company) <= 1000),
  location text not null check (char_length(location) <= 5000),
  url text check (url ~ '^https://' and char_length(url) <= 2000)
);
