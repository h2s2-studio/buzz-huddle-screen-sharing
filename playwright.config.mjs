import { defineConfig } from "@playwright/test";
export default defineConfig({
	workers: 1,
	testDir: "./test",
	testMatch: "browser.spec.mjs",
	projects: ["chromium", "webkit"].map((browserName) => ({
		name: browserName,
		use: { browserName },
	})),
});
