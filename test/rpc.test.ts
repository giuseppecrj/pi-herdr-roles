import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatPlanPrompt, PLAN_SKILL_PATH } from "../extensions/index.ts";
import {
	configuredHostRoot,
	IsolatedPi,
	PACK_ROOT,
	type RpcRecord,
} from "./helpers/rpc.ts";

const PACK_EXTENSION = join(PACK_ROOT, "extensions", "index.ts");
const ROLES = [
	"adversarial-reviewer",
	"planner",
	"reviewer",
	"scout",
	"visual-tester",
	"worker",
];
const RETIRED_COMMANDS = ["iterate", "btw", "btw-close"];

type CommandInfo = {
	name: string;
	source: string;
	path: string;
};

async function commands(pi: IsolatedPi): Promise<CommandInfo[]> {
	const response = await pi.request({ type: "get_commands" });
	assert.equal(response.success, true);
	// SAFETY: get_commands responses carry data.commands per the Pi 1.0.3 RPC docs.
	const data = response.data as {
		commands: Array<{
			name: string;
			source: string;
			sourceInfo: { path: string };
		}>;
	};
	return data.commands.map(({ name, source, sourceInfo }) => ({
		name,
		source,
		path: sourceInfo.path,
	}));
}

function userText(record: RpcRecord): string | undefined {
	// SAFETY: message_start records carry the AgentMessage emitted by Pi.
	const message = record.message as {
		role?: string;
		content?: string | Array<{ type: string; text?: string }>;
	};
	if (record.type !== "message_start" || message?.role !== "user")
		return undefined;
	if (typeof message.content === "string") return message.content;
	return (message.content ?? []).map((part) => part.text ?? "").join("");
}

async function deliveredPlanPrompt(pi: IsolatedPi, command: string) {
	const from = pi.records.length;
	const response = await pi.request({
		type: "prompt",
		message: `/${command} build x`,
	});
	assert.equal(response.success, true);
	const record = await pi.waitFor(
		(candidate) => userText(candidate) !== undefined,
		from,
	);
	await pi.waitFor((candidate) => candidate.type === "agent_settled", from);
	return userText(record);
}

async function listedRoles(pi: IsolatedPi): Promise<string> {
	await pi.request({ type: "prompt", message: "/test-arm-subagents-list" });
	const from = pi.records.length;
	await pi.request({ type: "prompt", message: "list roles" });
	const end = await pi.waitFor(
		(record) =>
			record.type === "tool_execution_end" &&
			record.toolName === "subagents_list",
		from,
	);
	await pi.waitFor((record) => record.type === "agent_settled", from);
	// SAFETY: tool_execution_end records carry the tool result content blocks.
	const result = end.result as { content: Array<{ text?: string }> };
	return result.content.map((part) => part.text ?? "").join("");
}

describe("installed pack without pi-herdr-agents", () => {
	it("exposes /plan and both skills from the package, with no retired commands", async () => {
		const pi = new IsolatedPi({ packages: [PACK_ROOT] });
		try {
			const listed = await commands(pi);
			const plan = listed.filter((command) => command.name.startsWith("plan"));
			assert.deepEqual(plan, [
				{ name: "plan", source: "extension", path: PACK_EXTENSION },
			]);
			for (const skill of ["plan", "orchestrate"])
				assert.deepEqual(
					listed.filter((command) => command.name === `skill:${skill}`),
					[
						{
							name: `skill:${skill}`,
							source: "skill",
							path: join(PACK_ROOT, "skills", skill, "SKILL.md"),
						},
					],
				);
			for (const retired of RETIRED_COMMANDS)
				assert.equal(
					listed.some((command) => command.name === retired),
					false,
				);
		} finally {
			await pi.close();
		}
	});

	it("fails /plan closed with a prerequisite diagnostic and starts no run", async () => {
		const pi = new IsolatedPi({ packages: [PACK_ROOT] });
		try {
			const from = pi.records.length;
			const response = await pi.request({
				type: "prompt",
				message: "/plan build x",
			});
			assert.deepEqual(response.data, { disposition: "handled" });
			const notice = await pi.waitFor(
				(record) =>
					record.type === "extension_ui_request" && record.method === "notify",
				from,
			);
			assert.equal(notice.notifyType, "error");
			assert.match(
				String(notice.message),
				/requires the pi-herdr-agents subagent tool/,
			);
			assert.equal(
				pi.records
					.slice(from)
					.some((record) => record.type === "agent_start" || userText(record)),
				false,
			);
		} finally {
			await pi.close();
		}
	});
});

/** Role lines from subagents_list, e.g. "scout (package:pi-herdr-roles)". */
function roleLines(listing: string): string[] {
	return [...listing.matchAll(/^• (\S+ \([^)]+\))/gm)]
		.map((match) => match[1])
		.toSorted();
}

async function assertDeliversPlan(pi: IsolatedPi, command: string) {
	assert.equal(
		await deliveredPlanPrompt(pi, command),
		formatPlanPrompt(
			PLAN_SKILL_PATH,
			readFileSync(PLAN_SKILL_PATH, "utf8"),
			"build x",
		),
	);
}

const hostRoot = configuredHostRoot();
const legacyHostRoot = configuredHostRoot("PI_HERDR_AGENTS_LEGACY_HOST");

// Role-free expectations always apply to PI_HERDR_AGENTS_HOST; a legacy host
// must fail here rather than loosen them. Legacy characterization is opt-in below.
describe("installed pack with a real role-free pi-herdr-agents host", {
	skip:
		hostRoot === undefined &&
		"set PI_HERDR_AGENTS_HOST=<host package root> to run combined-host checks",
}, () => {
	it("lists exactly the six roles and one unsuffixed /plan, with no collisions or retired commands", async () => {
		const pi = new IsolatedPi({ packages: [PACK_ROOT, hostRoot ?? ""] });
		try {
			const listing = await listedRoles(pi);
			const listed = await commands(pi);
			assert.deepEqual(
				roleLines(listing),
				ROLES.map((role) => `${role} (package:pi-herdr-roles)`),
				listing,
			);
			assert.doesNotMatch(listing, /^!/m, "no role diagnostics expected");
			assert.deepEqual(
				listed.filter((command) => /^plan(:\d+)?$/.test(command.name)),
				[{ name: "plan", source: "extension", path: PACK_EXTENSION }],
			);
			assert.deepEqual(
				listed
					.filter((command) => command.name === "skill:orchestrate")
					.map((command) => command.path),
				[join(PACK_ROOT, "skills", "orchestrate", "SKILL.md")],
			);
			const names = listed.map((command) => command.name);
			assert.equal(new Set(names).size, names.length, "duplicate commands");
			assert.equal(
				names.some((name) => /:\d+$/.test(name)),
				false,
				"no Pi duplicate-command suffixes",
			);
			for (const retired of RETIRED_COMMANDS)
				assert.equal(
					names.includes(retired),
					false,
					`host still registers retired /${retired}`,
				);
		} finally {
			await pi.close();
		}
	});

	it("delivers /plan as the literal plan-skill wrapper through the pack command", async () => {
		const pi = new IsolatedPi({ packages: [PACK_ROOT, hostRoot ?? ""] });
		try {
			const packPlan = (await commands(pi)).filter(
				(command) => command.path === PACK_EXTENSION,
			);
			assert.deepEqual(
				packPlan.map((command) => command.name),
				["plan"],
			);
			await assertDeliversPlan(pi, "plan");
		} finally {
			await pi.close();
		}
	});
});

// Explicit opt-in only: never inferred from a host's directory layout.
describe("legacy bundled host characterization", {
	skip:
		legacyHostRoot === undefined &&
		"set PI_HERDR_AGENTS_LEGACY_HOST=<pre-extraction host root> to characterize legacy hosts",
}, () => {
	it("host rejects pack roles with its own collision diagnostics", async () => {
		const pi = new IsolatedPi({ packages: [PACK_ROOT, legacyHostRoot ?? ""] });
		try {
			const listing = await listedRoles(pi);
			for (const role of ROLES)
				assert.ok(
					listing.includes(`Role pack cannot replace bundled role "${role}"`),
					`missing host-owned collision diagnostic for ${role}`,
				);
		} finally {
			await pi.close();
		}
	});

	it("with roles.bundled:false, pack roles register and /plan is suffixed", async () => {
		const pi = new IsolatedPi({
			packages: [PACK_ROOT, legacyHostRoot ?? ""],
			herdrAgentsConfig: JSON.stringify({
				status: { enabled: true },
				roles: { bundled: false },
			}),
		});
		try {
			const listing = await listedRoles(pi);
			for (const role of ROLES)
				assert.ok(
					listing.includes(`• ${role} (package:pi-herdr-roles)`),
					`missing ${role} with pack provenance in:\n${listing}`,
				);
			const packPlan = (await commands(pi)).filter(
				(command) => command.path === PACK_EXTENSION,
			);
			assert.equal(packPlan.length, 1);
			assert.match(
				packPlan[0].name,
				/^plan:\d+$/,
				"legacy hosts still own a colliding /plan",
			);
			await assertDeliversPlan(pi, packPlan[0].name);
		} finally {
			await pi.close();
		}
	});
});
