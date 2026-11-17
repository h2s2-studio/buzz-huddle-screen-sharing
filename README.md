# Huddle Screen Sharing for Buzz

An H2S2 Studio prototype packaged as an installable Buzz desktop plugin. The
presenter and viewer stay in their normal Buzz apps. Huddle audio uses the
existing Buzz relay. The plugin opens a screen-sharing panel beside the
conversation. Remote sharing uses a separate WebSocket service to establish a
video-only WebRTC connection. It uses public plugin API v1 and requires a Buzz desktop
build with `huddleStatus` and channel panel launchers, such as Buzz 1.0.4.

## Install from GitHub

In Buzz Desktop open **Settings → Plugins → Manage plugins → Add**. Paste
`https://github.com/h2s2-studio/buzz-huddle-screen-sharing` into **Git or GitHub
repository**, leave **Folder** blank, then select **Find** and **Install plugin**.
Enable the plugin in Manage plugins. Leave **Branch or tag** blank to follow the
default branch with Buzz’s **Check for updates**, or enter `v0.2.0` to pin the
initial prerelease. The repository root contains the built plugin.
Buzz loads it directly. Node.js is needed to run or test the signaling service.

If you previously installed a local copy, remove that installation in Manage
plugins before adding the GitHub version so Buzz can track the repository as its
source.

## Test by yourself

After installing in Buzz Desktop, open a conversation and select
**Screen sharing → Test my screen**. Choose a window or display in the system
picker. Buzz sends the video through two WebRTC peers inside the same window
and displays the result. Choose **Stop test** or close the panel to release
capture. The local test works without joining a Huddle or setting up a signaling
service. A live share also exercises connectivity to the other participant.

## Start the signaling service

Use Node.js 22 or later. From this repository's root, run these commands:

```sh
npm ci --omit=dev
npm start
```

The service listens on `127.0.0.1:8090` by default. Override `HOST` or `PORT`
when running behind a reverse proxy. Publish `/signal` over a trusted TLS
domain and forward WebSocket upgrades to the service. Both participants enter
the same address, such as `wss://screens.example.org/signal`. A GET to `/health`
is available for health checks. The service stores active sessions in memory.

Host ICE candidates are used by default for a same-network test. Set the
`ICE_SERVERS` environment variable to a JSON array of standard `RTCIceServer`
objects to use your STUN or TURN infrastructure. Both participants receive this
configuration. Use credentials suitable for distribution to the participants.

## Install and try

1. Install the plugin from GitHub in regular Buzz Desktop on both devices.
2. Join the same Huddle. In the conversation header, open **Screen sharing** and
   enter the signaling URL in both panels.
3. The presenter chooses **Share screen** and selects a display or window in the
   system picker. Send the code to the intended viewer, for example over a Buzz
   DM. The viewer enters it and chooses **Watch screen**.
4. Stop, close the panel, or leave the Huddle to end the video connection.

## Access and platform scope

Buzz API v1 gives this plugin the local call phase. Possession of the share code
grants access to one viewer. Invitations expire after five minutes and are consumed when a viewer connects.
Choose a signaling service you trust. It exchanges the connection descriptions
and ICE configuration. WebRTC handles the video stream separately.

The plugin uses the desktop webview’s `getDisplayMedia` API. Two-device tests
with the native picker in stock Buzz are pending. Linux WebKitGTK commonly denies
unhandled display permission requests, and Buzz 1.0.4's permission handler
specifically grants microphone requests. Linux presenting needs a host fix or
an OS capture integration. Verify receiving on the target Linux build before
claiming platform support. Both participants need the installed plugin.

## Verification

```sh
npm ci
npm test
npx playwright install chromium webkit
npm run test:browser
```

The browser tests exercise single-device playback without a connection to the
signaling service, as well as real WebRTC video and signaling between two
browser sessions. The fixture supplies the Huddle state and an artificial
capture stream. CI runs Chromium on Ubuntu and WebKit on macOS, including a
Chromium-to-WebKit share on macOS.

To make a release artifact, use the [Buzz plugin packer](https://github.com/block/buzz-app/blob/v1.0.4/docs/plugin-architecture.md#plugin-release-signing)
with the repository root. Release tags designate immutable plugin versions.
See the [product proposal](docs/product.md) for planned multi-stream behavior.
