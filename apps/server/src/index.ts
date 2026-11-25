import { join } from "node:path";
import { createApp } from "./app";
import { env } from "./config/env";
import { db } from "./db";
import { migrateDatabase } from "./db/migrate";
import { createInboxFiles } from "./inbound/inbox-files";
import { createJobHandlers } from "./jobs";
import { createWorker } from "./queue/worker";
import { scheduler } from "./scheduler";

migrateDatabase(db);

const files = createInboxFiles(join(env.STORAGE_PATH, "inbound"));
const app = createApp({ db, files });
if (env.SCHEDULER_ENABLED) app.use(scheduler(db, files));

const worker = createWorker({ db, handlers: createJobHandlers({ db, files }) });
if (env.WORKER_ENABLED) worker.start();

app.listen({ port: env.PORT, maxRequestBodySize: env.UPLOAD_MAX_BYTES + 1024 * 1024 });

console.info(`${env.APP_NAME} API listening on http://localhost:${env.PORT}/api`);

// Finish the job in progress, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.stop();
    await worker.stop();
    process.exit(0);
  });
}
