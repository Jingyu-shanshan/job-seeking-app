import type { AccessMethod, CatalogEntry } from '@jsa/shared';

/** The access methods where the app itself sends requests to the site. */
const requesting: ReadonlySet<AccessMethod> = new Set(['board_api', 'official_api']);

export interface SourceSetting {
  catalogId: string;
  enabled: boolean;
}

/**
 * The sources a discovery run may request: enabled, still in the catalog, and of an entry the
 * app requests itself. Job-alert emails and pasted jobs are never requested, and neither is a
 * source whose catalog entry has been removed.
 */
export function sourcesToRequest<S extends SourceSetting>(
  sources: readonly S[],
  catalog: readonly CatalogEntry[],
): { source: S; entry: CatalogEntry }[] {
  return sources.flatMap((source) => {
    const entry = catalog.find((e) => e.id === source.catalogId);
    return source.enabled && entry && requesting.has(entry.access) ? [{ source, entry }] : [];
  });
}
