# Third-Party Notices

This project retains the following third-party data, artwork, libraries, and service attribution. Complete license texts for bundled dashboard assets are tracked in [`LICENSES/`](LICENSES/). Dependency source distributions in `node_modules` contain their own license texts.

## Swedish region data

The Swedish friendly names and primary/secondary relationships shipped in `config.yaml` are derived from Meshat.se's Swedish MeshCore region table and are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source: [Meshat.se region table](https://meshat.se/meshcore/regioner/#lanskoder)
- Attribution: Meshat.se
- Local changes: the original county-oriented JSON structure and metadata were removed; required primary/secondary relationships were transferred to the broker's generic YAML configuration shape.

The data is inactive while `IATA_whitelist: false` and may be replaced by operators.

## Sweden boundary data

The `SWE` nodes API filter bundles Sweden's geometry from [Natural Earth Admin 0 – Countries, 1:10m](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/), version 5.1.1. Natural Earth data is in the public domain and may be used for any purpose.

- Source project: [Natural Earth](https://www.naturalearthdata.com/)
- Local changes: all non-Sweden features and feature properties were removed; the Sweden multipolygon coordinates are retained in GeoJSON form.

## Dashboard map

The dashboard bundles [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) under the BSD-3-Clause license. Its complete distributed license and bundled-component notices are in [`LICENSES/MapLibre-GL-JS.txt`](LICENSES/MapLibre-GL-JS.txt).

When the map is opened, browser clients request tiles directly from:

- [OpenStreetMap](https://www.openstreetmap.org/), displayed as `© OpenStreetMap contributors`; see the [copyright and license page](https://www.openstreetmap.org/copyright) and [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- [CARTO](https://carto.com/), displayed as `© OpenStreetMap contributors © CARTO`; see [CARTO attribution requirements](https://carto.com/attributions/).

No map API key is included. Map provider URLs, selection, and attribution are hard-coded.

## Dashboard icons and fonts

Dashboard icon paths use the Material Design Icons visual language maintained by [Pictogrammers](https://pictogrammers.com/library/mdi/) under Apache License 2.0. The complete license is in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt). The radio-tower project mark is an inline generic SVG.

The dashboard does not download a web font. It uses the browser/operating system's installed `Inter`, `Roboto`, system sans-serif, and monospace fallback fonts.

## API documentation

The API documentation serves [Swagger UI](https://swagger.io/tools/swagger-ui/) from the `swagger-ui-dist` package under the Apache License 2.0. The complete license is in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt); the distributed notice is: `swagger-ui — Copyright 2020-2021 SmartBear Software Inc.` Assets are served locally and are not loaded from a CDN.

## JavaScript dependencies

Direct runtime dependencies declare permissive licenses: MIT, ISC, BSD-3-Clause, or Apache-2.0. `package-lock.json` fixes the complete transitive dependency set. Review installed package license files when preparing binary distributions or changing dependencies.
