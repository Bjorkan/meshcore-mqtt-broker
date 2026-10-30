use super::ConfigError;
/// Legacy `MESHCORE_*` environment overrides: the variable name is
/// `MESHCORE_` + the setting path joined with underscores, uppercased.
/// A missing or whitespace-only variable never overrides the YAML value.
pub(super) fn env_value(path: &[&str]) -> Option<String> {
    let name = format!("MESHCORE_{}", path.join("_").to_ascii_uppercase());
    std::env::var(name)
        .ok()
        .filter(|raw| !raw.trim().is_empty())
}

pub(super) fn env_string(path: &[&str]) -> Option<String> {
    env_value(path).map(|raw| raw.trim().to_owned())
}

/// Like `env_string`, but also strips one pair of surrounding quotes the
/// way the legacy `envString()` did for target credentials.
pub(super) fn env_quoted_string(path: &[&str]) -> Option<String> {
    let trimmed = env_string(path)?;
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return Some(trimmed[1..trimmed.len() - 1].to_owned());
        }
    }
    Some(trimmed)
}

pub(super) fn env_int(path: &[&str], min: i64, max: i64) -> Result<Option<i64>, ConfigError> {
    let Some(raw) = env_value(path) else {
        return Ok(None);
    };
    let raw = raw.trim();
    let value: i64 = raw.parse().map_err(|_| {
        ConfigError::Invalid(format!(
            "Configuration value {} must be an integer, got {raw:?}",
            path.join(".")
        ))
    })?;
    if !(min..=max).contains(&value) {
        return Err(ConfigError::Invalid(format!(
            "Configuration value {} must be between {min} and {max}",
            path.join(".")
        )));
    }
    Ok(Some(value))
}

pub(super) fn env_bool(path: &[&str]) -> Result<Option<bool>, ConfigError> {
    let Some(raw) = env_value(path) else {
        return Ok(None);
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(Some(true)),
        "0" | "false" | "no" | "off" => Ok(Some(false)),
        other => Err(ConfigError::Invalid(format!(
            "Configuration value {} must be true/false/yes/no/on/off/1/0, got {other:?}",
            path.join(".")
        ))),
    }
}
