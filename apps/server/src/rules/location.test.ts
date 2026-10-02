import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SearchScope } from '@jsa/shared';
import { classifyLocation } from './location.ts';

const helsinki: SearchScope = { area: 'helsinki', includeRemote: false };
const helsinkiOrRemote: SearchScope = { area: 'helsinki', includeRemote: true };
const finland: SearchScope = { area: 'finland', includeRemote: false };
const worldwide: SearchScope = { area: 'worldwide', includeRemote: false };

const verdict = (location: string, scope: SearchScope) => classifyLocation(location, scope).verdict;

function assertVerdicts(scope: SearchScope, expected: Record<string, string>) {
  for (const [location, want] of Object.entries(expected)) {
    assert.equal(verdict(location, scope), want, JSON.stringify(location));
  }
}

test('Helsinki means Helsinki and Espoo, written in any of the usual ways', () => {
  assertVerdicts(helsinki, {
    'Helsinki, Finland': 'in_scope',
    Helsinki: 'in_scope',
    'Espoo, Finland': 'in_scope',
    'Helsingfors, Finland': 'in_scope',
    'Hybrid - Helsinki, Uusimaa': 'in_scope',
    'Berlin, Helsinki': 'in_scope',
    'HELSINKI METROPOLITAN AREA': 'in_scope',
    // One of several locations is enough.
    'Berlin, Germany; Helsinki, Finland; Stockholm, Sweden': 'in_scope',
  });
});

test('Vantaa and the rest of Finland are not Helsinki, but are Finland', () => {
  for (const location of ['Vantaa, Finland', 'Vantaa', 'Tampere, Finland', 'Finland']) {
    assert.equal(verdict(location, helsinki), 'out_of_scope', location);
    assert.equal(verdict(location, finland), 'in_scope', location);
  }
  assert.equal(verdict('Espoo, Finland', finland), 'in_scope');
});

test('a location in another named country is out of scope', () => {
  assertVerdicts(finland, {
    'Berlin, Germany': 'out_of_scope',
    'OSLO, Norway': 'out_of_scope',
    'Belgrade - Savski Venac, Serbia': 'out_of_scope',
    'Tel Aviv-Yafo, Israel': 'out_of_scope',
    'Atlanta, GA, United States; Central United States': 'out_of_scope',
    'Hybrid - San Francisco, California': 'out_of_scope',
    'Hybrid - London, England': 'out_of_scope',
    'Singapore; Sydney, Australia': 'out_of_scope',
    'Newark, New Jersey': 'out_of_scope',
  });
  assert.equal(classifyLocation('Berlin, Germany', helsinki).reason, 'Not in Helsinki or Espoo.');
  assert.equal(classifyLocation('Berlin, Germany', finland).reason, 'Not in Finland.');
});

test('a missing or unrecognised location is to be confirmed, never out of scope', () => {
  for (const scope of [helsinki, helsinkiOrRemote, finland]) {
    assertVerdicts(scope, {
      '': 'to_confirm',
      ' ; ': 'to_confirm',
      Tampere: 'to_confirm',
      'Berlin, Munich': 'to_confirm',
      'San Francisco, CA': 'to_confirm',
      'Nordics; Berlin, Germany': 'to_confirm',
      Hybrid: 'to_confirm',
    });
  }
  assert.equal(classifyLocation('', helsinki).reason, 'No location given.');
  assert.equal(
    classifyLocation('Tampere', helsinki).reason,
    'The location is not one the app recognises.',
  );
});

test('the Åland Islands are not a country outside Finland', () => {
  assert.equal(verdict('Mariehamn, Åland Islands', finland), 'to_confirm');
});

test('remote jobs count only when included, and only from Finland', () => {
  const fromFinland = [
    'Remote - Finland',
    'Finland (Remote)',
    'Remote (EU)',
    'Remote, Europe',
    'Remote - EMEA',
    'Remote, Nordics',
    'Remote - Worldwide',
    'Fully remote, anywhere',
  ];
  for (const location of fromFinland) {
    assert.equal(verdict(location, helsinkiOrRemote), 'in_scope', location);
    assert.equal(verdict(location, helsinki), 'out_of_scope', location);
  }
  assert.equal(
    classifyLocation('Remote - Finland', helsinki).reason,
    'Not in Helsinki or Espoo; remote jobs are not in the scope.',
  );

  assertVerdicts(helsinkiOrRemote, {
    'Remote - United States': 'out_of_scope',
    'Remote - San Francisco, California': 'out_of_scope',
    'Remote US': 'out_of_scope',
    // A bare "Remote" may well be tied to the company's country.
    Remote: 'to_confirm',
    Etätyö: 'to_confirm',
    'Remote; Serbia': 'to_confirm',
  });
  assert.equal(
    classifyLocation('Remote - United States', helsinkiOrRemote).reason,
    'Not in Helsinki or Espoo; remote only from elsewhere.',
  );
  assert.equal(
    classifyLocation('Remote', helsinkiOrRemote).reason,
    'Remote, but it does not say from where.',
  );
  // Without remote jobs in the scope, a remote job is out, wherever it may be done from.
  assert.equal(verdict('Remote', helsinki), 'out_of_scope');
});

test('a location that names Helsinki or Espoo counts even when it is remote or hybrid', () => {
  for (const location of ['Helsinki or remote', 'Remote - Espoo, Finland', 'Hybrid (Helsinki)']) {
    assert.equal(verdict(location, helsinki), 'in_scope', location);
  }
});

test('anywhere means every job, remote or not, with or without a location', () => {
  for (const location of ['', 'Remote', 'Berlin, Germany', 'Tampere', 'Remote - United States']) {
    assert.deepEqual(classifyLocation(location, worldwide), { verdict: 'in_scope', reason: '' });
  }
});
