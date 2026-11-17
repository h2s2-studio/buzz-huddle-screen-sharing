use std::{env, net::SocketAddr};

use anyhow::{ensure, Context, Result};
use url::{Host, Url};

pub struct Config {
    pub bind_addr: SocketAddr,
    pub livekit_url: Url,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub room_creation_key: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let bind_addr = env::var("BUZZ_STREAMS_BIND_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8091".into())
            .parse()
            .context("invalid BUZZ_STREAMS_BIND_ADDR")?;
        let livekit_url = Url::parse(&required("LIVEKIT_URL")?).context("invalid LIVEKIT_URL")?;
        let loopback = match livekit_url.host() {
            Some(Host::Domain("localhost")) => true,
            Some(Host::Ipv4(ip)) => ip.is_loopback(),
            Some(Host::Ipv6(ip)) => ip.is_loopback(),
            _ => false,
        };
        ensure!(
            (livekit_url.scheme() == "wss" || (livekit_url.scheme() == "ws" && loopback))
                && livekit_url.host().is_some()
                && livekit_url.username().is_empty()
                && livekit_url.password().is_none()
                && livekit_url.query().is_none()
                && livekit_url.fragment().is_none(),
            "LIVEKIT_URL must be a wss URL or a loopback ws URL"
        );
        let room_creation_key = required("ROOM_CREATION_KEY")?;
        ensure!(
            (24..=256).contains(&room_creation_key.len()),
            "ROOM_CREATION_KEY must be 24–256 bytes"
        );
        Ok(Self {
            bind_addr,
            livekit_url,
            room_creation_key,
            livekit_api_key: required("LIVEKIT_API_KEY")?,
            livekit_api_secret: required("LIVEKIT_API_SECRET")?,
        })
    }
}

fn required(name: &str) -> Result<String> {
    let value = env::var(name).with_context(|| format!("missing {name}"))?;
    ensure!(!value.is_empty(), "{name} is empty");
    Ok(value)
}
