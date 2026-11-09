import { env } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
    [key: string]: any;
}

/**
 * Normalize Error / PostgrestError / plain objects into a loggable shape.
 * Supabase errors are often not `instanceof Error`, so message/code/details
 * were previously dropped.
 */
export function serializeError(error?: unknown): Record<string, unknown> | undefined {
    if (error === undefined || error === null) return undefined;

    if (error instanceof Error) {
        const anyErr = error as Error & Record<string, unknown>;
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...(anyErr.code !== undefined ? { code: anyErr.code } : {}),
            ...(anyErr.details !== undefined ? { details: anyErr.details } : {}),
            ...(anyErr.hint !== undefined ? { hint: anyErr.hint } : {}),
            ...(anyErr.status !== undefined ? { status: anyErr.status } : {}),
            ...(anyErr.cause !== undefined
                ? { cause: serializeError(anyErr.cause) }
                : {}),
        };
    }

    if (typeof error === "object") {
        const obj = error as Record<string, unknown>;
        return {
            name: typeof obj.name === "string" ? obj.name : "UnknownError",
            message:
                typeof obj.message === "string"
                    ? obj.message
                    : JSON.stringify(obj),
            ...(obj.code !== undefined ? { code: obj.code } : {}),
            ...(obj.details !== undefined ? { details: obj.details } : {}),
            ...(obj.hint !== undefined ? { hint: obj.hint } : {}),
            ...(obj.status !== undefined ? { status: obj.status } : {}),
        };
    }

    return { message: String(error) };
}

class Logger {
    private serviceName: string;
    private minLevel: LogLevel;

    constructor(serviceName: string = "selah-backend") {
        this.serviceName = serviceName;
        this.minLevel = (env.LOG_LEVEL as LogLevel) || "info";
    }

    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ["debug", "info", "warn", "error"];
        return levels.indexOf(level) >= levels.indexOf(this.minLevel);
    }

    private log(level: LogLevel, message: string, context?: LogContext) {
        if (!this.shouldLog(level)) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.serviceName,
            message,
            ...context,
        };

        // In development, pretty-print for better readability
        // In production, output JSON for log aggregation tools
        if (env.NODE_ENV === "development") {
            const emoji = {
                debug: "🔍",
                info: "ℹ️",
                warn: "⚠️",
                error: "❌",
            }[level];
            console.log(
                `${emoji} [${level.toUpperCase()}] ${message}`,
                context ? context : ""
            );
        } else {
            // Production: JSON logs for parsing by monitoring tools
            console.log(JSON.stringify(logEntry));
        }
    }

    debug(message: string, context?: LogContext) {
        this.log("debug", message, context);
    }

    info(message: string, context?: LogContext) {
        this.log("info", message, context);
    }

    warn(message: string, context?: LogContext) {
        this.log("warn", message, context);
    }

    error(message: string, error?: unknown, context?: LogContext) {
        this.log("error", message, {
            ...context,
            error: serializeError(error),
        });
    }

    // Request logging helper
    request(method: string, path: string, context?: LogContext) {
        this.info(`${method} ${path}`, context);
    }
}

export const logger = new Logger();
