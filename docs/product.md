# Bringing Streams into Buzz Huddles

The H2S2 Studio prerelease uses stock Buzz’s panel, page route, toolbar, React,
and Huddle phase extension points. An independent Rust room service issues
admission tokens. LiveKit forwards each screen track to the participants who
choose to watch it. The plugin requests the active screen through the operating
system and leaves microphone capture, voice, and conversation navigation with Buzz.

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

1. Have the Buzz relay associate screen-share admission with a live Huddle and
   verified membership. The relay can issue a short-lived, screen-scoped
   credential after checking the same authority that admits the voice call.
2. Expose an opaque session handle and stream roster through the Huddle service.
   Keep the media provider behind that service so voice teardown, departure,
   and revocation stop screen tracks in the same lifecycle.
3. Put the presenter picker, stream list, and controls in Buzz's native Huddle
   surface as well as its conversation. Where the desktop webview needs a
   host permission or capture bridge, implement that in the native Rust host.
4. Validate the same watch and share behavior on macOS, Windows and Linux.
   Exercise mixed-platform sessions on separate devices, source replacement
   during watch, transport recovery, and Huddle teardown.

Until then, the plugin uses one expiring invite per sharing session. Anyone
with the invite can join during that window. A local “connected” phase is
insufficient evidence of room membership.
