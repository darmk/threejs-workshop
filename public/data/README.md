# Holographic Earth land data

`ne_110m_land.geojson` is the Natural Earth 1:110m land polygon dataset (127 features).

- Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
- Project: https://www.naturalearthdata.com/downloads/110m-physical-vectors/
- Terms: https://www.naturalearthdata.com/about/terms-of-use/ (public domain)

The `HolographicEarth` example rasterizes these polygons into a temporary canvas texture at runtime. It uses the mask for subtle coast highlights and water lighting.

The Earth imagery in `public/images/earth/` is credited to NASA:

- `blue-marble-july-source.jpg`: [Blue Marble Next Generation, July global base map](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/), NASA Earth Observatory / Reto Stöckli.
- `black-marble-source.jpg`: [Earth at Night / Black Marble, 2016](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/), NASA Earth Observatory.
- `clouds-source.jpg`: [Blue Marble: Clouds](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds/77558l), NASA Goddard Space Flight Center / Reto Stöckli / Robert Simmon.

These are composite visualizations, not a live view of Earth or current weather. Day/night shading, cloud movement, scan beam, and interaction are rendered in Three.js.

## Population Tide data

`population-cohorts.json` is a small, local extract of **World Population Prospects 2024**, published by the United Nations Department of Economic and Social Affairs, Population Division. It contains annual, both-sexes population by single age for the world, China, India, Japan, and the United States from 1950 through 2026. Values are de facto population as of 1 July, stored in thousands and rounded to the nearest thousand people. The 100+ age group is open-ended.

- Publisher and methodology: https://population.un.org/wpp/
- Official download catalogue: https://population.un.org/wpp/assets/downloads.json
- 1950–2023 estimates: https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_PopulationBySingleAgeSex_Medium_1950-2023.csv.gz
- 2024–2026 medium projections: https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz
- Data and licence: © United Nations, [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/). Suggested citation: United Nations, Department of Economic and Social Affairs, Population Division (2024). *World Population Prospects 2024, Online Edition*.

The extract is reproducible with `node scripts/build-population-data.mjs <directory-containing-both-gz-files>`. The animation reads the single-age population in year `birth year + age`. This is an age-year diagonal, not a longitudinal count of exactly the same individuals. For countries, migration also affects the numbers.

## Heat Wall data

`heat-wall-beijing.json` caches the default Beijing example: daily maximum 2 m air temperature for June–August 1986–2025, from the [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) with `models=era5` at 39.9075°N, 116.39723°E and `timezone=Asia/Shanghai`. Rebuild with `node scripts/build-heat-wall-data.mjs` using the Node version in `.nvmrc`. The script fails if a summer does not contain all 92 days. ERA5 reanalysis is a gridded model/observation estimate, not an individual weather-station measurement.

Other cities are resolved via the [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) and fetched in the browser from the historical API, so they require network access. The view uses a fixed Celsius color scale and reports the mean of daily maxima, the count of days with maximum ≥35°C, and the maximum daily value. Northern summer is June–August; southern summer is December–February, labeled by the ending year. This exploratory weather view is not a climate attribution study or a measurement of felt heat, humidity, or urban heat island intensity.
