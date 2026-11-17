import {
  Room, RoomEvent, Track, VideoPresets, VideoQuality,
  type LocalVideoTrack, type RemoteTrackPublication,
} from "livekit-client";
import { requestRoom } from "./admission";
import { captureError, captureScreen, limitCapture, presets, stopStream, type Preset } from "./capture";
import { inviteLink, socketUrl, type RoomRequest } from "./protocol";

type RoomPhase = "idle" | "connecting" | "connected" | "reconnecting";
type Capture = { source: MediaStreamTrack; published: LocalVideoTrack; label: string; preset: Preset };
type ActiveRoom = {
  room: Room;
  abort: AbortController;
  invite?: { link: string; expiresAt: number };
  publish?: Capture;
  pending?: MediaStreamTrack;
  picking: boolean;
  stopping: boolean;
  watching?: RemoteTrackPublication;
  remote?: MediaStream;
  quality: Quality;
  ticker?: ReturnType<typeof setInterval>;
};
type Quality = VideoQuality | "auto";
type Stream = { id: string; presenter: string; muted: boolean };
export type RoomSnapshot = {
  phase: RoomPhase;
  error?: string;
  invite?: ActiveRoom["invite"];
  picking: boolean;
  stopping: boolean;
  sharing?: Pick<Capture, "label" | "preset">;
  streams: Stream[];
  watching?: string;
  video?: MediaStream;
  quality: Quality;
  layers: { value: VideoQuality; height: number }[];
};
const idle: RoomSnapshot = {
  phase: "idle", picking: false, stopping: false, streams: [], quality: "auto", layers: [],
};

function layers(publication?: RemoteTrackPublication): RoomSnapshot["layers"] {
  if (!publication) return [];
  const info = publication.trackInfo;
  const codec = info?.codecs.find((item) => item.mimeType === publication.mimeType) ?? info?.codecs[0];
  const available = codec?.layers.length ? codec.layers : info?.layers ?? [];
  const choices = new Map<number, VideoQuality>();
  for (const layer of available) {
    const quality = [VideoQuality.LOW, VideoQuality.MEDIUM, VideoQuality.HIGH][layer.quality];
    if (layer.height > 0 && quality !== undefined) choices.set(layer.height, quality);
  }
  return [...choices.entries()].sort(([a], [b]) => a - b).map(([height, value]) => ({ height, value }));
}

export function makeRoomSession() {
  let active: ActiveRoom | undefined;
  let snapshot = idle;
  const listeners = new Set<() => void>();
  function emit(next: RoomSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function refresh(run: ActiveRoom, phase = snapshot.phase, error = snapshot.error) {
    if (active !== run) return;
    const streams: Stream[] = [];
    for (const participant of run.room.remoteParticipants.values()) {
      const publication = participant.getTrackPublication(Track.Source.ScreenShare);
      if (publication) streams.push({ id: publication.trackSid, presenter: participant.name || "Participant", muted: publication.isMuted });
    }
    if (run.watching && !streams.some((item) => item.id === run.watching?.trackSid)) {
      run.watching = undefined;
      run.quality = "auto";
    }
    const track = run.watching?.videoTrack?.mediaStreamTrack;
    if (run.remote?.getVideoTracks()[0] !== track) {
      run.remote = track ? new MediaStream([track]) : undefined;
    }
    const available = layers(run.watching);
    if (run.quality !== "auto" && !available.some(({ value }) => value === run.quality)) {
      run.quality = "auto";
      run.watching?.setVideoQuality(VideoQuality.HIGH);
    }
    emit({
      phase, error, streams, invite: run.invite, picking: run.picking, stopping: run.stopping,
      sharing: run.publish && { label: run.publish.label, preset: run.publish.preset },
      watching: run.watching?.trackSid, video: run.remote, quality: run.quality, layers: available,
    });
  }

  function leave(error?: string) {
    const run = active;
    active = undefined;
    if (run) {
      clearInterval(run.ticker);
      run.abort.abort();
      run.pending?.stop();
      run.publish?.source.stop();
      void run.room.disconnect().catch(() => {});
    }
    emit({ ...idle, error });
  }

  async function connect(brokerInput: string, request: RoomRequest) {
    if (active) return;
    let broker: string;
    try {
      broker = socketUrl(brokerInput);
    } catch {
      return leave("Enter a secure room service URL ending in /rooms.");
    }
    const room = new Room({ dynacast: true });
    const run: ActiveRoom = { room, abort: new AbortController(), quality: "auto", picking: false, stopping: false };
    active = run;
    refresh(run, "connecting", "");
    const sync = () => refresh(run);
    room
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.TrackPublished, sync)
      .on(RoomEvent.TrackUnpublished, sync)
      .on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.TrackSubscriptionFailed, (sid) => {
        if (run.watching?.trackSid === sid) {
          changeWatch(undefined);
          refresh(run, undefined, "Couldn’t load that stream. Try watching it again.");
        }
      })
      .on(RoomEvent.Reconnecting, () => refresh(run, "reconnecting"))
      .on(RoomEvent.Reconnected, () => refresh(run, "connected"))
      .on(RoomEvent.Disconnected, () => {
        if (active === run && snapshot.phase !== "connecting") leave("The sharing session disconnected.");
      });

    try {
      const admission = await requestRoom(broker, request, run.abort.signal);
      if (active !== run) return;
      if (admission.invite) {
        run.invite = {
          link: inviteLink({ broker, code: admission.invite.code }),
          expiresAt: admission.invite.expiresAt,
        };
      }
      try {
        await room.connect(admission.url, admission.token, { autoSubscribe: false, maxRetries: 0 });
      } catch {
        throw new Error("Couldn’t connect to the video service. Check the room service’s LiveKit setup.");
      }
      if (active !== run) {
        await room.disconnect();
        return;
      }
      // The SFU can advertise its encodings after announcing the publication.
      run.ticker = setInterval(sync, 2000);
      refresh(run, "connected", "");
    } catch (error) {
      if (active === run) leave(error instanceof Error ? error.message : "Couldn’t join the sharing session.");
    }
  }

  function changeWatch(id?: string) {
    const run = active;
    if (!run || (id && snapshot.phase !== "connected")) return;
    if (run.watching?.trackSid === id) return;
    run.watching?.setSubscribed(false);
    run.watching = undefined;
    run.quality = "auto";
    if (id) {
      for (const participant of run.room.remoteParticipants.values()) {
        const candidate = participant.getTrackPublication(Track.Source.ScreenShare);
        if (candidate?.trackSid === id) {
          run.watching = candidate;
          candidate.setSubscribed(true);
          candidate.setVideoQuality(VideoQuality.HIGH);
          break;
        }
      }
    }
    refresh(run, undefined, "");
  }

  function quality(value: Quality) {
    const run = active;
    if (!run?.watching || (value !== "auto" && !snapshot.layers.some((layer) => layer.value === value))) return;
    run.quality = value;
    run.watching.setVideoQuality(value === "auto" ? VideoQuality.HIGH : value);
    refresh(run, undefined, "");
  }

  async function stopSharing() {
    const run = active;
    if (!run || !run.publish) return;
    const capture = run.publish;
    run.publish = undefined;
    run.stopping = true;
    capture.source.stop();
    refresh(run);
    try {
      await run.room.localParticipant.unpublishTrack(capture.published);
    } catch {
      if (active === run) leave("The sharing session closed while stopping the stream.");
    } finally {
      run.stopping = false;
      refresh(run);
    }
  }

  async function share(preset: Preset) {
    const run = active;
    if (!run || run.picking || run.stopping || snapshot.phase !== "connected") return;
    const previous = run.publish;
    preset = previous?.preset ?? preset;
    run.picking = true;
    refresh(run, undefined, "");
    let incoming: MediaStream | undefined;
    let source: MediaStreamTrack | undefined;
    try {
      incoming = await captureScreen(preset);
      source = incoming.getVideoTracks()[0];
      if (active !== run || run.publish !== previous) return;
      if (!source || source.readyState !== "live") throw new Error("The selected source is unavailable.");
      run.pending = source;
      await limitCapture(source, preset);
      if (active !== run || run.publish !== previous) return;
      let published: LocalVideoTrack | undefined;
      if (previous) {
        published = await previous.published.replaceTrack(source);
      } else {
        const high = presets[preset].video;
        const publication = await run.room.localParticipant.publishTrack(source, {
          source: Track.Source.ScreenShare,
          simulcast: true,
          videoCodec: "vp8",
          screenShareEncoding: high.encoding,
          screenShareSimulcastLayers: preset === "sharp"
            ? [VideoPresets.h360, VideoPresets.h720]
            : [VideoPresets.h360],
        });
        published = publication.videoTrack;
      }
      if (active !== run || run.publish !== previous) return;
      if (!published || source.readyState !== "live") {
        if (published) await run.room.localParticipant.unpublishTrack(published);
        if (previous) void stopSharing();
        throw new Error("The selected source is unavailable.");
      }
      previous?.source.stop();
      const surface = source.getSettings().displaySurface;
      const label = source.label || ({ monitor: "Entire screen", window: "Window", browser: "Tab" }[surface ?? ""] ?? "Screen");
      const capture = { source, published, label, preset };
      run.publish = capture;
      source.addEventListener("ended", () => {
        if (active === run && run.publish === capture) void stopSharing();
      }, { once: true });
    } catch (error) {
      if (active === run && run.publish === previous) {
        if (previous && source && previous.published.mediaStreamTrack === source) {
          try {
            await previous.published.replaceTrack(previous.source);
          } catch {
            await stopSharing();
          }
        }
        refresh(run, undefined, incoming ? "Couldn’t publish the selected source." : captureError(error));
      }
    } finally {
      if (run.publish?.source !== source) stopStream(incoming);
      run.pending = undefined;
      run.picking = false;
      refresh(run);
    }
  }

  return {
    connect, leave, changeWatch, quality, share, stopSharing,
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
