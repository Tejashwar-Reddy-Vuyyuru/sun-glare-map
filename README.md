# Sun Glare Map

A web app that shows where low sun shines into drivers' eyes, for any date and time, and checks a trip for the stretches where the driver faces the sun.

- Live app: https://tejashwar-reddy-vuyyuru.github.io/sun-glare-map/
- Plugin demo: https://tejashwar-reddy-vuyyuru.github.io/sun-glare-map/demo.html

Status: working prototype, first built for St. Louis. The scoring has not yet been validated against crash records (see Roadmap).

## What it does

- Type a From and a To address, or pick both on the map, and get the minutes of the trip spent driving into the sun.
- Suggests a better leaving time within 30 minutes either way, and swaps From and To in one tap.
- Colours roads by glare risk for any date and time, with a slider that moves the sun through the day.
- Shows, for any road, which direction of travel faces the sun and the time windows when it happens.
- Raises risk near traffic signals, junctions, pedestrian crossings and schools.
- Draws on a standard street map, with glare lines blended so street names stay readable.
- Ships as a plugin (`glare-layer.js`) that adds a "Sun glare" layer to Leaflet, MapLibre, Mapbox and Google maps.

## How the score works

1. Sun position (height and compass direction) is calculated for the date, time and location.
2. A direction of travel has glare when the sun is between the horizon and 25° up, and within 30° left or right of straight ahead.
3. Glare score is 1.0 with the sun dead ahead and under 15° up, falling to 0 at the 30° and 25° limits.
4. Risk = glare score x hazard boost: 1.6 at traffic signals, 1.5 at junctions between main roads, 1.4 at crossings and schools, 1.0 elsewhere.
5. Levels: high at 0.6 or more, medium at 0.3 or more, low above 0.05.
6. A typed trip uses a public route service (OSRM); a trip picked on the map follows the quickest path on the loaded roads. The sun position is recalculated as the trip progresses.

## Running it

Open the live link, or open `index.html` from any web server. No build step.

- The page opens at once on a built-in sketch of main St. Louis roads, then loads real roads from OpenStreetMap in the background and remembers them in the browser.
- If a `roads.json` file sits next to `index.html`, roads load from it straight away. Create one with "Save road file for this site" under "More".
- Address search uses Nominatim, routes use the public OSRM demo server, and the background map uses OpenStreetMap tiles. These are free public services meant for light use.

## Adding the layer to another map

`glare-layer.js` is a single file with no dependencies. It adds a "Sun glare" overlay to a map a site already has, and loads roads for the visible area from OpenStreetMap.

Leaflet:

```js
var glare = SunGlare.leaflet(L).addTo(map);
L.control.layers(null, { 'Sun glare': glare }).addTo(map);
```

MapLibre GL or Mapbox GL:

```js
var glare = SunGlare.maplibre(map);
map.addControl(glare.control); // a "Sun glare" checkbox
```

Google Maps JavaScript API:

```js
var glare = SunGlare.google(map);
```

Follow the directions a user already asked the map for:

```js
SunGlare.followMapboxDirections(directionsControl, glare); // @mapbox/mapbox-gl-directions
SunGlare.followLeafletRouting(routingControl, glare);      // Leaflet Routing Machine
SunGlare.followGoogleDirections(directionsRenderer, glare);
```

Or hand over any route yourself. It accepts a GeoJSON line, an array of points, or an encoded polyline:

```js
glare.setRoute(route.geometry, { duration: route.duration }); // seconds
glare.clearRoute();
```

In route mode the layer shows glare only along that route, in the direction of travel, with the sun moving as the trip goes on.

Each one returns an object with `setTime(date)` (pass `null` to follow the clock), `setRoads(geojson, hazards)` to supply your own roads, and `refresh()`. `SunGlare.score(roads, date)` returns the affected stretches as GeoJSON without any map.

`demo.html` shows the Leaflet version with a layer switcher and a time slider. Keep it in the same folder as `glare-layer.js`.

Status: the scoring functions (`score`, `scoreRoute`) are tested. The Leaflet, MapLibre and Google adapters and the three directions hook-ups have not been run against live maps yet.

The main page can also export the affected roads for one moment as KML (Google Earth, Google My Maps) or GeoJSON.

## Data

- Roads and hazards: OpenStreetMap contributors, ODbL licence.
- Sun position: standard solar position formulas, calculated in the page.

## Known limits

- Hills, buildings and trees that block the sun are ignored, so the map over-warns in built-up or wooded streets.
- Clouds and wet-road reflection are ignored.
- Road slope is ignored.
- Times are US Central only.
- Trip times come from the route service or a fixed speed per road class, with no live traffic.
- A typed trip does not include the extra risk near signals and crossings.

## Prior work

- US patent 11112257, "Navigation with sun glare information", covers calculating routes with glare as an input. This project is a portfolio prototype and is not offered for sale.
- SunGlare (iOS app) shows glare times and affected roads.
- "Safety-Aware Route Navigation: Driving with Less Sun Glare", SIGSPATIAL 2024.

## Roadmap

1. Validate against crash records: test whether crashes are more frequent on a segment during its predicted glare windows than outside them.
2. Check predictions against timestamped street-level photos.
3. Remove false alarms using building and terrain heights.
4. Add a cloud-cover feed.
