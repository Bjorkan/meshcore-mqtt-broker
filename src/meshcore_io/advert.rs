use super::ingress::sanitize;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

#[derive(Debug)]
pub(super) struct ParsedAdvert {
    pub(super) public_key: String,
    pub(super) timestamp: u32,
    pub(super) advert_type: String,
    pub(super) name: Option<String>,
    pub(super) latitude: Option<f64>,
    pub(super) longitude: Option<f64>,
}

pub(super) fn is_advert_packet(packet: &[u8]) -> bool {
    packet
        .first()
        .is_some_and(|header| (header >> 2) & 0x0f == 4)
}

pub(super) fn parse_verified_advert(packet: &[u8]) -> Result<ParsedAdvert, String> {
    if packet.len() < 2 {
        return Err("packet too short".into());
    }
    let header = packet[0];
    if (header >> 2) & 0x0f != 4 {
        return Err("not an advert".into());
    }
    let mut offset = 1;
    if matches!(header & 0x03, 0 | 3) {
        offset += 4;
    }
    let path_len = *packet.get(offset).ok_or("missing path length")?;
    offset += 1;
    let path_bytes = (usize::from(path_len >> 6) + 1) * usize::from(path_len & 63);
    offset = offset.checked_add(path_bytes).ok_or("path overflow")?;
    let payload = packet.get(offset..).ok_or("invalid path length")?;
    if payload.len() < 101 {
        return Err("advert too short".into());
    }
    let public_key_bytes: [u8; 32] = payload[..32].try_into().unwrap();
    let timestamp = u32::from_le_bytes(payload[32..36].try_into().unwrap());
    let signature: [u8; 64] = payload[36..100].try_into().unwrap();
    let app_data = &payload[100..];

    let key = VerifyingKey::from_bytes(&public_key_bytes).map_err(|error| error.to_string())?;
    let mut signed = Vec::with_capacity(36 + app_data.len());
    signed.extend_from_slice(&public_key_bytes);
    signed.extend_from_slice(&timestamp.to_le_bytes());
    signed.extend_from_slice(app_data);
    key.verify(&signed, &Signature::from_bytes(&signature))
        .map_err(|_| "unverified advert".to_owned())?;

    let flags = app_data[0];
    let advert_type = match flags & 0x0f {
        2 => "REPEATER",
        3 => "ROOM",
        4 => "SENSOR",
        _ => "UNKNOWN",
    }
    .to_owned();
    let mut cursor = 1;
    let (latitude, longitude) = if flags & 0x10 != 0 {
        let lat = i32::from_le_bytes(
            app_data
                .get(cursor..cursor + 4)
                .ok_or("missing latitude")?
                .try_into()
                .unwrap(),
        );
        cursor += 4;
        let lon = i32::from_le_bytes(
            app_data
                .get(cursor..cursor + 4)
                .ok_or("missing longitude")?
                .try_into()
                .unwrap(),
        );
        cursor += 4;
        let coords = (f64::from(lat) / 1_000_000.0, f64::from(lon) / 1_000_000.0);
        if !(-90.0..=90.0).contains(&coords.0) || !(-180.0..=180.0).contains(&coords.1) {
            (None, None)
        } else {
            (Some(coords.0), Some(coords.1))
        }
    } else {
        (None, None)
    };
    if flags & 0x20 != 0 {
        cursor += 2;
    }
    if flags & 0x40 != 0 {
        cursor += 2;
    }
    let name = if flags & 0x80 != 0 {
        app_data
            .get(cursor..)
            .and_then(|bytes| sanitize(&String::from_utf8_lossy(bytes), 200))
    } else {
        None
    };
    Ok(ParsedAdvert {
        public_key: hex::encode(public_key_bytes),
        timestamp,
        advert_type,
        name,
        latitude,
        longitude,
    })
}

#[cfg(test)]
pub(super) fn signed_test_packet(timestamp: u32) -> (Vec<u8>, String) {
    use ed25519_dalek::{Signer, SigningKey};
    let signing = SigningKey::from_bytes(&[11; 32]);
    let public = signing.verifying_key().to_bytes();
    let app_data = vec![0x02_u8];
    let mut signed = Vec::with_capacity(37);
    signed.extend_from_slice(&public);
    signed.extend_from_slice(&timestamp.to_le_bytes());
    signed.extend_from_slice(&app_data);
    let signature = signing.sign(&signed);
    let mut packet = vec![0x10, 0, 0, 0, 0, 0];
    packet.extend_from_slice(&public);
    packet.extend_from_slice(&timestamp.to_le_bytes());
    packet.extend_from_slice(&signature.to_bytes());
    packet.extend_from_slice(&app_data);
    (packet, hex::encode(public))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advert_signature_is_verified_once_during_parsing() {
        let (packet, key) = signed_test_packet(100);
        let advert = parse_verified_advert(&packet).unwrap();
        assert_eq!(advert.public_key, key);
        assert_eq!(advert.advert_type, "REPEATER");

        let mut invalid = packet;
        invalid[50] ^= 1;
        assert_eq!(
            parse_verified_advert(&invalid).unwrap_err(),
            "unverified advert"
        );
    }
}
