'use strict';

const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

describe('Authentication API', () => {
  beforeAll(async () => {
    await helpers.createSchema();
  });

  beforeEach(async () => {
    await helpers.resetDatabase();
  });

  afterAll(async () => {
    await helpers.closeDatabase();
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/register', () => {
    const validUser = {
      name: 'Asha Rao',
      email: 'asha@example.com',
      password: 'super-secret-pw',
    };

    test('registers a new user and returns a JWT', async () => {
      const res = await request(app).post('/api/auth/register').send(validUser);

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ name: validUser.name, email: validUser.email });
      expect(res.body.user.id).toEqual(expect.any(Number));
      expect(typeof res.body.token).toBe('string');
    });

    test('never returns the password or its hash', async () => {
      const res = await request(app).post('/api/auth/register').send(validUser);

      expect(res.body.user).not.toHaveProperty('password');
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(JSON.stringify(res.body)).not.toContain(validUser.password);
    });

    test('rejects a duplicate email with 409', async () => {
      await request(app).post('/api/auth/register').send(validUser);
      const res = await request(app).post('/api/auth/register').send(validUser);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    test('rejects an invalid payload with 400 and lists every problem', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: '', email: 'not-an-email', password: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/validation/i);
      expect(res.body.details).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  describe('POST /api/auth/login', () => {
    const user = { name: 'Dev User', email: 'dev@example.com', password: 'another-secret' };

    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(user);
    });

    test('logs in with correct credentials and returns a token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(user.email);
      expect(typeof res.body.token).toBe('string');
    });

    test('rejects a wrong password with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong-password' });

      expect(res.status).toBe(401);
    });

    test('gives the same generic message for unknown email and wrong password', async () => {
      const wrongPassword = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'wrong-password' });
      const unknownEmail = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-pw' });

      // Identical responses, so the endpoint cannot be used to enumerate
      // which email addresses have accounts.
      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
    });

    test('email matching is case-insensitive', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email.toUpperCase(), password: user.password });

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/auth/me', () => {
    test('returns the current user for a valid token', async () => {
      const { token, email } = await helpers.registerTestUser(request, app);

      const res = await request(app).get('/api/auth/me').set(helpers.authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(email);
    });

    test('rejects a request with no Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
    });

    test('rejects a malformed or forged token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set(helpers.authHeader('this.is.not-a-real-token'));

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid token/i);
    });
  });
});
