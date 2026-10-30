#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MeshcoreTopic {
    pub iata: String,
    pub public_key: String,
    pub subtopic: String,
}

pub fn parse_meshcore_topic(topic: &str) -> Option<MeshcoreTopic> {
    let parts = topic.split('/').collect::<Vec<_>>();
    if parts.len() < 4
        || parts[0] != "meshcore"
        || parts
            .iter()
            .any(|part| part.trim().is_empty() || part.contains(['+', '#']))
    {
        return None;
    }
    let raw_iata = parts[1].trim();
    let public_key = parts[2].to_ascii_uppercase();
    if public_key.len() != 64 || !public_key.bytes().all(|value| value.is_ascii_hexdigit()) {
        return None;
    }
    Some(MeshcoreTopic {
        iata: if raw_iata.eq_ignore_ascii_case("test") {
            "test".to_owned()
        } else {
            raw_iata.to_ascii_uppercase()
        },
        public_key,
        subtopic: parts[3..].join("/"),
    })
}

pub fn is_private_meshcore_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4
        && parts[0] == "meshcore"
        && matches!(
            parts[3].to_ascii_lowercase().as_str(),
            "internal" | "serial"
        )
}

pub fn is_observer_error_topic(topic: &str) -> bool {
    let parts = topic.split('/').collect::<Vec<_>>();
    parts.len() >= 4
        && parts[0] == "meshcore"
        && parts[3] == "error"
        && parts[2].len() == 64
        && parts[2].bytes().all(|value| value.is_ascii_hexdigit())
}

pub(super) fn normalized_topic(parsed: &MeshcoreTopic) -> String {
    format!(
        "meshcore/{}/{}/{}",
        parsed.iata, parsed.public_key, parsed.subtopic
    )
}
