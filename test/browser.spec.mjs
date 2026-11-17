import { test, expect, chromium } from "@playwright/test";
import { createServer } from "vite";

let site, fixture;
const upstream = process.env.BUZZ_TEST_UPSTREAM_URL;
test.beforeAll(async () => {
  site = await createServer({
    configFile: false,
    server: { host: "127.0.0.1", port: 0, watch: null, ...(upstream && {
      proxy: { "/rooms": {
        target: upstream,
        ws: true,
        headers: {
          "X-Buzz-Streams-Proxy-Key": process.env.BUZZ_TEST_PROXY_KEY,
          Origin: "tauri://localhost",
        },
      } },
    }) },
  });
  await site.listen();
  fixture = `http://127.0.0.1:${site.httpServer.address().port}/test/fixture.html`;
});
test.afterAll(async () => { await site.close(); });

const launcher = (page) => page.getByRole("button", { name: "Streams", exact: true });
const video = (page) => page.locator('video[aria-label="Shared screen"]');
const preview = (page) => page.getByLabel("Your stream preview", { exact: true });
const watch = (page, name) => page.getByRole("button", { name: `Watch ${name}’s stream` });

async function expectPlayback(page) {
  await expect(video(page)).toBeVisible({ timeout: 12000 });
  await expect.poll(() => video(page).evaluate((element) => element.currentTime)).toBeGreaterThan(0);
  await expect(page.getByText(/Receiving \d+p/)).toBeVisible();
}

test("tests the screen on one device without a Huddle or a signaling connection", async ({ page }) => {
  await page.goto(`${fixture}?solo`);
  await expect(launcher(page).locator("svg")).toBeVisible();
  await expect(launcher(page)).toHaveText("");
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

test("starts sharing without setup and switches streams in a three-member room", async ({ page, context, browserName }) => {
  test.skip(!upstream, "Run npm run test:media for the real media test");
  test.setTimeout(90000);
  const other = browserName === "webkit"
    ? await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] })
    : undefined;
  try {
    const first = await (other ?? context).newPage();
    const second = await (other ?? context).newPage();
    await first.setViewportSize({ width: 340, height: 640 });
    await Promise.all([
      first.goto(`${fixture}?viewer=Alex`),
      second.goto(`${fixture}?viewer=Riley`),
      page.goto(`${fixture}?viewer=Viewer`),
    ]);
    await launcher(first).click();
    await expect(first.getByLabel("Room creation key, if required by your server")).toBeHidden();
    await first.evaluate(() => window.screenTest.cancelNextCapture());
    await first.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(first.getByRole("alert")).toContainText("Screen selection canceled");
    expect(await first.evaluate(() => window.screenTest.openedSockets())).toBe(0);
    await first.getByLabel("Share quality").selectOption("sharp");
    await first.getByRole("button", { name: "Share screen", exact: true }).click();
    const copyInvite = first.getByRole("button", { name: "Copy invite link", exact: true });
    await expect(copyInvite).toBeVisible({ timeout: 15000 });
    await expect(launcher(first)).toHaveAttribute("aria-description", "You’re sharing your screen.");
    await expect(preview(first)).toBeVisible();
    await expect.poll(() => preview(first).evaluate((element) => element.currentTime)).toBeGreaterThan(0);
    const previewTrack = (page) => preview(page).evaluate((element) => element.srcObject?.getVideoTracks()[0]?.id);
    const originalSource = await previewTrack(first);
    expect(originalSource).toBeTruthy();
    await first.getByRole("button", { name: "Hide preview" }).click();
    await expect(preview(first)).toBeHidden();
    expect(await first.evaluate(() => window.screenTest.captureStates())).toEqual(["live"]);
    await first.getByRole("button", { name: "Show preview" }).click();
    await expect(preview(first)).toBeVisible();
    const localVideoBox = await preview(first).boundingBox();
    const stageBox = await first.locator(".h2s2-stage").boundingBox();
    expect(localVideoBox.width / stageBox.width).toBeGreaterThan(0.98);
    expect(localVideoBox.height).toBeGreaterThan(150);

    await expect(first.getByLabel("Session invite")).toHaveCount(0);
    await copyInvite.click();
    await expect(first.getByText("Invite copied.", { exact: true })).toBeVisible();
    const invite = await first.evaluate(() => window.screenTest.clipboardText());
    expect(invite).toMatch(/^buzz:\/\/plugin/);
    await first.evaluate(() => window.screenTest.blockClipboard());
    await copyInvite.click();
    const manualInvite = first.getByLabel("Session invite");
    await expect(manualInvite).toHaveValue(invite);
    await expect(manualInvite).toBeFocused();
    expect(await first.locator("section").evaluate((section) =>
      section.scrollWidth <= section.clientWidth)).toBe(true);

    await launcher(second).click();
    await second.getByText("Join from an invite", { exact: true }).click();
    await second.getByLabel("Invite link").fill(invite);
    await second.getByRole("button", { name: "Join streams" }).click();
    await page.getByLabel("Buzz link").fill(invite);
    await page.getByRole("button", { name: "Open Buzz link" }).click();
    await expect(page.getByText("Sharing session on", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Join streams" }).click();

    await second.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(watch(page, "Alex")).toBeVisible({ timeout: 12000 });
    await expect(watch(page, "Riley")).toBeVisible({ timeout: 12000 });
    await expect(video(page)).toHaveCount(0);
    await watch(second, "Alex").click();
    await expectPlayback(second);
    await expect(preview(second)).toBeVisible();

    await watch(page, "Alex").click();
    await expectPlayback(page);
    const streams = page.getByRole("complementary", { name: "Live streams" });
    await page.setViewportSize({ width: 920, height: 740 });
    expect((await streams.boundingBox()).x).toBeGreaterThan((await video(page).boundingBox()).x);
    await page.setViewportSize({ width: 340, height: 640 });
    expect((await streams.boundingBox()).y).toBeGreaterThan((await video(page).boundingBox()).y);
    await page.setViewportSize({ width: 920, height: 740 });
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
    await expect(watch(page, "Riley")).toHaveAttribute("aria-pressed", "true");
    await expectPlayback(page);
    await watch(page, "Alex").click();
    await expectPlayback(page);
    const streamBefore = await video(page).evaluate((element) => element.srcObject.id);

    await first.evaluate(() => window.screenTest.cancelNextCapture());
    await first.getByRole("button", { name: "Change source" }).click();
    await expect(first.getByRole("alert")).toHaveText("Screen selection canceled or permission was denied.");
    await expect(first.getByText("Window 1")).toBeVisible();
    expect(await previewTrack(first)).toBe(originalSource);
    await first.getByRole("button", { name: "Change source" }).click();
    await expect(first.getByText("Window 2")).toBeVisible();
    await expect.poll(() => preview(first).evaluate((element) =>
      element.srcObject?.getVideoTracks()[0]?.label)).toBe("Window 2");
    await expect.poll(() => preview(first).evaluate((element) => element.currentTime)).toBeGreaterThan(0);
    expect(await first.evaluate(() => window.screenTest.captureStates())).toEqual(["ended", "live"]);
    expect(await video(page).evaluate((element) => element.srcObject.id)).toBe(streamBefore);

    await page.getByRole("button", { name: "Stop watching" }).click();
    await expect(video(page)).toHaveCount(0);
    await launcher(first).click();
    await first.getByRole("toolbar", { name: "Buzz toolbar" })
      .getByRole("button", { name: "Stop sharing" }).click({ timeout: 5000 });
    await expect(watch(page, "Alex")).toHaveCount(0);
    expect(await first.evaluate(() => window.screenTest.captureStates())).toEqual(["ended", "ended"]);
    await expect(launcher(first)).not.toHaveAttribute("aria-description", "You’re sharing your screen.");
    await launcher(first).click();
    await expect(preview(first)).toHaveCount(0);

    await second.evaluate(() => window.screenTest.leave());
    await expect(second.getByText("Join a Huddle to share or watch a screen.")).toBeVisible();
    await expect(preview(second)).toHaveCount(0);
    await expect(watch(page, "Riley")).toHaveCount(0);
    expect(await second.evaluate(() => window.screenTest.captureStates())).toEqual(["ended"]);
  } finally {
    await other?.close();
  }
});
