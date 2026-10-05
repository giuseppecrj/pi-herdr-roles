import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const hostRoot = configuredHostRoot();
const legacyHost =
	hostRoot !== undefined &&
	existsSync(join(hostRoot, "agents")) &&
	readdirSync(join(hostRoot, "agents")).some((file) => file.endsWith(".md"));

describe("installed pack with a real pi-herdr-agents host", {
	skip:
		hostRoot === undefined &&
		"set PI_HERDR_AGENTS_HOST=<host package root> to run combined-host checks",
}, () => {
	it(
		legacyHost
			? "legacy bundled host: host rejects pack roles with its own collision diagnostics"
			: "role-free host: lists the six roles with package provenance and no collisions",
		async () => {
			const pi = new IsolatedPi({ packages: [PACK_ROOT, hostRoot ?? ""] });
			try {
				const listing = await listedRoles(pi);
				const listed = await commands(pi);
				if (legacyHost) {
					for (const role of ROLES)
						assert.ok(
							listing.includes(
								`Role pack cannot replace bundled role "${role}"`,
							),
							`missing host-owned collision diagnostic for ${role}`,
						);
					return;
				}
				for (const role of ROLES)
					assert.ok(
						listing.includes(`• ${role} (package:pi-herdr-roles)`),
						`missing ${role} with pack provenance in:\n${listing}`,
					);
				assert.doesNotMatch(listing, /• poteto \(/);
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
				for (const retired of RETIRED_COMMANDS)
					assert.equal(
						listed.some((command) => command.name === retired),
						false,
						`host still registers retired /${retired}`,
					);
			} finally {
				await pi.close();
			}
		},
	);

	it("delivers /plan as the literal plan-skill wrapper through the pack command", async () => {
		const pi = new IsolatedPi({
			packages: [PACK_ROOT, hostRoot ?? ""],
			// Legacy hosts need their bundled layer disabled before pack roles register.
			herdrAgentsConfig: legacyHost
				? JSON.stringify({
						status: { enabled: true },
						roles: { bundled: false },
					})
				: undefined,
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
			if (legacyHost)
				assert.match(
					packPlan[0].name,
					/^plan:\d+$/,
					"legacy hosts still own a colliding /plan",
				);
			else assert.equal(packPlan[0].name, "plan");
			assert.equal(
				await deliveredPlanPrompt(pi, packPlan[0].name),
				formatPlanPrompt(
					PLAN_SKILL_PATH,
					readFileSync(PLAN_SKILL_PATH, "utf8"),
					"build x",
				),
			);
		} finally {
			await pi.close();
		}
	});
});
