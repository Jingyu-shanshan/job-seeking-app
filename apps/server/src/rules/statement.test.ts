import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProblemCode } from '@jsa/shared';
import { type StatementInput, isVerbatim, statementProblems, vocabularyOf } from './statement.ts';

// Made-up facts and job, in the shape the app sends them.
const facts = {
  role: {
    kind: 'experience' as const,
    body: 'Backend developer at Acme Oy, Helsinki, March 2021 – June 2024. Built the invoice API in Go and PostgreSQL.',
  },
  result: {
    kind: 'experience' as const,
    body: 'Cut invoice processing time by about 30% at Acme Oy by moving batch jobs to Kafka.',
  },
  team: { kind: 'experience' as const, body: 'Led a team of five developers for 18 months.' },
  skills: { kind: 'skill' as const, body: 'Go, TypeScript, Node.js, PostgreSQL, C#' },
  finnish: { kind: 'language' as const, body: 'Finnish: basic (A2)' },
  degree: {
    kind: 'education' as const,
    body: 'MSc in Computer Science, University of Turku, expected 2027',
  },
  plus: { kind: 'experience' as const, body: 'Wrote 10+ internal tools.' },
};

const jobText = `Platform Engineer, Example Payments

What You Bring
- 3+ years of Go
- Kubernetes and AWS in production
- Experience with Terraform is a plus

We move 2 billion euros a year for 40,000 merchants across the Nordics.`;

const context = {
  jobText,
  jobNames: 'Platform Engineer Example Payments',
  vocabulary: vocabularyOf(Object.values(facts), jobText),
};

const me = (text: string, ...cited: { body: string }[]): StatementInput => ({
  about: 'me',
  text,
  quote: null,
  unsentRefs: [],
  facts: cited.map((fact) => ({ body: fact.body, usable: true })),
});

const codes = (statement: StatementInput) =>
  statementProblems(statement, context).map((problem) => problem.code);

const passes = (statement: StatementInput) =>
  assert.deepEqual(statementProblems(statement, context), [], statement.text);

const fails = (statement: StatementInput, code: ProblemCode, mentions = '') => {
  const problems = statementProblems(statement, context);
  const found = problems.find((p) => p.code === code && p.message.includes(mentions));
  assert.ok(
    found,
    `${statement.text}: expected ${code} ${mentions}, got ${JSON.stringify(problems)}`,
  );
};

test('passes statements that say only what their facts say', () => {
  passes(me(facts.role.body, facts.role));
  passes(me('Built the invoice API at Acme Oy in Go and PostgreSQL.', facts.role));
  passes(
    me('Cut invoice processing time by about 30% by moving batch jobs to Kafka.', facts.result),
  );
  passes(me('Led five developers.', facts.team));
  passes(me('Led a team of 5 developers for eighteen months.', facts.team));
  passes(me('Go, TypeScript, Node.js and C#', facts.skills));
  passes(me('Backend developer, Acme Oy, Helsinki (2021-03 – 2024-06)', facts.role));
  passes(me('Finnish (basic, A2)', facts.finnish));
  passes(me('MSc in Computer Science, University of Turku (expected 2027)', facts.degree));
  passes(me('Built APIs in Go.', facts.role));
  passes(me("Worked on Acme Oy's invoice API.", facts.role));
});

test('a statement about the job seeker must cite facts that were sent', () => {
  assert.deepEqual(codes(me('Shipped tooling the whole company uses.')), ['uncited']);
  assert.deepEqual(codes({ ...me('Built a recommendation service.'), unsentRefs: ['F99'] }), [
    'unsent_fact',
  ]);
  assert.deepEqual(
    codes({ ...me('Built the invoice API in Go.', facts.role), unsentRefs: ['F99'] }),
    ['unsent_fact'],
  );
});

test('a fact that changed or may no longer be used takes its statements out', () => {
  assert.deepEqual(
    codes({
      ...me('Built the invoice API in Go.', facts.role),
      facts: [{ body: facts.role.body, usable: false }],
    }),
    ['fact_changed'],
  );
});

test('numbers must be in the facts cited', () => {
  fails(me('Cut invoice processing time by 45%.', facts.result), 'number', '45%');
  fails(me('Led a team of seven developers.', facts.team), 'number', 'seven');
  fails(me('Built the invoice API in 2019.', facts.role), 'number', '2019');
  fails(me('Moved 1,000 batch jobs to Kafka.', facts.result), 'number', '1,000');
  // Mentioned in the job text, not in the facts.
  fails(me('3+ years of Go at Acme Oy.', facts.role), 'number', '3+');
});

test('a statement keeps the qualifier of the number it cites', () => {
  fails(me('Cut invoice processing time by 30%.', facts.result), 'qualifier', 'about 30%');
  fails(me('Cut invoice processing time by over 30%.', facts.result), 'qualifier');
  passes(me('Cut invoice processing time by roughly 30%.', facts.result));
  fails(me('Wrote 10 internal tools.', facts.plus), 'qualifier');
  passes(me('Wrote more than 10 internal tools.', facts.plus));
  // Hedging an exact number is allowed; claiming more is not.
  passes(me('Led a team of about five developers.', facts.team));
  fails(me('Led a team of at least five developers.', facts.team), 'qualifier');
  // "Moreover" is not "over".
  passes(me('Led a team. Moreover 5 developers reported to me.', facts.team));
});

test('months must be in the facts cited, whatever their format', () => {
  passes(me('Backend developer from Mar 2021 to Jun 2024.', facts.role));
  passes(me('Backend developer, 03/2021 – 06/2024.', facts.role));
  fails(me('Backend developer from January 2021.', facts.role), 'date', 'January 2021');
  fails(me('Backend developer from 2021-01.', facts.role), 'date', '2021-01');
});

test('names must be in the facts cited', () => {
  fails(me('Built the invoice API in Go on Kubernetes.', facts.role), 'term', 'Kubernetes');
  fails(me('Built the invoice API with React and S3.', facts.role), 'term', 'React');
  fails(me('Built the invoice API with React and S3.', facts.role), 'term', 'S3');
  fails(me('Used C++ for the invoice API.', facts.role), 'term', 'C++');
  fails(me('Built the invoice API at Globex.', facts.role), 'term', 'Globex');
  // First in a sentence, a name the job text or the facts use is still checked...
  fails(me('Kubernetes clusters ran the invoice API.', facts.role), 'term', 'Kubernetes');
  fails(me('Kafka pipelines replaced the invoice API.', facts.role), 'term', 'Kafka');
  fails(me('AWS hosted the invoice API.', facts.role), 'term', 'AWS');
  // ...and an ordinary word is not.
  passes(me('Built the invoice API in Go.', facts.role));
  passes(me('Experience building the invoice API in Go.', facts.role));
});

test('a statement keeps the words that limit a fact', () => {
  fails(me('Finnish', facts.finnish), 'status', 'basic');
  fails(me('Finnish (basic)', facts.finnish), 'status', 'A2');
  fails(
    me('MSc in Computer Science, University of Turku, 2027', facts.degree),
    'status',
    'expected',
  );
});

test('contact details, work permits, visas and salary never go into a document', () => {
  fails(me('Reach me at someone@example.com.', facts.role), 'sensitive');
  fails(me('Call +358 40 123 4567.', facts.role), 'sensitive');
  fails(me('Holds a residence permit for Finland.', facts.role), 'sensitive');
  fails(me('Needs no visa sponsorship.', facts.role), 'sensitive');
  fails(me('Expects a salary of 5000 euros.', facts.role), 'sensitive');
});

test('placeholders and request refs never go into a document', () => {
  fails(me('Built the invoice API at [Company].', facts.role), 'placeholder');
  fails(me('Built the invoice API in Go {{years}}.', facts.role), 'placeholder');
  fails(me('Built the invoice API (F1).', facts.role), 'placeholder');
});

const job = (text: string, quote: string | null): StatementInput => ({
  about: 'job',
  text,
  quote,
  unsentRefs: [],
  facts: [],
});

test('a statement about the job says only what its quote says', () => {
  passes(
    job(
      'You move 2 billion euros a year across the Nordics.',
      'We move 2 billion euros a year for 40,000 merchants across the Nordics.',
    ),
  );
  fails(job('You move money across the Nordics.', 'We move 2 billion euros a year'), 'term');
  passes(
    job(
      'Example Payments serves 40,000 merchants across the Nordics.',
      'for 40,000 merchants across the Nordics',
    ),
  );
  passes(job('The Platform Engineer role asks for 3+ years of Go.', '3+ years of Go'));
  assert.deepEqual(codes(job('You serve many merchants.', null)), ['uncited']);
  assert.deepEqual(codes(job('You serve many merchants.', 'We serve 50,000 merchants.')), [
    'quote_not_found',
  ]);
  fails(job('You serve 50,000 merchants.', 'for 40,000 merchants'), 'number', '50,000');
  fails(job('You serve merchants in Sweden.', 'for 40,000 merchants'), 'term', 'Sweden');
  fails(job('You serve over 40,000 merchants.', 'for 40,000 merchants'), 'qualifier');
  // A quote that differs from the text only in whitespace is found.
  passes(job('You ask for Kubernetes and AWS.', 'Kubernetes   and\nAWS in production'));
});

const other = (text: string): StatementInput => ({
  about: 'other',
  text,
  quote: null,
  unsentRefs: [],
  facts: [],
});

test('a connecting sentence names nothing but the job and the company', () => {
  passes(other('I am writing to apply for the Platform Engineer role at Example Payments.'));
  passes(other('I would welcome the chance to talk with your team.'));
  passes(other('Dear Hiring Manager,'));
  fails(other('I have built payment systems for 5 years.'), 'number', '5');
  fails(other('I would bring my Kubernetes experience.'), 'term', 'Kubernetes');
  fails(other('Kafka is close to my heart.'), 'term', 'Kafka');
  fails(other('I am excited about your Stockholm office.'), 'term', 'Stockholm');
  fails(other('Please contact me at someone@example.com.'), 'sensitive');
});

test('the vocabulary leaves out headings, list starts and function words', () => {
  const vocabulary = context.vocabulary;
  for (const name of [
    'Kubernetes',
    'AWS',
    'Terraform',
    'Nordics',
    'Kafka',
    'Go',
    'Acme',
    'Finnish',
  ]) {
    assert.ok(vocabulary.has(name), name);
  }
  for (const word of ['What', 'You', 'Bring', 'Experience', 'We', 'Cut', 'Led', 'Wrote', 'Built']) {
    assert.ok(!vocabulary.has(word), word);
  }
});

test('knows a statement that is a cited fact word for word', () => {
  assert.equal(
    isVerbatim(` ${facts.team.body.replace(' ', '\n')} `, [facts.role, facts.team]),
    true,
  );
  assert.equal(isVerbatim('Led five developers.', [facts.team]), false);
});
