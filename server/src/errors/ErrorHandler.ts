import { AppError } from "./AppError.ts";
import { ErrorCode, ErrorMessage } from "../../shared/types_shared.ts";

export class ErrorHandler {
	public static handle(
		error: unknown,
		contextOverride: Record<string, unknown> = {},
	): ErrorMessage | null {
		let appError: AppError;

		if (error instanceof AppError) {
			appError = error;
			Object.assign(appError.context, contextOverride);
		} else {
			// Wrap unexpected crashes (e.g. ReferenceError, SyntaxError, external library errors)
			appError = new AppError(
				ErrorCode.INTERNAL_ERROR,
				contextOverride,
				undefined, // Use default message
				false,
				error, // Preserve original error as cause
			);
		}

		if (appError.isClientVisible) {
			return {
				type: "error",
				code: appError.code,
				message: appError.message,
			};
		}
		else {
			this.logError(appError);
		}

		return null;
	}

	private static logError(error: AppError) {
		const logPayload = {
			timestamp: new Date().toISOString(),
			level: "ERROR",
			code: error.code,
			message: error.message,
			context: error.context,
			stack: error.stack,
			// Recursively serialize the cause chain
			cause: this.serializeCause(error.cause, 0),
		};

		const errorMessage = 
			`[${logPayload.timestamp}] [${logPayload.level}] ` +
			`Error Code: ${logPayload.code} - ${logPayload.message}\n` +
			`Context: ${JSON.stringify(logPayload.context)}\n` +
			`Stack Trace: ${logPayload.stack}\n` +
			`Cause: ${logPayload.cause}`;
		console.error(errorMessage);
	}

	/**
	 * Helper to ensure Error objects (which are not JSON-friendly by default)
	 * are properly serialized in logs with increasing indentation.
	 */
	private static serializeCause(cause: unknown, depth: number = 0): string {
		if (!cause) {
			return "none";
		}

		const indent = "  ".repeat(depth);
		const nextIndent = "  ".repeat(depth + 1);

		if (cause instanceof Error) {
			let result = `\n${indent}${cause.name}: ${cause.message}`;
			if (cause.stack) {
				result += `\n${nextIndent}Stack: ${cause.stack.split("\n").join(`\n${nextIndent}`)}`;
			}
			if (cause.cause) {
				result += `\n${nextIndent}Caused by:${this.serializeCause(cause.cause, depth + 1)}`;
			}
			return result;
		}

		return `\n${indent}${JSON.stringify(cause)}`;
	}
}
