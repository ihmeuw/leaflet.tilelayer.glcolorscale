var bounds = [
  [37.5422237953776, 51.4153947924142],
  [-46.9810436586275, -25.3587574757147],
];
var year = 2000;

var map = L.map('map').fitBounds(bounds);

// Create base layer (without labels).
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png').addTo(map);

// Create the tile layer.
var tileLayer = new L.TileLayer.GLColorScale({
  url: getTileURLByYear(year),
  colorScale: [
    {color: "rgb(132, 54, 168)", offset: 0},
    {color: "rgb(132, 54, 168)", label: "≤ 25", offset: 25},
    {color: "rgb(222, 100, 175)", offset: 25.00001},
    {color: "rgb(255, 255, 191)", label: "50", offset: 50},
    {color: "rgb(194, 4, 36)", label: "≥ 200", offset: 200},
  ],
  nodataValue: -999999,
  bounds: bounds,
  maxNativeZoom: 5,
  noWrap: true,
}).addTo(map);

// Create label layer.
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png').addTo(map);

function getTileURLByYear(year) {
  var base = 'https://vizhub.healthdata.org/lbd/api/v1/themes/under5/schemas/mortality/map/raster/{z}/{x}/{y}.png';
  var querystring = L.Util.template('age_group=under5&location_id=1&measure=mortality&stat=mean&year={year}', {
    year: year,
  });
  return base + '?' + querystring;
}
