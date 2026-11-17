import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createSignaling } from "../server/index.mjs";

const code = "a".repeat(22);
const display = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
const read = async (socket) =>
	JSON.parse((await once(socket, "message"))[0].toString());
const send = (socket, value) => socket.send(JSON.stringify(value));
async function setup(t, options) {
	const { server, sockets } = createSignaling(options);
	t.after(async () => {
		for (const socket of sockets.clients) socket.terminate();
		await Promise.all([
			new Promise((done) => server.close(done)),
			new Promise((done) => sockets.close(done)),
		]);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return async () => {
		const socket = new WebSocket(
			`ws://127.0.0.1:${server.address().port}/signal`,
		);
		await once(socket, "open");
		return socket;
	};
}

test("a code pairs two peers once, relays their SDP and closes the other peer", {
	timeout: 5000,
}, async (t) => {
	const connect = await setup(t);
	const presenter = await connect();
	send(presenter, { type: "present", code });
	assert.equal((await read(presenter)).type, "waiting");
	const viewer = await connect();
	const pair = Promise.all([read(viewer), read(presenter)]);
	send(viewer, { type: "watch", code });
	assert.deepEqual(
		(await pair).map(({ type }) => type),
		["paired", "paired"],
	);
	const outsider = await connect();
	send(outsider, { type: "watch", code });
	assert.equal((await once(outsider, "close"))[0], 1008);
	send(presenter, { type: "offer", sdp: display });
	assert.deepEqual(await read(viewer), { type: "offer", sdp: display });
	send(viewer, { type: "answer", sdp: display });
	assert.deepEqual(await read(presenter), { type: "answer", sdp: display });
	const closed = once(presenter, "close");
	viewer.close();
	assert.equal((await closed)[0], 1000);
});

test("unclaimed invitations expire and refuse viewers", {
	timeout: 5000,
}, async (t) => {
	const connect = await setup(t, { invitationMs: 50 });
	const presenter = await connect();
	send(presenter, { type: "present", code });
	await once(presenter, "close");
	const viewer = await connect();
	send(viewer, { type: "watch", code });
	assert.equal((await once(viewer, "close"))[0], 1008);
});
