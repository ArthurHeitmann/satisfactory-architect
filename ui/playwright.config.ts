import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.test.ts",
	fullyParallel: false,
	workers: 1,
	// timeout: 5 * 60 * 1000,
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: [
		{
			name: "SvelteKit",
			command: "npm run dev -- --port 5173",
			url: "http://localhost:5173",
			reuseExistingServer: !process.env.CI,
		},
		{
			name: "Deno",
			command: "deno run start --server-buffer-ms=10 --heartbeat-fast-delay-ms=10 --database-path=:memory:",
			url: "http://localhost:8080",
			reuseExistingServer: !process.env.CI,
		}
	],
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
