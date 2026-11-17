import { ScreenSharePresets } from "livekit-client";

export const presets = {
  balanced: { label: "Balanced (up to 720p / 30 fps)", video: ScreenSharePresets.h720fps30 },
  sharp: { label: "Sharp text (up to 1080p / 30 fps)", video: ScreenSharePresets.h1080fps30 },
};
export type Preset = keyof typeof presets;

export function captureScreen(preset: Preset): Promise<MediaStream> {
  const { width, height } = presets[preset].video;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return Promise.reject(new Error("Screen capture isn’t available in this Buzz installation."));
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

export async function limitCapture(track: MediaStreamTrack, preset: Preset) {
  const { width, height } = presets[preset].video;
  const actual = track.getSettings();
  if (
    (actual.width ?? Infinity) > width ||
    (actual.height ?? Infinity) > height ||
    (actual.frameRate ?? Infinity) > 30
  ) {
    await track.applyConstraints({ width: { max: width }, height: { max: height }, frameRate: { max: 30 } });
  }
  track.contentHint = "detail";
}

export function captureError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Screen selection canceled or permission was denied.";
  }
  return error instanceof Error && error.message.startsWith("Screen capture isn’t available")
    ? error.message
    : "Couldn’t capture the selected source. Check screen recording permissions.";
}

type SoloRun = {
  sender?: RTCPeerConnection;
  receiver?: RTCPeerConnection;
  capture?: MediaStream;
  remote?: MediaStream;
  abort: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
};

function gather(connection: RTCPeerConnection, signal: AbortSignal) {
  return new Promise<RTCSessionDescription>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", check);
      signal.removeEventListener("abort", finish);
      const description = connection.localDescription;
      if (description && connection.iceGatheringState === "complete" && !signal.aborted) resolve(description);
      else reject(new Error("Local WebRTC negotiation did not finish."));
    };
    const check = () => {
      if (connection.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, 8000);
    connection.addEventListener("icegatheringstatechange", check);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
    else check();
  });
}

export type SoloState = { active: boolean; video?: MediaStream; error?: string };

export function makeSoloTest(onChange: (state: SoloState) => void) {
  let current: SoloRun | undefined;
  function stop(error?: string) {
    const run = current;
    if (!run) return;
    current = undefined;
    run.abort.abort();
    clearTimeout(run.timeout);
    run.sender?.close();
    run.receiver?.close();
    stopStream(run.capture);
    onChange({ active: false, error });
  }

  async function start() {
    if (current) return;
    const run: SoloRun = { abort: new AbortController() };
    current = run;
    onChange({ active: true });
    try {
      const stream = await captureScreen("balanced");
      if (current !== run) return stopStream(stream);
      run.capture = stream;
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState !== "live") throw new Error("The selected source is unavailable.");
      track.addEventListener("ended", () => { if (current === run) stop(); }, { once: true });
      const sender = new RTCPeerConnection({ iceServers: [] });
      run.sender = sender;
      const receiver = new RTCPeerConnection({ iceServers: [] });
      run.receiver = receiver;
      run.timeout = setTimeout(() => stop("Local video playback didn’t start."), 20000);
      const sync = () => {
        if (current !== run) return;
        if (receiver.connectionState === "failed" || receiver.connectionState === "disconnected") {
          stop("Local video playback stopped.");
        } else if (receiver.connectionState === "connected" && run.remote) {
          clearTimeout(run.timeout);
          onChange({ active: true, video: run.remote });
        }
      };
      receiver.onconnectionstatechange = sync;
      receiver.ontrack = ({ track }) => {
        run.remote = new MediaStream([track]);
        sync();
      };
      sender.addTransceiver(track, { direction: "sendonly" });
      await sender.setLocalDescription(await sender.createOffer());
      await receiver.setRemoteDescription(await gather(sender, run.abort.signal));
      await receiver.setLocalDescription(await receiver.createAnswer());
      await sender.setRemoteDescription(await gather(receiver, run.abort.signal));
    } catch (error) {
      if (current === run) stop(run.capture ? "Couldn’t start local video playback." : captureError(error));
    }
  }

  return { start, stop };
}

export function stopStream(stream?: MediaStream) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
