import { once } from "node:events";
import { test, expect, chromium } from "@playwright/test";
import { createServer } from "vite";
import { createSignaling } from "../server/index.mjs";

let relay, site, endpoint, fixture;
test.beforeAll(async () => {
	relay = createSignaling();
	relay.server.listen(0, "127.0.0.1");
	await once(relay.server, "listening");
	endpoint = `wss://127.0.0.1:${relay.server.address().port}/signal`;
	site = await createServer({
		configFile: false,
		server: { host: "127.0.0.1", port: 0, watch: null },
	});
	await site.listen();
	fixture = `http://127.0.0.1:${site.httpServer.address().port}/test/fixture.html?endpoint=${encodeURIComponent(endpoint)}`;
});
test.afterAll(async () => {
	for (const socket of relay.sockets.clients) socket.terminate();
	await Promise.all([
		site.close(),
		new Promise((done) => relay.server.close(done)),
		new Promise((done) => relay.sockets.close(done)),
	]);
});

async function shareAndLeave(page, viewer) {
	test.setTimeout(45_000);
	await Promise.all([page.goto(fixture), viewer.goto(fixture)]);
	for (const client of [page, viewer]) {
		await client.getByRole("button", { name: "Screen sharing" }).click();
		await client.getByLabel("Signaling URL").fill(endpoint);
	}
	await page.getByRole("button", { name: "Share screen", exact: true }).click();
	const invite = page.getByLabel("Your share code");
	await expect(invite).toBeVisible();
	await viewer
		.getByLabel("Share code", { exact: true })
		.fill(await invite.inputValue());
	await viewer
		.getByRole("button", { name: "Watch screen", exact: true })
		.click();
	const video = viewer.locator('video[aria-label="Shared screen"]');
	try {
		// Let the plugin's connection deadline elapse so failures show its final state.
		await expect(video).toBeVisible({ timeout: 22000 });
	} catch (error) {
		const [presenterStatus, viewerStatus] = await Promise.all([
			page.locator("main").innerText(),
			viewer.locator("main").innerText(),
		]);
		throw new Error(`Presenter:\n${presenterStatus}\n\nViewer:\n${viewerStatus}`, {
			cause: error,
		});
	}
	await expect
		.poll(() => video.evaluate((element) => element.currentTime))
		.toBeGreaterThan(0);
	await page.evaluate(() => window.screenTest.leave());
	await expect(
		page.getByText("Join a Huddle to share or watch a screen."),
	).toBeVisible();
	await expect(video).toHaveCount(0);
	expect(await page.evaluate(() => window.screenTest.captureState())).toBe(
		"ended",
	);
}

test("shares screen video and stops when the presenter leaves", async ({
	context,
	page,
}) => {
	await shareAndLeave(page, await context.newPage());
});

test("tests the screen in one window without a Huddle or signaling connection", async ({
	page,
}) => {
	await page.goto(`${fixture}&solo`);
	const showPanel = page.getByRole("button", {
		name: "Screen sharing",
		exact: true,
	});
	await showPanel.click();
	await expect(page.getByLabel("Signaling URL")).toHaveCount(0);
	await page
		.getByRole("button", { name: "Test my screen", exact: true })
		.click();
	const video = page.locator('video[aria-label="Shared screen"]');
	await expect(video).toBeVisible();
	await expect
		.poll(() => video.evaluate((element) => element.currentTime))
		.toBeGreaterThan(0);
	expect(await page.evaluate(() => window.screenTest.openedSockets())).toBe(0);
	await page.getByRole("button", { name: "Stop test" }).click();
	await expect(video).toHaveCount(0);
	expect(await page.evaluate(() => window.screenTest.captureState())).toBe(
		"ended",
	);
	await page
		.getByRole("button", { name: "Test my screen", exact: true })
		.click();
	await expect(video).toBeVisible();
	await showPanel.click();
	await expect(video).toHaveCount(0);
	expect(await page.evaluate(() => window.screenTest.captureState())).toBe(
		"ended",
	);
});

test("a Chromium presenter shares with a WebKit viewer", async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== "webkit", "Run this mixed-engine case on the WebKit runner");
	// CI runners may block multicast between browser processes. Both test peers
	// run on the same machine, so advertise Chromium's numeric ICE addresses.
	const other = await chromium.launch({
		args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
	});
	try {
		await shareAndLeave(await other.newPage(), page);
	} finally {
		await other.close();
	}
});
