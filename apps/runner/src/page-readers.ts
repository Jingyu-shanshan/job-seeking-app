// What the runner reads in the form's page. Playwright sends each function to the page as source
// text, so each must be self-contained: nothing from outside the function, not even a helper of
// this file. They only read; the runner fills the form through Playwright (greenhouse.ts).

/** A field of Greenhouse's application form as the page shows it, by the page's own id. */
export interface RawField {
  id: string;
  label: string;
  required: boolean;
  kind: 'text' | 'textarea' | 'select' | 'checkboxes' | 'checkbox' | 'file';
  value: string[];
  /** In the form's demographic section, where an id is the question's number. */
  demographic: boolean;
}

/**
 * Every field of the Greenhouse application form on the page (`form#application-form`), with the
 * value it holds now; null when the page has no such form. Drop-down lists are Greenhouse's
 * searchable selects, whose chosen options show as `.select__single-value` or
 * `.select__multi-value__label`.
 */
export function readGreenhouseForm(): RawField[] | null {
  const form = document.querySelector('form#application-form');
  if (!form) return null;
  const line = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  // A label's words, without the required marker beside them.
  const words = (el: Element | null) => {
    if (!el) return '';
    const copy = el.cloneNode(true) as Element;
    for (const marker of copy.querySelectorAll('[aria-hidden="true"], .required')) marker.remove();
    return line(copy.textContent);
  };
  const byId = (id: string) => (id ? document.getElementById(id) : null);
  const labels = [...form.querySelectorAll('label')];
  const labelFor = (control: Element) => {
    const id = control.id;
    const own = labels.find((l) => l.htmlFor === id && !l.classList.contains('visually-hidden'));
    const named = byId(`${id}-label`) ?? byId(control.getAttribute('aria-labelledby') ?? '');
    return words(own ?? named) || line(control.getAttribute('aria-label'));
  };
  const required = (control: Element) =>
    control.getAttribute('aria-required') === 'true' ||
    control.hasAttribute('required') ||
    control.closest('[aria-required="true"]') !== null;
  const demographic = (control: Element) => control.closest('#demographic-section') !== null;

  const fields: RawField[] = [];
  const add = (
    control: Element,
    field: Omit<RawField, 'id' | 'required' | 'demographic'>,
    id = control.id,
  ) => {
    if (!id || fields.some((f) => f.id === id)) return;
    fields.push({ id, required: required(control), demographic: demographic(control), ...field });
  };

  // A file question is a group labelled `upload-label-<id>`. Once Greenhouse has taken a file, it
  // takes the file input away and shows the file's name instead.
  const uploads = '[role="group"][aria-labelledby^="upload-label-"]';
  for (const control of form.querySelectorAll(`input, textarea, fieldset.checkbox, ${uploads}`)) {
    // Greenhouse's stand-ins that only make the browser require a select's value.
    if (control.getAttribute('aria-hidden') === 'true') continue;
    if (control.matches(uploads)) {
      const labelId = control.getAttribute('aria-labelledby')!;
      // A file the input holds that the page did not take (it shows an error instead) is not
      // attached.
      const names = [...control.querySelectorAll('.file-upload__filename')].map((el) =>
        line(el.textContent),
      );
      const id = labelId.slice('upload-label-'.length);
      add(control, { label: words(byId(labelId)), kind: 'file', value: names }, id);
      continue;
    }
    if (control instanceof HTMLFieldSetElement) {
      const checked = [...control.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
        .filter((box) => box.checked)
        .map((box) => words(labels.find((l) => l.htmlFor === box.id) ?? null));
      add(control, {
        label: words(control.querySelector('legend')),
        kind: 'checkboxes',
        value: checked,
      });
      continue;
    }
    if (control instanceof HTMLTextAreaElement) {
      if (!control.checkVisibility()) continue;
      add(control, { label: labelFor(control), kind: 'textarea', value: [control.value] });
      continue;
    }
    if (!(control instanceof HTMLInputElement)) continue;
    const type = control.type;
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'radio') continue;
    if (type === 'checkbox') {
      if (control.closest('fieldset.checkbox')) continue;
      add(control, {
        label: labelFor(control),
        kind: 'checkbox',
        value: control.checked ? ['checked'] : [],
      });
    } else if (type === 'file') {
      if (control.closest(uploads)) continue;
      const names = [...(control.files ?? [])].map((file) => file.name);
      add(control, { label: labelFor(control), kind: 'file', value: names });
    } else if (!control.checkVisibility()) {
      // Not shown, such as the search box of the phone number's list of countries.
      continue;
    } else if (control.getAttribute('role') === 'combobox') {
      const select = control.closest('.select__container') ?? control.closest('.select');
      const chosen = [
        ...(select?.querySelectorAll('.select__single-value, .select__multi-value__label') ?? []),
      ].map((el) => line(el.textContent));
      add(control, { label: labelFor(control), kind: 'select', value: chosen });
    } else {
      add(control, { label: labelFor(control), kind: 'text', value: [control.value] });
    }
  }
  return fields;
}

/**
 * Whether the page's own script has taken the form over. Greenhouse renders the form on its
 * server and then hands it to React, which marks every element it manages; before that, its
 * selects do not open and text typed into a field may be wiped.
 */
export function formIsLive(): boolean {
  const input = document.querySelector('form#application-form input');
  return input !== null && Object.keys(input).some((key) => key.startsWith('__react'));
}

/**
 * Whatever on the page only the user may deal with: a CAPTCHA challenge or a sign-in. The badge
 * of an invisible reCAPTCHA is not one; Greenhouse shows it on every form.
 */
export function findBlocker(): 'captcha' | 'login' | null {
  const shown = (el: Element) =>
    el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  for (const frame of document.querySelectorAll('iframe')) {
    if (frame.closest('.grecaptcha-badge')) continue;
    const where = `${frame.getAttribute('src') ?? ''} ${frame.title}`;
    if (/captcha|challenges\.cloudflare\.com/i.test(where) && shown(frame)) return 'captcha';
  }
  if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return 'login';
  return null;
}

/** What the page shows after the runner pressed Submit (T18). */
export interface AfterSubmit {
  /** Greenhouse's confirmation page, with no application form on it. */
  confirmation: boolean;
  /** Greenhouse asks for the security code it emailed. */
  securityCode: boolean;
  /** The form is there, with fields it did not accept. */
  formErrors: boolean;
  /** The page's words: the confirmation's, else the whole page's. */
  text: string;
}

/**
 * What the page shows after Submit. Greenhouse's confirmation page (`/embed/job_app/confirmation`)
 * shows a `.confirmation` block; asking for an emailed code, it shows inputs `security-input-<n>`;
 * a field it did not accept is marked `aria-invalid`.
 */
export function readAfterSubmit(): AfterSubmit {
  const form = document.querySelector('form#application-form');
  const confirmation = document.querySelector('.confirmation');
  const words = ((confirmation ?? document.body)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    confirmation:
      location.pathname === '/embed/job_app/confirmation' && confirmation !== null && !form,
    securityCode: document.querySelector('input[id^="security-input-"]') !== null,
    formErrors: form?.querySelector('[aria-invalid="true"]') != null,
    text: words.slice(0, 20_000),
  };
}
