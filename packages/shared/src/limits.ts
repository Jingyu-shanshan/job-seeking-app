// Plain limits with no TypeBox. Web uses this entry and /fact-import for values;
// the main entry builds schemas at module level, which a bundle keeps.

/** The longest email source the app takes, in characters. */
export const maxAlertEmailLength = 2_000_000;

/** The upload limit for a PDF, in bytes. */
export const maxPdfBytes = 2 * 1024 * 1024;

/** The most files the user may upload when recording an application sent outside the app. */
export const maxManualFiles = 3;

/** Limits for the text and candidates of one fact import. */
export const maxFactImportTextLength = 200_000;
export const maxFactImportCandidates = 200;
export const maxFactLength = 5000;
