import { Routes } from '@angular/router';
import { requireSignIn } from './auth/require-sign-in';
import { Home } from './home/home';
import { Login } from './login/login';
import { NotFound } from './not-found/not-found';

export const routes: Routes = [
  { path: 'login', component: Login, title: 'Sign in' },
  {
    // Every page of the app goes in here, so it needs a signed-in user.
    path: '',
    canActivateChild: [requireSignIn],
    children: [
      { path: '', component: Home, title: 'Job Search Workbench' },
      {
        path: 'jobs',
        loadComponent: () => import('./jobs/jobs').then((m) => m.Jobs),
        title: 'Jobs',
      },
      {
        path: 'jobs/paste',
        loadComponent: () => import('./jobs/paste-job').then((m) => m.PasteJob),
        title: 'Paste a job',
      },
      {
        path: 'jobs/alerts',
        loadComponent: () => import('./jobs/import-alerts').then((m) => m.ImportAlerts),
        title: 'Import job-alert emails',
      },
      {
        path: 'jobs/:id',
        loadComponent: () => import('./jobs/job-detail').then((m) => m.JobDetailPage),
        title: 'Job',
      },
      {
        path: 'applications',
        loadComponent: () => import('./applications/applications').then((m) => m.Applications),
        title: 'Applications',
      },
      {
        path: 'applications/:id',
        loadComponent: () =>
          import('./applications/application-page').then((m) => m.ApplicationPage),
        title: 'Application',
      },
      {
        path: 'drafts/:id',
        loadComponent: () => import('./drafts/draft-page').then((m) => m.DraftPage),
        title: 'Draft',
      },
      {
        path: 'drafts/:id/document',
        loadComponent: () => import('./drafts/document-page').then((m) => m.DocumentPage),
        title: 'Document',
      },
      {
        path: 'profile',
        loadComponent: () => import('./profile/profile').then((m) => m.ProfilePage),
        title: 'Your details',
      },
      {
        path: 'answers',
        loadComponent: () => import('./answers/answers').then((m) => m.Answers),
        title: 'Form answers',
      },
      {
        path: 'facts',
        loadComponent: () => import('./facts/facts').then((m) => m.Facts),
        title: 'Facts about you',
      },
      {
        path: 'criteria',
        loadComponent: () => import('./criteria/criteria').then((m) => m.CriteriaPage),
        title: 'Criteria',
      },
      {
        path: 'sources',
        loadComponent: () => import('./sources/sources').then((m) => m.Sources),
        title: 'Sources',
      },
      {
        path: 'runner',
        loadComponent: () => import('./runner/runner').then((m) => m.RunnerPage),
        title: 'Runner',
      },
    ],
  },
  { path: '**', component: NotFound, title: 'Page not found' },
];
