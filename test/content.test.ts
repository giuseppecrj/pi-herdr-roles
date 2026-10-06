import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PACK_ROOT } from "./helpers/rpc.ts";

type Replacement = { from: string; to: string; reason: string };
type ProvenanceEntry = {
	path: string;
	source: string;
	sourceSha256: string;
	sha256: string;
	status: "unchanged" | "adapted";
	replacements: Replacement[];
};
type Provenance = {
	sourceRepository: string;
	sourceCommit: string;
	files: ProvenanceEntry[];
};

const read = (path: string) => readFileSync(join(PACK_ROOT, path), "utf8");
const sha256 = (value: string | Buffer) =>
	createHash("sha256").update(value).digest("hex");
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
const sectionBetween = (value: string, start: string, end: string) => {
	const startIndex = value.indexOf(start);
	const endIndex = value.indexOf(end, startIndex + start.length);
	assert.notEqual(startIndex, -1, `missing section start: ${start}`);
	assert.notEqual(endIndex, -1, `missing section end: ${end}`);
	return normalized(value.slice(startIndex, endIndex));
};

// SAFETY: test-owned fixture generated from the pinned source commit.
const provenance = JSON.parse(
	read("test/fixtures/provenance.json"),
) as Provenance;
// SAFETY: this package's own manifest.
const manifest = JSON.parse(read("package.json")) as {
	name: string;
	version: string;
	private: boolean;
	license: string;
	keywords: string[];
	scripts: Record<string, string>;
	peerDependencies: Record<string, string>;
	dependencies?: Record<string, string>;
	pi: { extensions: string[]; skills: string[] };
};
// SAFETY: this package's own Biome configuration.
const biomeConfig = JSON.parse(read("biome.json")) as {
	files: { includes: string[] };
};

const ROLES = [
	"adversarial-reviewer",
	"planner",
	"reviewer",
	"scout",
	"visual-tester",
	"worker",
];
const roleFiles = readdirSync(join(PACK_ROOT, "roles")).toSorted();
const skill = read("skills/orchestrate/SKILL.md");
const adversarialReview = read("skills/orchestrate/adversarial-review.md");
const adversarialExample = read(
	"skills/orchestrate/adversarial-review-example.js",
);
const reviewer = read("roles/reviewer.md");
const adversarialAgent = read("roles/adversarial-reviewer.md");
const planSkill = read("skills/plan/SKILL.md");

/** Parses role frontmatter with ADR-0003's strict capability-key rules. */
function frontmatter(path: string): Map<string, string> {
	const text = read(path);
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
	assert.ok(match, `${path} must start with frontmatter`);
	const fields = new Map<string, string>();
	for (const line of match[1].split("\n")) {
		const field = /^([a-z][a-z-]*):(?: (.*))?$/.exec(line);
		if (!field) continue;
		assert.equal(fields.has(field[1]), false, `${path}: duplicate ${field[1]}`);
		fields.set(field[1], field[2] ?? "");
	}
	for (const key of ["tools", "deny-tools"]) {
		const value = fields.get(key);
		if (value === undefined) continue;
		assert.match(
			value,
			/^[A-Za-z0-9_-]+(?:, ?[A-Za-z0-9_-]+)*$/,
			`${path}: ${key} must be one inline comma-separated scalar`,
		);
	}
	const spawning = fields.get("spawning");
	if (spawning !== undefined)
		assert.match(spawning, /^(true|false)$/, `${path}: invalid spawning`);
	return fields;
}

const ordinaryReviewClauses = [
	"For ordinary review, prefer a different authenticated model family.",
	"When no other authenticated model family is available, ordinary review may use a same-family reviewer in a fresh standalone session.",
	"Disclose that this review is context-isolated, not cross-family independent.",
	"Cross-family verification, `/skill:orchestrate`, and `adversarial-reviewer` must not use this fallback.",
];

describe("source provenance and extraction parity", () => {
	it("pins every moved file to the recorded pi-herdr-agents commit", () => {
		assert.equal(
			provenance.sourceCommit,
			"c2177dff835da44937e614e8a03d0405d442e848",
		);
		for (const entry of provenance.files) {
			const content = readFileSync(join(PACK_ROOT, entry.path));
			assert.equal(
				sha256(content),
				entry.sha256,
				`${entry.path} changed without updating its reviewed provenance`,
			);
			if (entry.status === "unchanged") {
				assert.equal(entry.sha256, entry.sourceSha256, entry.path);
				assert.deepEqual(entry.replacements, []);
				continue;
			}
			assert.ok(entry.replacements.length > 0, entry.path);
			const text = content.toString("utf8");
			for (const { from, to, reason } of entry.replacements) {
				assert.ok(reason.length > 0, `${entry.path}: undocumented change`);
				assert.ok(text.includes(to), `${entry.path}: missing ${to}`);
				assert.equal(text.includes(from), false, `${entry.path}: kept ${from}`);
			}
		}
	});

	const source =
		process.env.PI_HERDR_AGENTS_SOURCE ??
		resolve(PACK_ROOT, "..", "pi-herdr-agents");
	const hasSource =
		existsSync(join(source, ".git")) &&
		spawnSync("git", [
			"-C",
			source,
			"cat-file",
			"-e",
			`${provenance.sourceCommit}^{commit}`,
		]).status === 0;
	it("reconstructs each destination from the source commit and recorded replacements", {
		skip:
			!hasSource &&
			"set PI_HERDR_AGENTS_SOURCE to a pi-herdr-agents Git checkout containing the source commit",
	}, () => {
		for (const entry of provenance.files) {
			const original = execFileSync("git", [
				"-C",
				source,
				"show",
				`${provenance.sourceCommit}:${entry.source}`,
			]);
			assert.equal(sha256(original), entry.sourceSha256, entry.source);
			let text = original.toString("utf8");
			for (const { from, to } of entry.replacements) {
				assert.equal(text.split(from).length, 2, `${entry.path}: ${from}`);
				text = text.replace(from, () => to);
			}
			assert.equal(text, read(entry.path), entry.path);
		}
	});

	it("accounts for exactly the six generic roles and no poteto", () => {
		assert.deepEqual(
			roleFiles,
			ROLES.map((role) => `${role}.md`),
		);
		const moved = new Set(provenance.files.map((entry) => entry.path));
		for (const role of ROLES) assert.ok(moved.has(`roles/${role}.md`), role);
		assert.equal(existsSync(join(PACK_ROOT, "roles", "poteto.md")), false);
	});

	it("ships only the plan and orchestrate skills", () => {
		assert.deepEqual(readdirSync(join(PACK_ROOT, "skills")).toSorted(), [
			"orchestrate",
			"plan",
		]);
		assert.match(skill, /^---\nname: orchestrate\ndescription: .+\n---/);
		assert.match(planSkill, /^---\nname: plan\ndescription: >\n/);
	});
});

describe("role definitions", () => {
	it("use the strict role-pack format with matching names and descriptions", () => {
		for (const role of ROLES) {
			const fields = frontmatter(`roles/${role}.md`);
			assert.equal(fields.get("name"), role);
			assert.ok((fields.get("description") ?? "").length > 0, role);
		}
	});

	it("preserve inherited runtimes, interaction modes and capability declarations", () => {
		const expected: Record<string, Record<string, string | undefined>> = {
			scout: { tools: "read, bash", spawning: "false", "auto-exit": "true" },
			planner: {
				tools: undefined,
				spawning: undefined,
				"auto-exit": undefined,
			},
			worker: {
				tools: "read, bash, write, edit",
				spawning: "false",
				"auto-exit": "true",
			},
			reviewer: {
				tools: "read, bash, grep, find, ls",
				spawning: "false",
				"auto-exit": "true",
			},
			"adversarial-reviewer": {
				tools: "read, bash, grep, find, ls, subagent",
				spawning: "true",
				"auto-exit": "false",
				interactive: "false",
				thinking: "high",
			},
			"visual-tester": {
				tools: "bash, read, write",
				spawning: "false",
				"auto-exit": "true",
				skills: "chrome-cdp",
			},
		};
		for (const [role, fields] of Object.entries(expected)) {
			const actual = frontmatter(`roles/${role}.md`);
			assert.equal(actual.get("model"), undefined, `${role} inherits model`);
			assert.equal(actual.get("system-prompt"), "append", role);
			if (role !== "adversarial-reviewer")
				assert.equal(
					actual.get("thinking"),
					undefined,
					`${role} inherits thinking`,
				);
			for (const [key, value] of Object.entries(fields))
				assert.equal(actual.get(key), value, `${role}.${key}`);
		}
	});

	it("keep the adversarial coordinator's public-child instructions", () => {
		assert.match(adversarialAgent, /model-catalog source/i);
		assert.match(adversarialAgent, /how authentication was\s+confirmed/i);
		assert.doesNotMatch(adversarialAgent, /model:\s*["'][^"']+\/[^"']+["']/);
		assert.match(adversarialAgent, /project review rules/i);
		assert.match(
			adversarialAgent,
			/Routine\s+risk uses two distinct eligible\s+exact model IDs/i,
		);
		assert.match(
			adversarialAgent,
			/High risk uses three distinct eligible IDs with lenses/i,
		);
		assert.match(adversarialAgent, /candidate-dependent/i);
		assert.match(adversarialAgent, /different provider\/model family/i);
		assert.doesNotMatch(adversarialAgent, /same-family.*fallback/i);
		assert.match(adversarialAgent, /fresh reviewer carrying alias\s+`S1`/i);
		assert.match(adversarialAgent, /subagent_ping.*not a review report/is);
		assert.match(
			adversarialAgent,
			/nonzero exit, provider error, launch error/i,
		);
		assert.match(adversarialAgent, /Never silently replace a\s+runtime/i);
		assert.match(adversarialAgent, /16,000 characters/i);
		assert.match(adversarialAgent, /call\s+`subagent_done`/i);
		assert.match(
			adversarialAgent,
			/Never call it[\s\S]*lacks a terminal envelope/i,
		);
		assert.match(
			adversarialAgent,
			/Do not run verification that can generate\s+artifacts/i,
		);
		assert.doesNotMatch(adversarialAgent, /tools:\s*["']read,bash,write["']/);
	});

	it("requires fork:false in the adversarial-reviewer launch contract", () => {
		const pinSection = sectionBetween(
			adversarialAgent,
			"## Pin the scope and runtimes",
			"## Launch contract",
		);
		assert.ok(pinSection.includes("`fork: false`"));
		assert.ok(
			/override.*non-standalone|forces? standalone.*regardless/i.test(
				pinSection,
			),
		);
		const item3 = pinSection.slice(
			pinSection.indexOf("3."),
			pinSection.indexOf("4."),
		);
		assert.doesNotMatch(item3, /stop.*(?:for|if).*non-standalone.*mode/i);
		assert.ok(
			/stop.*(?:unknown|cannot be applied|cannot be confirmed)/i.test(
				pinSection,
			),
		);
		assert.doesNotMatch(adversarialAgent, /fork: false.*does not override/i);
	});

	it("rejects every same-family fallback on strict review surfaces", () => {
		for (const [label, content] of [
			["skills/orchestrate/SKILL.md", skill],
			["skills/orchestrate/adversarial-review.md", adversarialReview],
			["roles/adversarial-reviewer.md", adversarialAgent],
		] as const) {
			assert.doesNotMatch(content, /same-family[\s\S]{0,100}fallback/i, label);
			assert.doesNotMatch(
				content,
				/context-isolated[\s\S]{0,60}review/i,
				label,
			);
			assert.match(content, /different.*family/i, label);
			const compact = normalized(content);
			for (const clause of ordinaryReviewClauses)
				assert.ok(!compact.includes(clause), `${label}: ${clause}`);
		}
		assert.doesNotMatch(
			adversarialAgent,
			/ordinary[\s\S]{0,200}same-family[\s\S]{0,200}fallback/i,
		);
		assert.doesNotMatch(
			adversarialAgent,
			/[Ww]hen no other.*family[\s\S]{0,200}same-family/,
		);
		assert.match(adversarialAgent, /no model or tool fallback/);
	});

	it("keeps generic reviewer findings evidence-backed and task-specific", () => {
		for (const phrase of [
			"P0",
			"P1",
			"P2",
			"P3",
			"Provenance",
			"Reproduced",
			"Trace-backed",
			"Unverified",
			"Preconditions",
			"Expected behavior",
			"actual behavior",
			"INCOMPLETE",
			"task-specific output schema",
			"untrusted review data",
		])
			assert.ok(
				reviewer.includes(phrase),
				`missing reviewer contract: ${phrase}`,
			);
		assert.doesNotMatch(reviewer, /confidence\s+0-100/i);
		assert.match(
			reviewer,
			/Numeric confidence and vote\s+counts are\s+not evidence/i,
		);
	});
});

describe("orchestrate skill", () => {
	it("keeps the public subagent review contract", () => {
		for (const phrase of [
			"local paths, URLs, tickets",
			"deleted and base-only",
			"at least two fresh discovery reviewers",
			"exact authenticated `provider/model-id`",
			"author families",
			"tools:",
			"`read,bash` is **not** read-only",
			"untrusted review data",
			"Do not poll",
			"parent synthesizes",
		])
			assert.ok(skill.includes(phrase), `missing skill contract: ${phrase}`);
		assert.match(skill, /subagent\s*\(\s*\)/);
		assert.doesNotMatch(skill, /herdr_workflow|APPROVE <|\bWorker\b|\bvm\b/);
	});

	it("keeps adversarial review in the public-child topology", () => {
		assert.match(
			skill,
			/\[the adversarial review procedure\]\(adversarial-review\.md\)/,
		);
		for (const phrase of [
			"Routine",
			"2 fresh reviewers",
			"High",
			"3 fresh reviewers with distinct lenses",
			"cross-family verifier",
			"P0–P3",
			"reproduced",
			"trace-backed",
			"unverified",
			"INCOMPLETE",
			"untrusted review data",
			"public `subagent()`",
			"parent synthesis",
		])
			assert.ok(
				adversarialReview.includes(phrase),
				`missing adversarial contract: ${phrase}`,
			);
		assert.match(adversarialReview, /fresh\s+standalone/i);
		assert.match(
			adversarialReview,
			/name \| agent kind \| role \| model \| worktree/,
		);
		assert.match(adversarialReview, /deleted or base-only/i);
		assert.match(adversarialReview, /child\s+`INCOMPLETE`/i);
		assert.match(
			adversarialReview,
			/author-family exclusion[\s\S]*origin is unknown/i,
		);
		assert.match(adversarialExample, /function validateReviewReport/);
		assert.match(adversarialExample, /function parseReviewResult/);
		assert.match(adversarialExample, /function validatePublicReviewResults/);
		assert.doesNotMatch(
			adversarialReview,
			/herdr_workflow|APPROVE <|runner-owned/,
		);
		assert.doesNotMatch(adversarialReview, /confidence\s*[><=]/i);
	});

	it("requires fork:false for reviewer launches", () => {
		assert.ok(
			sectionBetween(
				skill,
				"## 2. Select reviewers",
				"## 3. Fan out and synthesize",
			).includes("`fork: false`"),
		);
		assert.ok(
			sectionBetween(
				adversarialReview,
				"## Topology and models",
				"## Finding records",
			).includes("`fork: false`"),
		);
	});
});

describe("plan skill", () => {
	it("pins the Phase 7 reviewer evidence and fork:false before launch", () => {
		const phase7 = sectionBetween(
			planSkill,
			"## Phase 7: Review",
			"## Completion Checklist",
		);
		assert.ok(phase7.includes("fork: false,"));
		for (const phrase of [
			"canonical repository root",
			"exact comparison base and head SHAs",
			"Dirty-state inventory and fingerprint",
			"Complete diff and deleted/base-only evidence",
			'cwd: "<canonical repository root>"',
			"untrusted review data",
		])
			assert.ok(planSkill.includes(phrase), `missing review input: ${phrase}`);
	});

	it("states the authenticated-family ordinary-review gate", () => {
		const compact = normalized(planSkill);
		assert.ok(compact.includes("Phase 7 uses ordinary review."));
		for (const clause of ordinaryReviewClauses)
			assert.ok(compact.includes(clause), `/plan must include: ${clause}`);
		assert.doesNotMatch(compact, /do not disclose/i);
	});

	it("references host-owned guidance without a sibling filesystem path", () => {
		assert.doesNotMatch(
			planSkill,
			/\.\.\/pi-herdr-agents|this package's guide/,
		);
		assert.match(planSkill, /installed pi-herdr-agents package/);
	});
});

describe("workflow dependency closure", () => {
	const workflowFiles = [
		...ROLES.map((role) => `roles/${role}.md`),
		"skills/plan/SKILL.md",
		"skills/orchestrate/SKILL.md",
		"skills/orchestrate/adversarial-review.md",
	];

	it("launches only roles shipped by this pack", () => {
		const referenced = new Set<string>();
		for (const file of workflowFiles)
			for (const match of read(file).matchAll(/agent:\s*"([a-z-]+)"/g))
				referenced.add(match[1]);
		assert.ok(referenced.size > 0);
		for (const role of referenced)
			assert.ok(ROLES.includes(role), `unresolved role dependency: ${role}`);
	});

	it("resolves relative links inside the packaged workflow surface", () => {
		for (const file of workflowFiles)
			for (const match of read(file).matchAll(/\]\(([^)#:]+)(?:#[^)]*)?\)/g))
				assert.ok(
					existsSync(join(PACK_ROOT, dirname(file), match[1])),
					`${file}: broken link ${match[1]}`,
				);
	});

	it("keeps chrome-cdp an optional, visible, uninstalled prerequisite", () => {
		assert.equal(existsSync(join(PACK_ROOT, "skills", "chrome-cdp")), false);
		const readme = read("README.md");
		assert.match(readme, /chrome-cdp/);
		assert.match(readme, /optional/i);
		assert.match(
			read("roles/visual-tester.md"),
			/does \*\*not\*\* install them/,
		);
	});

	it("does not reintroduce retired commands", () => {
		for (const file of [...workflowFiles, "extensions/index.ts", "README.md"])
			assert.doesNotMatch(
				read(file),
				/(^|[\s`(])\/(iterate|btw)\b/m,
				`${file} references a retired command`,
			);
	});
});

describe("package manifest", () => {
	it("is a private experimental Pi package with host peers", () => {
		assert.equal(manifest.name, "pi-herdr-roles");
		assert.equal(manifest.private, true);
		assert.match(manifest.version, /^0\.\d+\.\d+-experimental\.\d+$/);
		assert.equal(manifest.license, "MIT");
		assert.ok(manifest.keywords.includes("pi-package"));
		assert.deepEqual(manifest.peerDependencies, {
			"@earendil-works/pi-coding-agent": "*",
			"pi-herdr-agents": "*",
		});
		assert.equal(manifest.dependencies, undefined);
		assert.deepEqual(manifest.pi, {
			extensions: ["./extensions/index.ts"],
			skills: ["./skills"],
		});
	});

	it("checks the shipped review helper", () => {
		assert.ok(
			biomeConfig.files.includes.includes(
				"skills/orchestrate/adversarial-review-example.js",
			),
		);
		for (const script of ["format", "format:check", "lint"])
			assert.match(
				manifest.scripts[script],
				/skills\/orchestrate\/adversarial-review-example\.js/,
			);
	});

	it("packs runtime resources and notices without development artifacts", () => {
		const [pack] = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: PACK_ROOT,
				encoding: "utf8",
			}),
		) as Array<{ files: Array<{ path: string }> }>;
		const files = new Set(pack.files.map(({ path }) => path));
		for (const path of [
			"package.json",
			"README.md",
			"LICENSE",
			"THIRD_PARTY_NOTICES.md",
			"extensions/index.ts",
			...ROLES.map((role) => `roles/${role}.md`),
			"skills/plan/SKILL.md",
			"skills/orchestrate/SKILL.md",
			"skills/orchestrate/adversarial-review.md",
			"skills/orchestrate/adversarial-review-example.js",
			"docs/compatibility.md",
			"docs/provenance.md",
			"docs/review-evaluation.md",
		])
			assert.ok(files.has(path), `missing package file: ${path}`);
		for (const path of files)
			assert.doesNotMatch(
				path,
				/(^|\/)(?:\.pi|test|node_modules|sessions|\.reviews)(?:\/|$)|(^|\/)(?:config\.json|\.npmrc|AGENTS\.md)$/,
			);
		for (const path of files)
			if (path.startsWith("roles/"))
				assert.match(path, /^roles\/[a-z-]+\.md$/, "roles/ holds only roles");
	});
});
