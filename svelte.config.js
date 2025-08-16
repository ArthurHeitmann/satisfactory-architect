import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/kit").Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess({}),

	kit: {
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({
			fallback: "index.html",
		})
	},
	compilerOptions: {
		warningFilter: (warning) => {
			const ignore = [
				"a11y_click_events_have_key_events",
				"a11y_consider_explicit_label",
				"a11y_media_has_caption",
				"a11y_mouse_events_have_key_events",
				"a11y_no_noninteractive_element_interactions",
				"a11y_no_noninteractive_tabindex",
				"a11y_no_redundant_roles",
				"a11y_no_static_element_interactions",
				"a11y_missing_attribute",
			]
			return !ignore.includes(warning.code)
		},
	},
	onwarn: (warning, handler) => {
		// suppress warnings on `vite dev` and `vite build`; but even without this, things still work
		if (warning.code === "a11y_click_events_have_key_events") return;
		if (warning.code === "a11y_consider_explicit_label") return;
		if (warning.code === "a11y_media_has_caption") return;
		if (warning.code === "a11y_mouse_events_have_key_events") return;
		if (warning.code === "a11y_no_noninteractive_element_interactions") return;
		if (warning.code === "a11y_no_noninteractive_tabindex") return;
		if (warning.code === "a11y_no_redundant_roles") return;
		if (warning.code === "a11y_no_static_element_interactions") return;
		if (warning.code === "a11y_missing_attribute") return;
		handler(warning);
	},
};

export default config;
