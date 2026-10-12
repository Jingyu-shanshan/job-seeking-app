import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ExportPage } from './export';

describe('ExportPage', () => {
  it('offers a browser download without cloud backup setup', async () => {
    TestBed.configureTestingModule({ imports: [ExportPage], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ExportPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    const link = page.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link.getAttribute('href')).toBe('/api/export');
    expect(link.textContent?.trim()).toBe('Download the export');
    expect(page.textContent).toContain('Your sign-in details and runner tokens are left out.');
    expect(page.querySelector('h1')?.textContent).toBe('Export your data');
    expect(page.textContent).toContain('your browser’s download folder');
    expect(page.textContent).not.toMatch(/iCloud|Backups|JSA_BACKUP_|db:backup|db:restore/);
  });
});
