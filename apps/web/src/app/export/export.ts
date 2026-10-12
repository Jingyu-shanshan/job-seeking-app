import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A downloadable copy of the user's job-search data (T10). */
@Component({
  selector: 'app-export',
  imports: [RouterLink],
  template: `
    <h1>Export your data</h1>
    <p>
      One zip file with a copy of everything the app keeps about your job search, to read or keep
      somewhere else:
    </p>
    <ul>
      <li>
        <code>facts.md</code>: the confirmed version of each fact, in the Markdown the
        <a routerLink="/facts">Facts</a> page imports.
      </li>
      <li><code>applications.md</code>: each application and the files that went out with it.</li>
      <li>
        <code>data.json</code>: every record as JSON, from job texts and drafts to form answers and
        the runner’s fills.
      </li>
      <li>
        <code>files/</code>: the PDFs you kept and sent and the runner’s screenshots, as they are
        stored.
      </li>
      <li><code>manifest.json</code>: the size and SHA-256 of each of these files.</li>
    </ul>
    <p>
      Your sign-in details and runner tokens are left out. The zip holds your contact details, your
      facts and your applications: keep it somewhere private.
    </p>
    <p>The zip downloads to your browser’s download folder. You choose where to keep it.</p>
    <p><a href="/api/export" download>Download the export</a></p>
  `,
})
export class ExportPage {}
