/**
 * Swedish MeshCore logical region scopes.
 *
 * Canonical form is lowercase: `se` (Sweden), `seXX` (county), `seXXXX` (municipality).
 * These are MeshCore neighbor scopes/regions and are intentionally distinct from the
 * three-letter geographic IATA MQTT ingress codes handled by `iata-registry.ts`.
 *
 * Codes follow Statistiska centralbyrån (SCB), "Län och kommuner 2026".
 * Municipality names are hardcoded from the official Swedish municipality list
 * (Wikipedia, "Lista över Sveriges kommuner", 2026). Attribution is recorded in
 * THIRD_PARTY_NOTICES.md.
 */

const LAN_NAMES: Record<string, string> = {
  "01": "Stockholms län",
  "03": "Uppsala län",
  "04": "Södermanlands län",
  "05": "Östergötlands län",
  "06": "Jönköpings län",
  "07": "Kronobergs län",
  "08": "Kalmar län",
  "09": "Gotlands län",
  "10": "Blekinge län",
  "12": "Skåne län",
  "13": "Hallands län",
  "14": "Västra Götalands län",
  "17": "Värmlands län",
  "18": "Örebro län",
  "19": "Västmanlands län",
  "20": "Dalarnas län",
  "21": "Gävleborgs län",
  "22": "Västernorrlands län",
  "23": "Jämtlands län",
  "24": "Västerbottens län",
  "25": "Norrbottens län",
};

const KOMMUN_NAMES: Record<string, string> = {
  "0114": "Upplands Väsby kommun",
  "0115": "Vallentuna kommun",
  "0117": "Österåkers kommun",
  "0120": "Värmdö kommun",
  "0123": "Järfälla kommun",
  "0125": "Ekerö kommun",
  "0126": "Huddinge kommun",
  "0127": "Botkyrka kommun",
  "0128": "Salems kommun",
  "0136": "Haninge kommun",
  "0138": "Tyresö kommun",
  "0139": "Upplands-Bro kommun",
  "0140": "Nykvarns kommun",
  "0160": "Täby kommun",
  "0162": "Danderyds kommun",
  "0163": "Sollentuna kommun",
  "0180": "Stockholms kommun",
  "0181": "Södertälje kommun",
  "0182": "Nacka kommun",
  "0183": "Sundbybergs kommun",
  "0184": "Solna kommun",
  "0186": "Lidingö kommun",
  "0187": "Vaxholms kommun",
  "0188": "Norrtälje kommun",
  "0191": "Sigtuna kommun",
  "0192": "Nynäshamns kommun",
  "0305": "Håbo kommun",
  "0319": "Älvkarleby kommun",
  "0330": "Knivsta kommun",
  "0331": "Heby kommun",
  "0360": "Tierps kommun",
  "0380": "Uppsala kommun",
  "0381": "Enköpings kommun",
  "0382": "Östhammars kommun",
  "0428": "Vingåkers kommun",
  "0461": "Gnesta kommun",
  "0480": "Nyköpings kommun",
  "0481": "Oxelösunds kommun",
  "0482": "Flens kommun",
  "0483": "Katrineholms kommun",
  "0484": "Eskilstuna kommun",
  "0486": "Strängnäs kommun",
  "0488": "Trosa kommun",
  "0509": "Ödeshögs kommun",
  "0512": "Ydre kommun",
  "0513": "Kinda kommun",
  "0560": "Boxholms kommun",
  "0561": "Åtvidabergs kommun",
  "0562": "Finspångs kommun",
  "0563": "Valdemarsviks kommun",
  "0580": "Linköpings kommun",
  "0581": "Norrköpings kommun",
  "0582": "Söderköpings kommun",
  "0583": "Motala kommun",
  "0584": "Vadstena kommun",
  "0586": "Mjölby kommun",
  "0604": "Aneby kommun",
  "0617": "Gnosjö kommun",
  "0642": "Mullsjö kommun",
  "0643": "Habo kommun",
  "0662": "Gislaveds kommun",
  "0665": "Vaggeryds kommun",
  "0680": "Jönköpings kommun",
  "0682": "Nässjö kommun",
  "0683": "Värnamo kommun",
  "0684": "Sävsjö kommun",
  "0685": "Vetlanda kommun",
  "0686": "Eksjö kommun",
  "0687": "Tranås kommun",
  "0760": "Uppvidinge kommun",
  "0761": "Lessebo kommun",
  "0763": "Tingsryds kommun",
  "0764": "Alvesta kommun",
  "0765": "Älmhults kommun",
  "0767": "Markaryds kommun",
  "0780": "Växjö kommun",
  "0781": "Ljungby kommun",
  "0821": "Högsby kommun",
  "0834": "Torsås kommun",
  "0840": "Mörbylånga kommun",
  "0860": "Hultsfreds kommun",
  "0861": "Mönsterås kommun",
  "0862": "Emmaboda kommun",
  "0880": "Kalmar kommun",
  "0881": "Nybro kommun",
  "0882": "Oskarshamns kommun",
  "0883": "Västerviks kommun",
  "0884": "Vimmerby kommun",
  "0885": "Borgholms kommun",
  "0980": "Gotlands kommun",
  "1060": "Olofströms kommun",
  "1080": "Karlskrona kommun",
  "1081": "Ronneby kommun",
  "1082": "Karlshamns kommun",
  "1083": "Sölvesborgs kommun",
  "1214": "Svalövs kommun",
  "1230": "Staffanstorps kommun",
  "1231": "Burlövs kommun",
  "1233": "Vellinge kommun",
  "1256": "Östra Göinge kommun",
  "1257": "Örkelljunga kommun",
  "1260": "Bjuvs kommun",
  "1261": "Kävlinge kommun",
  "1262": "Lomma kommun",
  "1263": "Svedala kommun",
  "1264": "Skurups kommun",
  "1265": "Sjöbo kommun",
  "1266": "Hörby kommun",
  "1267": "Höörs kommun",
  "1270": "Tomelilla kommun",
  "1272": "Bromölla kommun",
  "1273": "Osby kommun",
  "1275": "Perstorps kommun",
  "1276": "Klippans kommun",
  "1277": "Åstorps kommun",
  "1278": "Båstads kommun",
  "1280": "Malmö kommun",
  "1281": "Lunds kommun",
  "1282": "Landskrona kommun",
  "1283": "Helsingborgs kommun",
  "1284": "Höganäs kommun",
  "1285": "Eslövs kommun",
  "1286": "Ystads kommun",
  "1287": "Trelleborgs kommun",
  "1290": "Kristianstads kommun",
  "1291": "Simrishamns kommun",
  "1292": "Ängelholms kommun",
  "1293": "Hässleholms kommun",
  "1315": "Hylte kommun",
  "1380": "Halmstads kommun",
  "1381": "Laholms kommun",
  "1382": "Falkenbergs kommun",
  "1383": "Varbergs kommun",
  "1384": "Kungsbacka kommun",
  "1401": "Härryda kommun",
  "1402": "Partille kommun",
  "1407": "Öckerö kommun",
  "1415": "Stenungsunds kommun",
  "1419": "Tjörns kommun",
  "1421": "Orusts kommun",
  "1427": "Sotenäs kommun",
  "1430": "Munkedals kommun",
  "1435": "Tanums kommun",
  "1438": "Dals-Eds kommun",
  "1439": "Färgelanda kommun",
  "1440": "Ale kommun",
  "1441": "Lerums kommun",
  "1442": "Vårgårda kommun",
  "1443": "Bollebygds kommun",
  "1444": "Grästorps kommun",
  "1445": "Essunga kommun",
  "1446": "Karlsborgs kommun",
  "1447": "Gullspångs kommun",
  "1452": "Tranemo kommun",
  "1460": "Bengtsfors kommun",
  "1461": "Melleruds kommun",
  "1462": "Lilla Edets kommun",
  "1463": "Marks kommun",
  "1465": "Svenljunga kommun",
  "1466": "Herrljunga kommun",
  "1470": "Vara kommun",
  "1471": "Götene kommun",
  "1472": "Tibro kommun",
  "1473": "Töreboda kommun",
  "1480": "Göteborgs kommun",
  "1481": "Mölndals kommun",
  "1482": "Kungälvs kommun",
  "1484": "Lysekils kommun",
  "1485": "Uddevalla kommun",
  "1486": "Strömstads kommun",
  "1487": "Vänersborgs kommun",
  "1488": "Trollhättans kommun",
  "1489": "Alingsås kommun",
  "1490": "Borås kommun",
  "1491": "Ulricehamns kommun",
  "1492": "Åmåls kommun",
  "1493": "Mariestads kommun",
  "1494": "Lidköpings kommun",
  "1495": "Skara kommun",
  "1496": "Skövde kommun",
  "1497": "Hjo kommun",
  "1498": "Tidaholms kommun",
  "1499": "Falköpings kommun",
  "1715": "Kils kommun",
  "1730": "Eda kommun",
  "1737": "Torsby kommun",
  "1760": "Storfors kommun",
  "1761": "Hammarö kommun",
  "1762": "Munkfors kommun",
  "1763": "Forshaga kommun",
  "1764": "Grums kommun",
  "1765": "Årjängs kommun",
  "1766": "Sunne kommun",
  "1780": "Karlstads kommun",
  "1781": "Kristinehamns kommun",
  "1782": "Filipstads kommun",
  "1783": "Hagfors kommun",
  "1784": "Arvika kommun",
  "1785": "Säffle kommun",
  "1814": "Lekebergs kommun",
  "1860": "Laxå kommun",
  "1861": "Hallsbergs kommun",
  "1862": "Degerfors kommun",
  "1863": "Hällefors kommun",
  "1864": "Ljusnarsbergs kommun",
  "1880": "Örebro kommun",
  "1881": "Kumla kommun",
  "1882": "Askersunds kommun",
  "1883": "Karlskoga kommun",
  "1884": "Nora kommun",
  "1885": "Lindesbergs kommun",
  "1904": "Skinnskattebergs kommun",
  "1907": "Surahammars kommun",
  "1960": "Kungsörs kommun",
  "1961": "Hallstahammars kommun",
  "1962": "Norbergs kommun",
  "1980": "Västerås kommun",
  "1981": "Sala kommun",
  "1982": "Fagersta kommun",
  "1983": "Köpings kommun",
  "1984": "Arboga kommun",
  "2021": "Vansbro kommun",
  "2023": "Malung-Sälens kommun",
  "2026": "Gagnefs kommun",
  "2029": "Leksands kommun",
  "2031": "Rättviks kommun",
  "2034": "Orsa kommun",
  "2039": "Älvdalens kommun",
  "2061": "Smedjebackens kommun",
  "2062": "Mora kommun",
  "2080": "Falu kommun",
  "2081": "Borlänge kommun",
  "2082": "Säters kommun",
  "2083": "Hedemora kommun",
  "2084": "Avesta kommun",
  "2085": "Ludvika kommun",
  "2101": "Ockelbo kommun",
  "2104": "Hofors kommun",
  "2121": "Ovanåkers kommun",
  "2132": "Nordanstigs kommun",
  "2161": "Ljusdals kommun",
  "2180": "Gävle kommun",
  "2181": "Sandvikens kommun",
  "2182": "Söderhamns kommun",
  "2183": "Bollnäs kommun",
  "2184": "Hudiksvalls kommun",
  "2260": "Ånge kommun",
  "2262": "Timrå kommun",
  "2280": "Härnösands kommun",
  "2281": "Sundsvalls kommun",
  "2282": "Kramfors kommun",
  "2283": "Sollefteå kommun",
  "2284": "Örnsköldsviks kommun",
  "2303": "Ragunda kommun",
  "2305": "Bräcke kommun",
  "2309": "Krokoms kommun",
  "2313": "Strömsunds kommun",
  "2321": "Åre kommun",
  "2326": "Bergs kommun",
  "2361": "Härjedalens kommun",
  "2380": "Östersunds kommun",
  "2401": "Nordmalings kommun",
  "2403": "Bjurholms kommun",
  "2404": "Vindelns kommun",
  "2409": "Robertsfors kommun",
  "2417": "Norsjö kommun",
  "2418": "Malå kommun",
  "2421": "Storumans kommun",
  "2422": "Sorsele kommun",
  "2425": "Dorotea kommun",
  "2460": "Vännäs kommun",
  "2462": "Vilhelmina kommun",
  "2463": "Åsele kommun",
  "2480": "Umeå kommun",
  "2481": "Lycksele kommun",
  "2482": "Skellefteå kommun",
  "2505": "Arvidsjaurs kommun",
  "2506": "Arjeplogs kommun",
  "2510": "Jokkmokks kommun",
  "2513": "Överkalix kommun",
  "2514": "Kalix kommun",
  "2518": "Övertorneå kommun",
  "2521": "Pajala kommun",
  "2523": "Gällivare kommun",
  "2560": "Älvsbyns kommun",
  "2580": "Luleå kommun",
  "2581": "Piteå kommun",
  "2582": "Bodens kommun",
  "2583": "Haparanda kommun",
  "2584": "Kiruna kommun",
};

export const REGION_SCOPE_SWEDEN = "se";
export const REGION_SCOPE_UNSCOPED_NAME = "Unscoped";

/** Matches Sweden ("se"), county ("seXX"), or municipality ("seXXXX") case-insensitively. */
const SE_SCOPE_PATTERN = /^[sS][eE](\d{2}|\d{4})?$/;

/**
 * Returns the canonical lowercase MeshCore region scope for a reported scope.
 * Known Swedish codes are normalized to `se`, `seXX`, or `seXXXX`; all other
 * scopes (for example `public`, `*`, or future firmware scopes) are preserved
 * trimmed and unchanged so no reported scope information is lost.
 */
export function normalizeRegionScope(value: string): string {
  const trimmed = value.trim();
  const match = SE_SCOPE_PATTERN.exec(trimmed);
  return match ? `se${match[1] ?? ""}` : trimmed;
}

/**
 * Returns the Swedish administrative name for a canonical region scope, or
 * `null` when the scope is not a known Swedish code.
 */
export function regionScopeName(value: string): string | null {
  const normalized = normalizeRegionScope(value);
  if (normalized === REGION_SCOPE_SWEDEN) return "Sverige";
  if (!/^se\d{2,4}$/.test(normalized)) return null;
  const digits = normalized.slice(2);
  return LAN_NAMES[digits] ?? KOMMUN_NAMES[digits] ?? null;
}

export function regionScopeCountyCount(): number {
  return Object.keys(LAN_NAMES).length;
}

export function regionScopeMunicipalityCount(): number {
  return Object.keys(KOMMUN_NAMES).length;
}

export interface RegionScopeEntry {
  scope: string;
  name: string;
}

/**
 * Returns a canonical scope entry carrying both the lowercase scope code and,
 * on a separate field, the Swedish administrative name when the scope is a
 * known Swedish code. The firmware `*` scope is named `Unscoped`; any other
 * scope without a registered name uses the scope code as the name so every
 * entry remains self-describing.
 */
export function regionScopeEntry(value: string): RegionScopeEntry {
  const scope = normalizeRegionScope(value);
  return {
    scope,
    name:
      regionScopeName(scope) ??
      (scope === "*" ? REGION_SCOPE_UNSCOPED_NAME : scope),
  };
}

/** Display name for a registry row: known Swedish name, `Unscoped` for `*`, or the scope itself. */
export function regionScopeDisplayName(value: string): string {
  return regionScopeEntry(value).name;
}

export interface RegionScopeRegistryEntry {
  region: string;
  name: string | null;
}

/**
 * Returns the complete built-in Swedish registry: `se` plus every county
 * (`seXX`) and municipality (`seXXXX`) with its administrative name.
 */
export function regionScopeRegistryEntries(): RegionScopeRegistryEntry[] {
  const entries: RegionScopeRegistryEntry[] = [
    { region: REGION_SCOPE_SWEDEN, name: "Sverige" },
  ];
  for (const code of Object.keys(LAN_NAMES).sort())
    entries.push({ region: `se${code}`, name: LAN_NAMES[code] });
  for (const code of Object.keys(KOMMUN_NAMES).sort())
    entries.push({ region: `se${code}`, name: KOMMUN_NAMES[code] });
  return entries;
}
