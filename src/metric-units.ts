const EXACT_UNITS = new Map<string, string>([
  ["stats.battery_mv", "mV"],
  ["battery_mv", "mV"],
  ["stats.last_rssi", "dBm"],
  ["last_rssi", "dBm"],
  ["stats.noise_floor", "dBm"],
  ["noise_floor", "dBm"],
  ["stats.last_snr", "dB"],
  ["last_snr", "dB"],
]);

export function canonicalMetricUnit(
  metricName: string,
  providedUnit?: string | null,
): string | null {
  const normalized = metricName.trim().toLowerCase();
  const exact = EXACT_UNITS.get(normalized);
  if (exact) return exact;
  if (/(?:^|[._-])(?:rssi|noise(?:_floor)?)(?:$|[._-])/.test(normalized)) {
    return "dBm";
  }
  if (/(?:^|[._-])snr(?:$|[._-])/.test(normalized)) return "dB";
  if (/(?:^|[._-])(?:battery|voltage)_mv(?:$|[._-])/.test(normalized)) {
    return "mV";
  }
  if (/(?:^|[._-])(?:battery|voltage)(?:$|[._-])/.test(normalized)) {
    return "V";
  }
  if (
    /(?:^|[._-])(?:uptime|rx_airtime|tx_airtime)(?:$|[._-])/.test(normalized)
  ) {
    return "s";
  }
  if (/(?:^|[._-])(?:frequency|freq)(?:_mhz)?(?:$|[._-])/.test(normalized)) {
    return "MHz";
  }
  if (/(?:^|[._-])(?:tx_power|power)(?:_dbm)?(?:$|[._-])/.test(normalized)) {
    return "dBm";
  }
  if (normalized.includes("temperature")) return "°C";
  if (normalized.includes("percent") || normalized.endsWith("_pct")) {
    return "%";
  }
  return providedUnit?.trim() || null;
}
