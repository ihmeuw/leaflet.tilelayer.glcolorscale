# Visualizing Geospatial Pixel Data with Leaflet and WebGL

## Outline

- frame the problem
  - pixel-based maps with float values
  - Leaflet tile layer only displays pre-rendered images
  - colorizing pixels on the CPU is sequential and slow
- the idea: colorize client-side on the GPU
  - encode float values into image tiles; decode each pixel in the shader
  - advantages: GPU can render faster by processing pixels in parallel, float values are available for inspection client-side
- technical hurdles:
  - baseline WebGL 1.0 doesn't support floating-point textures; textures expose pixel values as RGBA
  - each RGBA vec4 must be reinterpreted as a float; this requires converting the vec4 into its 32 bits and then reinterpreting the bits as a float according to the IEEE 754 specification
  - no bitwise operators in GLSL 1.0 - need to use ordinary arithmetic!
  - simplest rendering scheme, rendering only pixels within the viewport, doesn't mesh well with Leaflet's GridLayer - the latter maintains a cache of tiles in and (optionally surrounding) the viewport
  - to integrate well with Leaflet's GridLayer, we render each tile in an offscreen canvas, then copy the pixels to a grid of on-screen canvases
  - to use the hardware efficiently, we use a single texture to hold all the tiles; we treat the texture as an LRU cache, maintaining a mapping of tile coordinates to texture coordinates
- flourishes
  - animated transitions using interpolation
  - pixel value on hover
  - modular shader code using glslify

For [IHME](http://www.healthdata.org/)'s [Local Burden of Disease](http://www.healthdata.org/lbd) project we produce raster datasets showing the geographical distribution of diseases, medical interventions, and other measures. Each pixel represents our researchers' best estimate of the value of a given measure, expressed as a floating-point number, for an area representing roughly a 5km by 5km square. To visualize these data points, we colorize pixels using linear color scales, essentially translating each floating-point value to a color with linear interpolation. Here, for example, is a pixel map representing vaccine coverage in Africa. Looking at the legend in the lower right corner, you can see that data values ranging from 0.0 to 100.0 are mapped to colors ranging from red-orange to blue.

![vaccine coverage pixel map](./vaccine_coverage.png)

Rendering this pixel data efficiently in our [web visualization tool](https://vizhub.healthdata.org/lbd) (shown above) proved to be an interesting problem. This article describes the challenges we faced and how we addressed them.

## First attempt: map tiles rendered server-side with Carto

Our first approach to producing colorized raster map tiles leveraged the "location intelligence platform" [Carto](https://carto.com/). Carto provides, among other things, a map tile server that is capable of the sort of pixel colorization via linear interpolation that we needed. While setting up a custom instance of Carto's open-source platform was far from easy, its capabilities served our needs well for a time. We were able to give the tile server a SQL query for generating map tiles from data in our custom [PostGIS](http://postgis.net/) database, along with some rules for how to colorize the pixels, and the server would return to our browser-based visualization colorized map tiles as PNG images. We then displayed these tiles using the mapping framework [Leaflet](https://leafletjs.com/).

Over time we grew dissatisfied with this approach, however. Not only was Carto challenging to set up and maintain, particularly in our [containerized implementation](https://github.com/ihmeuw/cartodb-docker), but the tile server was quite slow at producing the colorized map tiles, making using the visualization tool a frustrating experience. We did some performance testing of the server with Apache Jmeter and found that it was taking about 3 seconds, in the best case, to return a tile. I suspect we could have squeezed better performance out of the server with some optimizations, but its codebase was always something of an impenetrable black box to us, and the prospect of searching for needles in this haystack seemed quite daunting.
