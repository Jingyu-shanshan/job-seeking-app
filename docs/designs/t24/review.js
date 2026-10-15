/* global document, window, location, Option, ResizeObserver, URLSearchParams */
(() => {
  const { screens } = globalThis.T24;
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const get = (id) => document.getElementById(id);
  const controls = ['screen', 'view', 'action', 'state', 'theme', 'width'];
  const labels = {
    overview: 'Overview',
    jobs: 'Jobs',
    runs: 'Runs',
    applications: 'Applications',
    facts: 'Facts',
    profile: 'Your details',
    answers: 'Form answers',
    criteria: 'Criteria',
    sources: 'Sources',
    runner: 'Runner',
    export: 'Export',
  };
  const option = (value, label) => new Option(label, value);
  for (const screen of screens)
    get('screen').add(option(screen.id, `${screen.title} · ${screen.route}`));

  function selection() {
    const [id, query = ''] = location.hash.slice(1).split('?');
    const params = new URLSearchParams(query);
    const screen = byId.get(id) ?? byId.get('facts');
    const view = screen.views[params.get('view')] ? params.get('view') : 'normal';
    const action = screen.actions.find((a) => a.id === params.get('action'));
    return {
      screen,
      view,
      action,
      state: ['ready', 'busy', 'error', 'blocked', 'success'].includes(params.get('state'))
        ? params.get('state')
        : 'ready',
      theme: params.get('theme') === 'dark' ? 'dark' : 'light',
      width: ['1440', '1024', '768', '605', '390', '360'].includes(params.get('width'))
        ? params.get('width')
        : 'auto',
    };
  }

  function navigate(values) {
    const params = new URLSearchParams();
    for (const key of ['view', 'action', 'state', 'theme', 'width'])
      if (values[key]) params.set(key, values[key]);
    location.hash = `${values.screen}?${params}`;
  }

  function feedback(message, tone = '', id = '') {
    const node = document.createElement('div');
    node.className = `feedback ${tone}`;
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    node.tabIndex = -1;
    if (id) node.id = id;
    const p = document.createElement('p');
    p.textContent = message;
    node.append(p);
    return node;
  }

  function navLink(id, active) {
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.dataset.screen = id;
    a.textContent = labels[id] ?? byId.get(id)?.title ?? id;
    if (active === id) a.setAttribute('aria-current', 'page');
    return a;
  }

  function nav(active) {
    const aside = document.createElement('aside');
    aside.className = 'side';
    aside.innerHTML =
      '<a class="brand" href="#overview" data-screen="overview">Job Search<br /> Workbench</a><details class="nav-menu"><summary>Menu · ' +
      (labels[active] ?? 'Your workspace') +
      '</summary><nav aria-label="Main"></nav></details><div class="account"><a href="#guide" data-screen="guide">Quick guide</a><p>sample@example.test</p><a href="#login" data-screen="login">Sign out</a></div>';
    const navigation = aside.querySelector('nav');
    for (const id of ['overview', 'jobs', 'runs', 'applications', 'facts'])
      navigation.append(navLink(id, active));
    const group = document.createElement('p');
    group.className = 'nav-group';
    group.textContent = 'Your setup';
    navigation.append(group);
    for (const id of ['profile', 'answers', 'criteria', 'sources', 'runner', 'export'])
      navigation.append(navLink(id, active));
    return aside;
  }

  function render() {
    const s = selection();
    const page = s.screen;
    get('screen').value = page.id;
    get('view').replaceChildren(
      ...Object.entries(page.views).map(([value, v]) => option(value, v.label)),
    );
    get('view').value = s.view;
    get('action').replaceChildren(
      option('', '页面整体'),
      ...page.actions.map((a) => option(a.id, a.label)),
    );
    get('action').value = s.action?.id ?? '';
    get('state').value = s.state;
    get('state').disabled = !s.action;
    get('theme').value = s.theme;
    get('width').value = s.width;
    get('mapping').textContent =
      `${page.route} → ${page.file} · ${page.task} · 画板 ${page.id}/${s.view}${s.action ? `/${s.action.id}/${s.state}` : ''}`;
    get('notes').textContent = page.notes;
    const preview = get('preview');
    preview.dataset.theme = s.theme;
    preview.style.maxWidth = s.width === 'auto' ? '1440px' : `${s.width}px`;
    preview.replaceChildren();
    const signedOut =
      page.id === 'login' ||
      s.view === 'session-expired' ||
      (page.id === 'not-found' && s.view === 'signedout');
    const shell = document.createElement('div');
    shell.className = 'shell';
    const skip = document.createElement('a');
    skip.href = '#main-content';
    skip.className = 'skip';
    skip.textContent = 'Skip to main content';
    const skipNav = document.createElement('nav');
    skipNav.className = 'skip-nav';
    skipNav.setAttribute('aria-label', 'Skip links');
    skipNav.append(skip);
    shell.append(skipNav);
    if (!signedOut && page.id !== 'desktop') shell.append(nav(page.nav));
    else shell.style.display = 'block';
    const main = document.createElement('main');
    main.id = 'main-content';
    main.tabIndex = -1;
    main.className = page.id === 'login' ? 'login' : 'work';
    if (page.id === 'login')
      main.innerHTML =
        '<a class="brand" href="#login" data-screen="login">Job Search Workbench</a>';
    else
      main.innerHTML =
        '<header><span>Your workspace</span><span>' +
        (labels[page.nav] ?? 'Job Search Workbench') +
        '</span></header>';
    const heading = document.createElement('h1');
    heading.textContent = page.title;
    const intro = document.createElement('p');
    intro.className = 'lead';
    intro.textContent = page.intro;
    main.append(heading, intro);
    const view = page.views[s.view];
    if (view.heading) heading.textContent = view.heading;
    const content = document.createElement('div');
    content.className = 'content';
    if (view.message) main.append(feedback(view.message, view.tone));
    if (view.destination) {
      const a = navLink(view.destination, '');
      a.className = 'button';
      a.textContent = view.cta;
      main.append(a);
    }
    if (view.replace) {
      if (s.view === 'loading')
        content.innerHTML =
          '<div aria-hidden="true"><div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div></div>';
      else if (s.view === 'load-error')
        content.innerHTML = '<button type="button" data-retry>Try again</button>';
      else if (s.view === 'session-expired') content.append(navLink('login', ''));
    } else content.innerHTML = (view.body ?? '') + page.body;
    main.append(content);
    shell.append(main);
    preview.append(shell);
    if (view.open) content.querySelector(`#${view.open}`).open = true;

    // Conditional controls follow the real workflow; the action selector opens its review context.
    const visibleAction = (id, show) => {
      const node = content.querySelector(`[data-operation="${id}"]`);
      if (node) node.hidden = !show && s.action?.id !== id;
    };
    if (page.id === 'approval' && !view.replace) {
      const special = s.action?.id;
      const finished =
        ['applied', 'not-submitted'].includes(s.view) ||
        (s.state === 'success' && ['approve', 'settle-yes', 'settle-no'].includes(special));
      const submitting = ['submitting', 'needs-action'].includes(s.view);
      const unknown = !finished && (s.view === 'to-verify' || special?.startsWith('settle-'));
      const paused = s.view === 'paused' || special === 'continue-fill';
      const approved = s.view === 'approved' || special === 'withdraw-approval';
      visibleAction('approve', !unknown && !paused && !approved && !finished && !submitting);
      visibleAction('look-again', !unknown && !paused && !approved && !finished && !submitting);
      visibleAction('close-fill', !unknown && !finished && !submitting);
      visibleAction('withdraw-approval', approved);
      visibleAction('continue-fill', paused && !unknown);
      visibleAction('settle-yes', unknown);
      visibleAction('settle-no', unknown);
      if (unknown || paused || approved || finished || submitting) {
        const tag = content.querySelector('.badge');
        tag.textContent = finished
          ? s.view === 'not-submitted' || special === 'settle-no'
            ? 'Did not go through'
            : 'Applied'
          : submitting
            ? 'Submitting — awaiting result'
            : unknown
              ? 'Result unknown'
              : paused
                ? 'Needs your action'
                : 'Approved — waiting for runner';
      }
      if (finished) {
        content.querySelector('.badge').className = 'badge';
        content.append(navLink('application', ''));
        content.lastElementChild.textContent = 'Read frozen application';
      }
      if (s.view !== 'normal')
        content.querySelector('[data-operation="approve"] button').disabled = true;
    }
    if (page.id === 'interview') {
      const unprepared =
        ['unprepared', 'external', 'omitted', 'not-submitted', 'bad-excerpt'].includes(s.view) ||
        s.action?.id === 'generate-practice';
      visibleAction('generate-practice', unprepared);
      visibleAction('save-notes', !unprepared);
      const firstPractice = [...content.querySelectorAll('h2')].find(
        (node) => node.textContent === 'Role understanding',
      );
      if (unprepared && firstPractice) {
        let node = firstPractice;
        while (node) {
          const next = node.nextElementSibling;
          node.remove();
          node = next;
        }
      }
      const generate = content.querySelector('[data-action="generate-practice"]');
      if (['external', 'bad-excerpt', 'not-submitted'].includes(s.view)) generate.disabled = true;
      if (s.view === 'omitted') {
        [...content.querySelectorAll('details')]
          .find((node) => node.textContent.includes('M1 ·'))
          ?.remove();
        generate.disabled = true;
        content.prepend(
          feedback(
            'No permitted sent material remains. Interview practice needs a permitted material source or a valid excerpt you explicitly allow.',
            'warning',
          ),
        );
      }
      if (s.view === 'bad-excerpt')
        content.prepend(
          feedback(
            'The proposed work excerpt contains an unsupported sentence. Correct it and grant permission before generating.',
            'error',
          ),
        );
    }
    if (page.id === 'application') {
      const h2 = [...content.querySelectorAll('h2')];
      if (s.view === 'manual' || s.view === 'no-files') {
        for (const title of s.view === 'manual'
          ? ['The form as you approved it', 'What the page showed after Submit']
          : ['Files that went out', 'Facts the files cite']) {
          let node = h2.find((h) => h.textContent === title);
          while (node) {
            const next = node.nextElementSibling;
            node.remove();
            if (!next || next.tagName === 'H2') break;
            node = next;
          }
        }
      }
      if (s.view === 'to-verify') {
        content.querySelector('.badge').textContent = 'Result unknown';
        content.querySelector('[data-screen="interview"]').remove();
        [...content.querySelectorAll('p, pre')]
          .filter((node) => /confirmation observed|Thank you for applying/.test(node.textContent))
          .forEach((node) => node.remove());
      }
    }
    if (page.id === 'fact-edit') {
      if (s.view === 'edit') content.querySelector('select').disabled = true;
    }
    if (page.id === 'facts' && s.view === 'sensitive') {
      const panel = content.querySelector('details:has(input[type="checkbox"])').closest('.panel');
      panel.querySelector('p').textContent = 'Contact email: sample@example.test';
      panel.querySelector('details').open = true;
      panel.querySelector('input[type="checkbox"]').disabled = true;
    }
    if (page.id === 'candidates' && s.view === 'cancelled')
      content.querySelectorAll('input[type="checkbox"]').forEach((node) => {
        node.checked = false;
      });
    if (page.id === 'candidates' && s.view === 'markdown')
      content.querySelector('details').remove();
    if (page.id === 'profile' && s.view === 'blank')
      content.querySelectorAll('input').forEach((node) => {
        node.value = '';
      });
    if (page.id === 'applications')
      content.querySelectorAll('.row h3').forEach((h) => {
        const next = document.createElement('h2');
        next.textContent = h.textContent;
        h.replaceWith(next);
      });
    if (page.id === 'facts' && !view.replace) {
      const filter = content.querySelectorAll('select')[1];
      filter.prepend(new Option('All kinds', 'all'));
      filter.value = 'all';
    }
    if (page.id === 'runs') visibleAction('stop-run', false);
    if (page.id === 'document' && s.view === 'missing')
      content.querySelector('input[type="file"]').disabled = true;

    const disableActions = (ids) =>
      ids.forEach((id) => {
        const node = content.querySelector(`[data-action="${id}"]`);
        if (node) node.disabled = true;
      });
    const removeSection = (title) => {
      let node = [...content.querySelectorAll('h2')].find((h) => h.textContent === title);
      while (node) {
        const next = node.nextElementSibling;
        node.remove();
        if (!next || next.tagName === 'H2') break;
        node = next;
      }
    };
    if (!view.replace) {
      if (s.view === 'empty') {
        if (page.id === 'alerts') {
          removeSection('Imported now');
          removeSection('Imported before');
        }
        if (page.id === 'answers') removeSection('Saved answers (1)');
        if (page.id === 'runs') {
          removeSection('Saved presets');
          removeSection('Recent runs');
        }
        if (page.id === 'runner') removeSection('Tokens');
        if (page.id === 'sources') {
          visibleAction('toggle-source', false);
          visibleAction('remove-source', false);
          content.querySelectorAll('input[type="text"]').forEach((node) => {
            node.value = '';
          });
          [...content.querySelectorAll('p')]
            .find((p) => p.textContent.includes('Last read:'))
            ?.remove();
        }
      }
      if (page.id === 'jobs' && s.view === 'no-eligible') {
        const h = [...content.querySelectorAll('h2')].find((node) =>
          node.textContent.startsWith('Eligible'),
        );
        h.nextElementSibling.remove();
        h.textContent = 'Eligible (0)';
      }
      if (page.id === 'job' && s.view === 'no-text') {
        const read = content.querySelector('[data-operation="read-job"]').cloneNode(true);
        content.replaceChildren(
          navLink('jobs', ''),
          feedback(
            'No original job description saved. No summary, match or draft has been prepared from this listing.',
          ),
          read,
        );
      }
      if (page.id === 'job' && s.view === 'no-facts')
        disableActions(['match', 'resume', 'cover-letter']);
      if (page.id === 'form' && ['unknown', 'unsupported'].includes(s.view))
        disableActions(['start-fill']);
      if (page.id === 'form' && s.view === 'unsupported') {
        content.querySelector('.panel').remove();
      }
      if (page.id === 'runs' && ['budget', 'model-busy'].includes(s.view))
        disableActions(['start-run', 'resume-run']);
      if (page.id === 'document' && s.view === 'missing') {
        content
          .querySelector('.sheet')
          .replaceChildren(
            feedback(
              'The document is unavailable until your name and valid included statements are present.',
              'warning',
            ),
          );
        disableActions(['print', 'verify-pdf']);
      }
      if (page.id === 'facts' && s.view === 'filtered') {
        content.querySelectorAll('.panel').forEach((node) => {
          if (!node.closest('#withdrawn')) node.remove();
        });
        content.querySelectorAll('h2').forEach((node) => {
          if (!node.closest('#withdrawn')) node.remove();
        });
        content.querySelector('.meta').textContent = 'Showing 0 of 3 active facts · Withdrawn 1';
        content.querySelectorAll('select')[1].value = 'Language';
      }
      if (page.id === 'candidates') {
        if (s.view === 'markdown') {
          content.querySelector('.meta').textContent =
            'sample-profile.md · 2 candidates · 1 selected';
          [...content.querySelectorAll('.meta')].slice(1).forEach((node) => {
            node.textContent = 'sample-profile.md · User-corrected text · UTF-8 text fingerprint';
          });
          intro.textContent =
            'Review the text and heading categories before saving. No PDF page numbers apply to Markdown.';
        }
        if (s.view === 'duplicates') {
          const first = content.querySelector('.panel');
          const newCandidate = first.cloneNode(true);
          const batch = first.cloneNode(true);
          first.querySelector('textarea').value =
            'Developed TypeScript services and PostgreSQL APIs.';
          first.querySelector('input[type="checkbox"]').checked = false;
          first.append(
            feedback('Already exists as a current fact. It will be skipped if selected.'),
            navLink('facts', ''),
          );
          first.lastElementChild.textContent = 'View current fact';
          const withdrawn = content.querySelectorAll('.panel')[1];
          withdrawn.querySelector('textarea').value = 'Maintained a legacy reporting service.';
          newCandidate.querySelector('h2').textContent = 'Candidate 3';
          newCandidate.querySelector('.choice').lastChild.textContent = 'Include candidate 3';
          batch.querySelector('h2').textContent = 'Candidate 4';
          batch.querySelector('.choice').lastChild.textContent = 'Include candidate 4';
          batch.querySelector('input[type="checkbox"]').checked = false;
          batch.append(
            feedback(
              'Same text as selected candidate 3 in this batch. Uncheck the earlier candidate to select this one instead.',
              'warning',
            ),
          );
          withdrawn.after(newCandidate, batch);
          content.querySelector('.meta').textContent =
            'sample-profile.pdf · 2 pages · 4 candidates · 1 selected';
        }
        if (s.view === 'cancelled')
          content.querySelector('.meta').textContent =
            'sample-profile.pdf · 2 pages · 2 candidates · 0 selected';
      }
      if (page.id === 'draft') {
        const columns = content.querySelector('.columns');
        const panels = content.querySelectorAll('.panel');
        columns.after(panels[1]);
        const previewLink = content.querySelector('[data-screen="document"]');
        content.append(previewLink);
        const leftOut = ['empty', 'invalid'].includes(s.view) || s.action?.id === 'put-back';
        visibleAction('leave-out', !leftOut);
        visibleAction('put-back', leftOut);
        if (leftOut) panels[0].querySelector('.badge').textContent = 'Left out';
        if (s.view === 'invalid') {
          panels[0].querySelectorAll('.badge')[1].textContent = 'Checks failed';
          panels[0].querySelectorAll('.badge').forEach((node) => node.classList.add('warning'));
          panels[0].querySelector('p').textContent = 'Led a team of twelve.';
          panels[0].querySelector('textarea').value = 'Led a team of twelve.';
          const evidence = columns.children[1];
          evidence.querySelector('.muted').textContent =
            'Changed wording: the proposed statement adds a team of twelve; the cited fact only describes TypeScript services and PostgreSQL APIs.';
          const checks = evidence.querySelector('details');
          checks.querySelector('summary').textContent = 'Why the checks failed';
          checks.querySelector('p').textContent =
            'Number check: twelve (12) is absent from the cited fact. The statement stays left out; remove unsupported wording before trying to include it.';
          checks.open = true;
          disableActions(['put-back']);
        }
      }
      if (page.id === 'runner') {
        if (s.view === 'issued') {
          const secret = document.createElement('pre');
          secret.textContent = 'SAMPLE TOKEN — NOT A REAL CREDENTIAL';
          content.prepend(secret);
        }
        if (s.view === 'revoked') {
          [...content.querySelectorAll('p')].find((node) =>
            node.textContent.includes('Active ·'),
          ).textContent = 'Revoked · no longer permitted to request work';
          visibleAction('revoke-token', false);
        }
      }
    }

    if (s.action && !view.replace) {
      const target = content.querySelector(`[data-operation="${s.action.id}"]`);
      if (!target) {
        main.append(feedback(s.action.blocked, 'warning', 'action-feedback'));
      } else {
        target.hidden = false;
        const button = target.querySelector('button, input');
        if (s.state === 'busy' || s.state === 'blocked') button.disabled = true;
        if (s.state === 'busy') {
          if (button.tagName === 'BUTTON')
            button.textContent =
              (/^(Saving|Confirming|Reading|Creating|Revoking|Starting|Stopping|Resuming|Deleting|Removing|Withdrawing)/.exec(
                s.action.busy,
              )?.[1] ?? 'Working') + '…';
          target.setAttribute('aria-busy', 'true');
          const container = target.closest('.panel') ?? content;
          container.querySelectorAll('input, select, textarea, button').forEach((node) => {
            node.disabled = true;
          });
        }
        if (s.state !== 'ready') {
          const note = feedback(
            s.action[s.state],
            s.state === 'error' ? 'error' : s.state === 'blocked' ? 'warning' : '',
            'action-feedback',
          );
          note.classList.add('op-feedback');
          target.append(note);
          button.setAttribute('aria-describedby', note.id);
          if (
            button.tagName === 'BUTTON' &&
            s.state === 'error' &&
            !['approve', 'print', 'download-export'].includes(s.action.id)
          )
            button.textContent = `Try again: ${s.action.label}`;
          if (s.state === 'error' && s.action.id === 'approve') {
            button.disabled = true;
            target.append(navLink('approval', ''));
            target.lastElementChild.textContent = 'Refresh fill state';
          }
        }
        target.closest('details')?.setAttribute('open', '');
      }
    }

    if (s.action && s.state === 'success' && !view.replace) {
      const id = s.action.id;
      const note = get('action-feedback');
      intro.after(note);
      if (page.id === 'approval' && ['approve', 'settle-yes', 'settle-no'].includes(id)) {
        content.querySelectorAll('.operation').forEach((node) => {
          node.hidden = true;
        });
      }
      if (page.id === 'facts') {
        const withdrawn = content.querySelector('#withdrawn');
        const confirmed = [...content.querySelectorAll('h2')].find(
          (node) => node.textContent === 'Confirmed',
        );
        if (id === 'confirm') {
          const card = content.querySelector('.panel');
          card.querySelector('.badge').textContent = 'Confirmed';
          card.querySelector('.badge').className = 'badge';
          confirmed.after(card);
          card.querySelector('[data-operation="confirm"]').remove();
          const template = [...content.querySelectorAll('.panel')].find(
            (node) => node !== card && node.querySelector('[data-operation="permissions"]'),
          );
          card.append(
            template.querySelector('details').cloneNode(true),
            template.querySelector('.actions').cloneNode(true),
          );
          card.querySelectorAll('input[type="checkbox"]').forEach((node) => {
            node.checked = false;
          });
          [...content.querySelectorAll('h2')].find(
            (h) => h.textContent === 'To confirm',
          ).textContent = 'To confirm (0)';
          content.querySelector('.meta').textContent = 'Active 3 · To confirm 0 · Confirmed 3';
        }
        if (id === 'withdraw') {
          const card = content.querySelector('[data-operation="withdraw"]').closest('.panel');
          card.querySelector('.badge').textContent = 'Withdrawn';
          card.querySelector('.badge').className = 'badge neutral';
          card.querySelector('details').remove();
          card.querySelector('[data-operation="withdraw"]').remove();
          card.querySelector('.muted').textContent =
            'Retained permissions — DeepSeek: not allowed · Materials: allowed. Confirming again keeps these choices.';
          card.append(withdrawn.querySelector('[data-operation="restore"]').cloneNode(true));
          withdrawn.append(card);
          withdrawn.open = false;
          withdrawn.querySelector('summary').textContent = 'Withdrawn (2)';
          content.querySelector('.meta').textContent = 'Active 2 · To confirm 1 · Confirmed 1';
        }
        if (id === 'restore') {
          const card = withdrawn.querySelector('.panel');
          card.querySelector('.badge').textContent = 'Confirmed';
          card.querySelector('.badge').className = 'badge';
          card.querySelector('[data-operation="restore"]').remove();
          [...card.querySelectorAll('p')].find((p) =>
            p.textContent.includes('Retained permissions'),
          ).textContent =
            'Usable in materials: Yes · Allowed for DeepSeek: No. Retained permission choices are in effect.';
          const template = [...content.querySelectorAll('.panel')].find(
            (node) => node !== card && node.querySelector('[data-operation="permissions"]'),
          );
          card.append(
            template.querySelector('details').cloneNode(true),
            template.querySelector('.actions').cloneNode(true),
          );
          confirmed.after(card);
          withdrawn.open = false;
          withdrawn.querySelector('summary').textContent = 'Withdrawn (0)';
          content.querySelector('.meta').textContent = 'Active 4 · To confirm 1 · Confirmed 3';
        }
      }
      if (page.id === 'candidates' && id === 'save-candidates') {
        const selected = content.querySelectorAll('input[type="checkbox"]:checked').length;
        const count = content.querySelectorAll('.panel').length;
        note.textContent = `Added ${selected} · skipped 0 · cancelled ${count - selected}. ${selected ? 'Review the new facts To confirm; both permissions are off.' : 'No facts were added.'}`;
        content.replaceChildren(navLink('facts', ''));
        content.firstElementChild.textContent = selected
          ? 'Review facts To confirm'
          : 'Back to Facts';
      }
      if (page.id === 'draft' && ['leave-out', 'put-back'].includes(id)) {
        const card = content.querySelector('.panel');
        card.querySelector('.badge').textContent = id === 'leave-out' ? 'Left out' : 'Included';
        visibleAction('leave-out', id === 'put-back');
        visibleAction('put-back', id === 'leave-out');
      }
    }
    for (const [index, node] of [...main.querySelectorAll('input, select, textarea')].entries()) {
      node.id = `sample-field-${index}`;
      const label = node.closest('label');
      if (label) label.htmlFor = node.id;
    }
    for (const node of main.querySelectorAll('[data-view-link]')) {
      node.href = '#';
      node.setAttribute('aria-label', `${node.textContent} — view PDF (design example)`);
    }
    // Responsive navigation responds to the pane's own width, including Electron.
    const menu = preview.querySelector('.nav-menu');
    if (menu) menu.open = preview.getBoundingClientRect().width >= 900;
    document.title = `T24 · ${page.title} · ${view.label}`;
    preview.dataset.frame = [page.id, s.view, s.action?.id ?? '', s.state, s.theme, s.width].join(
      '/',
    );
    if (s.view === 'loading') main.setAttribute('aria-busy', 'true');
  }

  for (const id of controls)
    get(id).addEventListener('change', () => {
      const values = Object.fromEntries(controls.map((key) => [key, get(key).value]));
      if (id === 'screen') {
        values.view = 'normal';
        values.action = '';
        values.state = 'ready';
      }
      if (id === 'action') {
        values.view = 'normal';
        values.state = 'ready';
      }
      navigate(values);
    });
  get('preview').addEventListener('click', (event) => {
    const target = event.target.closest(
      '[data-screen], [data-action], [data-retry], [data-view-link], [data-demo], .skip',
    );
    if (!target) return;
    event.preventDefault();
    const s = selection();
    if (target.classList.contains('skip')) {
      get('main-content').focus();
      return;
    }
    if (target.hasAttribute('data-demo') || target.hasAttribute('data-view-link')) return;
    if (target.dataset.screen)
      navigate({ screen: target.dataset.screen, theme: s.theme, width: s.width });
    else
      navigate({
        screen: s.screen.id,
        view: 'normal',
        action: target.dataset.action ?? '',
        state: target.hasAttribute('data-retry') ? 'ready' : 'busy',
        theme: s.theme,
        width: s.width,
      });
  });
  window.addEventListener('hashchange', render);
  const observer = new ResizeObserver(() => {
    const menu = get('preview').querySelector('.nav-menu');
    const wide = get('preview').getBoundingClientRect().width >= 900;
    if (menu && menu.dataset.wide !== String(wide)) {
      menu.open = wide;
      menu.dataset.wide = String(wide);
    }
  });
  observer.observe(get('preview'));
  render();
})();
