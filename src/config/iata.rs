use super::ConfigError;

const FRIENDLY_NAME_MAX_LENGTH: usize = 120;

/// The legacy loader validated `friendly_name`: a non-empty string without
/// control characters, at most 120 characters.
pub(super) fn validate_friendly_name(raw: Option<&str>, code: &str) -> Result<(), ConfigError> {
    let Some(name) = raw else {
        return Ok(());
    };
    let name = name.trim();
    if name.is_empty() {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must not be empty"
        )));
    }
    if name.chars().count() > FRIENDLY_NAME_MAX_LENGTH {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must be at most {FRIENDLY_NAME_MAX_LENGTH} characters"
        )));
    }
    if name.chars().any(|ch| ch.is_control()) {
        return Err(ConfigError::Invalid(format!(
            "Configuration value allowed_iata.{code}.friendly_name must not contain control characters"
        )));
    }
    Ok(())
}

pub(super) fn normalize_iata(raw: &str) -> Result<String, ConfigError> {
    let code = raw.trim().to_ascii_uppercase();
    if code.len() != 3 || !code.bytes().all(|v| v.is_ascii_alphabetic()) {
        return Err(ConfigError::Invalid(format!(
            "IATA code must be exactly three letters, got {raw:?}"
        )));
    }
    Ok(code)
}
