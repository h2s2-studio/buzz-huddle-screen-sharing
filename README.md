# Huddle Screen Sharing for Buzz

An H2S2 Studio plugin for sharing and watching screens inside Buzz Desktop.
Multiple Huddle participants can publish at once. Viewers pick one stream,
switch between presenters, and keep their Buzz voice call connected.

## Install from GitHub

In Buzz Desktop, open **Settings → Plugins → Manage plugins → Add**. Paste
`https://github.com/h2s2-studio/buzz-huddle-screen-sharing` into **Git or GitHub
repository**, leave **Folder** blank, then select **Find → Install plugin** and
enable it. Use **Branch or tag** to pin a tagged release. Leave it blank to
follow the default branch with **Check for updates**. Buzz reads the committed
`manifest.json` and `plugin.js` from the root and builds nothing at install time.

If you installed a local copy, remove it before installing from GitHub so Buzz
records GitHub as the update source. For the original one-presenter,
one-viewer WebSocket setup, pin [v0.2.0](https://github.com/h2s2-studio/buzz-huddle-screen-sharing/tree/v0.2.0).

## Try it on one device

Open **Streams → Test my screen** from a conversation and select a source in the
system picker. The test sends video between two WebRTC peers inside the same
Buzz window. It works without a Huddle or a server. Select **Stop test** or
close the panel to release capture.

## Share in a Huddle

1. Everyone installs the plugin and joins the Huddle in Buzz.
2. Open **Streams → Share screen**, then choose a source in the system picker.
   A compatible community deployment creates the session automatically. For a
   service on another host or one that requires a key, use **Room service settings**.
3. Copy the **Session invite** into Buzz. Recipients open it and select **Join
   streams**. They can also paste it into **Join from an invite**. Streams uses their
   Buzz display names when available.
4. Select **Watch stream** beside a presenter. **Viewer quality** shows Auto and
   the advertised layers for that stream. The player displays the actual
   incoming resolution and offers **Fullscreen**. You can watch while sharing.
   **Change source** keeps the same stream and preserves the old source if canceled.

**Stop sharing** is also available in the Buzz toolbar while capture is active.
Switching conversations keeps the stream open. Leaving the Huddle ends the
local media session and stops capture. Streams carry screen video. Buzz
continues to handle voice. System audio is outside this prerelease.

## Host a deployment

One operator runs the **Rust room service** and **LiveKit** for their community.
They can run alongside a Buzz relay on a Linux VM. Other users install the plugin
and open the invite inside Buzz. See the [deployment guide](docs/deployment.md).

Room admission uses a 15-minute invite and a short-lived LiveKit token restricted
to the room and screen-share publishing. Anyone with the link can request access
during its lifetime. Send links to the intended participants. Buzz plugin API v1
exposes local call phase and does not verify who is in the same Huddle. The
[upstream design](docs/product.md) describes the integration needed for that.

## Authoring and verification

The plugin source uses TypeScript and TSX. Buzz supplies React. The build emits a
self-contained JavaScript module and CI checks it against the committed artifact.
The sidecar lives in the Rust workspace under `crates/buzz-streams-room-service`.

```sh
npm ci
npm run build
npm run check:build
cargo test --locked --workspace
cargo build --locked
npx playwright install chromium webkit
LIVEKIT_SERVER_BIN=livekit-server npm run test:media
```

Media tests launch the Rust service and a real local LiveKit instance. They use
synthetic capture tracks to verify solo playback, multi-presenter playback,
quality changes, source replacement, and teardown. Native Windows and Linux
screen capture still need physical device checks. Linux may require Buzz to
grant display-capture permission through its webview host.

Build a standalone artifact with
`buzzodz plugin pack . huddle-screen-sharing.buzzplugin`.
