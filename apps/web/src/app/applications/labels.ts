import type { ApplicationMethod, ApplicationStatus, DraftKind, FactKind } from '@jsa/shared';

export const statusLabels: Record<ApplicationStatus, string> = {
  submitted: 'Applied',
  to_verify: 'Result unknown',
  not_submitted: 'Did not go through',
};

export const methodLabels: Record<ApplicationMethod, string> = {
  runner: 'submitted by the runner',
  manual: 'sent outside the app',
};

export const kindLabels: Record<DraftKind, string> = {
  resume: 'resume',
  cover_letter: 'cover letter',
};

export const factKindLabels: Record<FactKind, string> = {
  experience: 'Experience',
  project: 'Project',
  education: 'Education',
  skill: 'Skill',
  language: 'Language',
  certification: 'Certification',
  statement: 'Statement',
  other: 'Other',
};
