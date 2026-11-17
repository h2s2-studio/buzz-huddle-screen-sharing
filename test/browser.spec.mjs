import { test, expect, chromium } from "@playwright/test";
import { createServer } from "vite";

let site, fixture;
test.beforeAll(async () => {
  site = await createServer({
    configFile: false,
    server: { host: "127.0.0.1", port: 0, watch: null },
  });
  await site.listen();
  fixture = `http://127.0.0.1:${site.httpServer.address().port}/test/fixture.html`;
});
test.afterAll(async () => { await site.close(); });

const launcher = (page) => page.getByRole("button", { name: "Streams", exact: true });
const video = (page) => page.locator('video[aria-label="Shared screen"]');
const watch = (page, name) => page.getByRole("button", { name: `Watch ${name}’s stream` });

async function expectPlayback(page) {
  await expect(video(page)).toBeVisible({ timeout: 12000 });
  await expect.poll(() => video(page).evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  await expect(page.getByText(/Receiving \d+p/)).toBeVisible();
}

test("tests the screen on one device without a Huddle or a signaling connection", async ({ page }) => {
  await page.goto(`${fixture}?solo`);
  await launcher(page).click();
  await page.getByRole("button", { name: "Test my screen", exact: true }).click();
  await expect(video(page)).toBeVisible();
  await expect.poll(() => video(page).evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.screenTest.openedSockets())).toBe(0);
  await page.getByRole("button", { name: "Stop test", exact: true }).click();
  await expect(video(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.screenTest.captureStates())).toEqual(["ended"]);

  await page.getByRole("button", { name: "Test my screen", exact: true }).click();
  await expect(video(page)).toBeVisible();
  await launcher(page).click();
  await expect(video(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.screenTest.captureStates())).toEqual(["ended", "ended"]);
});

test("three members can publish, select, change quality and source, and leave", async ({ page, context, browserName }) => {
  test.skip(!process.env.BUZZ_TEST_ROOM_URL, "Set BUZZ_TEST_ROOM_URL to run the real media test");
  test.setTimeout(90000);
  const other = browserName === "webkit"
    ? await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] })
    : undefined;
  try {
    const first = await (other ?? context).newPage();
    const second = await (other ?? context).newPage();
    await Promise.all([first.goto(fixture), second.goto(fixture), page.goto(fixture)]);
    await launcher(first).click();
    await first.getByRole("button", { name: "Start a session" }).click();
    await first.getByLabel("Display name").fill("Alex");
    await first.getByLabel("Room service URL").fill(process.env.BUZZ_TEST_ROOM_URL);
    await first.getByLabel("Room creation key").fill(process.env.BUZZ_TEST_CREATION_KEY);
    await first.getByRole("button", { name: "Create room" }).click();
    await expect(first.getByLabel("Session invite")).toBeVisible({ timeout: 15000 });
    const invite = await first.getByLabel("Session invite").inputValue();

    await launcher(second).click();
    await second.getByLabel("Display name").fill("Riley");
    await second.getByLabel("Invite link").fill(invite);
    await second.getByRole("button", { name: "Join streams" }).click();
    await page.getByLabel("Buzz link").fill(invite);
    await page.getByRole("button", { name: "Open Buzz link" }).click();
    await expect(page.getByText("Room service on", { exact: false })).toBeVisible();
    await page.getByLabel("Display name").fill("Viewer");
    await page.getByRole("button", { name: "Join streams" }).click();

    await first.getByLabel("Share quality").selectOption("sharp");
    await first.getByRole("button", { name: "Share screen", exact: true }).click();
    await second.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(watch(page, "Alex")).toBeVisible({ timeout: 12000 });
    await expect(watch(page, "Riley")).toBeVisible({ timeout: 12000 });
    await expect(video(page)).toHaveCount(0);
    await watch(second, "Alex").click();
    await expectPlayback(second);

    await watch(page, "Alex").click();
    await expectPlayback(page);
    if (browserName === "chromium") {
      await page.getByRole("button", { name: "Fullscreen" }).click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("VIDEO");
      await page.evaluate(() => document.exitFullscreen());
    }
    const quality = page.getByLabel("Viewer quality");
    await expect.poll(() => quality.locator("option").allTextContents(), { timeout: 15000 })
      .toEqual(expect.arrayContaining(["360p", "1080p"]));
    await quality.selectOption({ label: "360p" });
    await expect(page.getByText("Receiving 360p")).toBeVisible({ timeout: 15000 });
    await quality.selectOption("auto");

    await watch(page, "Riley").click();
    await expect(page.getByText("Watching Riley")).toBeVisible();
    await expectPlayback(page);
    await watch(page, "Alex").click();
    await expectPlayback(page);
    const streamBefore = await video(page).evaluate((element) => element.srcObject.id);

    await first.evaluate(() => window.screenTest.cancelNextCapture());
    await first.getByRole("button", { name: "Change source" }).click();
    await expect(first.getByRole("alert")).toHaveText("Screen selection canceled or permission was denied.");
    await expect(first.getByText("Window 1")).toBeVisible();
    await first.getByRole("button", { name: "Change source" }).click();
    await expect(first.getByText("Window 2")).toBeVisible();
    expect(await first.evaluate(() => window.screenTest.captureStates())).toEqual(["ended", "live"]);
    expect(await video(page).evaluate((element) => element.srcObject.id)).toBe(streamBefore);

    await page.getByRole("button", { name: "Stop watching" }).click();
    await expect(video(page)).toHaveCount(0);
    await launcher(first).click();
    await first.getByRole("toolbar", { name: "Buzz toolbar" })
      .getByRole("button", { name: "Stop sharing" }).click({ timeout: 5000 });
    await expect(watch(page, "Alex")).toHaveCount(0);
    expect(await first.evaluate(() => window.screenTest.captureStates())).toEqual(["ended", "ended"]);

    await second.evaluate(() => window.screenTest.leave());
    await expect(second.getByText("Join a Huddle to share or watch a screen.")).toBeVisible();
    await expect(watch(page, "Riley")).toHaveCount(0);
    expect(await second.evaluate(() => window.screenTest.captureStates())).toEqual(["ended"]);
  } finally {
    await other?.close();
  }
});
