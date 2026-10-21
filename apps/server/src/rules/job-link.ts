/** Recognises a single job link; requests are built from these IDs, never from the pasted URL. */
export function jobLink(address: string) {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let catalogId: 'greenhouse_board' | 'ashby_board';
  let board: string | undefined;
  let id: string | undefined;
  if (url.hostname === 'boards.greenhouse.io' || url.hostname === 'job-boards.greenhouse.io') {
    catalogId = 'greenhouse_board';
    const match = /^\/([^/]+)\/jobs\/(\d{1,20})\/?$/.exec(url.pathname);
    if (match) [, board, id] = match;
    else if (url.pathname === '/embed/job_app') {
      board = url.searchParams.get('for') ?? undefined;
      id = url.searchParams.get('token') ?? undefined;
    }
    if (!id || !/^\d{1,20}$/.test(id)) return null;
  } else if (url.hostname === 'jobs.ashbyhq.com') {
    catalogId = 'ashby_board';
    const match = /^\/([^/]+)\/([A-Za-z0-9_-]{1,200})(?:\/application)?\/?$/.exec(url.pathname);
    if (!match) return null;
    [, board, id] = match;
  } else return null;
  if (!board || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(board) || !id) return null;
  return { catalogId, board: board.toLowerCase(), id };
}
