/**
 * Worker process scaffold. In v0 the Next.js webhook route writes directly to
 * Postgres and publishes to Redis — this process does no work yet. It exists
 * so the deploy topology (separate container, separate scaling) is right from
 * day one; BullMQ consumers land here once background jobs (history rollups,
 * alert evaluation, notifications) are actually needed.
 */
function main() {
  console.log("rio-gps worker: no queues configured yet (v0 scaffold)");
}

main();
