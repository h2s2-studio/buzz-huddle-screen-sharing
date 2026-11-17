# Bringing Streams into Buzz Huddles

The H2S2 Studio prerelease uses stock Buzz’s panel, page route, toolbar, React,
and Huddle phase extension points. An independent Rust room service issues
admission tokens. LiveKit forwards each screen track to the participants who
choose to watch it. The plugin requests the active screen through the operating
system and leaves microphone capture, voice, and conversation navigation with Buzz.

## Desktop flow

- Open Streams with the monitor icon next to the conversation controls. A dot
  marks active capture even with the panel closed. The toolbar keeps a separate
  **Stop sharing** action available.
- In a Huddle, **Share screen** opens the OS picker. The player shows the source
  and maximum quality, with **Change source** and **Stop sharing** directly
  below it. Canceling the picker keeps the existing share.
- **Your preview** fills the player until you watch another presenter. While
  watching, a compact local preview keeps your own controls accessible. **Hide
  preview** keeps capture active while avoiding a recursive view.
- The panel uses Buzz's button variants, typography, surfaces, and focus colors.
  The live stream list sits alongside the player in a wide panel and stacks below
  it in a narrow panel. **Copy invite link** and **Leave Streams** sit in the footer.
- Opening an invite offers **Join streams**. Each live presenter has a
  **Watch stream** action. Watching, sharing, and voice each have their own
  stop action. **Leave Streams** ends the media session while voice continues.
- Keep the panel usable when clipboard access is denied by focusing a
  selectable copy of the invite. Show picker and connection errors above the
  current controls so the user can retry without looking below the player.

## Plugin catalog artwork

The package includes a cyan-to-teal monitor tile in `icon.png`. Stock Buzz
1.0.4 uses its bundled icon registry for the Settings catalog. A host change can
load the validated PNG or JPEG for an installed plugin and render it in the
same tile, using the installed revision as its cache key. The catalog's
publisher and trust indicators remain host-owned.

## Voice channels

Use a persistent named channel as the place people join for voice. The sidebar
shows who is in the active Huddle and who is sharing. A member can join, mute
or leave from that entry. Audio starts on join, and the next person can start
a new Huddle when the room is empty.

Share and watch controls belong in the voice room. Joining voice reveals
the live streams that room membership permits. The screen picker opens on
request, and the viewer starts each stream explicitly. Leaving voice removes
access to that room's streams and stops local capture. Stopping a share or
leaving the player keeps the person in voice.

An existing named Buzz conversation can already serve as a regular meeting spot
with native Huddles and the Streams invite flow. A first-class voice channel
needs a join action and roster in the Buzz sidebar and a relay-verified room
identity for Streams. The screen transport can stay behind the same room
identity and lifecycle.

## How the implementation fits the Buzz codebase

- The Rust room service mirrors the conventions in
  [the Buzz relay workspace](https://github.com/block/buzz/blob/main/Cargo.toml).
  It uses a Cargo workspace member, Tokio, Axum, serde wire types, explicit
  configuration and tracing. Its listener owns WebSocket admission and shutdown.
- The desktop source uses TypeScript and React supplied by the host. Its
  generated JavaScript module uses
  [Buzz’s external plugin contract](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md#plugin-module-contract).
  Local Huddle phase events bound the life of its media session.
- The client asks for a screen-only publication. The service signs a short-lived
  credential for one media room. LiveKit handles subscriptions, simulcast and
  transport. [LiveKit tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/)

## Upstream integration

### Put Streams in the Huddle window

The [companion window](https://github.com/block/buzz-app/blob/main/src/bundled/huddles/window-entry.tsx)
renders the built-in Huddle view in a separate webview. It receives a snapshot
and sends predefined actions through the [Huddle bridge](https://github.com/block/buzz-app/blob/main/src/features/huddle/window.ts).
The [plugin API](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md#huddle-status)
provides the call phase and the main shell's panel registry. Adding controls to
the companion requires a change to Buzz itself.

- Add a Buzz-owned screen-share button next to mute and chat. Give the player
  the main call area when watching or previewing a share, with the participant
  list and native call controls still visible.
- Give the Huddle owner a narrowly scoped screen-sharing contribution, with a
  versioned state and action contract. The companion renders Buzz-owned controls
  from that state. Keep one media session per Huddle. Choose how the companion
  presents its video explicitly, since the current bridge carries serializable
  state and cannot move a `MediaStream` between webviews.
- Tie admission and stream discovery to relay-verified Huddle membership. Issue
  short-lived, screen-scoped credentials under the same authority as voice.
  Joining voice would reveal streams and **Watch stream** would start an
  individual subscription. Closing or minimizing the companion keeps the call
  and share active. Leaving the Huddle stops capture and subscriptions.
- Implement any webview capture permissions or bridges in the native Rust host.
  Validate mixed-platform sessions on macOS, Windows and Linux, including
  source replacement, recovery and teardown.

Until then, the plugin uses one expiring invite per sharing session. Anyone
with the invite can join during that window. A local “connected” phase is
insufficient evidence of room membership.
