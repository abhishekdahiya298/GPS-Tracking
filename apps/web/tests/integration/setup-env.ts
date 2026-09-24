// Imported first by every integration test file, before any app module reads env.
process.env.RIO_DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.AUTH_URL = "http://localhost:3000";
process.env.AUTH_SECRET = "integration-test-secret-that-is-at-least-32-chars";
process.env.TRACCAR_WEBHOOK_SECRET = "integration-webhook-secret-at-least-32-chars!!";
process.env.SSE_SESSION_RECHECK_SECONDS = "2";
process.env.SSE_MAX_STREAMS_PER_USER = "3";
export {};
