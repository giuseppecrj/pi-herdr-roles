import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	createAgentSession,
	createEventBus,
	DefaultResourceLoader,
	type ExtensionAPI,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import piHerdrRoles, {
	formatPlanPrompt,
	PLAN_SKILL_PATH,
	ROLE_DISCOVERY_EVENT,
	ROLES_DIR,
} from "../extensions/index.ts";
import { PACK_ROOT } from "./helpers/rpc.ts";

const EXTENSION = join(PACK_ROOT, "extensions", "index.ts");

function discover(
	bus: ReturnType<typeof createEventBus>,
	apiVersion: number,
): string[] {
	const registered: string[] = [];
	bus.emit(ROLE_DISCOVERY_EVENT, {
		apiVersion,
		register: (path: string) => registered.push(path),
	});
	return registered;
}

describe("role-pack v1 bridge", () => {
	it("removes its own listener from its session_shutdown handler", () => {
		// Pi 1.0.3 also drops extension listeners on reload/dispose, so this checks
		// the pack's own ADR-0003 cleanup directly against a real SDK event bus.
		const bus = createEventBus();
		const shutdown: Array<() => void> = [];
		const api = {
			events: bus,
			on(event: string, handler: () => void) {
				if (event === "session_shutdown") shutdown.push(handler);
			},
			registerCommand() {},
		};
		// SAFETY: the factory only uses events, on and registerCommand at load time.
		piHerdrRoles(api as unknown as ExtensionAPI);
		assert.deepEqual(discover(bus, 1), [ROLES_DIR]);
		assert.equal(shutdown.length, 1);
		shutdown[0]();
		assert.deepEqual(discover(bus, 1), []);
	});
});

describe("role-pack v1 bridge in a real SDK session", () => {
	it("registers once across reloads and not after dispose", async () => {
		const root = mkdtempSync(join(tmpdir(), "pi-herdr-roles-sdk-"));
		const cwd = join(root, "work");
		const agentDir = join(root, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		try {
			const bus = createEventBus();
			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				eventBus: bus,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
				additionalExtensionPaths: [EXTENSION],
			});
			await resourceLoader.reload();
			const { session } = await createAgentSession({
				cwd,
				agentDir,
				resourceLoader,
				settingsManager,
				sessionManager: SessionManager.inMemory(cwd),
			});
			await session.bindExtensions({});

			assert.deepEqual(discover(bus, 1), [ROLES_DIR]);
			assert.deepEqual(discover(bus, 2), [], "only apiVersion 1 is accepted");

			await session.reload();
			await session.reload();
			assert.deepEqual(
				discover(bus, 1),
				[ROLES_DIR],
				"reload must not leave a stale listener",
			);

			session.dispose();
			assert.deepEqual(discover(bus, 1), [], "dispose must leave no listener");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("/plan prompt delivery", () => {
	it("keeps the host's literal skill wrapper, location and task suffix", () => {
		const skill = readFileSync(PLAN_SKILL_PATH, "utf8");
		const prompt = formatPlanPrompt(PLAN_SKILL_PATH, skill, "build x");
		const body = skill.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
		assert.equal(
			prompt,
			`<skill name="plan" location="${PLAN_SKILL_PATH}">\n${body}\n</skill>\n\nbuild x`,
		);
		assert.ok(PLAN_SKILL_PATH.startsWith(PACK_ROOT));
		assert.ok(body.startsWith("# Plan\n"));
		assert.ok(!prompt.includes("name: plan\n"), "frontmatter is stripped");
	});
});
