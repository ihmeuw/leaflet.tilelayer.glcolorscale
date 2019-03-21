import REGL from 'regl';

import vertDouble from './shaders/double.vert.glsl';
import vertSingle from './shaders/single.vert.glsl';

import fragInterpolateColor from './shaders/interpolateColor.frag.glsl';
import fragInterpolateValue from './shaders/interpolateValue.frag.glsl';
import fragSingle from './shaders/single.frag.glsl';

import {
  COLOR_SCALE_MAX_LENGTH,
  DEFAULT_COLOR_STOP,
  SENTINEL_VALUES_MAX_LENGTH,
} from './constants';
import {
  DrawCommon,
  DrawTile,
  DrawTileInterpolateColor,
  DrawTileInterpolateValue,
} from './types';
import * as util from './util';

const littleEndian = util.machineIsLittleEndian();

const bindStructArray = util.bindStructArray.bind(null, ['color', 'offset'], DEFAULT_COLOR_STOP);

const colorScaleUniforms = bindStructArray(COLOR_SCALE_MAX_LENGTH, 'colorScale');
const sentinelValuesUniforms = bindStructArray(SENTINEL_VALUES_MAX_LENGTH, 'sentinelValues');

const fragMacros = {
  SCALE_MAX_LENGTH: COLOR_SCALE_MAX_LENGTH,
  SENTINEL_MAX_LENGTH: SENTINEL_VALUES_MAX_LENGTH,
};

/**
 * The object generated by this function should be merged into the DrawConfig for each Regl
 * DrawCommand in the application.
 */
export function getCommonDrawConfiguration(
  tileSize: number,
  nodataValue: number,
): REGL.DrawConfig<DrawCommon.Uniforms, DrawCommon.Attributes, DrawCommon.Props> {
  return {
    uniforms: {
      nodataValue,
      littleEndian,
      transformMatrix: ({ viewportWidth, viewportHeight }) => (
        util.getTransformMatrix(viewportWidth, viewportHeight)
      ),
    },
    attributes: {
      position: (_, { canvasCoordinates }) => {
        const [left, top] = canvasCoordinates;
        const [right, bottom] = [left + tileSize, top + tileSize];
        return [
          [left,  top   ],
          [right, top   ],
          [left,  bottom],
          [right, bottom],
        ];
      },
    },
    // We don't need the depth buffer for 2D drawing. Leaving it enabled (and failing to clear it
    // between draw calls) results in visual artifacts.
    depth: { enable: false },
    primitive: 'triangle strip',
    count: 4,
    viewport: (_, { canvasSize: [width, height] }) => ({ width, height }),
  };
}

/**
 * The resulting Regl DrawCommand is used to draw a single tile. The fragment shader decodes the
 * Float32 value of a pixel and colorizes it with the given color scale (and/or sentinel values).
 */
export function createDrawTileCommand(
  regl: REGL.Regl,
  commonConfig: REGL.DrawConfig<DrawCommon.Uniforms, DrawCommon.Attributes, DrawCommon.Props>,
) {
  return regl<DrawTile.Uniforms, DrawTile.Attributes, DrawTile.Props>({
    ...commonConfig,
    vert: vertSingle,
    frag: util.defineMacros(fragSingle, fragMacros),
    uniforms: {
      ...commonConfig.uniforms as DrawCommon.Uniforms,
      ...colorScaleUniforms,
      ...sentinelValuesUniforms,
      colorScaleLength: (_, { colorScale }) => colorScale.length,
      sentinelValuesLength: (_, { sentinelValues }) => sentinelValues.length,
      texture: (_, { texture }) => texture,
    },
    attributes: {
      ...commonConfig.attributes as DrawCommon.Attributes,
      texCoord: (_, { textureBounds }) => util.getTexCoordVertices(textureBounds),
    },
  });
}

/**
 * The DrawCommand output by this function interpolates, for each pixel, between two values, one
 * from `textureA` and one from `textureB`. The same color scale / sentinel values are applied to
 * both.
 */
export function createDrawTileInterpolateValueCommand(
  regl: REGL.Regl,
  commonConfig: REGL.DrawConfig<DrawCommon.Uniforms, DrawCommon.Attributes, DrawCommon.Props>,
) {
  return regl<
    DrawTileInterpolateValue.Uniforms,
    DrawTileInterpolateValue.Attributes,
    DrawTileInterpolateValue.Props
  >({
    ...commonConfig,
    vert: vertDouble,
    frag: util.defineMacros(fragInterpolateValue, fragMacros),
    uniforms: {
      ...commonConfig.uniforms as DrawCommon.Uniforms,
      ...colorScaleUniforms,
      ...sentinelValuesUniforms,
      colorScaleLength: (_, { colorScale }) => colorScale.length,
      sentinelValuesLength: (_, { sentinelValues }) => sentinelValues.length,
      textureA: (_, { textureA }) => textureA,
      textureB: (_, { textureB }) => textureB,
      interpolationFraction: (_, { interpolationFraction }) => interpolationFraction,
    },
    attributes: {
      ...commonConfig.attributes as DrawCommon.Attributes,
      texCoordA: (_, { textureBoundsA }) => util.getTexCoordVertices(textureBoundsA),
      texCoordB: (_, { textureBoundsB }) => util.getTexCoordVertices(textureBoundsB),
    },
  });
}

/**
 * The behavior of this DrawCommand is similar to the one above, except that pixels from `textureA`
 * are colorized with one color scale / set of sentinel values, while pixels from `textureB` use a
 * different color scale / set of sentinel values.
 */
export function createDrawTileInterpolateColorCommand(
  regl: REGL.Regl,
  commonConfig: REGL.DrawConfig<DrawCommon.Uniforms, DrawCommon.Attributes, DrawCommon.Props>,
) {
  return regl<
    DrawTileInterpolateColor.Uniforms,
    DrawTileInterpolateColor.Attributes,
    DrawTileInterpolateColor.Props
  >({
    ...commonConfig,
    vert: vertDouble,
    frag: util.defineMacros(fragInterpolateColor, fragMacros),
    uniforms: {
      ...commonConfig.uniforms as DrawCommon.Uniforms,
      ...bindStructArray(COLOR_SCALE_MAX_LENGTH, 'colorScaleA'),
      ...bindStructArray(COLOR_SCALE_MAX_LENGTH, 'colorScaleB'),
      ...bindStructArray(SENTINEL_VALUES_MAX_LENGTH, 'sentinelValuesA'),
      ...bindStructArray(SENTINEL_VALUES_MAX_LENGTH, 'sentinelValuesB'),
      colorScaleLengthA: (_, { colorScaleA }) => colorScaleA.length,
      colorScaleLengthB: (_, { colorScaleB }) => colorScaleB.length,
      sentinelValuesLengthA: (_, { sentinelValuesA }) => sentinelValuesA.length,
      sentinelValuesLengthB: (_, { sentinelValuesB }) => sentinelValuesB.length,
      textureA: (_, { textureA }) => textureA,
      textureB: (_, { textureB }) => textureB,
      interpolationFraction: (_, { interpolationFraction }) => interpolationFraction,
    },
    attributes: {
      ...commonConfig.attributes as DrawCommon.Attributes,
      texCoordA: (_, { textureBoundsA }) => util.getTexCoordVertices(textureBoundsA),
      texCoordB: (_, { textureBoundsB }) => util.getTexCoordVertices(textureBoundsB),
    },
  });
}
