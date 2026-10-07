// A stand-in for Greenhouse's Job Board API in tests. Boards and jobs are made up.

export interface FakeJob {
  id: number;
  title?: string;
  location?: string;
  company_name?: string;
  absolute_url?: string;
  first_published?: string;
  content?: string;
  /** What `?questions=true` adds: `questions`, `compliance`, `data_compliance`, … */
  form?: Record<string, unknown>;
}

/** A made-up form like the ones Greenhouse hosts: the standard fields and two of the company's. */
export const greenhouseForm = {
  questions: [
    {
      required: true,
      label: 'First Name',
      description: null,
      fields: [{ name: 'first_name', type: 'input_text', values: [] }],
    },
    {
      required: true,
      label: 'Last Name',
      description: null,
      fields: [{ name: 'last_name', type: 'input_text', values: [] }],
    },
    {
      required: true,
      label: 'Email',
      description: null,
      fields: [{ name: 'email', type: 'input_text', values: [] }],
    },
    {
      required: false,
      label: 'Phone',
      description: null,
      fields: [{ name: 'phone', type: 'input_text', values: [] }],
    },
    {
      required: true,
      label: 'Resume/CV',
      description: null,
      fields: [
        { name: 'resume', type: 'input_file', values: [] },
        { name: 'resume_text', type: 'textarea', values: [] },
      ],
    },
    {
      required: false,
      label: 'Cover Letter',
      description: null,
      fields: [
        { name: 'cover_letter', type: 'input_file', values: [] },
        { name: 'cover_letter_text', type: 'textarea', values: [] },
      ],
    },
    {
      required: false,
      label: 'LinkedIn Profile',
      description: null,
      fields: [{ name: 'question_101', type: 'input_text', values: [] }],
    },
    {
      required: true,
      label: 'Will you now or in the future require sponsorship for a visa?',
      description: '&lt;p&gt;We can sponsor some visas.&lt;/p&gt;',
      fields: [
        {
          name: 'question_102',
          type: 'multi_value_single_select',
          values: [
            { label: 'Yes', value: 1 },
            { label: 'No', value: 0 },
          ],
        },
      ],
    },
    {
      required: true,
      label: 'What is your notice period?',
      description: null,
      fields: [{ name: 'question_103', type: 'input_text', values: [] }],
    },
  ],
  location_questions: [
    {
      required: true,
      label: 'Location',
      fields: [{ name: 'location', type: 'input_text', values: [] }],
    },
    {
      required: true,
      label: 'Latitude',
      fields: [{ name: 'latitude', type: 'input_hidden', values: [] }],
    },
    {
      required: true,
      label: 'Longitude',
      fields: [{ name: 'longitude', type: 'input_hidden', values: [] }],
    },
  ],
  compliance: [
    {
      type: 'eeoc',
      description: '&lt;p&gt;Voluntary self-identification.&lt;/p&gt;',
      questions: [
        {
          required: false,
          label: 'Gender',
          fields: [
            {
              name: 'gender',
              type: 'multi_value_single_select',
              values: [
                { label: 'Decline To Self Identify', value: '3' },
                { label: 'Female', value: '2' },
                { label: 'Male', value: '1' },
              ],
            },
          ],
        },
      ],
    },
  ],
  data_compliance: [
    {
      type: 'gdpr',
      requires_consent: true,
      requires_processing_consent: true,
      requires_retention_consent: false,
      retention_period: null,
      demographic_data_consent_applies: false,
    },
  ],
};

/** A job as Greenhouse lists it, with made-up defaults for the fields not given. */
export function greenhouseJob({ id, location = 'Helsinki, Finland', ...rest }: FakeJob) {
  return {
    id,
    internal_job_id: id + 1000,
    title: `Job ${id}`,
    company_name: 'Acme',
    location: { name: location },
    absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    first_published: '2026-09-01T10:00:00-04:00',
    updated_at: '2026-09-30T10:00:00-04:00',
    requisition_id: null,
    metadata: null,
    ...rest,
  };
}

/**
 * A fetch that answers board list requests from `boards` (by lowercase board name, as Greenhouse
 * does): jobs, an HTTP status, or a function for anything else. Unknown boards answer 404.
 * `requested` collects every URL asked for.
 */
export function fakeGreenhouse(
  boards: Record<string, FakeJob[] | number | (() => Promise<Response>)>,
) {
  const requested: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const [, board, jobId, withForm] =
      /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+)\/jobs(?:\/(\d+))?(\?questions=true)?$/.exec(
        url,
      ) ?? [];
    const answer = board === undefined ? 404 : (boards[board.toLowerCase()] ?? 404);
    if (typeof answer === 'function') return answer();
    const notFound = (status: number) =>
      Response.json({ status, error: 'Job not found' }, { status });
    if (typeof answer === 'number') return notFound(answer);
    if (jobId !== undefined) {
      const job = answer.find((j) => String(j.id) === jobId);
      if (!job) return notFound(404);
      const content = job.content ?? '&lt;p&gt;Made up job text.&lt;/p&gt;';
      const { form = greenhouseForm, ...listed } = job;
      return Response.json({
        ...greenhouseJob(listed),
        content,
        departments: [],
        offices: [],
        ...(withForm ? form : {}),
      });
    }
    // A list has no forms; JSON leaves out the undefined field.
    const jobs = answer.map((job) => greenhouseJob({ ...job, form: undefined }));
    return Response.json({ jobs, meta: { total: jobs.length } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requested };
}
