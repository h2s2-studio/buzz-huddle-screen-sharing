import * as React from "react";
import { createRoot } from "react-dom/client";
import { apply } from "../plugin.js";

const cleanups = [];
const phaseListeners = new Set();
const query = new URLSearchParams(location.search);
let phase = query.has("solo") ? "idle" : "connected";
let openedSockets = 0;
let panel;
let page;
let rejectCapture = false;
const captures = [];
const NativeSocket = window.WebSocket;
window.WebSocket = class extends NativeSocket {
  constructor(...args) {
    openedSockets++;
    super(...args);
  }
};
Object.defineProperty(MediaDevices.prototype, "getDisplayMedia", {
  value: async ({ video }) => {
    if (rejectCapture) {
      rejectCapture = false;
      throw new DOMException("Capture canceled", "NotAllowedError");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.width.ideal;
    canvas.height = video.height.ideal;
    const ctx = canvas.getContext("2d");
    const index = captures.length;
    let n = 0;
    const draw = () => {
      ctx.fillStyle = (index % 2 ? ["purple", "orange"] : ["green", "blue"])[++n % 2];
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white";
      ctx.fillRect(n % canvas.width, canvas.height / 2, 100, 100);
    };
    draw();
    const stream = canvas.captureStream(12);
    const capture = stream.getVideoTracks()[0];
    Object.defineProperty(capture, "label", { value: `Window ${index + 1}` });
    captures.push(capture);
    const interval = setInterval(() => {
      if (capture.readyState === "live") draw();
      else clearInterval(interval);
    }, 84);
    return stream;
  },
});
window.screenTest = {
  leave() {
    phase = "idle";
    for (const listener of phaseListeners) listener();
  },
  cancelNextCapture() { rejectCapture = true; },
  captureStates: () => captures.map((track) => track.readyState),
  openedSockets: () => openedSockets,
};
apply({
  react: React,
  panels: { register(contribution) { panel = contribution; } },
  pages: { register(contribution) { page = contribution; } },
  effect(setup) { cleanups.push(setup()); },
  inject(keys, callback) {
    if (keys[0] !== "huddleStatus") throw new Error("Unexpected injection");
    callback({
      effect(setup) { cleanups.push(setup()); },
      huddleStatus: {
        phase: () => phase,
        subscribe(listener) {
          phaseListeners.add(listener);
          return () => phaseListeners.delete(listener);
        },
      },
    });
  },
});
window.addEventListener("pagehide", () => {
  for (const cleanup of cleanups.reverse()) cleanup();
}, { once: true });

function Fixture() {
  const [open, setOpen] = React.useState(false);
  const [route, setRoute] = React.useState();
  if (route) {
    return React.createElement(page.component, { navigation: { target: { route } } });
  }
  return React.createElement(React.Fragment, null,
    React.createElement("div", { role: "toolbar", "aria-label": "Buzz toolbar" }, React.createElement(panel.toolbar)),
    React.createElement(panel.channelLauncher, {
      pressed: open,
      available: () => true,
      toggle: (target) => {
        if (panel.matches(target)) setOpen(!open);
      },
    }),
    React.createElement("button", {
      onClick: () => {
        const url = new URL(document.getElementById("route-link").value);
        const params = Object.fromEntries(
          [...url.searchParams.entries()].filter(([key]) => key.startsWith("route.")).map(([key, value]) => [key.slice(6), value]),
        );
        if (url.searchParams.get("page") !== page.id || !page.route.validate(params)) {
          throw new Error("Invite route was rejected");
        }
        setRoute({ version: page.route.version, params });
      },
    }, "Open Buzz link"),
    React.createElement("input", { "aria-label": "Buzz link", id: "route-link" }),
    open && React.createElement(panel.component),
  );
}
createRoot(document.querySelector("#app")).render(React.createElement(Fixture));
