/**
 * The page to open for what the user typed in the address bar: a web address, with https
 * added when no scheme is given. Null for anything else, such as a file or a script address or
 * search words, since the built-in browser only shows web pages.
 */
export function addressToUrl(typed: string): string | null {
  const text = typed.trim();
  if (text === '' || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]+:\d+(?:[/?#]|$)/.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!hasScheme && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href;
}

/** True for the addresses the built-in browser may show: web pages, and its empty start page. */
export function isWebAddress(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === 'about:blank';
}
