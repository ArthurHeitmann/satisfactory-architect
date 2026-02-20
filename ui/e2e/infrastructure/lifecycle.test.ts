import { expect, test } from "@playwright/test";
import {
	getServerStderr,
	startDenoServer,
	startViteDevServer,
	stopManagedServer,
} from "../utils/serverManagement";

test.describe.serial("infrastructure: process lifecycle", () => {
	test("server lifecycle start -> stop", async () => {
		const server = await startDenoServer();
		try {
			const response = await fetch(server.url);
			expect(response.status).toBeGreaterThanOrEqual(100);
		} finally {
			await stopManagedServer(server);
		}
		expect(server.process.exitCode !== null || server.process.signalCode !== null).toBe(true);
	});

	test("dev server lifecycle start -> stop", async () => {
		const devServer = await startViteDevServer();
		try {
			const response = await fetch(devServer.url);
			expect(response.status).toBe(200);
			const body = await response.text();
			expect(body.toLowerCase()).toContain("<!doctype html>");
		} finally {
			await stopManagedServer(devServer);
		}
		expect(devServer.process.exitCode !== null || devServer.process.signalCode !== null).toBe(true);
		expect(getServerStderr(devServer)).not.toContain("EADDRINUSE");
	});
});
