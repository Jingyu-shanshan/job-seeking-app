-- Up Migration

-- Preserve existing scopes and immutable run snapshots; custom locations are opt-in.
alter table job_criteria drop constraint search_scope_area_check;
alter table job_criteria
  add constraint job_criteria_area_check check (area in ('helsinki', 'finland', 'worldwide', 'custom')),
  add column location_places text[] not null default '{}' check (cardinality(location_places) <= 50),
  add constraint job_criteria_custom_places check (area <> 'custom' or cardinality(location_places) > 0);
