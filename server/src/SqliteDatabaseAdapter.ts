/**
 * SQLite database adapter using @db/sqlite (Deno SQLite library)
 */

import { DB } from "https://deno.land/x/sqlite@v3.8/mod.ts";
import type { DatabaseAdapter } from "./persistence.ts";

/**
 * SQLite database adapter implementation
 */
export class SqliteDatabaseAdapter implements DatabaseAdapter {
	private db: DB;

	constructor(path: string = ":memory:") {
		this.db = new DB(path);
		console.log(`SQLite database opened: ${path}`);
	}

	execute(sql: string, params?: unknown[]): void {
		try {
			this.db.query(sql, params as never[] ?? []);
		} catch (error) {
			console.error("SQLite execute error:", error);
			throw error;
		}
	}

	query<T = unknown>(sql: string, params?: unknown[]): T[] {
		try {
			const rows = this.db.queryEntries(sql, params as never[] ?? []);
			return rows as T[];
		} catch (error) {
			console.error("SQLite query error:", error);
			throw error;
		}
	}

	close(): void {
		this.db.close();
		console.log("SQLite database closed");
	}
}
