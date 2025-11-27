import { AppError } from "./AppError.ts";
import { ErrorCode, ErrorMessage } from "../types_shared.ts";

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

		this.logError(appError);

		if (appError.isClientVisible) {
			return {
				type: "error",
				code: appError.code,
				message: appError.message,
			};
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
			cause: this.serializeCause(error.cause),
		};

		console.error(JSON.stringify(logPayload));
	}

	/**
	 * Helper to ensure Error objects (which are not JSON-friendly by default)
	 * are properly serialized in logs.
	 */
	private static serializeCause(cause: unknown): unknown {
		if (cause instanceof Error) {
			return {
				name: cause.name,
				message: cause.message,
				stack: cause.stack,
				cause: cause.cause
					? this.serializeCause(cause.cause)
					: undefined,
			};
		}
		return cause;
	}
}
