import { ErrorHandler } from "../errors/ErrorHandler.ts";

export class Scheduler {
	/**
	 * A safe wrapper around setInterval that catches errors and prevents the loop from crashing.
	 */
	public static safeInterval(
		name: string,
		fn: () => Promise<void> | void,
		ms: number,
	): number {
		return setInterval(async () => {
			try {
				await fn();
			} catch (error) {
				ErrorHandler.handle(error, {
					source: "Scheduler",
					taskName: name,
				});
			}
		}, ms);
	}

	/**
	 * A safe wrapper around setTimeout that catches errors.
	 */
	public static safeTimeout(
		name: string,
		fn: () => Promise<void> | void,
		ms: number,
	): number {
		return setTimeout(async () => {
			try {
				await fn();
			} catch (error) {
				ErrorHandler.handle(error, {
					source: "Scheduler",
					taskName: name,
				});
			}
		}, ms);
	}
}
