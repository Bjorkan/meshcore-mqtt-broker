use super::types::RadioParams;
use serde_json::{Map, Value};

fn number(object: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        object.get(*key).and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
        })
    })
}

pub(super) fn parse_radio_params(object: &Map<String, Value>) -> RadioParams {
    let direct = object
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let mut params = object
        .get("radio")
        .and_then(Value::as_str)
        .map(parse_radio_string)
        .unwrap_or_default();
    let fields = RadioParams {
        freq: number(direct, &["freq", "frequency", "radioFreq"]),
        cr: number(direct, &["cr", "codingRate", "radioCr"]),
        sf: number(direct, &["sf", "spreadingFactor", "radioSf"]),
        bw: number(direct, &["bw", "bandwidth", "radioBw"]),
    };
    if fields.freq.is_some() {
        params.freq = fields.freq;
    }
    if fields.cr.is_some() {
        params.cr = fields.cr;
    }
    if fields.sf.is_some() {
        params.sf = fields.sf;
    }
    if fields.bw.is_some() {
        params.bw = fields.bw;
    }
    if params.freq.is_some_and(|freq| freq > 10_000_000.0) {
        params.freq = params.freq.map(|freq| freq / 1_000_000.0);
    } else if params.freq.is_some_and(|freq| freq > 10_000.0) {
        params.freq = params.freq.map(|freq| freq / 1_000.0);
    }
    if params.bw.is_some_and(|bw| bw > 1_000.0) {
        params.bw = params.bw.map(|bw| bw / 1_000.0);
    }
    params
}

fn parse_radio_string(value: &str) -> RadioParams {
    let comma = value.split(',').map(str::trim).collect::<Vec<_>>();
    let numeric = |token: &str| token.trim().parse::<f64>().ok();
    if comma.len() == 4 && comma.iter().all(|part| numeric(part).is_some()) {
        return RadioParams {
            freq: numeric(comma[0]),
            bw: numeric(comma[1]),
            sf: numeric(comma[2]),
            cr: numeric(comma[3]),
        };
    }
    if comma.len() == 5 && comma.iter().all(|part| numeric(part).is_some()) {
        return RadioParams {
            freq: numeric(comma[1]),
            bw: numeric(comma[2]),
            sf: numeric(comma[3]),
            cr: numeric(comma[4]),
        };
    }
    let tokens = value.split_whitespace().collect::<Vec<_>>();
    let preceding_number = |index: usize| {
        index
            .checked_sub(1)
            .and_then(|previous| numeric(tokens[previous]))
    };
    let following_number = |index: usize| tokens.get(index + 1).and_then(|next| numeric(next));
    let mut params = RadioParams::default();
    for (index, token) in tokens.iter().enumerate() {
        let upper = token.trim().to_ascii_uppercase();
        if let Some(raw) = upper.strip_suffix("MHZ") {
            match raw.trim().parse::<f64>() {
                Ok(freq) => params.freq = Some(freq),
                Err(_) if raw.trim().is_empty() => params.freq = preceding_number(index),
                Err(_) => {}
            }
            continue;
        }
        if let Some(raw) = upper.strip_suffix("KHZ") {
            match raw.trim().parse::<f64>() {
                Ok(freq) => params.freq = Some(freq / 1_000.0),
                Err(_) if raw.trim().is_empty() => {
                    params.freq = preceding_number(index).map(|freq| freq / 1_000.0);
                }
                Err(_) => {}
            }
            continue;
        }
        for (prefix, slot) in [
            ("BW", &mut params.bw),
            ("SF", &mut params.sf),
            ("CR", &mut params.cr),
        ] {
            if let Some(raw) = upper.strip_prefix(prefix) {
                match raw.trim().parse::<f64>() {
                    Ok(value) => *slot = Some(value),
                    Err(_) if raw.trim().is_empty() => *slot = following_number(index),
                    Err(_) => {}
                }
                break;
            }
        }
    }
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(radio: &str) -> RadioParams {
        parse_radio_params(serde_json::json!({"radio": radio}).as_object().unwrap())
    }

    #[test]
    fn firmware_radio_forms_are_normalized() {
        let four = params("868.0,125,7,5");
        assert_eq!(four.freq, Some(868.0));
        assert!(four.valid());

        let hertz = params("869525000,125000,11,5");
        assert_eq!(hertz.freq, Some(869.525));
        assert_eq!(hertz.bw, Some(125.0));

        let legacy = params("0,869525000,125000,11,5");
        assert_eq!(legacy.freq, Some(869.525));
        for radio in [
            "869.525MHz BW125 SF11 CR5",
            "868 MHz BW125 SF7 CR5",
            "868 MHz BW 125 SF 7 CR 5",
            "868000 KHz BW125 SF7 CR5",
        ] {
            assert!(params(radio).valid(), "{radio}");
        }
        assert!(!params("not a radio string").valid());
    }
}
