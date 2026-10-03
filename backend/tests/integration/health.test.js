'use strict';

const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

// The health endpoint is the contract the entire delivery pipeline relies on:
// the Dockerfile HEALTHCHECK, docker compose's depends_on condition, and the
// CD workflow's post-deploy verification all read it. If its shape changes,
// deployments start failing - so it is covered explicitly.

describe('Health and service metadata', () => {
  beforeAll(async () => {
    await helpers.createSchema();
  });

  afterAll(async () => {
    await helpers.closeDatabase();
  });

  describe('GET /health', () => {
    test('returns 200 with status "healthy" when the database is reachable', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'healthy',
        service: 'fintrack-backend',
      });
    });

    test('reports the database check explicitly', async () => {
      const res = await request(app).get('/health');

      expect(res.body.checks).toEqual({ database: 'up' });
    });

    test('includes uptime and a timestamp for deployment logs', async () => {
      const res = await request(app).get('/health');

      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
    });

    test('needs no authentication - Docker and nginx probe it anonymously', async () => {
      const res = await request(app).get('/health');

      expect(res.status).not.toBe(401);
    });
  });

  describe('GET /health/live', () => {
    test('returns a liveness answer without touching the database', async () => {
      const res = await request(app).get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });
  });

  describe('API discovery and error handling', () => {
    test('GET /api lists the available endpoints', async () => {
      const res = await request(app).get('/api');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.endpoints)).toBe(true);
    });

    test('an unknown route returns a clean 404, not an HTML error page', async () => {
      const res = await request(app).get('/api/this-does-not-exist');

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/route not found/i);
    });

    test('a malformed JSON body returns 400 rather than crashing the process', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": broken');

      expect(res.status).toBe(400);
    });

    test('the server does not advertise its framework', async () => {
      const res = await request(app).get('/health');

      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
