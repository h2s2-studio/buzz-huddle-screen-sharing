# Self-host Buzz Streams

Run one room service and one LiveKit SFU for your group. Both can share a Linux
VM with the Buzz relay. The service uses separate listeners and does not need
the relay's credentials, database, or configuration. Video consumes additional
network bandwidth, especially with several publishers and viewers.

## Run beside the relay

Use the sample [Compose deployment](../deploy/compose.yaml) with your existing
TLS reverse proxy. Its room broker listens on loopback TCP 8091 and LiveKit
signaling listens on loopback TCP 7880. The compose stack uses Linux host
networking. Verify 7880, 7881, 7882, and 8091 are available before starting it.

1. Point a separate hostname such as `streams.example.org` at the VM. Add the
   [Caddy example](../deploy/Caddyfile.example) to your existing TLS proxy or
   adapt it for your proxy. Route `/rooms` and `/health` to 8091 and other paths
   including `/rtc` to 7880. Preserve WebSocket upgrades.
2. On the VM, allow TCP 7881 and UDP 7882 from the client networks. LiveKit
   advertises the `LIVEKIT_NODE_IP` that clients use for media. Use the VPN
   address for a VPN-only install, or the reachable public IP for a public
   install. Some restrictive networks need a TURN deployment. [LiveKit firewall reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
3. Create a deployment env file outside version control with restrictive file
   permissions. Set values for the following fields.

   | Variable | Value |
   | --- | --- |
   | `LIVEKIT_URL` | Browser-facing LiveKit URL such as `wss://streams.example.org` |
   | `LIVEKIT_NODE_IP` | IP address reachable by clients for media |
   | `LIVEKIT_API_KEY` | A randomly generated LiveKit key |
   | `LIVEKIT_API_SECRET` | A randomly generated LiveKit secret |
   | `ROOM_CREATION_KEY` | A separate random key of 24–256 bytes, shared with session organizers |

   Generate the LiveKit credentials with `livekit-server generate-keys` or
   generate them independently with `openssl rand -hex 32`. Generate a separate
   random value for `ROOM_CREATION_KEY`. Keep LiveKit credentials server-side.
4. From the checked-out plugin repository, validate and start the stack. Replace
   `/path/to/streams.env` with the file you created.

   ```sh
   docker compose --env-file /path/to/streams.env -f deploy/compose.yaml config --quiet
   docker compose --env-file /path/to/streams.env -f deploy/compose.yaml up -d --build
   curl -fsSI https://streams.example.org/
   curl -fsS https://streams.example.org/health
   ```

5. Give organizers `wss://streams.example.org/rooms` and the creation key. Test
   with two presenters and one viewer on the networks you expect users to use.

Configure TLS with a certificate trusted by the stock Buzz webview. Session
admission and LiveKit signaling use WebSockets. The SFU terminates WebRTC
transport encryption to relay video to viewers.

## Operation

The room broker stores invitations in memory. Restarting it invalidates
outstanding links. Already connected participants use LiveKit directly.
Restarting LiveKit can interrupt active video rooms. Roll back the room service
and plugin together using a tested release tag. No Buzz relay restart is
necessary for either operation.

For a local developer run, start LiveKit with `--dev` and use `cargo run --locked`
with the same credential variables, `LIVEKIT_URL=ws://127.0.0.1:7880` and
`BUZZ_STREAMS_BIND_ADDR=127.0.0.1:8091`. The Playwright fixture can use plain
loopback WebSockets. Use trusted WSS when testing inside stock Buzz Desktop.
