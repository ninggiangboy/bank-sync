import { app } from "./app";
import { env } from "./config/env";

app.listen({ port: env.PORT });

console.info(`${env.APP_NAME} API listening on http://localhost:${env.PORT}/api`);
