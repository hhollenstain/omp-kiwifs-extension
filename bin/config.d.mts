export const PACKAGE_NAME: string;

export interface KiwiConfig {
	url: string;
	urlExplicit: boolean;
	root: string;
	rootExplicit: boolean;
	apiKey: string;
	actor: string;
	space: string;
	mode: string;
	bin: string;
	injectContext: boolean;
	timeoutMs: number;
}

export function normalizeServerUrl(raw: string | undefined): string;
export function expandHome(value: string, home: string): string;
export function pluginsLockPath(env: NodeJS.ProcessEnv, home: string): string;
export function projectOverridePath(cwd: string): string | null;
export function readSettings(options?: {
	home?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): Record<string, unknown>;
export function resolveConfig(input?: {
	env?: NodeJS.ProcessEnv;
	settings?: Record<string, unknown>;
	home?: string;
}): KiwiConfig;
export function loadConfig(options?: {
	home?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}): KiwiConfig;
export function mcpArguments(config: KiwiConfig): { mode: string; args: string[] };
