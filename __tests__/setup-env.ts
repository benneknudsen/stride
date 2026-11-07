// Tests must not inherit a developer's Upstash credentials: `lib/rate-limit.ts`
// would then share Redis counters between suites, making rate-limit tests depend
// on order and on the shell that launched them (issue #366). Clearing both here
// forces the deterministic in-memory fallback for every suite. Tests that need
// the Redis path (__tests__/rate-limit.test.ts) set the env themselves.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
