import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

/** The made-up Greenhouse form of the tests, as HTML. */
export const greenhouseFormHtml = readFileSync(
  new URL('./greenhouse-form.html', import.meta.url),
  'utf8',
);

/**
 * A page for the page readers' tests. The readers run as source text inside it, as Playwright
 * runs them, so a reader that uses anything from outside itself fails here too. The page's own
 * scripts do not run. jsdom lays nothing out, so an element is shown unless it or a parent has the
 * `hidden` attribute.
 */
export function page(html: string, url = 'https://job-boards.greenhouse.io/embed/job_app') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.Element.prototype.checkVisibility = function (this: Element) {
    return this.closest('[hidden]') === null;
  };
  return {
    document: dom.window.document,
    window: dom.window,
    run<T>(reader: () => T): T {
      // Copied out of the page's realm, as Playwright copies a result out of the page.
      return JSON.parse(JSON.stringify(dom.window.eval(`(${reader.toString()})()`))) as T;
    },
  };
}
