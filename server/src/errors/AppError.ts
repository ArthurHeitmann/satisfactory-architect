import { ErrorCode } from "../types_shared.ts";

export interface ErrorContext {
	clientId?: string;
	roomId?: string;
	messageType?: string;
	source?: string;
	[key: string]: unknown;
}

const DEFAULT_ERROR_MESSAGES: { [K in ErrorCode]: string } = {
	[ErrorCode.VERSION_MISMATCH]:
		"Client and server versions are incompatible.",
	[ErrorCode.ROOM_NOT_FOUND]: "The requested room does not exist.",
	[ErrorCode.ROOM_FULL]: "The room has reached its maximum capacity.",
	[ErrorCode.INVALID_MESSAGE]: "The received message format is invalid.",
	[ErrorCode.INTERNAL_ERROR]: "An internal server error occurred.",
	[ErrorCode.UPLOAD_NOT_AUTHORIZED]:
		"You are not authorized to upload state to this room.",
	[ErrorCode.STATE_NOT_INITIALIZED]:
		"The room state has not been initialized yet.",
	[ErrorCode.TIMEOUT]: "The operation timed out.",
};

export class AppError extends Error {
	public readonly code: ErrorCode;
	public readonly context: ErrorContext;
	public readonly isClientVisible: boolean;

	constructor(
		code: ErrorCode,
		context: ErrorContext = {},
		message?: string,
		isClientVisible = false,
		cause?: unknown,
	) {
		const finalMessage = message || DEFAULT_ERROR_MESSAGES[code] || code;
		super(finalMessage, { cause });

		this.name = "AppError";
		this.code = code;
		this.context = context;
		this.isClientVisible = isClientVisible;
	}

	/**
	 * Wraps an unknown error into an AppError.
	 * If it's already an AppError, it merges the context.
	 * If it's an external error (e.g. DB error), it becomes the 'cause'.
	 */
	static wrap(
		error: unknown,
		code: ErrorCode,
		context: ErrorContext = {},
		message?: string,
	): AppError {
		if (error instanceof AppError) {
			// Merge new context with existing context
			Object.assign(error.context, context);
			return error;
		}

		// Create new AppError with the original error as the cause
		return new AppError(code, context, message, false, error);
	}
}
