declare module "@oh-my-pi/pi-coding-agent" {
	interface ZodSchema {
		optional(): ZodSchema;
		describe(description: string): ZodSchema;
	}

	interface Zod {
		string(): ZodSchema;
		number(): ZodSchema;
		boolean(): ZodSchema;
		array(schema: ZodSchema): ZodSchema;
		object(shape: Record<string, ZodSchema>): ZodSchema;
		record(schema: ZodSchema): ZodSchema;
		unknown(): ZodSchema;
	}

	interface ExtensionContext {
		hasUI: boolean;
		ui: {
			notify(message: string, type?: "info" | "warning" | "error"): void;
		};
	}

	interface ExtensionAPI {
		zod: Zod;
		logger: {
			warn(message: string): void;
		};
		registerTool(tool: {
			name: string;
			label: string;
			description: string;
			parameters: unknown;
			approval?: "read" | "write" | "exec";
			loadMode?: "essential" | "discoverable";
			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
			) => Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown; isError?: boolean }>;
		}): void;
		registerCommand(
			name: string,
			options: {
				description?: string;
				getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }>;
				handler: (args: string, ctx: ExtensionContext) => Promise<void>;
			},
		): void;
		on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
		on(
			event: "before_agent_start",
			handler: (event: { systemPrompt: string[] }, ctx: ExtensionContext) => Promise<{ systemPrompt?: string[] } | void> | { systemPrompt?: string[] } | void,
		): void;
		sendMessage(
			message: { customType?: string; content: string; display?: boolean },
			options?: { triggerTurn?: boolean },
		): void;
	}
}
