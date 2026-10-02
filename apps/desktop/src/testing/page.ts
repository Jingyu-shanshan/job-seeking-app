import { JSDOM } from 'jsdom';

/**
 * A page for the readers' tests, at `url`. The readers run as source text inside it, as they do
 * in a real page, so a reader that uses anything from outside itself fails here too.
 *
 * jsdom lays nothing out, so two things are stood in for: innerText is the text content, and an
 * element is shown unless it or a parent has the `hidden` attribute.
 */
export function page(html: string, url = 'https://www.linkedin.com/jobs/view/4000000001/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { HTMLElement, Element } = dom.window;
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent;
    },
  });
  Element.prototype.checkVisibility = function (this: Element) {
    return this.closest('[hidden]') === null;
  };
  return {
    run<T>(reader: (...args: never[]) => T, ...args: unknown[]): T {
      const call = `(${reader.toString()})(${args.map((a) => JSON.stringify(a)).join(', ')})`;
      // Copied out of the page's realm, as Electron copies a result out of the page.
      return JSON.parse(JSON.stringify(dom.window.eval(call))) as T;
    },
    select(selector: string) {
      const el = dom.window.document.querySelector(selector)!;
      dom.window.getSelection()!.selectAllChildren(el);
    },
  };
}
