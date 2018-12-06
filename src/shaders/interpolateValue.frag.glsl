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

uniform ScaleStop colorScale[SCALE_MAX_LENGTH];
uniform int colorScaleLength;

uniform ScaleStop sentinelValues[SENTINEL_MAX_LENGTH];
uniform int sentinelValuesLength;

uniform float nodataValue;
uniform sampler2D textureA;
uniform sampler2D textureB;
uniform bool littleEndian;
uniform float interpolationFraction;

varying vec2 vTexCoordA;
varying vec2 vTexCoordB;

bool isSentinelValue(ScaleStop sentinelValues[SENTINEL_MAX_LENGTH], int len, float value) {
  for (int i = 0; i < SENTINEL_MAX_LENGTH; ++i) {
    if (i == len) {
      break;
    }
    if (isCloseEnough(sentinelValues[i].offset, value)) {
      return true;
    }
  }
  return false;
}

void main() {
  if (interpolationFraction <= 0.0) {
    vec4 rgbaFloats = texture2D(textureA, vTexCoordA);
    float pixelFloatValue = rgbaToFloat(rgbaFloats, littleEndian);
    if (isCloseEnough(pixelFloatValue, nodataValue)) {
      discard;
    }
    gl_FragColor = computeColor(pixelFloatValue, colorScale, sentinelValues, colorScaleLength, sentinelValuesLength);
  } else if (interpolationFraction >= 1.0) {
    vec4 rgbaFloats = texture2D(textureB, vTexCoordB);
    float pixelFloatValue = rgbaToFloat(rgbaFloats, littleEndian);
    if (isCloseEnough(pixelFloatValue, nodataValue)) {
      discard;
    }
    gl_FragColor = computeColor(pixelFloatValue, colorScale, sentinelValues, colorScaleLength, sentinelValuesLength);
  } else {
    vec4 rgbaFloatsA = texture2D(textureA, vTexCoordA);
    float pixelFloatValueA = rgbaToFloat(rgbaFloatsA, littleEndian);
    vec4 rgbaFloatsB = texture2D(textureB, vTexCoordB);
    float pixelFloatValueB = rgbaToFloat(rgbaFloatsB, littleEndian);
    bool aIsNodata = isCloseEnough(pixelFloatValueA, nodataValue);
    bool bIsNodata = isCloseEnough(pixelFloatValueB, nodataValue);
    if (aIsNodata && bIsNodata) {
      discard;
    } else if (
      aIsNodata
      || bIsNodata
      || isSentinelValue(sentinelValues, sentinelValuesLength, pixelFloatValueA)
      || isSentinelValue(sentinelValues, sentinelValuesLength, pixelFloatValueB)
    ) {
      vec4 colorA = (
        aIsNodata
        ? TRANSPARENT
        : computeColor(pixelFloatValueA, colorScale, sentinelValues, colorScaleLength, sentinelValuesLength)
      );
      vec4 colorB = (
        bIsNodata
        ? TRANSPARENT
        : computeColor(pixelFloatValueB, colorScale, sentinelValues, colorScaleLength, sentinelValuesLength)
      );
      gl_FragColor = mix(colorA, colorB, interpolationFraction);
    } else {
      float interpolated = mix(pixelFloatValueA, pixelFloatValueB, interpolationFraction);
      gl_FragColor = computeColor(interpolated, colorScale, sentinelValues, colorScaleLength, sentinelValuesLength);
    }
  }
}
