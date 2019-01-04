#ifndef RELATIVE_TOLERANCE
#define RELATIVE_TOLERANCE 0.0001
#endif

bool isCloseEnough(float a, float b) {
  return abs(a - b) < abs(a * RELATIVE_TOLERANCE);
}

#pragma glslify: export(isCloseEnough)
