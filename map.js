// Import Mapbox as an ESM module (v3: needed for my Standard-based Studio style)
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@3.9.4/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Public access token (pk.); safe to have in the browser and on GitHub
mapboxgl.accessToken =
  'pk.eyJ1IjoiZmVsaWFuZyIsImEiOiJjbXdmOHA0NTYwNDFxMnlwc3dhM3ZzZm11In0.wRz-D-KQl0jmF47QAFf3VA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/feliang/cmwf9bxy9008s01sm0tws55tj', // my custom style from Mapbox Studio
  center: [-71.09415, 42.36027], // [longitude, latitude], near MIT
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// The <svg> layered on top of the map, where D3 draws the station circles
const svg = d3.select('#map').select('svg');

// Turn a station's longitude/latitude into pixel x/y on the map as it looks right now.
// map.project() accounts for panning, zooming and rotation for us.
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Shared style for every bike lane layer, so a tweak here changes both cities
const bikeLaneStyle = {
  'line-color': '#32D400', // bright green
  'line-width': 3,
  'line-opacity': 0.5,
  'line-emissive-strength': 1, // ignore the style's dusk lighting so the green stays bright
};

// Wait until the map has finished loading before adding data to it
map.on('load', async () => {
  // Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Bluebikes stations
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    // no "const" here: we fill in the jsonData declared above, so it still exists after the try block
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return; // nothing to draw without the stations
  }

  let stations = jsonData.data.stations;
  console.log('Stations Array:', stations);

  // Step 4.1: every Bluebikes ride in March 2024 (~260,000 rows, so this takes a moment)
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
  );

  // Step 4.2: count rides per station. rollup gives a Map: station id -> count
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id, // rides that STARTED at the station
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id, // rides that ENDED at the station
  );

  // Attach the counts to each station. "?? 0" = use 0 if the station had no rides
  stations = stations.map((station) => {
    let id = station.short_name; // the same id the trips file uses
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
  console.log('Stations with traffic:', stations);

  // Step 4.3: circle AREA proportional to traffic, so a square-root scale for the radius
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // One circle per station (positions are set in updatePositions below;
  // colors are in map.css)
  const circles = svg
    .selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    // Step 4.4: a <title> inside a circle becomes the browser's hover tooltip
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  // Move every circle to where its station is on the map right now
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  // Place them once now, then again whenever the map moves
  updatePositions();
  map.on('move', updatePositions); // while panning
  map.on('zoom', updatePositions); // while zooming
  map.on('resize', updatePositions); // when the window size changes
  map.on('moveend', updatePositions); // final adjustment after movement ends
});
