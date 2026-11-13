// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Public access token (pk.); safe to have in the browser and on GitHub
mapboxgl.accessToken =
  'pk.eyJ1IjoiZmVsaWFuZyIsImEiOiJjbXdmOHA0NTYwNDFxMnlwc3dhM3ZzZm11In0.wRz-D-KQl0jmF47QAFf3VA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude], near MIT
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});
