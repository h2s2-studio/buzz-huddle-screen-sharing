# Changelog

## v0.3.1

- Open the system picker directly from **Share screen**. Create a room after
  selection through the community’s trusted private proxy.
- Use the existing Buzz profile name when available and join an invite without
  a naming step. Keep custom broker setup under **Room service settings**.

## v0.3.0

- Added multi-presenter rooms, in-Buzz invites, selective playback, viewer
  quality and resolution, presenter presets, and source replacement.
- Added a toolbar stop control that stays available while navigating Buzz.
- Moved plugin authoring to TypeScript and kept the generated JavaScript at the
  GitHub install root.
- Added a Rust room service and self-hosted LiveKit deployment sample.
  The v0.2.0 tag still installs the original one-viewer plugin.

## 0.2.0 · 2026-11-16

- Install directly from the H2S2 Studio GitHub repository using Buzz’s Git importer.
- Test your screen picker and WebRTC playback locally without joining a Huddle.
- Share video with one viewer using an expiring code and a configured signaling service.
- Run signaling and playback tests in Chromium and WebKit.

The native screen-picker compatibility matrix and a hosted live Huddle test are pending.
