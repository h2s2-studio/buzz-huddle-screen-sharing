# Huddle screen sharing proposal

The proposed experience runs in an installable stock Buzz plugin. Open **Streams**
from the conversation header to see who is sharing. Select **Watch stream** for one
presenter, and switch streams without leaving the Huddle. Watching and presenting
have independent controls. A person can share while watching someone else.

## Presenting and watching

- **Share screen** opens the system picker. Show the applications, windows, and
  displays that the platform offers. Confirm the choice, show the selected source
  and an obvious sharing indicator, and keep **Stop sharing** accessible. **Change
  source** replaces the video after confirming a new selection. Canceling the picker
  keeps the current source. Keep **Test my screen** available for setup.
- Show a live list of presenters next to the focused viewer. Subscribe to video when
  a viewer selects **Watch stream**. Treat switching or **Stop watching** as a video
  action and leave Huddle audio connected. Offer **Fullscreen** for the focused stream.
- Give presenters a quality cap, starting with **Balanced** at 720p and 30 fps and
  **Sharp text** at up to 1080p and 30 fps. Give viewers **Auto** by default and show
  the actual received resolution. Expose explicit resolution choices only for
  published layers. Requesting a layer caps quality and may still adapt down when
  connectivity drops. Both presets depend on capture and encoder capabilities.
- Keep the stop control accessible when the conversation changes. Stop capture on
  Huddle leave or session revocation. Show a brief reconnection status for viewers
  and return to the list when the presenter ends the stream.

## Media rooms and access

The current plugin pairs one presenter and one viewer. Move to one media room per
sharing session and use a selective forwarding unit (SFU) such as self-hosted LiveKit.
Each presenter publishes a screen track. The service forwards only the stream each
viewer subscribes to and can serve different quality layers from the same presenter.
Keep microphone and voice playback on the existing Buzz Huddle. Start with video-only
sharing and verify OS capture and optional system audio separately. [LiveKit track subscription](https://docs.livekit.io/transport/media/subscribe/) · [Screen simulcast options](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishOptions.html)

For a stock-Buzz release, allow one expiring **Join sharing session** invite link per
room. The link opens the plugin through a registered in-app link target where
supported. Joining the media room reveals all active shares. Public plugin API v1
provides the local call phase and conversation context. Automatic Huddle-only admission
requires an upstream room-scoped proof or an equivalent server-side authority check.
Avoid assuming conversation membership is active call attendance. [Buzz plugin contract](https://github.com/block/buzz-app/blob/main/docs/plugin-architecture.md#huddle-status)

## First release milestone

Three Buzz users join one media room. Two can publish, the third switches between
streams, changes viewing quality, and goes fullscreen. Changing a source keeps the
current viewer subscribed. A stopped share disappears, and leaving tears down the
capture. Validate on real macOS and Windows installations and verify Linux capture
capability before claiming that Linux can publish. [Screen capture specification](https://www.w3.org/TR/screen-capture/)
