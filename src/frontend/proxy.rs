use crate::config::IpNetwork;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

pub(super) fn forwarded_source(
    request: &str,
    transport_peer: SocketAddr,
    trusted_proxies: &[IpNetwork],
) -> SocketAddr {
    if !is_trusted_proxy(transport_peer.ip(), trusted_proxies) {
        return transport_peer;
    }

    let forwarded = request
        .lines()
        .skip(1)
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("x-forwarded-for")
                .then_some(value)
        })
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .map(str::parse::<IpAddr>)
        .collect::<Result<Vec<_>, _>>();
    let Ok(forwarded) = forwarded else {
        return transport_peer;
    };

    let mut source = transport_peer.ip();
    for candidate in forwarded.into_iter().rev() {
        if !is_trusted_proxy(source, trusted_proxies) {
            break;
        }
        source = candidate;
    }
    SocketAddr::new(source, transport_peer.port())
}

fn is_trusted_proxy(address: IpAddr, trusted_proxies: &[IpNetwork]) -> bool {
    trusted_proxies
        .iter()
        .any(|network| network.contains(address))
}

pub(super) fn proxy_protocol_line(source: SocketAddr, destination: SocketAddr) -> String {
    let destination = match (source, destination) {
        (SocketAddr::V4(_), SocketAddr::V4(destination)) => SocketAddr::V4(destination),
        (SocketAddr::V6(_), SocketAddr::V6(destination)) => SocketAddr::V6(destination),
        (SocketAddr::V4(_), _) => {
            SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), destination.port())
        }
        (SocketAddr::V6(_), _) => {
            SocketAddr::new(IpAddr::V6(Ipv6Addr::UNSPECIFIED), destination.port())
        }
    };
    let family = if source.is_ipv4() { "TCP4" } else { "TCP6" };
    format!(
        "PROXY {family} {} {} {} {}\r\n",
        source.ip(),
        destination.ip(),
        source.port(),
        destination.port()
    )
}
