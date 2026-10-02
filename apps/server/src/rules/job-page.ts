// The address that identifies a job saved from a page in the desktop app (T21). Saving the same
// page twice, or the same job from a results page and from its own page, gives the same address,
// so the job is saved once.
//
// LinkedIn shows one job at many addresses: its own page (/jobs/view/<id>, on country subdomains
// with a title slug such as /jobs/view/software-engineer-at-acme-<id>, and /comm/jobs/view/<id>
// in emails) and the search and collection pages with the job open beside the list
// (?currentJobId=<id>). All of them become https://www.linkedin.com/jobs/view/<id>/. A LinkedIn
// page that names no job is not a job page.
//
// Other sites keep their address without the fragment and common tracking parameters, because
// the app cannot know which other parts identify the job.

const tracking = /^(?:utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

const linkedInJobPath = /^(?:\/comm)?\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/;

export function linkedInJobUrl(id: string): string {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

function isLinkedIn(hostname: string) {
  return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
}

/** The address a saved job is known by, or why the page cannot be saved as a job. */
export function jobPageAddress(address: string): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { error: 'The page address is not valid.' };
  }
  if (url.protocol !== 'https:') {
    return { error: 'Only pages opened over https can be saved.' };
  }
  if (url.username || url.password) {
    return { error: 'The page address carries a user name or password, so it is not saved.' };
  }

  if (isLinkedIn(url.hostname)) {
    const id = linkedInJobPath.exec(url.pathname)?.[1] ?? url.searchParams.get('currentJobId');
    if (!id || !/^\d{1,20}$/.test(id)) {
      return { error: 'This LinkedIn page is not a job’s page. Open a job and save again.' };
    }
    return { url: linkedInJobUrl(id) };
  }

  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (tracking.test(name)) url.searchParams.delete(name);
  }
  return { url: url.href };
}
