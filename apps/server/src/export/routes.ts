import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Pool } from 'pg';
import { exportArchive } from './export.ts';

// The user's export (T10): facts and applications as Markdown, every table as JSON and the stored
// PDFs and screenshots, in one zip. It is a copy to keep, not a backup to restore from.
export const exportRoutes: FastifyPluginAsyncTypebox<{ pool: Pool }> = async (app, { pool }) => {
  app.get('/export', async (_request, reply) => {
    const now = new Date();
    const archive = await exportArchive(pool, now);
    const name = `job-search-export-${now.toISOString().slice(0, 10)}.zip`;
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(archive);
  });
};
