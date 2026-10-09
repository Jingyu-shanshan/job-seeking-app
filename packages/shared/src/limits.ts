// Plain values with no TypeBox, the only part of @jsa/shared apps/web may import as values
// (`@jsa/shared/limits`); the main entry builds schemas at module level, which a bundle keeps.

/** The longest email source the app takes, in characters. */
export const maxAlertEmailLength = 2_000_000;

/** The upload limit for a PDF, in bytes. */
export const maxPdfBytes = 2 * 1024 * 1024;

/** The most files the user may upload when recording an application sent outside the app. */
export const maxManualFiles = 3;
