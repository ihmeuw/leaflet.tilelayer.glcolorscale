#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

const int SCALE_MAX_LENGTH = 16;
const int SENTINEL_MAX_LENGTH = 4;
const vec4 TRANSPARENT = vec4(0.0, 0.0, 0.0, 0.0);

#pragma glslify: computeColor = require('./util/computeColor.glsl',SCALE_MAX_LENGTH=SCALE_MAX_LENGTH,SENTINEL_MAX_LENGTH=SENTINEL_MAX_LENGTH)
#pragma glslify: isCloseEnough = require('./util/isCloseEnough.glsl')
#pragma glslify: rgbaToFloat = require('./util/rgbaToFloat.glsl')
#pragma glslify: ScaleStop = require('./util/ScaleStop.glsl')

uniform sampler2D textureA;
uniform ScaleStop colorScaleA[SCALE_MAX_LENGTH];
uniform int colorScaleLengthA;
uniform ScaleStop sentinelValuesA[SENTINEL_MAX_LENGTH];
uniform int sentinelValuesLengthA;

uniform sampler2D textureB;
uniform ScaleStop colorScaleB[SCALE_MAX_LENGTH];
uniform int colorScaleLengthB;
uniform ScaleStop sentinelValuesB[SENTINEL_MAX_LENGTH];
uniform int sentinelValuesLengthB;

uniform float nodataValue;
uniform bool littleEndian;
uniform float interpolationFraction;

varying vec2 vTexCoordA;
varying vec2 vTexCoordB;

void main() {
  if (interpolationFraction <= 0.0) {
    vec4 rgbaFloats = texture2D(textureA, vTexCoordA);
    float pixelFloatValue = rgbaToFloat(rgbaFloats, littleEndian);
    if (isCloseEnough(pixelFloatValue, nodataValue)) {
      discard;
    }
    gl_FragColor = computeColor(pixelFloatValue, colorScaleA, colorScaleLengthA, sentinelValuesA, sentinelValuesLengthA);
  } else if (interpolationFraction >= 1.0) {
    vec4 rgbaFloats = texture2D(textureB, vTexCoordB);
    float pixelFloatValue = rgbaToFloat(rgbaFloats, littleEndian);
    if (isCloseEnough(pixelFloatValue, nodataValue)) {
      discard;
    }
    gl_FragColor = computeColor(pixelFloatValue, colorScaleB, colorScaleLengthB, sentinelValuesB, sentinelValuesLengthB);
  } else {
    vec4 rgbaFloatsA = texture2D(textureA, vTexCoordA);
    float pixelFloatValueA = rgbaToFloat(rgbaFloatsA, littleEndian);
    vec4 rgbaFloatsB = texture2D(textureB, vTexCoordB);
    float pixelFloatValueB = rgbaToFloat(rgbaFloatsB, littleEndian);
    vec4 colorA = (
      isCloseEnough(pixelFloatValueA, nodataValue)
      ? TRANSPARENT
      : computeColor(pixelFloatValueA, colorScaleA, colorScaleLengthA, sentinelValuesA, sentinelValuesLengthA)
    );
    vec4 colorB = (
      isCloseEnough(pixelFloatValueB, nodataValue)
      ? TRANSPARENT
      : computeColor(pixelFloatValueB, colorScaleB, colorScaleLengthB, sentinelValuesB, sentinelValuesLengthB)
    );
    gl_FragColor = mix(colorA, colorB, interpolationFraction);
  }
}
