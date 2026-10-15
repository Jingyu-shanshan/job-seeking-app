// Static, made-up design content. No API, storage, credentials or model calls.
(() => {
  const op = (id, label, tone = '') => {
    const checkbox = {
      permissions: ['Allow sending to DeepSeek', false],
      'material-permission': ['Allow use in materials', true],
      'toggle-source': ['Use sample-board', true],
      'toggle-alert': ['Use LinkedIn job alerts', true],
    }[id];
    return checkbox
      ? `<div class="operation" data-operation="${id}"><label class="choice"><input type="checkbox" data-action="${id}" ${checkbox[1] ? 'checked' : ''} />${checkbox[0]}</label></div>`
      : `<div class="operation" data-operation="${id}"><button type="button" data-action="${id}" class="${tone}">${label}</button></div>`;
  };
  const link = (id, label, primary = false) =>
    `<a class="${primary ? 'button primary' : ''}" href="#${id}" data-screen="${id}">${label}</a>`;
  const badge = (text, tone = '') => `<span class="badge ${tone}">${text}</span>`;
  const field = (label, value = '', type = 'text') =>
    `<label>${label}<input type="${type}" value="${value}" /></label>`;
  const area = (label, value = '') =>
    `<label>${label}<textarea rows="4">${value}</textarea></label>`;
  const choice = (label, checked = false, disabled = false) =>
    `<label class="choice"><input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />${label}</label>`;
  const notice = (text, tone = '') => `<div class="feedback ${tone}"><p>${text}</p></div>`;
  const actions = (...items) => `<div class="actions">${items.join('')}</div>`;
  const panel = (heading, body) => `<section class="panel"><h2>${heading}</h2>${body}</section>`;
  const rows = (items) =>
    items.map(([title, body]) => `<div class="row"><h3>${title}</h3>${body}</div>`).join('');
  const action = (id, label, busy, error, blocked, success) => ({
    id,
    label,
    busy,
    error,
    blocked,
    success,
  });
  const save = (id, label, noun, blocked = 'Make a change before saving.') =>
    action(
      id,
      label,
      `Saving ${noun}…`,
      `Could not save ${noun}. Your changes are still here. Try again.`,
      blocked,
      `${noun[0].toUpperCase() + noun.slice(1)} saved.`,
    );
  const model = (id, label, noun, blocked) =>
    action(
      id,
      label,
      `DeepSeek is preparing ${noun}. This can take two minutes.`,
      `DeepSeek could not prepare ${noun}. Check the recorded usage before trying again; the request may have used the budget.`,
      blocked,
      `${noun[0].toUpperCase() + noun.slice(1)} ready to review.`,
    );
  const states = (name, empty, extra = {}) => ({
    normal: { label: '正常' },
    loading: { label: '加载', message: `Loading ${name}…`, replace: true },
    'load-error': {
      label: '加载失败 / 重试',
      message: `Could not load ${name}. Try again.`,
      tone: 'error',
      replace: true,
    },
    forbidden: {
      label: '权限不足',
      message:
        'This action is not allowed from this app address. Open the trusted app address and sign in again.',
      tone: 'error',
      replace: true,
    },
    'session-expired': {
      label: '登录过期',
      message:
        'Your session has ended. Sign in to return to this page. Re-enter unsaved changes after signing in.',
      tone: 'warning',
      replace: true,
    },
    ...(empty
      ? {
          empty: {
            label: '首次为空',
            message: empty.text,
            heading: empty.heading,
            destination: empty.destination,
            cta: empty.cta,
            replace: true,
          },
        }
      : {}),
    ...extra,
  });
  const empty = (heading, text, destination, cta) => ({ heading, text, destination, cta });
  const kinds =
    '<label>Kind<select><option>Experience</option><option>Project</option><option>Education</option><option selected>Skill</option><option>Language</option><option>Certification</option><option>Statement</option><option>Other</option></select></label>';
  const paid = (scope) =>
    `<p class="muted prose">One paid DeepSeek request sends this job text and ${scope} outside the EU. Contact details and saved form answers stay out. Actual usage and estimated cost are recorded after the request.</p>`;
  const rule = (title, strength = 'off', unknown = true) =>
    `<fieldset><legend>${title} · Counts as</legend>${['hard', 'preference', 'off'].map((value) => `<label class="choice"><input type="radio" name="${title}" value="${value}" ${strength === value ? 'checked' : ''} />${value === 'hard' ? 'Hard' : value === 'preference' ? 'Preference' : 'Off'}</label>`).join('')}</fieldset>${unknown ? `<label>If ${title.toLowerCase()} is missing or unclear (when hard)<select><option>To confirm</option><option>Rule out</option></select></label>` : ''}`;
  const pdfFile =
    '<p><a href="#" data-view-link>sample-resume.pdf</a> · 2 pages · 48 KiB</p><p class="hash">SHA-256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef</p>';
  const screens = [
    {
      id: 'login',
      route: '/login',
      title: 'Sign in',
      nav: '',
      file: 'apps/web/src/app/login/login.ts',
      task: 'T25–T26',
      intro: 'Use the account created for your workbench.',
      body:
        field('Email', 'sample@example.test', 'email') +
        field('Password', '', 'password') +
        actions(op('sign-in', 'Sign in', 'primary')),
      views: {
        normal: { label: '正常' },
        expired: {
          label: '登录过期',
          message: 'Sign in to return to the page you were viewing.',
          tone: 'warning',
        },
      },
      actions: [
        action(
          'sign-in',
          'Sign in',
          'Signing in…',
          'The email address or password is wrong. Check them and try again.',
          'Enter a valid email address and your password.',
          'Signed in. Returning to the original page.',
        ),
      ],
      notes: '登录前不显示业务导航；保留 next 深链接。无注册、忘记密码或新的账户管理入口。',
    },
    {
      id: 'overview',
      route: '/',
      title: 'Your next step',
      nav: 'overview',
      file: 'apps/web/src/app/home/home.ts',
      task: 'T26',
      intro: 'Build a clear application from your own experience, then review what goes out.',
      body:
        panel(
          'Review your experience',
          '<p>Your imported facts are waiting for confirmation. Confirm each one, then choose its permissions.</p>' +
            link('facts', 'Review facts', true),
        ) +
        '<h2>Before your first application</h2>' +
        rows([
          ['Add your experience', link('facts', 'Open Facts')],
          ['Add your document name', link('profile', 'Open Your details')],
          ['Choose a job', link('paste', 'Paste a job')],
          [
            'Read the materials and the form',
            '<p>Open a job to review the draft, kept PDFs and actual form values.</p>',
          ],
        ]) +
        actions(link('guide', 'Quick guide')),
      views: states(
        'your next steps',
        empty(
          'Start with your experience',
          'Add a fact or import a document. Imported text needs your review and separate permissions.',
          'facts',
          'Add your experience',
        ),
        {
          complete: {
            label: '清单已完成',
            message:
              'Your setup is ready. Choose a job and review its materials before approving an application.',
            destination: 'jobs',
            cta: 'Open Jobs',
          },
        },
      ),
      actions: [],
      notes:
        '仅按真实 Facts/Profile/Jobs/材料状态显示下一步；读过教程不算完成业务任务。当前首页未实现该数据清单，属于 T26。',
    },
    {
      id: 'guide',
      route: '/',
      title: 'A short guide to your workbench',
      nav: 'overview',
      file: 'apps/web/src/app/home/home.ts',
      task: 'T26',
      intro: 'You can skip this guide and return from Quick guide whenever you need it.',
      body:
        '<ol><li><strong>Add your experience.</strong> Import or type facts, review them, then choose model and material permissions independently.</li><li><strong>Choose a job.</strong> Paste its original description. Sources and Runs are optional.</li><li><strong>Review before sending.</strong> Read every statement, check the kept PDFs and actual form values, then approve this one application.</li></ol>' +
        actions(
          op('guide-back', 'Previous'),
          op('guide-next', 'Continue', 'primary'),
          op('guide-skip', 'Skip guide'),
        ),
      views: {
        normal: { label: '第一步', message: 'Step 1 of 3 · Add your experience' },
        step2: {
          label: '第二步',
          message: 'Step 2 of 3 · Choose a job',
          destination: 'paste',
          cta: 'Paste a job',
        },
        step3: {
          label: '第三步 / 完成',
          message:
            'Step 3 of 3 · Review before sending. Finish the guide to return to your original page.',
        },
        'storage-unavailable': {
          label: '本地存储不可用',
          message:
            'Your browser could not remember this guide. You can keep using the app; the guide may appear again.',
          tone: 'warning',
        },
      },
      actions: [
        action(
          'guide-back',
          'Previous',
          'Returning to the previous step…',
          'Could not remember the guide position. You can still use the app.',
          'This is the first step.',
          'Previous step opened.',
        ),
        action(
          'guide-next',
          'Continue',
          'Opening the next step…',
          'Could not remember your progress. You can still continue.',
          'The guide is already finished. Open Quick guide to read it again.',
          'Progress remembered on this device.',
        ),
        action(
          'guide-skip',
          'Skip guide',
          'Closing the guide…',
          'Could not remember that you skipped it. The guide may appear again.',
          'The guide is already closed.',
          'Guide closed. Your original page is available.',
        ),
      ],
      notes:
        '教程是现有路由内的非阻塞区，不新增教程路由。最后一步 Continue 改为 Finish guide；按稳定账户 ID＋版本记录本地状态，存储失败仍继续。',
    },
    {
      id: 'facts',
      route: '/facts',
      title: 'Facts about you',
      nav: 'facts',
      file: 'apps/web/src/app/facts/facts.ts',
      task: 'T22 / T25',
      intro: 'Confirm your experience and choose what may support your applications.',
      body:
        actions(link('import', 'Import PDF or Markdown', true), link('fact-edit', 'Add a fact')) +
        '<p class="meta">Active 3 · To confirm 1 · Confirmed 2</p><div class="form-grid"><label>Status<select><option>All active</option><option>To confirm</option><option>Confirmed</option></select></label>' +
        kinds +
        '</div><h2>To confirm</h2>' +
        panel(
          'Experience',
          badge('To confirm', 'warning') +
            '<p>Built a small internal tool that made weekly reporting easier.</p><p class="meta">Version 1 · sample-profile.pdf · page 1 · reviewed</p><p class="muted">Usable in materials: No · Allowed for DeepSeek: No</p>' +
            actions(op('confirm', 'Confirm', 'primary')),
        ) +
        '<h2>Confirmed</h2>' +
        panel(
          'Skill',
          badge('Confirmed') +
            '<p>Developed TypeScript services and PostgreSQL APIs.</p><p class="muted">Usable in materials: Yes · Allowed for DeepSeek: No</p><details><summary>Permissions</summary><p>These choices are independent. They take effect while this version is confirmed.</p>' +
            actions(
              op('permissions', 'Model permission'),
              op('material-permission', 'Material permission'),
            ) +
            '</details>' +
            actions(link('fact-edit', 'Edit'), op('withdraw', 'Withdraw', 'danger')) +
            '<details><summary>Earlier versions (1)</summary><p>Version 1 · Manual · Withdrawn: Built backend services.</p></details>',
        ) +
        panel(
          'Experience',
          badge('Confirmed') +
            '<p>Collaborated with design and operations to improve an internal workflow.</p><p class="muted">Usable in materials: Yes · Allowed for DeepSeek: No</p>',
        ) +
        '<details id="withdrawn"><summary>Withdrawn (1)</summary><p class="muted">Kept for history. Excluded from current model and material use.</p>' +
        panel(
          'Skill',
          badge('Withdrawn', 'neutral') +
            '<p>Maintained a legacy reporting service.</p><p>Retained permissions — DeepSeek: not allowed · Materials: allowed. Confirming again keeps these choices and re-enables the allowed uses.</p>' +
            actions(op('restore', 'Confirm again'), link('fact-edit', 'Edit')) +
            '<details><summary>Earlier versions</summary><p>Original text remains available.</p></details>',
        ) +
        '</details>',
      views: states(
        'your facts',
        empty(
          'No facts yet',
          'Add a fact or import a PDF or Markdown document. Imported facts start To confirm with both permissions off.',
          'fact-edit',
          'Add a fact',
        ),
        {
          filtered: {
            label: '筛选为空',
            heading: 'No active facts match',
            message:
              'Change or clear these filters. Withdrawn facts remain in the separate section at the bottom.',
            destination: 'facts',
            cta: 'Clear filters',
            replace: true,
          },
          withdrawn: { label: '撤回区展开', open: 'withdrawn' },
          sensitive: {
            label: '敏感事实',
            message:
              'This fact contains contact details, so it never goes to DeepSeek. Material permission remains separate.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        action(
          'confirm',
          'Confirm',
          'Confirming fact…',
          'Could not confirm this fact. It is still To confirm. Try again.',
          'A fact change is already being saved. Wait for it to finish.',
          'Fact confirmed. Both permission choices are unchanged.',
        ),
        save(
          'permissions',
          'Model permission',
          'permission choices',
          'This fact contains sensitive information, so model permission cannot be enabled.',
        ),
        save(
          'material-permission',
          'Material permission',
          'material permission',
          'A fact change is already being saved.',
        ),
        action(
          'withdraw',
          'Withdraw',
          'Withdrawing fact…',
          'Could not withdraw the fact. It remains in its current section. Try again.',
          'This fact has already been withdrawn.',
          'Fact withdrawn. It is now in Withdrawn at the bottom; its text and history are kept.',
        ),
        action(
          'restore',
          'Confirm again',
          'Confirming again…',
          'Could not confirm again. The fact is still withdrawn. Try again.',
          'Another change is being saved. Retained permissions are shown above.',
          'Fact confirmed again with the retained permission choices.',
        ),
      ],
      notes:
        'T22 语义已实现；新视觉由 T25。示例计数与卡片一致；Withdrawn 默认折叠，不受活跃筛选影响。两个 checkbox 各自立即保存并显示反馈；不增加统一授权按钮。',
    },
    {
      id: 'fact-edit',
      route: '/facts',
      title: 'Add or edit a fact',
      nav: 'facts',
      file: 'apps/web/src/app/facts/fact-card.ts',
      task: 'T22 / T25',
      intro: 'Keep the text in your own words. Review it before allowing its use.',
      body:
        link('facts', 'Back to Facts') +
        panel(
          'Fact text',
          kinds +
            area('Text', 'Developed TypeScript services and PostgreSQL APIs.') +
            '<p class="muted">Saving adds a new version To confirm with both permissions off. Earlier versions are kept.</p>' +
            actions(op('save-fact', 'Save fact', 'primary'), link('facts', 'Cancel')),
        ),
      views: {
        normal: { label: '手填' },
        edit: { label: '编辑现有事实' },
        invalid: {
          label: '字段错误',
          message: 'Enter fact text of at most 5,000 characters.',
          tone: 'error',
        },
      },
      actions: [
        save('save-fact', 'Save fact', 'fact', 'Enter non-empty text of at most 5,000 characters.'),
      ],
      notes:
        '不是新路由。新增入口在 Facts；编辑保留身份并生成 proposed 版本。编辑既有事实不改变类别，类别字段仅用于新增。',
    },
    {
      id: 'import',
      route: '/facts',
      title: 'Import your experience',
      nav: 'facts',
      file: 'apps/web/src/app/facts/fact-import.ts',
      task: 'T23 / T25',
      intro: 'Read the text first. Nothing becomes a fact until you save the reviewed candidates.',
      body:
        link('facts', 'Back to Facts') +
        panel(
          'Choose a file',
          '<label>PDF, Markdown or plain text<input type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/plain" /></label><p class="muted">PDF: up to 2 MiB and 20 pages. Text: up to 200,000 characters. Scanned PDFs need text pasted below.</p>' +
            actions(op('read-pdf', 'Read PDF', 'primary'), op('read-markdown', 'Read Markdown')),
        ) +
        panel(
          'Or paste Markdown',
          area(
            'Markdown',
            '## Skills\n- TypeScript and PostgreSQL\n\n## Experience\n- Built 42 APIs in 2021–2024.',
          ) + actions(op('preview-paste', 'Preview text')),
        ) +
        link('candidates', 'Review candidate screen'),
      views: {
        normal: { label: '选择文件 / 粘贴' },
        scanned: {
          label: '扫描件 / 无文字',
          message:
            'No readable text layer was found. Choose a PDF with selectable text or paste the text.',
          tone: 'error',
        },
        password: {
          label: '加密 PDF',
          message: 'This PDF is password-protected. Choose an unlocked copy or paste its text.',
          tone: 'error',
        },
        broken: {
          label: '损坏 / 伪装 PDF',
          message: 'This file could not be read as a PDF. Choose a valid PDF or paste its text.',
          tone: 'error',
        },
        limit: {
          label: '文件 / 页数 / 字数超限',
          message:
            'This import exceeds the limit: 2 MiB, 20 PDF pages or 200,000 text characters. Use a smaller file or paste a shorter section.',
          tone: 'error',
        },
        candidates: {
          label: '候选数超限',
          message: 'This text produces more than 200 candidates. Import it in smaller sections.',
          tone: 'error',
        },
      },
      actions: [
        action(
          'read-pdf',
          'Read PDF',
          'Reading the PDF…',
          'Could not read the PDF. Choose another file or paste its text.',
          'Choose a non-empty PDF within 2 MiB and 20 pages.',
          'PDF text is ready for review. No facts have been saved.',
        ),
        action(
          'read-markdown',
          'Read Markdown',
          'Reading Markdown…',
          'Could not read the text file. Your pasted text is still here. Try another file.',
          'Choose a non-empty text file within the text limit.',
          'Markdown candidates are ready for review. No facts have been saved.',
        ),
        action(
          'preview-paste',
          'Preview text',
          'Preparing candidates…',
          'Could not prepare candidates. Your text is still here. Try again.',
          'Paste non-empty text of at most 200,000 characters.',
          'Candidates are ready for review. No facts have been saved.',
        ),
      ],
      notes:
        'T23 已实现。Read PDF/Markdown 在产品里是选择文件后的同一读取过程，画板按钮用于明确展示动作状态；不新增上传后额外确认步骤。失败仍可重新选文件/粘贴；不存 PDF、不外发。',
    },
    {
      id: 'candidates',
      route: '/facts',
      title: 'Review candidates',
      nav: 'facts',
      file: 'apps/web/src/app/facts/fact-import.ts',
      task: 'T23 / T25',
      intro:
        'Check every date, number and sentence. Columns and tables may be read in the wrong order.',
      body:
        '<p class="meta">sample-profile.pdf · 2 pages · 2 candidates · 1 selected</p><details><summary>PDF page text</summary><h3>Page 1</h3><pre>Skills\nTypeScript and PostgreSQL\nExperience\nBuilt 42 APIs in 2021–2024.</pre><h3>Page 2</h3><pre>Projects\nImproved reporting by 30%.</pre></details>' +
        panel(
          'Candidate 1',
          choice('Include candidate 1', true) +
            kinds +
            area('Text', 'Built 42 APIs in 2021–2024.') +
            '<p class="meta">Pages 1–2 · User-corrected text · source fingerprint</p>' +
            actions(op('split', 'Split at cursor'), op('merge', 'Merge with next')),
        ) +
        panel(
          'Candidate 2',
          choice('Include candidate 2') +
            kinds +
            area('Text', 'TypeScript and PostgreSQL') +
            notice(
              'Already exists as a withdrawn fact. Selecting this duplicate will skip it; viewing it does not restore it.',
              'warning',
            ) +
            link('facts', 'View withdrawn fact / confirm again'),
        ) +
        actions(
          op('save-candidates', 'Save selected candidates', 'primary'),
          op('discard', 'Discard preview'),
        ) +
        '<p class="muted">Saved facts are To confirm with both permissions off. Unchecked candidates are cancelled. Duplicate text is checked again when saving.</p>',
      views: {
        normal: { label: 'PDF 候选' },
        markdown: {
          label: 'Markdown 候选',
          message:
            'sample-profile.md · User-corrected text · headings determine the initial kinds. No PDF page numbers.',
        },
        duplicates: {
          label: '当前 / 本批 / 撤回重复',
          message:
            'Duplicates are unselected initially. Current text, withdrawn text and earlier selected candidates are explained separately. Viewing a fact does not restore it.',
          tone: 'warning',
        },
        cancelled: {
          label: '全部取消',
          message:
            'No candidates selected. Saving records no facts and reports the cancelled count.',
        },
        invalid: {
          label: '选中空白 / 超长',
          message:
            'A selected candidate is blank or exceeds 5,000 characters. Correct it or uncheck it.',
          tone: 'error',
        },
      },
      actions: [
        action(
          'split',
          'Split at cursor',
          'Splitting candidate…',
          'Place the cursor between two non-empty parts.',
          'Select a cursor position that leaves text on both sides; no more than 200 candidates.',
          'Candidate split. Both parts keep their source.',
        ),
        action(
          'merge',
          'Merge with next',
          'Merging candidates…',
          'These candidates could not be merged. Their text is still here.',
          'There is no next candidate to merge.',
          'Candidates merged. PDF page provenance is combined.',
        ),
        action(
          'save-candidates',
          'Save selected candidates',
          'Saving reviewed candidates…',
          'No facts were saved. Your corrections and selections are still here. Try saving again.',
          'Correct or uncheck selected blank or oversized candidates.',
          'Added 1 · skipped 0 · cancelled 1. Review the new facts To confirm; both permissions are off.',
        ),
        action(
          'discard',
          'Discard preview',
          'Closing preview…',
          'Could not close this preview. Your review is still here.',
          'A save is in progress. Wait for its result.',
          'Unsaved preview discarded. You may choose a new file.',
        ),
      ],
      notes:
        '预览和编辑不写库；保存整批原子；重复项不是历史版本正文去重。PDF 与 Markdown 来源有各自字段，页码仅 PDF。失败保留输入，全部取消合法。',
    },
    {
      id: 'jobs',
      route: '/jobs',
      title: 'Jobs',
      nav: 'jobs',
      file: 'apps/web/src/app/jobs/jobs.ts',
      task: 'T27',
      intro: 'Jobs from the sources you use, grouped by your hard criteria.',
      body:
        actions(link('paste', 'Paste a job', true), link('alerts', 'Import job-alert emails')) +
        panel(
          'Read your boards',
          field('Eligible jobs wanted (optional)', '', 'number') +
            actions(op('discover', 'Find jobs')) +
            '<p class="muted">Only enabled Greenhouse and Ashby boards are read. Other sites can be pasted, imported from email or saved in the desktop app.</p>',
        ) +
        '<p class="meta">Location: Helsinki and Espoo · Criteria apply to this list</p><h2>Eligible (1)</h2>' +
        rows([
          [
            'Backend Engineer',
            '<p>Sample Company · Helsinki · Greenhouse</p>' +
              badge('Eligible') +
              link('job', 'Open job'),
          ],
        ]) +
        '<h2>To confirm (1)</h2>' +
        rows([
          [
            'Platform Developer',
            '<p>Example Company · Remote location unclear</p>' +
              badge('To confirm', 'warning') +
              '<p>The job does not say whether it may be done from Finland.</p>' +
              link('job', 'Read job text'),
          ],
        ]) +
        '<details><summary>Ruled out (1)</summary><p>Sample Analyst · Outside your hard location criterion.</p></details>',
      views: states(
        'jobs',
        empty(
          'No jobs yet',
          'Paste one original job description, import an alert email or enable a job board.',
          'paste',
          'Paste a job',
        ),
        {
          'no-eligible': {
            label: '没有合格职位',
            message:
              'No jobs currently meet all your hard criteria. Read To confirm or review your criteria; unknown information is not a pass.',
            tone: 'warning',
          },
          'discovery-partial': {
            label: '发现部分失败',
            message:
              'One board could not be read. Jobs read from other boards are kept; review the run result before retrying.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        action(
          'discover',
          'Find jobs',
          'Reading your enabled boards. This can take a minute.',
          'Could not finish reading the boards. Previously saved jobs remain; review any partial results before trying again.',
          'Enable a supported board on Sources, or paste a job instead.',
          'Board reading finished. Review Eligible, To confirm and Ruled out.',
        ),
      ],
      notes:
        '不用新匹配分数、全网搜索或搜索框。未配置来源不阻止手动粘贴。不存在 Jobs 页面搜索筛选；“没有合格职位”是条件结果，区别于 Facts 筛选空态。',
    },
    {
      id: 'paste',
      route: '/jobs/paste',
      title: 'Paste a job',
      nav: 'jobs',
      file: 'apps/web/src/app/jobs/paste-job.ts',
      task: 'T27',
      intro: 'Paste the original description from the page you are reading.',
      body:
        link('jobs', 'Back to Jobs') +
        '<div class="prose">' +
        field('Job title', 'Backend Engineer') +
        field('Company', 'Sample Company') +
        field('Location', 'Helsinki') +
        field('Job URL (required HTTPS link)', 'https://example.test/jobs/backend', 'url') +
        area(
          'Original job text',
          'Develop and maintain backend services. Work with relational databases. Partner with product and operations.',
        ) +
        '<p class="muted">Saving does not call DeepSeek. Read and summarise the job afterwards.</p>' +
        actions(op('save-job', 'Save the job', 'primary')) +
        '</div>',
      views: {
        normal: { label: '正常' },
        invalid: {
          label: '字段错误',
          message: 'Enter a title, an HTTPS job URL and the original job text.',
          tone: 'error',
        },
      },
      actions: [
        save(
          'save-job',
          'Save the job',
          'job',
          'Enter the required title, HTTPS job URL and original text within the supported limits.',
        ),
      ],
      notes: '原文、URL、公司和地点沿用现有契约；失败保留文本；成功导航到保存的职位。',
    },
    {
      id: 'alerts',
      route: '/jobs/alerts',
      title: 'Import job-alert emails',
      nav: 'jobs',
      file: 'apps/web/src/app/jobs/import-alerts.ts',
      task: 'T27',
      intro: 'Paste an email’s original source or choose .eml files. No mailbox is connected.',
      body:
        link('jobs', 'Back to Jobs') +
        '<details><summary>How to get an email’s source</summary><p>Use your mail app’s Show original or Download message option.</p></details>' +
        area(
          'Email source',
          'From: alerts@example.test\nSubject: Example jobs\n\nSample job content',
        ) +
        '<label>Or choose .eml files<input type="file" accept=".eml" multiple /></label>' +
        actions(op('import-emails', 'Import emails', 'primary')) +
        '<h2>Imported now</h2>' +
        rows([
          [
            'Sample alert',
            '<p>1 job added · 1 existing job linked · 0 unresolved addresses</p>' +
              link('job', 'Open job'),
          ],
        ]) +
        '<h2>Imported before</h2><p class="muted">Imported message identifiers and job links remain available. The original email is not kept.</p>',
      views: states(
        'email imports',
        empty(
          'No imported emails yet',
          'Paste an original alert message or choose .eml files above.',
          'alerts',
          'Import an email',
        ),
        {
          unsupported: {
            label: '不支持的提醒',
            message:
              'This message is not a recognised job alert. Paste the job description instead.',
            tone: 'warning',
            destination: 'paste',
            cta: 'Paste a job',
          },
          partial: {
            label: '部分文件失败',
            message:
              'One message failed; the others imported. Results show each message separately. Retry only the failed file.',
            tone: 'warning',
          },
          unresolved: {
            label: '地址未解析',
            message:
              'An encrypted tracking link could not be resolved. The job is kept without an address; paste its original description.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        action(
          'import-emails',
          'Import emails',
          'Reading the selected emails…',
          'This message could not be imported. The email text is still here. Results show any other messages already imported.',
          'Paste original email source or select non-empty .eml files within the existing limits.',
          'Imports finished. Review new, existing and unresolved jobs per message.',
        ),
      ],
      notes: '不是邮箱 OAuth；不把普通阅读提醒当作职位提醒。多文件可能部分成功，不声称整批回滚。',
    },
    {
      id: 'job',
      route: '/jobs/:id',
      title: 'Backend Engineer',
      nav: 'jobs',
      file: 'apps/web/src/app/jobs/job-detail.ts',
      task: 'T27',
      intro: 'Sample Company · Helsinki · Example original job description',
      body:
        link('jobs', 'All jobs') +
        '<ol class="steps"><li>Source</li><li aria-current="step">Summary</li><li>Match</li><li>Materials</li><li>Form</li><li>Review</li></ol><div class="columns"><div><h2>Your criteria</h2>' +
        badge('Eligible') +
        '<p>Location: Helsinki · No hard criterion failed.</p><h2>What the role asks for</h2>' +
        rows([
          [
            'TypeScript services',
            '<p>“Develop and maintain backend services.”</p><details><summary>View source quote</summary><p>Original job text: Develop and maintain backend services.</p></details>',
          ],
          ['Relational databases', '<p>“Work with relational databases.”</p>'],
        ]) +
        '<details><summary>Edit requirement</summary>' +
        area('What the job asks for', 'TypeScript services') +
        '<label>Kind<select><option>Must have</option><option>Nice to have</option></select></label>' +
        area('Quote from the job text', 'Develop and maintain backend services.') +
        '<p class="muted">A quote not found in the original stays To confirm.</p>' +
        actions(
          op('save-requirement', 'Save requirement'),
          op('remove-requirement', 'Remove requirement', 'danger'),
        ) +
        '</details>' +
        '<h2>Match with your facts</h2><p>TypeScript: confirmed evidence available. Team leadership: no evidence yet.</p>' +
        paid('confirmed facts allowed for DeepSeek') +
        actions(op('match', 'Match requirements with facts')) +
        '</div><div><h2>Original job</h2><details><summary>Read original text</summary><pre>Develop and maintain backend services.\nWork with relational databases.\nPartner with product and operations.</pre></details>' +
        actions(op('read-job', 'Read job text'), op('summary', 'Summarise')) +
        '<p class="muted">One paid DeepSeek request sends only this job text outside the EU; no personal facts are sent for a summary.</p>' +
        '<h2>Materials</h2>' +
        paid('confirmed facts allowed for both DeepSeek and materials') +
        actions(op('resume', 'Write resume', 'primary'), op('cover-letter', 'Write cover letter')) +
        link('draft', 'Review current draft') +
        '<h2>Application form</h2>' +
        actions(op('read-form', 'Read application form')) +
        link('form', 'Review answers and fill') +
        '<h2>Applications</h2>' +
        link('manual', 'I applied outside the app') +
        '</div></div><h2>Recorded model usage</h2><p class="meta">Illustrative records: 2 summary requests · 0 failed · estimated US$0.0012; 1 match request · 0 failed · estimated US$0.0006; 1 resume request · 0 failed · estimated US$0.0009. These are recorded estimates, not a quote for the next request.</p>',
      views: states('this job', null, {
        'no-text': {
          label: '缺少 JD 原文',
          message:
            'This job only has a listing or email snippet. Read a supported source, paste its original description or save its page in the desktop app.',
          tone: 'warning',
          destination: 'paste',
          cta: 'Paste original text',
        },
        stale: {
          label: '原文 / 总结 / 匹配过期',
          message:
            'The job text or facts have changed. Earlier results are kept as history; read and prepare current results before using them.',
          tone: 'warning',
        },
        'no-facts': {
          label: '没有可外发事实',
          message:
            'Matching needs confirmed facts allowed for DeepSeek. Drafts need confirmed facts allowed for both DeepSeek and materials.',
          tone: 'warning',
          destination: 'facts',
          cta: 'Review fact permissions',
        },
        'not-found': {
          label: '职位不存在',
          message: 'This job could not be found. Return to the job list.',
          destination: 'jobs',
          cta: 'All jobs',
          replace: true,
        },
      }),
      actions: [
        action(
          'read-job',
          'Read job text',
          'Reading the original job description…',
          'The source could not be read. Existing text is kept; paste the description or use the desktop app.',
          'None of the enabled supported sources lists this job. Paste its original text.',
          'Original job text saved. Check whether earlier results are outdated.',
        ),
        model(
          'summary',
          'Summarise',
          'the summary',
          'Save the original job text before summarising.',
        ),
        model(
          'match',
          'Match requirements with facts',
          'the match',
          'Confirm a fact and allow it to go to DeepSeek before matching.',
        ),
        model(
          'resume',
          'Write resume',
          'a resume draft',
          'No confirmed fact is permitted for both model and material use.',
        ),
        model(
          'cover-letter',
          'Write cover letter',
          'a cover letter draft',
          'No confirmed fact is permitted for both model and material use.',
        ),
        save(
          'save-requirement',
          'Save requirement',
          'requirement',
          'Enter requirement text and keep it and the quote within 1,000 characters. A quote absent from the original stays To confirm.',
        ),
        action(
          'remove-requirement',
          'Remove requirement',
          'Removing requirement…',
          'Could not remove the requirement. It remains available. Try again.',
          'Another job change is being saved.',
          'Requirement removed from the current summary.',
        ),
        action(
          'read-form',
          'Read application form',
          'Reading the Greenhouse application form…',
          'Could not read the form. Try again or open the source page.',
          'Only a supported Greenhouse job can be read. Apply manually for other sources.',
          'Form questions are ready for your answers.',
        ),
      ],
      notes:
        '原文缺失和 stale 是不同状态。单个模型动作旁显示用途对应的真实外发内容；各用途旁分别注明外发范围：Summary 仅发 JD，Match 发 JD+模型许可事实，Draft 再要求材料许可；已记录请求数/失败数/费用在页面末尾。引用展开后焦点移到原文；不让未知显示成功。',
    },
    {
      id: 'form',
      route: '/jobs/:id',
      title: 'Application form',
      nav: 'jobs',
      file: 'apps/web/src/app/answers/job-form.ts',
      task: 'T28',
      intro: 'Backend Engineer · Answer required questions before filling the form.',
      body:
        link('job', 'Back to job') +
        panel(
          'Your answers',
          field('First name', 'Sample') +
            field('Email', 'sample@example.test', 'email') +
            '<label>Do you have the right to work in Finland?<select><option>Select an answer</option><option>Yes</option><option>No</option></select></label>' +
            choice('Use this sensitive saved answer for this optional question on this job only') +
            actions(op('save-answer', 'Save answer'), op('choose-answer', 'Use saved answer')) +
            '<p class="muted">Unknown questions wait for your answer. Form answers never go to DeepSeek.</p>',
        ) +
        panel(
          'Files to upload',
          pdfFile + '<p>Choose the kept PDFs you actually intend to send.</p>',
        ) +
        actions(op('start-fill', 'Fill in the form with the runner', 'primary')) +
        '<p class="muted">The runner on your computer opens visible Chrome, fills one form and stops before Submit. Each submission needs your individual approval.</p>' +
        link('approval', 'Review actual form screen'),
      views: states('this form', null, {
        unsupported: {
          label: '不支持的站点',
          message:
            'Only Greenhouse forms are supported. Open this job’s source and apply manually.',
          tone: 'warning',
        },
        unknown: {
          label: '未回答必填题',
          message:
            'Answer the required work-authorisation question before filling. The app does not guess.',
          tone: 'warning',
        },
        'runner-offline': {
          label: 'Runner 离线',
          message:
            'No runner has asked for work recently. Start it on your computer; your answers are kept.',
          tone: 'warning',
          destination: 'runner',
          cta: 'Runner setup',
        },
      }),
      actions: [
        save(
          'save-answer',
          'Save answer',
          'answer',
          'Answer the required question using one of its supported choices.',
        ),
        action(
          'choose-answer',
          'Use saved answer',
          'Applying the selected answer…',
          'Could not use this answer. The previous choice is kept. Try again.',
          'This answer does not fit the question’s choices or location scope.',
          'Answer chosen for this job; the new wording is remembered.',
        ),
        action(
          'start-fill',
          'Fill in the form with the runner',
          'Waiting for the local runner…',
          'Could not start this fill. Your answers and kept PDFs remain available.',
          'Answer required questions and choose current kept PDFs before filling.',
          'The runner filled the form and stopped before Submit. Review what it actually holds.',
        ),
      ],
      notes: '填写不是提交；敏感可选答案仅此职位显式选择。没有新映射模型、远程浏览器或自动批准。',
    },
    {
      id: 'approval',
      route: '/jobs/:id',
      title: 'Review this application',
      nav: 'jobs',
      file: 'apps/web/src/app/runner/job-fill.ts',
      task: 'T28',
      intro: 'Backend Engineer · Sample Company · Read the actual form values before approving.',
      body:
        link('job', 'Back to job') +
        badge('Filled — awaiting approval', 'warning') +
        '<h2>What the form holds</h2><p class="meta">Read from visible Chrome at 14:20 · This is the actual readback</p><dl class="keyvals"><div><dt>First name · required</dt><dd>Sample</dd></div><div><dt>Email · required</dt><dd>sample@example.test</dd></div><div><dt>Right to work in Finland · required</dt><dd>Yes — answered by you</dd></div><div><dt>Resume · required</dt><dd>sample-resume.pdf · matched attachment</dd></div></dl><details><summary>View form screenshot</summary><p class="muted">The product shows the runner’s real screenshot here. The design sample contains no third-party page capture.</p></details><h2>Materials and job text bound to approval</h2>' +
        pdfFile +
        '<p>Original job text captured at 14:00. Read the PDF and confirm that these are the materials you intend to send.</p>' +
        actions(op('look-again', 'Look at the form again')) +
        panel(
          'Submit this application',
          '<p>Approval lets the runner press Submit once for this job, using these fields, this job text and these exact attachments. It reads the form again before submitting; any change invalidates the approval.</p><p class="muted">Example: 1 of at most 5 applications went in or may have in the last 24 hours. The actual remaining count comes from the server.</p>' +
            actions(
              op('approve', 'Approve and submit', 'primary'),
              op('withdraw-approval', 'Withdraw your approval', 'danger'),
              op('close-fill', 'Close the window'),
            ),
        ) +
        actions(
          op('continue-fill', 'Continue'),
          op('settle-yes', 'Yes, it went through'),
          op('settle-no', 'No, it did not go through'),
        ),
      views: states('the form readback', null, {
        approved: {
          label: 'Approved 等待执行',
          message: 'Approval accepted. Waiting for the runner to recheck this exact form.',
        },
        submitting: {
          label: '提交进行中',
          message:
            'The runner is submitting once. Wait for the result; this window cannot be closed now.',
        },
        applied: {
          label: '确认成功',
          message: 'Confirmation observed. This application is recorded as Applied.',
        },
        'not-submitted': {
          label: '用户核实未成功',
          message: 'You verified that it did not go through. The record is kept.',
        },
        paused: {
          label: '填写暂停',
          message: 'Complete the requested action in visible Chrome, then continue the fill.',
          tone: 'warning',
        },
        expired: {
          label: '批准失效',
          message:
            'The form, job text, answers or attachments changed. The runner will not press Submit. Look at the form again and review a new approval.',
          tone: 'warning',
        },
        'needs-action': {
          label: 'CAPTCHA / 邮件验证码',
          message:
            'The page needs your action. Complete the CAPTCHA or security code in visible Chrome. The runner watches for confirmation; do not approve a second submission.',
          tone: 'warning',
        },
        'to-verify': {
          label: '结果未知',
          message:
            'Submit was pressed, but confirmation was not observed. Check the live browser or receipt and say whether it went through. This still counts toward the limit.',
          tone: 'warning',
        },
        cap: {
          label: '24 小时 / 运行名额用完',
          message:
            'The daily or run submission limit has been reached. Wait for capacity; reopening or resuming does not reset used slots.',
          tone: 'warning',
        },
      }),
      actions: [
        action(
          'look-again',
          'Look at the form again',
          'Asking the runner to read the form again…',
          'Could not request another readback. Existing readback stays visible but is not a new approval.',
          'Wait until the current fill is paused or filled; the runner must be available.',
          'New readback is ready. Review its fields and attachments.',
        ),
        action(
          'approve',
          'Approve and submit',
          'Approval sent. The runner rechecks the form before pressing Submit once.',
          'Could not confirm approval. Refresh the fill state before doing anything else; do not start another submission.',
          'The readback is outdated, a required field is unresolved, or the submission limit is exhausted.',
          'Greenhouse confirmation observed. Application recorded as Applied.',
        ),
        action(
          'withdraw-approval',
          'Withdraw your approval',
          'Withdrawing unused approval…',
          'Could not withdraw approval. Refresh the fill state to check whether it was already used.',
          'There is no unused approval; submission has started or finished.',
          'Unused approval withdrawn. The runner will not press Submit on its basis.',
        ),
        action(
          'close-fill',
          'Close the window',
          'Closing this fill…',
          'Could not close the fill. Check the live runner and refresh its state.',
          'Submit is in progress. Wait for its result.',
          'Fill closed. Existing application history remains.',
        ),
        action(
          'continue-fill',
          'Continue',
          'Resuming the paused fill…',
          'Could not continue this fill. Check the visible window and try again.',
          'This fill is not paused, or the runner is unavailable.',
          'Fill continued. Review the next readback before approving.',
        ),
        action(
          'settle-yes',
          'Yes, it went through',
          'Recording your verification…',
          'Could not save your verification. The result remains unknown. Try again.',
          'Verification is available only when the result is unknown.',
          'Your verification recorded: Applied.',
        ),
        action(
          'settle-no',
          'No, it did not go through',
          'Recording your verification…',
          'Could not save your verification. The result remains unknown. Try again.',
          'Verification is available only when the result is unknown.',
          'Your verification recorded: Did not go through.',
        ),
      ],
      notes:
        '正常 filled 只显示 Look again / Approve / Close；unused approved 才显示 Withdraw approval；paused 才显示 Continue；to_verify 才显示核实按钮。审批请求成功仅表示 approved，只有回执或用户核实才 Applied，不能把请求成功当投递成功。',
    },
    {
      id: 'manual',
      route: '/jobs/:id',
      title: 'Record an application you sent yourself',
      nav: 'jobs',
      file: 'apps/web/src/app/applications/job-applications.ts',
      task: 'T29',
      intro: 'Record what was actually sent outside the app. This does not submit anything.',
      body:
        link('job', 'Back to job') +
        field('When you sent it', '', 'datetime-local') +
        field('Where or how (optional)', 'Sent from the employer’s website.') +
        choice('Record the current kept resume PDF as sent') +
        '<label>Other PDFs actually sent<input type="file" accept="application/pdf,.pdf" multiple /></label><p class="muted">The job text must be available. Files are frozen as sent; current drafts do not replace them. Manual records do not use the runner’s daily cap.</p>' +
        actions(op('record-manual', 'Record application', 'primary'), link('job', 'Cancel')),
      views: {
        normal: { label: '正常' },
        'no-text': {
          label: '缺少原文',
          message: 'Save the job’s original text before recording what you sent.',
          tone: 'warning',
        },
        'future-time': {
          label: '时间错误',
          message: 'The sent time must not be in the future.',
          tone: 'error',
        },
      },
      actions: [
        save(
          'record-manual',
          'Record application',
          'application record',
          'Provide a valid sent time and the job text; check the PDF file limits.',
        ),
      ],
      notes: '保存后到冻结记录。没有新投递方式；不将手动记录伪装成执行器回执。',
    },
    {
      id: 'runs',
      route: '/runs',
      title: 'Runs',
      nav: 'runs',
      file: 'apps/web/src/app/runs/runs.ts',
      task: 'T30',
      intro:
        'Find jobs and prepare drafts within a saved budget. Every submission still needs individual approval.',
      body:
        panel(
          'New preset',
          field('Preset name', 'My job search') +
            '<div class="form-grid">' +
            field('Jobs to consider', '20', 'number') +
            field('New drafts', '0', 'number') +
            field('Approved submissions', '0', 'number') +
            field('External requests', '20', 'number') +
            field('Running time (seconds)', '600', 'number') +
            field('Estimated cost limit (USD)', '0', 'number') +
            field('Repeat every (hours; 0 is off)', '0', 'number') +
            '</div><p class="muted prose">Cost, drafts, submissions and repeat are off by default. Model requests send permitted content outside the EU. Unknown usage keeps its reservation. Resuming keeps counts and costs.</p>' +
            actions(op('save-preset', 'Save preset', 'primary')),
        ) +
        '<h2>Saved presets</h2>' +
        rows([
          [
            'My job search',
            '<p>Enabled sources, criteria and limits are captured when starting.</p>' +
              actions(op('start-run', 'Start run')),
          ],
        ]) +
        '<h2>Recent runs</h2>' +
        panel(
          'My job search',
          badge('Stopped', 'warning') +
            '<p>Jobs considered 3 / 20 · requests 2 / 20 · drafts 0 / 0 · submissions 0 / 0</p><p>Recorded estimate: US$0.00 / US$0.00. Resuming does not reset budget; unused approvals were withdrawn.</p>' +
            actions(op('resume-run', 'Resume'), op('stop-run', 'Stop')) +
            '<details><summary>Captured settings and jobs</summary><p>Helsinki and Espoo · Example board · unchanged snapshot</p>' +
            link('job', 'Open job from this run') +
            '</details>',
        ),
      views: states(
        'runs',
        empty(
          'No saved presets or runs',
          'Save a preset with limits. Sources and criteria are captured at start; submitting remains a separate approval.',
          'runs',
          'Create a preset',
        ),
        {
          budget: {
            label: '预算用完',
            message:
              'This run reached a limit. Its completed work and reserved usage are kept. Resuming cannot reset the budget.',
            tone: 'warning',
          },
          'model-busy': {
            label: '模型操作互斥',
            message:
              'A model step is already running elsewhere in this app. Wait for it before starting another.',
            tone: 'warning',
          },
          schedule: {
            label: '定时暂停 / 漏跑',
            message:
              'A stopped or failed run pauses this preset’s schedule. Resume it to continue. Missed times are not replayed; a scheduled new run gets a new budget.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        save(
          'save-preset',
          'Save preset',
          'preset',
          'Correct any invalid limit. Repeat is 0 or 1–168 hours.',
        ),
        action(
          'start-run',
          'Start run',
          'Starting run…',
          'Could not start the run. Check recent runs before retrying to avoid an unintended second run.',
          'Another run is active, or the selected preset is invalid.',
          'Run started with captured sources, criteria and limits.',
        ),
        action(
          'stop-run',
          'Stop',
          'Stopping after the current step…',
          'Could not stop the run. Refresh its status before trying again.',
          'This run is already stopped or finished.',
          'Run stopped. Unused approvals withdrawn; counts and cost reservations retained.',
        ),
        action(
          'resume-run',
          'Resume',
          'Resuming run…',
          'Could not resume the run. Refresh its status before retrying.',
          'Another run is active, the run cannot be resumed, or its budget is exhausted.',
          'Run resumed with the same counts and budgets. Submissions need new approval.',
        ),
      ],
      notes:
        '图中预算/计数是编造示例，与配置相符。初始 defaults 以代码为准，不因视觉改为非零预算；后台不自动填表/批准/提交。',
    },
    {
      id: 'draft',
      route: '/drafts/:id',
      title: 'Resume draft',
      nav: 'jobs',
      file: 'apps/web/src/app/drafts/draft-page.ts',
      task: 'T28',
      intro:
        'Read every statement. Deterministic checks do not prove that a sentence is semantically correct.',
      body:
        link('job', 'Back to job') +
        '<div class="columns"><div><h2>Experience</h2>' +
        panel(
          'Statement 1',
          badge('Included') +
            badge('Checks passed') +
            '<p>Developed TypeScript services and PostgreSQL APIs.</p>' +
            area('Edit statement', 'Developed TypeScript services and PostgreSQL APIs.') +
            actions(
              op('edit-statement', 'Save wording', 'primary'),
              op('leave-out', 'Leave out'),
              op('put-back', 'Put back'),
              op('reset-wording', 'Use model wording'),
            ),
        ) +
        panel(
          'Statement 2',
          badge('Left out', 'warning') +
            '<p>Led a team of twelve.</p><p>No cited evidence supports this claim. It cannot be put back until its checks pass.</p>',
        ) +
        '</div><div><h2>Evidence for statement 1</h2><p>Skill · Fact version 2</p><p>Developed TypeScript services and PostgreSQL APIs.</p><p class="muted">No wording changes.</p><details><summary>Why the checks passed</summary><p>The statement cites a confirmed permitted fact version and adds no unsupported tokens under the deterministic checks.</p></details>' +
        link('document', 'Preview document', true) +
        '</div></div>',
      views: states('this draft', null, {
        stale: {
          label: '引用事实 / JD 变化',
          message:
            'A cited fact or job text has changed. This draft is outdated. Return to the job and prepare a current draft before making a PDF.',
          tone: 'warning',
        },
        invalid: {
          label: '改写校验不通过',
          message:
            'The revised wording does not pass the checks. Read the reason and its cited evidence; do not add unsupported details.',
          tone: 'warning',
        },
        empty: {
          label: '全部陈述移出',
          message:
            'No statements are included. Review the evidence and put back only statements that pass the checks.',
          tone: 'warning',
        },
      }),
      actions: [
        save(
          'edit-statement',
          'Save wording',
          'statement wording',
          'Correct the wording and keep it within the existing statement limit.',
        ),
        action(
          'leave-out',
          'Leave out',
          'Leaving statement out…',
          'Could not leave this statement out. Its current inclusion is unchanged.',
          'Another statement change is being saved.',
          'Statement left out. Its history and evidence are kept.',
        ),
        action(
          'put-back',
          'Put back',
          'Checking and including statement…',
          'Could not put this statement back. It remains left out.',
          'This statement does not pass the deterministic checks.',
          'Statement included after checks. Read it before using the document.',
        ),
        action(
          'reset-wording',
          'Use model wording',
          'Restoring model wording…',
          'Could not restore the model wording. Your current wording remains.',
          'This statement already uses the model wording.',
          'Model wording restored and checked.',
        ),
      ],
      notes:
        '两栏由陈述和当前选中证据组成，窄屏证据紧随对应陈述。Included 不用 Confirmed；Leave out 不用 Withdraw。旧当前版本、diff 和失败原因不删除。',
    },
    {
      id: 'document',
      route: '/drafts/:id/document',
      title: 'Resume for Backend Engineer',
      nav: 'jobs',
      file: 'apps/web/src/app/drafts/document-page.ts',
      task: 'T28',
      intro: 'Read the document, print to PDF, then upload it for text verification.',
      body:
        '<div class="screen-only">' +
        link('draft', 'Back to draft') +
        '<ol><li>Read the document. Change wording in the draft and contact details in Your details.</li><li>Print and choose Save as PDF, A4, with browser headers and footers off.</li><li>Upload that PDF. It is kept only when its text matches the document.</li></ol>' +
        actions(op('print', 'Print', 'primary')) +
        '<label>Upload the PDF<input type="file" accept="application/pdf,.pdf" /></label>' +
        actions(op('verify-pdf', 'Verify uploaded PDF')) +
        '<h2>PDFs the app kept</h2>' +
        pdfFile +
        '</div><article class="sheet" aria-label="Document page"><h2>Sample Candidate</h2><p>sample@example.test · Helsinki</p><h2>Profile</h2><p>Backend developer working with TypeScript services and relational databases.</p><h2>Experience</h2><ul><li>Developed TypeScript services and PostgreSQL APIs.</li><li>Collaborated with design and operations to improve an internal workflow.</li></ul></article>',
      views: states('the document', null, {
        missing: {
          label: '缺姓名 / 可用陈述',
          message:
            'Add your name in Your details and include valid statements before keeping a PDF.',
          tone: 'warning',
          destination: 'profile',
          cta: 'Your details',
        },
        stale: {
          label: '文档已变',
          message:
            'The document changed since the kept PDF. Read and print the current version before uploading it.',
          tone: 'warning',
        },
        mismatch: {
          label: '上传文字不匹配',
          message:
            'This PDF was not kept: text is missing, cut off or added. Print the current document with headers and footers off, then upload it again.',
          tone: 'error',
        },
      }),
      actions: [
        action(
          'print',
          'Print',
          'The browser print dialog is open. Choose Save as PDF.',
          'If the print dialog did not open, use the browser’s Print command. The app cannot read whether you saved a file.',
          'Read and correct the missing document details before making an application PDF.',
          'Print requested. Check the saved file yourself; the app has not kept it yet.',
        ),
        action(
          'verify-pdf',
          'Verify uploaded PDF',
          'Reading and comparing the PDF text…',
          'The PDF was not kept. Read the mismatch details and print the current document again.',
          'Add your name and valid included statements, then select a non-empty PDF within the existing limits.',
          'PDF kept. Its text is the current document’s text.',
        ),
      ],
      notes:
        'Verify uploaded PDF 代表选文件即触发的现有校验，不新增步骤。浏览器对话框没有可观察的“保存成功”。A4 210×297mm / 16mm上下18mm左右，沿用 DocumentSheet；主题只改变界面，文档永远白纸黑字。',
    },
    {
      id: 'applications',
      route: '/applications',
      title: 'Applications',
      nav: 'applications',
      file: 'apps/web/src/app/applications/applications.ts',
      task: 'T29',
      intro: 'What went out, with the job text and files frozen as they were then.',
      body: rows([
        [
          'Backend Engineer · Sample Company',
          badge('Applied') +
            '<p>14 October 2026 · Submitted by the runner</p>' +
            link('application', 'Read frozen application'),
        ],
        [
          'Platform Developer · Example Company',
          badge('Result unknown', 'warning') +
            '<p>Submit was pressed; confirmation was not observed.</p>' +
            link('approval', 'Verify on the job page'),
        ],
        [
          'Sample Analyst · Example Company',
          badge('Did not go through', 'neutral') +
            '<p>You verified that the application did not go through.</p>' +
            link('application', 'Read record'),
        ],
      ]),
      views: states(
        'applications',
        empty(
          'No applications recorded',
          'Choose a job, review its materials and form, or record an application you sent yourself.',
          'jobs',
          'Choose a job',
        ),
      ),
      actions: [],
      notes:
        '不加入不存在的申请筛选或招聘反馈状态。未知结果单独显示，不计作 Applied；冻结记录不是当前草稿。',
    },
    {
      id: 'application',
      route: '/applications/:id',
      title: 'Backend Engineer · Application',
      nav: 'applications',
      file: 'apps/web/src/app/applications/application-page.ts',
      task: 'T29',
      intro: 'Sample Company · 14 October 2026 · Submitted by the runner',
      body:
        link('applications', 'All applications') +
        badge('Applied') +
        actions(link('interview', 'Prepare for an interview', true)) +
        '<h2>Files that went out</h2>' +
        pdfFile +
        actions(op('download-sent', 'Download PDF as sent')) +
        '<h2>Facts the files cite</h2><p>Skill · Version 2: Developed TypeScript services and PostgreSQL APIs.</p><p class="muted">This fact has changed or been withdrawn since. Its historical text is kept here.</p><h2>The form as you approved it</h2><dl class="keyvals"><div><dt>Email</dt><dd>sample@example.test</dd></div><div><dt>Resume</dt><dd>sample-resume.pdf</dd></div></dl><details><summary>Approved form screenshot</summary><p>The frozen screenshot is shown here in the product.</p></details><h2>What the page showed after Submit</h2><p>Greenhouse confirmation observed at 14:22.</p><pre>Thank you for applying. Your application was received.</pre><h2>The frozen match</h2><p>TypeScript and PostgreSQL: evidence available. Team leadership: unknown.</p><h2>The job text as sent</h2><details><summary>Read frozen original</summary><pre>Develop and maintain backend services. Work with relational databases.</pre></details>',
      views: states('this application', null, {
        'to-verify': {
          label: '结果未知',
          message:
            'This application’s result is unknown. Verify on its job page; there is no retry-submit action in this record.',
          tone: 'warning',
          destination: 'approval',
          cta: 'Verify on job page',
        },
        manual: {
          label: '手动记录',
          message:
            'Sent outside the app. The time and sent PDFs were recorded by you; no runner approval or receipt exists.',
        },
        'no-files': {
          label: '未记录文件',
          message:
            'No files were recorded with this application. The record does not invent a sent PDF.',
        },
        missing: {
          label: '记录不存在',
          message: 'This application could not be found.',
          destination: 'applications',
          cta: 'All applications',
          replace: true,
        },
      }),
      actions: [
        action(
          'download-sent',
          'Download PDF as sent',
          'Requesting the frozen PDF…',
          'Could not read this file. Retry the download; the application record is unchanged.',
          'No file was recorded with this application.',
          'Download requested. Check your browser’s download folder.',
        ),
      ],
      notes:
        '整条只读；实际文件下载保留已有普通链接。手动分支没有表单/回执；未知结果不出现面试准备按钮。',
    },
    {
      id: 'interview',
      route: '/applications/:id/interview',
      title: 'Interview preparation',
      nav: 'applications',
      file: 'apps/web/src/app/interviews/interview-page.ts',
      task: 'T29',
      intro:
        'Practice from the frozen job text and materials you actually sent. These are possible questions, not known interview questions.',
      body:
        link('application', 'Back to application') +
        '<h2>Text selected from the frozen application</h2><details><summary>J1 · Job text as sent</summary><pre>Develop and maintain backend services. Work with relational databases.</pre></details><details><summary>M1 · Sent material excerpt</summary><pre>Developed TypeScript services and PostgreSQL APIs.</pre></details><p class="muted">One paid DeepSeek request. Only the selected frozen text and any excerpts you allow leave the EU. Current drafts and private notes are excluded.</p>' +
        actions(op('generate-practice', 'Generate interview practice', 'primary')) +
        '<h2>Role understanding</h2><p>How would you keep a backend service reliable? Sources: J1</p><h2>Resume follow-ups</h2><p>Explain a PostgreSQL query you improved. Sources: M1</p><h2>Behavioural practice</h2><p>How did you work with operations? Confirm the details from your own memory.</p><h2>Questions to ask</h2><p>How does the team review reliability incidents? Sources: J1</p><h2>STAR drafts — to confirm</h2><dl class="keyvals"><div><dt>Situation</dt><dd>Add the actual context.</dd></div><div><dt>Task</dt><dd>Add your own responsibility.</dd></div><div><dt>Action</dt><dd>Developed a service; confirm details.</dd></div><div><dt>Result</dt><dd>Add the actual outcome.</dd></div></dl>' +
        area(
          'Your additions and practice notes — to confirm',
          'Ask about service ownership and team collaboration.',
        ) +
        '<p class="muted">Your notes stay private in the app; they are not sent to DeepSeek or added to facts or materials.</p>' +
        actions(op('save-notes', 'Save notes')),
      views: states('interview preparation', null, {
        unprepared: {
          label: '尚未生成',
          message:
            'Read the selected frozen sources, then choose whether to make one paid request.',
        },
        external: {
          label: '应用外 PDF 摘录授权',
          body: panel(
            'External PDF as sent',
            '<details open><summary>Extracted frozen PDF text</summary><pre>Sample Candidate\nDeveloped TypeScript services and PostgreSQL APIs.</pre></details>' +
              area(
                'Work excerpt to send (optional)',
                'Developed TypeScript services and PostgreSQL APIs.',
              ) +
              choice(
                'I checked these excerpts for private details and allow them to go to DeepSeek outside the EU.',
              ) +
              '<p class="muted">Copy one continuous passage. Leave out your name, contact details, work permit and salary. Blank omits the file.</p>',
          ),
        },
        omitted: {
          label: '历史 / 当前许可不足',
          message:
            'A frozen statement is omitted because its fact no longer permits model use or contains private details. The sent record stays unchanged.',
          tone: 'warning',
        },
        'not-submitted': {
          label: '申请未确认成功',
          message:
            'Interview preparation is available only for an application recorded as Applied.',
          tone: 'warning',
        },
        'bad-excerpt': {
          label: '摘录非原文 / 敏感',
          message:
            'The excerpt is not a continuous part of the extracted text, or contains private details. Correct it before generating.',
          tone: 'error',
        },
      }),
      actions: [
        model(
          'generate-practice',
          'Generate interview practice',
          'interview practice',
          'The application must be Applied. Read valid frozen sources and explicitly allow any external PDF excerpts.',
        ),
        save(
          'save-notes',
          'Save notes',
          'practice notes',
          'Generate practice first, then make a note change within the existing text limit.',
        ),
      ],
      notes:
        '未生成只显示来源/生成；已生成只显示练习/笔记，不再提供生成动作。每份申请一份不可改准备；笔记独立可保存；不引用当前 PDF。',
    },
    {
      id: 'profile',
      route: '/profile',
      title: 'Your details',
      nav: 'profile',
      file: 'apps/web/src/app/profile/profile.ts',
      task: 'T30',
      intro:
        'These details appear on your documents and application forms. They never go to DeepSeek.',
      body:
        '<div class="prose">' +
        field('Name', 'Sample Candidate') +
        '<div class="form-grid">' +
        field('Email', 'sample@example.test', 'email') +
        field('Phone', '+358 40 000 0000', 'tel') +
        '</div>' +
        field('Where you live, as documents should say it', 'Helsinki') +
        '<fieldset><legend>Links (https://…)</legend>' +
        field('Link 1', 'https://example.test/portfolio', 'url') +
        field('Link 2', '', 'url') +
        field('Link 3', '', 'url') +
        '</fieldset><p class="muted">Empty fields are left out. A PDF needs your name. Saving details does not change already sent files.</p>' +
        actions(op('save-profile', 'Save', 'primary')) +
        '</div>',
      views: states('your details', null, {
        blank: {
          label: '首次空白表单',
          message:
            'Fill in only what you want on your documents. Your name is needed before keeping a PDF.',
        },
        invalid: {
          label: '字段错误',
          message: 'Enter a valid email and HTTPS links, or leave optional fields blank.',
          tone: 'error',
        },
      }),
      actions: [save('save-profile', 'Save', 'details')],
      notes:
        '首次为空是可编辑空白表单，不是加载失败。保留 name/email/phone/location/3 links；不新增 profile模型许可。',
    },
    {
      id: 'answers',
      route: '/answers',
      title: 'Form answers',
      nav: 'answers',
      file: 'apps/web/src/app/answers/answers.ts',
      task: 'T30',
      intro: 'Reusable answers you write yourself. Nothing here is sent to DeepSeek.',
      body:
        panel(
          'Add or edit an answer',
          area(
            'Question wordings (one per line)',
            'Are you legally authorised to work in Finland?',
          ) +
            area('Your answer', 'Yes') +
            choice('Several options, one per line, for a multi-select question') +
            field('Places (optional, separated with commas)', 'Finland, Helsinki') +
            choice('Sensitive answer') +
            '<p class="muted">An answer must fit the question wording, choices and location. Optional sensitive questions require your choice for that job.</p>' +
            actions(op('save-answer-record', 'Save answer', 'primary')),
        ) +
        '<h2>Saved answers (1)</h2>' +
        rows([
          [
            'Work authorisation',
            '<p>Yes · Only for jobs in Finland or Helsinki</p>' +
              actions(op('delete-answer', 'Delete answer', 'danger')),
          ],
        ]),
      views: states(
        'form answers',
        empty(
          'No saved answers yet',
          'Add one here, or save the answer you give on a job’s form.',
          'answers',
          'Add an answer',
        ),
      ),
      actions: [
        save(
          'save-answer-record',
          'Save answer',
          'answer',
          'Provide at least one wording and an answer that fits its supported format.',
        ),
        action(
          'delete-answer',
          'Delete answer',
          'Deleting saved answer…',
          'Could not delete this answer. It remains available.',
          'Another answer change is being saved.',
          'Saved answer deleted. Frozen application answers remain unchanged.',
        ),
      ],
      notes:
        'Delete 是答案库现有动作，不套用 Facts 撤回语义。字段名称/拆行方式以 AnswerEditor 为准，不改答案类型或匹配规则。',
    },
    {
      id: 'criteria',
      route: '/criteria',
      title: 'Criteria',
      nav: 'criteria',
      file: 'apps/web/src/app/criteria/criteria.ts',
      task: 'T30',
      intro:
        'Hard criteria rule jobs out. Preferences are shown without excluding them. Missing information is never a pass.',
      body:
        '<div class="prose"><h2>Location</h2><label>Jobs located in<select><option>Helsinki and Espoo</option><option>Finland</option><option>Anywhere</option></select></label>' +
        choice('Also remote jobs') +
        rule('Location', 'hard') +
        '<h2>Job title</h2>' +
        field('Title words (separate with commas)', '') +
        rule('Title', 'off', false) +
        '<h2>Words to avoid</h2>' +
        field('Words to avoid in the title', '') +
        rule('Avoid words', 'off', false) +
        '<h2>Languages</h2>' +
        field('Language names (separate with commas)', '') +
        rule('Languages') +
        '<h2>Employment type</h2>' +
        choice('Full-time') +
        choice('Part-time') +
        choice('Permanent') +
        choice('Fixed-term') +
        choice('Contract or freelance') +
        choice('Internship or trainee') +
        rule('Employment') +
        '<h2>Must-have requirements</h2>' +
        rule('Must-haves', 'preference') +
        '<p class="muted">Changes apply to the current job list; nothing is sent to the model.</p>' +
        actions(op('save-criteria', 'Save criteria', 'primary')) +
        '</div>',
      views: states('criteria', null, {
        invalid: {
          label: '字段错误',
          message:
            'A hard title or language rule needs at least one word. Correct the marked rule before saving.',
          tone: 'error',
        },
      }),
      actions: [save('save-criteria', 'Save criteria', 'criteria')],
      notes:
        'Helsinki 包含 Espoo 不包含 Vantaa；远程必须可从 Finland 工作。各类 CriterionStrengthFields 要逐项保留，不能共用一个全局强度。',
    },
    {
      id: 'sources',
      route: '/sources',
      title: 'Sources',
      nav: 'sources',
      file: 'apps/web/src/app/sources/sources.ts',
      task: 'T30',
      intro: 'Choose supported boards and review how each source may be used.',
      body:
        '<h2>Public job board API</h2>' +
        panel(
          'Greenhouse',
          '<p class="muted">Public board API · Terms checked <a href="https://docs.greenhouse.io/job-board.html" target="_blank" rel="noopener">2026-10-01</a> · app limit: 1 request / 2 seconds</p>' +
            field('Board token', 'sample-board') +
            actions(op('add-source', 'Add board')) +
            actions(
              op('toggle-source', 'Source enabled choice'),
              op('remove-source', 'Remove board', 'danger'),
            ) +
            '<p>Last read: successful · recorded time</p>',
        ) +
        panel(
          'Ashby',
          field('Board name', '') +
            actions(op('add-ashby', 'Add Ashby board')) +
            '<p class="muted">Public board API · Terms checked <a href="https://developers.ashbyhq.com/docs/public-job-posting-api" target="_blank" rel="noopener">2026-10-02</a> · app limit: 1 request / 2 seconds. Use the board name after jobs.ashbyhq.com/.</p>',
        ) +
        '<h2>Job-alert emails</h2><p>Import recognised alerts yourself. The app does not connect to your inbox.</p>' +
        actions(op('toggle-alert', 'Use LinkedIn job alerts')) +
        '<p class="meta">LinkedIn · Job alerts · No alerts imported · supported sender and subject matching</p><details><summary>About LinkedIn alerts</summary><p>The app imports recognised alert messages you bring; it never requests this site. Other configured alert sources use the same enabled/status/metadata layout.</p></details>' +
        link('alerts', 'Import emails') +
        '<h2>You bring the job</h2><p>Browse sites manually, then paste the description or save the visible page in the desktop app.</p>' +
        link('paste', 'Paste a job'),
      views: states(
        'sources',
        empty(
          'No boards added',
          'Add an employer’s supported board token. Manual paste and email import remain available.',
          'sources',
          'Add a board',
        ),
        {
          blocked: {
            label: '来源条款 / 不支持访问',
            message:
              'This source is manual-only or cannot currently be read. Use its stated access method; do not promise automatic discovery.',
            tone: 'warning',
          },
          rate: {
            label: '限流 / 无法访问',
            message:
              'This source could not be read at the recorded time. Keep the status and request limit visible; wait before retrying.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        save(
          'add-ashby',
          'Add Ashby board',
          'Ashby source',
          'Enter a supported board name, rather than a URL.',
        ),
        save(
          'toggle-alert',
          'Use LinkedIn job alerts',
          'alert source selection',
          'A source change is already being saved.',
        ),
        save(
          'add-source',
          'Add board',
          'source',
          'Enter the supported board identifier in the format shown by this source.',
        ),
        save(
          'toggle-source',
          'Source enabled choice',
          'source selection',
          'A source change is already being saved.',
        ),
        action(
          'remove-source',
          'Remove board',
          'Removing source…',
          'Could not remove the board. It remains configured.',
          'A source change is already being saved.',
          'Board removed. Existing jobs and application history remain.',
        ),
      ],
      notes:
        'Source enabled choice 是立即保存 checkbox 的状态展示，不新增按钮；保留 access/terms/rate/status，manual-only 始终真实表述。',
    },
    {
      id: 'runner',
      route: '/runner',
      title: 'Runner',
      nav: 'runner',
      file: 'apps/web/src/app/runner/runner.ts',
      task: 'T30',
      intro:
        'Run the local tool on your computer to fill supported Greenhouse forms in visible Chrome.',
      body:
        '<h2>Starting it</h2><ol><li>Create a token for this computer.</li><li>Set JSA_APP_URL and JSA_RUNNER_TOKEN in your local runner environment.</li><li>Run the existing runner command on your computer. Keep visible Chrome available.</li></ol><p class="muted">The desktop app and runner are separate tools. A token permits runner work; it does not approve an application.</p>' +
        panel(
          'Create a token',
          field('Computer name', 'Sample laptop') +
            actions(op('issue-token', 'Create token', 'primary')),
        ) +
        '<h2>Tokens</h2>' +
        rows([
          [
            'Sample laptop',
            '<p>Active · last seen recently</p>' + actions(op('revoke-token', 'Revoke', 'danger')),
          ],
        ]),
      views: states(
        'runner tokens',
        empty(
          'No runner tokens',
          'Create a token for the computer that will run the local tool.',
          'runner',
          'Create token',
        ),
        {
          issued: {
            label: '一次性显示令牌',
            message:
              'Copy the new token now and keep it private. It cannot be shown again; only a fingerprint is stored.',
          },
          revoked: {
            label: '令牌撤销',
            message:
              'This token is revoked. Create a new token only for the computer you intend to use.',
            tone: 'warning',
          },
          offline: {
            label: '本地运行器离线',
            message:
              'No runner has asked for work recently. Check the local runner; this page does not start it remotely.',
            tone: 'warning',
          },
        },
      ),
      actions: [
        action(
          'issue-token',
          'Create token',
          'Creating token…',
          'Could not create the token. Retry only after checking whether a token was issued.',
          'Enter a computer name within the existing limit.',
          'Token issued. Copy the one-time secret now; it cannot be shown again.',
        ),
        action(
          'revoke-token',
          'Revoke',
          'Revoking token…',
          'Could not revoke this token. Refresh its status before trying again.',
          'This token is already revoked.',
          'Token revoked. It can no longer access runner work.',
        ),
      ],
      notes:
        '不在稿中放任何真实令牌。只描述一次性 secret 展示区域；不添加虚构连接按钮或远程启动。代码/环境说明在此设置页对用户执行操作有必要。',
    },
    {
      id: 'export',
      route: '/export',
      title: 'Export your data',
      nav: 'export',
      file: 'apps/web/src/app/export/export.ts',
      task: 'T30',
      intro: 'Download one private ZIP copy of the data the app keeps.',
      body:
        '<ul><li>facts.md — confirmed facts in importable Markdown</li><li>applications.md — applications and files sent</li><li>data.json — all job-search records</li><li>files/ — kept and sent PDFs and runner screenshots</li><li>manifest.json — file sizes and SHA-256 values</li></ul><p class="prose">Sign-in details and runner tokens are excluded. The export includes your contact details, facts and applications; choose a private place to keep it.</p>' +
        actions(op('download-export', 'Download the export', 'primary')) +
        '<p class="muted">Your browser chooses its download folder. The app does not offer scheduled backups or user-facing restore.</p>',
      views: {
        normal: { label: '正常' },
        'session-expired': {
          label: '登录过期',
          message: 'Sign in again to download your private export.',
          tone: 'warning',
          replace: true,
        },
      },
      actions: [
        action(
          'download-export',
          'Download the export',
          'Download requested. Your browser handles the file transfer.',
          'If no ZIP was downloaded, sign in and try the download again. Keep any partial file separate.',
          'Sign in before downloading your private data.',
          'Download requested. Check your browser’s download folder; the app cannot confirm that you kept the file.',
        ),
      ],
      notes:
        '现有 download anchor 保持直接下载；busy/success 文案表示请求已发起，不增加假下载百分比/自动备份/恢复入口。错误提示是浏览器失败后的恢复说明，不声称现有客户端可检测下载成功。',
    },
    {
      id: 'not-found',
      route: '**',
      title: 'Page not found',
      nav: '',
      file: 'apps/web/src/app/not-found/not-found.ts',
      task: 'T25',
      intro: 'This address does not point to a page in your workbench.',
      body: actions(link('overview', 'Go to Overview', true), link('jobs', 'All jobs')),
      views: {
        normal: { label: '已登录' },
        signedout: {
          label: '未登录',
          message: 'Sign in to open your workbench.',
          destination: 'login',
          cta: 'Sign in',
        },
      },
      actions: [],
      notes: '未知地址仍保留返回入口；未登录不显示业务导航。没有新增路由或错误上报服务。',
    },
    {
      id: 'desktop',
      route: 'Electron toolbar',
      title: 'Built-in browser',
      nav: '',
      file: 'apps/desktop/src/toolbar/toolbar.css',
      task: 'T25',
      intro: 'Browse a site yourself and save only the visible job or visible LinkedIn results.',
      body:
        '<div class="toolbar-example"><div class="toolbar-nav"><button type="button" aria-label="Back" data-demo><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4 6 10l6 6" /></svg></button><button type="button" aria-label="Forward" data-demo><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 6 6-6 6" /></svg></button><button type="button" aria-label="Reload" data-demo><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a7 7 0 1 0 0 6M16 2v5h-5" /></svg></button><label><span class="sr-only">Address</span><input type="url" value="https://example.test/jobs/backend" /></label></div>' +
        actions(
          op('save-visible-job', 'Save this job', 'primary'),
          op('save-visible-results', 'Save jobs on this page'),
        ) +
        '<p role="status">Ready to save the page you are viewing.</p></div><div class="browser-example"><h2>Sample employer page</h2><p>Backend Engineer · Helsinki</p><p>Illustrative third-party content. Browser isolation, cookies and page reading are unchanged.</p></div>',
      views: {
        normal: { label: '正常' },
        signin: {
          label: '应用未登录',
          message: 'Sign in to the app pane before saving this page.',
          tone: 'warning',
        },
        unsupported: {
          label: '不支持的页面',
          message:
            'This page is not a supported job or visible LinkedIn results page. Paste its job text instead.',
          tone: 'warning',
        },
        navigated: {
          label: '页面已导航',
          message:
            'The page changed while saving. Check the page you are viewing, then save again.',
          tone: 'warning',
        },
      },
      actions: [
        action(
          'save-visible-job',
          'Save this job',
          'Reading and saving the visible job…',
          'Could not save this page. Keep the page open and try again, or paste its job text.',
          'Open a supported job page and sign in to the app pane first.',
          'Visible job saved. Open it in the app pane.',
        ),
        action(
          'save-visible-results',
          'Save jobs on this page',
          'Reading and saving visible job entries…',
          'Could not save these entries. Previously saved jobs remain; try again on this visible page.',
          'This is not a supported LinkedIn results page with visible job entries.',
          'Visible entries saved. Review the jobs in the app pane.',
        ),
      ],
      notes:
        '工具栏布局两行控件＋两行状态，目标高度160px；T25 必须同步 main.ts toolbarHeight，不可仍使用96px截断。最小右 pane 479px，app pane 360/605 单独检查；第三方页内容不套应用主题，不扩大抓取范围。',
    },
  ];
  for (const screen of screens)
    if (['alerts', 'answers', 'sources', 'runs', 'runner'].includes(screen.id)) {
      screen.views.empty.replace = false;
      delete screen.views.empty.destination;
      delete screen.views.empty.cta;
    }
  screens.find((screen) => screen.id === 'facts').views.filtered.replace = false;
  globalThis.T24 = { screens, opStates: ['ready', 'busy', 'error', 'blocked', 'success'] };
})();
