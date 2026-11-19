CREATE TABLE "deploy_step" (
	"name" text PRIMARY KEY NOT NULL,
	"commands" integer NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
