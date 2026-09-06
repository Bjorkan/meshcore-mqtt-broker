## 2026-09-06 (Europe/Stockholm) — Muse Spark (opencode) — Regel 3: flytt rensar neighbor-evidence

- När en nod får en ny verifierad advert-position som skiljer sig från den lagrade raderas: nodens egna neighbor_snapshots (entries+scopes via CASCADE) samt entries i andras snapshots som listar noden. Berörda regionaggregat byggs om. Adverts/sightings/paths lämnas orörda så historik bevaras.
- `regionScopesForSnapshots()` samlar scopes från både egna snapshots, egna entries och andras snapshots som listar noden (UNION med explicita ::text-casts).
- Tester: nytt relocation-test (egen snapshot borta, andras snapshot kvar utan entries, scopes/regionaggregat korrekta, adverts orörda; samma-position-raderas-inte) + nytt 3-byte-klassningstest (resolved/intilliggande/längd). Full postgres-svit: 303 pass. check (format/lint/typecheck) grön.
