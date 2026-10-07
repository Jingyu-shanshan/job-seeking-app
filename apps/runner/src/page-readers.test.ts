import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isGreenhouseForm, keyOf, pageFields, pageId } from './greenhouse.ts';
import { type RawField, findBlocker, formIsLive, readGreenhouseForm } from './page-readers.ts';
import { greenhouseFormHtml, page } from './testing/page.ts';

const brief = (fields: RawField[] | null) =>
  fields?.map((f) => [f.id, f.label, f.required, f.kind, f.value, f.demographic]);

describe('reading Greenhouse’s form', () => {
  test('every field, with its label, whether it is required, and how it takes a value', () => {
    const form = page(greenhouseFormHtml).run(readGreenhouseForm);
    assert.deepEqual(brief(form), [
      ['first_name', 'First Name', true, 'text', [''], false],
      ['last_name', 'Last Name', true, 'text', [''], false],
      ['email', 'Email', true, 'text', [''], false],
      ['country', 'Country', true, 'select', [], false],
      ['phone', 'Phone', false, 'text', [''], false],
      ['resume', 'Resume/CV', true, 'file', [], false],
      ['cover_letter', 'Cover Letter', false, 'file', [], false],
      ['candidate-location', 'Location (City)', true, 'select', [], false],
      ['question_101', 'LinkedIn Profile', false, 'text', [''], false],
      [
        'question_102',
        'Will you now or in the future require sponsorship for a visa?',
        true,
        'select',
        [],
        false,
      ],
      ['question_103', 'What is your notice period?', true, 'textarea', [''], false],
      ['question_104[]', 'Which countries could you work in?', true, 'checkboxes', [], false],
      ['question_105[]', 'Which languages do you speak fluently?', true, 'select', [], false],
      ['gender', 'Gender', false, 'select', [], false],
      [
        '4001',
        'Do you identify as a member of an under-represented group?',
        false,
        'select',
        [],
        true,
      ],
      [
        'gdpr_processing_consent_given',
        'I agree that Example Oy processes my data for this application.',
        true,
        'checkbox',
        [],
        false,
      ],
    ]);
  });

  test('what each field holds: text, chosen options, ticked boxes, attached files', () => {
    const p = page(greenhouseFormHtml);
    const doc = p.document;
    (doc.getElementById('first_name') as HTMLInputElement).value = 'Test';
    (doc.getElementById('question_103') as HTMLTextAreaElement).value = 'One\nmonth';
    // Greenhouse's selects show what is chosen next to their input.
    const single = doc.createElement('div');
    single.className = 'select__single-value';
    single.textContent = ' No ';
    doc.querySelector('#question_102')!.closest('.select__value-container')!.prepend(single);
    for (const language of ['English', 'Finnish']) {
      const chip = doc.createElement('div');
      chip.className = 'select__multi-value';
      chip.innerHTML = `<div class="select__multi-value__label">${language}</div>`;
      doc.getElementById('question_105[]')!.closest('.select__value-container')!.prepend(chip);
    }
    (doc.getElementById('question_104[]_3') as HTMLInputElement).checked = true;
    (doc.getElementById('gdpr_processing_consent_given') as HTMLInputElement).checked = true;
    Object.defineProperty(doc.getElementById('resume'), 'files', {
      value: [new p.window.File(['%PDF'], 'Test Person - Resume.pdf')],
    });
    const values = Object.fromEntries(p.run(readGreenhouseForm)!.map((f) => [f.id, f.value]));
    assert.deepEqual(values.first_name, ['Test']);
    assert.deepEqual(values.question_103, ['One\nmonth']);
    assert.deepEqual(values.question_102, ['No']);
    assert.deepEqual(values['question_105[]'], ['Finnish', 'English']);
    assert.deepEqual(values['question_104[]'], ['Estonia']);
    assert.deepEqual(values.gdpr_processing_consent_given, ['checked']);
    // The input holds a file, but the page did not take it: it shows no file name.
    assert.deepEqual(values.resume, []);
  });

  test('an attached file, which Greenhouse shows by its name in place of the file input', () => {
    const p = page(greenhouseFormHtml);
    p.document.querySelector(
      '[aria-labelledby="upload-label-resume"] .file-upload__wrapper',
    )!.innerHTML =
      '<div class="file-upload__filename"><p class="body body__secondary">Test Person - Resume.pdf</p><button type="button" aria-label="Remove file"></button></div>';
    const resume = p.run(readGreenhouseForm)!.find((f) => f.id === 'resume');
    assert.deepEqual(resume, {
      id: 'resume',
      label: 'Resume/CV',
      required: true,
      kind: 'file',
      value: ['Test Person - Resume.pdf'],
      demographic: false,
    });
  });

  test('a text field that is not shown is not one of the form’s', () => {
    const p = page(
      greenhouseFormHtml.replace(
        '<label id="phone-label"',
        '<div class="iti__dropdown-content" hidden><input type="search" id="iti-0__search-input" aria-label="Search"></div><label id="phone-label"',
      ),
    );
    const ids = p.run(readGreenhouseForm)!.map((f) => f.id);
    assert.ok(ids.includes('phone'));
    assert.ok(!ids.includes('iti-0__search-input'));
  });

  test('a page without Greenhouse’s form has none', () => {
    assert.equal(page('<form id="other"><input id="a"></form>').run(readGreenhouseForm), null);
  });

  test('the form is live once React has taken it over', () => {
    const p = page(greenhouseFormHtml);
    assert.equal(p.run(formIsLive), false);
    Object.assign(p.document.querySelector('#application-form input')!, { __reactFiber$x: {} });
    assert.equal(p.run(formIsLive), true);
    assert.equal(page('<p>No form.</p>').run(formIsLive), false);
  });
});

describe('what only the user may deal with', () => {
  test('a CAPTCHA challenge or a sign-in; not the badge of an invisible reCAPTCHA', () => {
    assert.equal(page(greenhouseFormHtml).run(findBlocker), null);
    const challenge =
      '<iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/enterprise/bframe?k=x"></iframe>';
    assert.equal(page(challenge).run(findBlocker), 'captcha');
    assert.equal(page(`<div hidden>${challenge}</div>`).run(findBlocker), null);
    assert.equal(
      page(
        '<iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x"></iframe>',
      ).run(findBlocker),
      'captcha',
    );
    assert.equal(
      page('<iframe src="https://newassets.hcaptcha.com/captcha/v1/x"></iframe>').run(findBlocker),
      'captcha',
    );
    assert.equal(page('<form><input type="password"></form>').run(findBlocker), 'login');
    assert.equal(page('<form hidden><input type="password"></form>').run(findBlocker), null);
  });
});

describe('the app’s keys and the page’s ids', () => {
  test('are the same, except for the location search and demographic questions', () => {
    assert.equal(pageId('question_102'), 'question_102');
    assert.equal(pageId('location'), 'candidate-location');
    assert.equal(pageId('demographic_4001'), '4001');
    assert.equal(keyOf({ id: 'candidate-location', demographic: false }), 'location');
    assert.equal(keyOf({ id: '4001', demographic: true }), 'demographic_4001');
    assert.equal(keyOf({ id: '4001', demographic: false }), '4001');
    assert.equal(keyOf({ id: 'gender', demographic: true }), 'gender');
  });

  test('fields go to the app by its keys, within its limits', () => {
    const fields = pageFields([
      {
        id: '4001',
        label: 'Q',
        required: false,
        kind: 'select',
        value: ['Yes'],
        demographic: true,
      },
      {
        id: 'question_1',
        label: 'L'.repeat(3000),
        required: true,
        kind: 'textarea',
        value: ['v'.repeat(20_000)],
        demographic: false,
      },
    ]);
    assert.deepEqual(fields[0], {
      key: 'demographic_4001',
      label: 'Q',
      required: false,
      kind: 'select',
      value: ['Yes'],
    });
    assert.equal(fields[1]!.label.length, 2000);
    assert.equal(fields[1]!.value[0]!.length, 10_000);
  });

  test('the runner opens only Greenhouse’s own form pages', () => {
    assert.ok(isGreenhouseForm('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=7'));
    for (const url of [
      'http://job-boards.greenhouse.io/embed/job_app',
      'https://job-boards.greenhouse.io.example.com/x',
      'https://careers.example.com/jobs/7',
      'not a url',
    ]) {
      assert.equal(isGreenhouseForm(url), false, url);
    }
  });
});
