/** Explains known restrictions on automatic link imports; manual text imports stay available. */
export function jobLinkImportProblem(address: string): string | undefined {
  let hostname: string;
  try {
    hostname = new URL(address.trim()).hostname.replace(/\.$/, '');
  } catch {
    return undefined;
  }
  const from = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  let reason: string;
  if (from('linkedin.com')) {
    reason =
      'LinkedIn does not permit automated scraping, so this app does not fetch its job links.';
  } else if (from('duunitori.fi')) {
    reason =
      'Automatic fetching is disabled for Duunitori because permission for automated access has not been established.';
  } else if (from('jobly.fi')) {
    reason = 'Jobly link import is not supported yet.';
  } else return undefined;
  return `${reason} Paste the job text below, or open the page yourself in the desktop app and choose Save this job.`;
}
