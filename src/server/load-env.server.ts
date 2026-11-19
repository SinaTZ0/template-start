import { existsSync } from "node:fs";

/*===== .env =====*/
// Development reads its settings from `.env`. Docker and CI set real environment variables instead, and those win: a
// variable already set is never replaced by the file. Imported first by every module that reads the environment
// (`#/server/config.server`), so whichever loads first finds the file applied.
if (existsSync(".env")) process.loadEnvFile(".env");
