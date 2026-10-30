import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { Layout } from '../views/layout.js';
import { DigestPage } from '../views/digest.js';
import { readNight } from './read-night.js';

// GET /digest/:night. Same reader as the JSON route, so the page and the JSON agree (ADR 0001).
export function registerDigestPage(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = readNight(config.runsDir, night);
    if (!digest) {
      return c.html(
        <Layout title="digest" lane={lane()}>
          <h1>digest · {night}</h1>
          <p class="warn">no run log for this night</p>
        </Layout>,
        404,
      );
    }
    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });
}
