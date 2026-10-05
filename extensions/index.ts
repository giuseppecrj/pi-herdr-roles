import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const ROLE_DISCOVERY_EVENT = "pi-herdr-subagents:roles:discover:v1";
export const ROLES_DIR = fileURLToPath(new URL("../roles", import.meta.url));
export const PLAN_SKILL_PATH = fileURLToPath(
	new URL("../skills/plan/SKILL.md", import.meta.url),
);

type RoleDiscoveryRequest = {
	apiVersion: number;
	register(path: string): void;
};

/** Wraps the plan skill exactly as pi-herdr-agents' former `/plan` did. */
export function formatPlanPrompt(
	skillPath: string,
	skillContent: string,
	task: string,
): string {
	const body = skillContent.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
	return `<skill name="plan" location="${skillPath}">\n${body}\n</skill>\n\n${task}`;
}

export default function piHerdrRoles(pi: ExtensionAPI) {
	const unsubscribe = pi.events.on(ROLE_DISCOVERY_EVENT, (request) => {
		// SAFETY: the host emits this versioned request shape; apiVersion gates use.
		const discovery = request as RoleDiscoveryRequest;
		if (discovery.apiVersion === 1) discovery.register(ROLES_DIR);
	});
	pi.on("session_shutdown", unsubscribe);

	pi.registerCommand("plan", {
		description: "Start a planning session: /plan <what to build>",
		handler: async (args, ctx) => {
			const task = args.trim();
			if (!task) {
				ctx.ui.notify("Usage: /plan <what to build>", "warning");
				return;
			}
			if (!pi.getAllTools().some((tool) => tool.name === "subagent")) {
				ctx.ui.notify(
					"/plan requires the pi-herdr-agents subagent tool. Install and enable pi-herdr-agents, then /reload.",
					"error",
				);
				return;
			}
			pi.sendUserMessage(
				formatPlanPrompt(
					PLAN_SKILL_PATH,
					readFileSync(PLAN_SKILL_PATH, "utf8"),
					task,
				),
			);
		},
	});
}
