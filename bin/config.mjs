/**
 * Resolves KiwiFS connection settings for the omp extension and the MCP launcher.
 *
 * Precedence, lowest to highest: built-in defaults, user plugin settings
 * (`omp plugin config`), project `.omp/plugin-overrides.json`, environment.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PACKAGE_NAME = "omp-kiwifs-extension";

export const DEFAULTS = {
	url: "http://127.0.0.1:3333",
	actor: "agent:omp",
	mode: "auto",
	bin: "kiwifs",
	injectContext: true,
	timeoutMs: 15_000,
};

const MODES = new Set(["auto", "root", "remote"]);

/**
 * @param {string | undefined} raw
 */
export function normalizeServerUrl(raw) {
	let url = String(raw ?? "").trim().replace(/\/+$/, "");
	if (!url) return "";
	url = url.replace(/\/mcp$/i, "");
	url = url.replace(/\/api\/kiwi$/i, "");
	url = url.replace(/\/api$/i, "");
	return url.replace(/\/+$/, "");
}

/**
 * @param {string} value
 * @param {string} home
 */
export function expandHome(value, home) {
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
	return value;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 */
export function pluginsLockPath(env, home) {
	const configDir = env.PI_CONFIG_DIR || ".omp";
	if (env.XDG_DATA_HOME) {
		return path.join(env.XDG_DATA_HOME, "omp", "plugins", "omp-plugins.lock.json");
	}
	return path.join(home, configDir, "plugins", "omp-plugins.lock.json");
}

/**
 * @param {string} cwd
 */
export function projectOverridePath(cwd) {
	let current = path.resolve(cwd);
	const root = path.parse(current).root;
	while (true) {
		const candidate = path.join(current, ".omp", "plugin-overrides.json");
		if (fs.existsSync(candidate)) return candidate;
		if (current === root) return null;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/**
 * @param {string} file
 */
function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

/**
 * @param {{ home?: string, cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function readSettings(options = {}) {
	const env = options.env ?? process.env;
	const home = options.home ?? os.homedir();
	const cwd = options.cwd ?? process.cwd();
	const lock = readJson(pluginsLockPath(env, home));
	const globalSettings = lock && typeof lock === "object" && lock.settings && typeof lock.settings === "object"
		? lock.settings[PACKAGE_NAME]
		: undefined;
	const overrideFile = projectOverridePath(cwd);
	const overrides = overrideFile ? readJson(overrideFile) : null;
	const projectSettings = overrides && typeof overrides === "object" && overrides.settings && typeof overrides.settings === "object"
		? overrides.settings[PACKAGE_NAME]
		: undefined;
	return {
		...(isRecord(globalSettings) ? globalSettings : {}),
		...(isRecord(projectSettings) ? projectSettings : {}),
	};
}

/**
 * @param {unknown} value
 */
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function cleanString(value) {
	if (typeof value !== "string") return "";
	return value.trim();
}

/**
 * @param {unknown} value
 */
function cleanBool(value) {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const text = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(text)) return true;
	if (["0", "false", "no", "off"].includes(text)) return false;
	return undefined;
}

/**
 * @param {unknown} value
 */
function cleanTimeout(value) {
	const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isFinite(number)) return undefined;
	return Math.max(1_000, Math.min(120_000, Math.trunc(number)));
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, settings?: Record<string, unknown>, home?: string }} input
 */
export function resolveConfig(input = {}) {
	const env = input.env ?? process.env;
	const settings = input.settings ?? {};
	const home = input.home ?? os.homedir();

	const urlFromSettings = cleanString(settings.url);
	const urlFromEnv = cleanString(env.KIWIFS_URL);
	const rootFromSettings = cleanString(settings.root);
	const rootFromEnv = cleanString(env.KIWIFS_ROOT);
	const modeFromSettings = cleanString(settings.mode);
	const modeFromEnv = cleanString(env.KIWIFS_MODE).toLowerCase();
	const mode = MODES.has(modeFromEnv) ? modeFromEnv : MODES.has(modeFromSettings) ? modeFromSettings : DEFAULTS.mode;

	const url = normalizeServerUrl(urlFromEnv || urlFromSettings || DEFAULTS.url);
	const root = expandHome(rootFromEnv || rootFromSettings, home);
	const apiKey = cleanString(env.KIWIFS_API_KEY) || cleanString(settings.apiKey);
	const actor = cleanString(env.KIWIFS_ACTOR) || cleanString(settings.actor) || DEFAULTS.actor;
	const space = cleanString(env.KIWIFS_SPACE) || cleanString(settings.space);
	const bin = cleanString(env.KIWIFS_BIN) || cleanString(settings.bin) || DEFAULTS.bin;
	const injectFromEnv = cleanBool(env.KIWIFS_INJECT_CONTEXT);
	const injectFromSettings = cleanBool(settings.injectContext);
	const timeout = cleanTimeout(env.KIWIFS_TIMEOUT_MS) ?? cleanTimeout(settings.timeoutMs) ?? DEFAULTS.timeoutMs;

	return {
		url,
		urlExplicit: Boolean(urlFromEnv || urlFromSettings),
		root,
		rootExplicit: Boolean(rootFromEnv || rootFromSettings),
		apiKey,
		actor,
		space,
		mode,
		bin,
		injectContext: injectFromEnv ?? injectFromSettings ?? DEFAULTS.injectContext,
		timeoutMs: timeout,
	};
}

/**
 * @param {{ home?: string, cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function loadConfig(options = {}) {
	const env = options.env ?? process.env;
	const home = options.home ?? os.homedir();
	return resolveConfig({
		env,
		home,
		settings: readSettings({ env, home, cwd: options.cwd }),
	});
}

/**
 * Arguments for `kiwifs mcp`. Root mode opens a directory in-process.
 * Remote mode proxies a running `kiwifs serve` so omp shares its index.
 *
 * @param {ReturnType<typeof resolveConfig>} config
 */
export function mcpArguments(config) {
	const useRoot = config.mode === "root" || (config.mode === "auto" && config.rootExplicit && !config.urlExplicit);
	if (useRoot) {
		if (!config.root) {
			throw new Error("KiwiFS root mode needs KIWIFS_ROOT or `omp plugin config set omp-kiwifs-extension root <path>`");
		}
		return { mode: "root", args: ["mcp", "--root", config.root] };
	}
	if (!config.url) {
		throw new Error("KiwiFS remote mode needs KIWIFS_URL");
	}
	const args = ["mcp", "--remote", config.url];
	if (config.apiKey) args.push("--api-key", config.apiKey);
	if (config.space) args.push("--space", config.space);
	return { mode: "remote", args };
}
