import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Test-only deterministic provider. It performs no network access and is not
 * evidence that a live model follows any role or skill prose.
 */
export default function fauxTestProvider(pi: ExtensionAPI) {
	const faux = fauxProvider({
		provider: "faux",
		models: [
			{
				id: "faux-1",
				name: "Faux 1",
				contextWindow: 100_000,
				maxTokens: 4_000,
			},
		],
	});
	faux.setResponses(
		Array.from({ length: 20 }, () => fauxAssistantMessage("ok")),
	);
	pi.registerProvider(faux.provider);
	pi.registerCommand("test-arm-subagents-list", {
		description: "Test only: the next model turn calls subagents_list",
		handler: async () => {
			faux.setResponses([
				fauxAssistantMessage([fauxToolCall("subagents_list", {})]),
				fauxAssistantMessage("done"),
			]);
		},
	});
}
