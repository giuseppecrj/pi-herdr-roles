import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACK_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const FAUX_EXTENSION = join(PACK_ROOT, "test", "fixtures", "faux-provider.ts");
const LOCAL_PI_CLI = join(
	PACK_ROOT,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"bundle",
	"cli.js",
);
const BUILTIN_EXTENSIONS = [
	"-builtin:mcp",
	"-builtin:llama.cpp",
	"-builtin:codemode",
	"-builtin:tool-search",
];
const INHERITED_ENV =
	/^(HERDR_|PI_SUBAGENT_|PI_DENY_TOOLS|PI_SESSION_|PI_MODEL|PI_PROVIDER|PI_REASONING|PI_CODING_AGENT_DIR)/;

/** A JSON object emitted by Pi on stdout in RPC mode. */
export type RpcRecord = { [key: string]: RpcValue };
export type RpcValue =
	| null
	| boolean
	| number
	| string
	| RpcValue[]
	| RpcRecord;

/** Selects the pinned dev-dependency CLI unless PI_BIN explicitly overrides it. */
export function piCommand(): string[] {
	if (process.env.PI_BIN) return [process.env.PI_BIN];
	return [process.execPath, LOCAL_PI_CLI];
}

export type IsolatedPiOptions = {
	packages: string[];
	herdrAgentsConfig?: string;
};

/**
 * Starts Pi in RPC mode with test-owned agent, home and project directories.
 * Packages load through an isolated settings.json, as an installed package would.
 */
export class IsolatedPi {
	readonly root: string;
	readonly agentDir: string;
	readonly records: RpcRecord[] = [];
	stderr = "";
	private readonly child: ChildProcessWithoutNullStreams;
	private nextId = 0;
	private buffer = "";
	private waiters: Array<() => void> = [];

	constructor(options: IsolatedPiOptions) {
		this.root = mkdtempSync(join(tmpdir(), "pi-herdr-roles-test-"));
		this.agentDir = join(this.root, "agent");
		const home = join(this.root, "home");
		const work = join(this.root, "work");
		for (const dir of [this.agentDir, home, work]) mkdirSync(dir);
		writeFileSync(
			join(this.agentDir, "settings.json"),
			JSON.stringify({
				packages: options.packages,
				extensions: BUILTIN_EXTENSIONS,
			}),
		);
		if (options.herdrAgentsConfig !== undefined) {
			mkdirSync(join(this.agentDir, "herdr-agents"));
			writeFileSync(
				join(this.agentDir, "herdr-agents", "config.json"),
				options.herdrAgentsConfig,
			);
		}
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PI_CODING_AGENT_DIR: this.agentDir,
			HOME: home,
			XDG_CONFIG_HOME: join(home, ".config"),
			XDG_DATA_HOME: join(home, ".local", "share"),
			XDG_STATE_HOME: join(home, ".local", "state"),
			XDG_CACHE_HOME: join(home, ".cache"),
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			PI_TELEMETRY: "0",
		};
		for (const key of Object.keys(env))
			if (INHERITED_ENV.test(key) && key !== "PI_CODING_AGENT_DIR")
				delete env[key];
		const [command, ...prefix] = piCommand();
		this.child = spawn(
			command,
			[
				...prefix,
				"--mode",
				"rpc",
				"--no-session",
				"--offline",
				"-e",
				FAUX_EXTENSION,
				"-np",
				"-nc",
				"--no-approve",
				"--provider",
				"faux",
				"--model",
				"faux-1",
			],
			{ cwd: work, env, stdio: ["pipe", "pipe", "pipe"] },
		);
		this.child.stderr.setEncoding("utf8");
		this.child.stderr.on("data", (chunk: string) => {
			this.stderr += chunk;
		});
		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk: string) => this.consume(chunk));
	}

	private consume(chunk: string) {
		this.buffer += chunk;
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line.startsWith("{")) this.records.push(JSON.parse(line));
			newline = this.buffer.indexOf("\n");
		}
		for (const wake of this.waiters.splice(0)) wake();
	}

	/** Waits for a record at or after `from` that satisfies `matches`. */
	async waitFor(
		matches: (record: RpcRecord) => boolean,
		from = 0,
		timeoutMs = 20_000,
	): Promise<RpcRecord> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const found = this.records.slice(from).find(matches);
			if (found) return found;
			const remaining = deadline - Date.now();
			if (remaining <= 0 || this.child.exitCode !== null)
				throw new Error(
					`timed out waiting for RPC record; stderr:\n${this.stderr.slice(-2000)}`,
				);
			await new Promise<void>((wake) => {
				const timer = setTimeout(wake, Math.min(remaining, 250));
				this.waiters.push(() => {
					clearTimeout(timer);
					wake();
				});
			});
		}
	}

	/** Sends one RPC command and resolves with its response record. */
	async request(command: RpcRecord): Promise<RpcRecord> {
		const id = `test-${this.nextId++}`;
		const from = this.records.length;
		this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		return this.waitFor(
			(record) => record.type === "response" && record.id === id,
			from,
		);
	}

	async close() {
		this.child.stdin.end();
		if (this.child.exitCode === null)
			await new Promise<void>((done) => {
				const timer = setTimeout(() => {
					this.child.kill("SIGKILL");
				}, 5_000);
				this.child.once("exit", () => {
					clearTimeout(timer);
					done();
				});
			});
		rmSync(this.root, { recursive: true, force: true });
	}
}

/** Optional real host package root for combined-host checks. */
export function configuredHostRoot(): string | undefined {
	const root = process.env.PI_HERDR_AGENTS_HOST;
	if (!root) return undefined;
	if (!existsSync(join(root, "package.json")))
		throw new Error(`PI_HERDR_AGENTS_HOST has no package.json: ${root}`);
	return resolve(root);
}
