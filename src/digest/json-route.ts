import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './read-night.js';

// GET /api/digest/:night — the same DigestNight the page renders, as JSON.
// Rows come straight from the shared reader (already sorted by job).
export function registerDigestJson(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', (c) => {
    const digest = readNight(config.runsDir, c.req.param('night'));
    if (digest === null) return c.json({ error: 'not found' }, 404);
    return c.json(digest);
  });
}
