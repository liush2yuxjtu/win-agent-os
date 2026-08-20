/** Central constants: env config, limits, DB names. */
import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

// Shared credentials live in ~/.env; project-local dotenv only supplies non-secret overrides.
loadEnv({ path: join(homedir(), ".env") });
loadEnv();

export const DATABASES = ["video_management", "WIN_DOUYIN"] as const;

export interface DbConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	encrypt: boolean;
	trustServerCertificate: boolean;
	connectTimeoutMs: number;
	requestTimeoutMs: number;
}

export function loadDbConfig(): DbConfig {
	return {
		host: process.env.QC_MSSQL_HOST ?? "127.0.0.1",
		port: Number(process.env.QC_MSSQL_PORT ?? 1433),
		user: process.env.QC_MSSQL_USER ?? "",
		password: process.env.QC_MSSQL_PASSWORD ?? "",
		encrypt: (process.env.QC_MSSQL_ENCRYPT ?? "false").toLowerCase() === "true",
		trustServerCertificate:
			(
				process.env.QC_MSSQL_TRUST_SERVER_CERTIFICATE ?? "true"
			).toLowerCase() === "true",
		connectTimeoutMs: Number(process.env.QC_MSSQL_CONNECT_TIMEOUT_MS ?? 10000),
		requestTimeoutMs: Number(process.env.QC_MSSQL_REQUEST_TIMEOUT_MS ?? 30000),
	};
}

export function rawFilesDir(): string {
	return process.env.QC_RAW_FILES_DIR ?? "./raw_files";
}

export const CHARACTER_LIMIT = 40000;

/** Max concurrent DB connections per database — must cover parallel MCP tool calls. */
export const DB_POOL_MAX = 16;
/** Keep at least one warm connection per database so calls reuse, not reconnect. */
export const DB_POOL_MIN = 1;
/** Idle TTL before a pooled connection is closed. */
export const DB_POOL_IDLE_MS = 300_000;
