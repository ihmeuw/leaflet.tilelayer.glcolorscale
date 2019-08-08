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

Over time we grew dissatisfied with this approach, however. Not only was Carto challenging to set up and maintain, particularly in our [containerized microservice implementation](https://github.com/ihmeuw/cartodb-docker), but the tile server was quite slow at producing the colorized map tiles, making using the visualization tool a frustrating experience. We did some performance testing of the server with [Apache Jmeter](https://jmeter.apache.org/) and found that it was taking about 3 seconds, in the best case, to return a tile. I suspect we could have squeezed better performance out of the server with some optimizations, but its codebase was always something of an impenetrable black box to us, and the prospect of searching for needles in this haystack seemed quite daunting.

## The idea: client-side rendering with WebGL

Around this time, I began thinking about other ways to render our map tiles. One option was to create our own tile server, better suited to our specific needs and something we understood well enough to be able to optimize its performance. Yet a server-side solution had some inherent limitations. Rendering a large number of pixels on the CPU is bound to be slow, because the pixels must be processed sequentially (or with limited parallelization taking advantage of multicore architecture). With commodity hardware and the VMs in which our containerized services run, there would be hard limits on how fast the tiles could be produced. It seemed to me that the ideal way to render the images was on the [GPU](https://en.wikipedia.org/wiki/Graphics_processing_unit), which is specifically designed to process large numbers of pixels in parallel, and fortunately modern browsers provide a way to do GPU processing: [WebGL](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)! A WebGL solution would mean the tile server would have very little to do - just retrieve pixel data from PostGIS and then pass it in essentially raw form to the client. The user's browser would then be responsible for actually colorizing the pixels, and it could take advantage of GPU rendering to do this very efficiently.

Having the raw floating-point pixel values available clientside would have another advantage as well. I thought it would be a nice for a user to be able to see the actual pixel-level estimates in the visualization. While humans have a pretty keen color sense, the result of mentally translating a color from a gradient back to the value it's supposed to represent seemed pretty imprecise. Our visualization already had the capability of getting the data value of a given pixel when clicked by the user, but doing so required a backend request and was therefore relatively slow. Having this data available clientside would mean we could retrieve and display these values very quickly.

## Problem 1: reading floats from a texture in a WebGL shader

The first and most important hurdle I foresaw with this new approach was a limitation of WebGL 1.0: the lack of support for floating-point textures. A "texture," in graphics parlance, is essentially an image you pass to the GPU. Once a texture is loaded, you can read any pixel or pixels you like from it in your shader, which is a small user-defined program that runs on the GPU. WebGL 1.0, by far the most widely implemented version of WebGL, allows you to create textures using a variety of pixel types, like RGB and RGBA, but unless the extension `OES_texture_float` is enabled for a user's hardware and browser, it's not possible to use a texture in which the pixels represent floats. WebGL 2.0 adds support for float textures, but our analytics indicated that many of the users of our tool didn't have the capability of using WebGL 2.0.

Luckily I had an idea for a workaround. An RGBA pixel is supposed to represent four color "channels" (red, green, blue, and alpha - aka. opacity), each of which is a single byte (i.e. 8 bits). This gives us 32 bits total to work with per pixel, exactly the space needed to store a single 32-bit floating point value! In principle, therefore, we could encode one float per pixel, feed this raw binary data to WebGL, and then decode the floats in the shader code. Using JavaScript's TypedArrays, it's trivial to create binary data representing a series of floats, then reinterpret this data as 8-bit unsigned integers in order to "trick" WebGL into accepting it as RGBA pixel data:

```javascript
// construct the pixel data
const floatArray = new Float32Array([ /* pixels */ ]);
const uintArray = new Uint8Array(floatArray.buffer);

// bind the pixel data to a WebGL texture
gl.texImage2D(
  gl.TEXTURE_2D,    // target
  0,                // mipmap level
  gl.RGBA,          // internal format: 4 color channels
  width,            // width of texture in pixels
  height,           // height of texture in pixels
  0,                // border: must be 0
  gl.RGBA,          // format: must be the same as internal format
  gl.UNSIGNED_BYTE, // type: 8 bits per channel
  uintArray,        // pixels
);
```

The hard part is decoding the pixels in the shader code. GLSL 1.00, the shader language used in WebGL 1.0, doesn't even provide any bitwise operators, so one has to resort to ordinary arithmetic for parsing the binary data. My general approach was to decompose the four 8-bit integers representing the RGBA channels into an array of 32 bits, then compute the floating point value from these raw bits. With frequent references to the [IEEE Standard for Floating-Point Arithmetic (IEEE 754)](https://en.wikipedia.org/wiki/IEEE_754), some trial and error, and a lot of perseverance, I finally succeeded. If you're curious you can see my solution [here](https://github.com/ihmeuw/glsl-rgba-to-float/blob/master/index.glsl).

