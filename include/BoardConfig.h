#pragma once

// GPIO8 confirmed by the owner from their board information on 2026-09-09.
// See docs/HARDWARE.md for provenance and the GPIO8 boot-strapping restriction.
namespace BoardConfig {
constexpr bool rgbVerified = true;
constexpr int rgbDataPin = 8;
constexpr unsigned char brightness = 24; // Out of 255; deliberately modest.
static_assert(!rgbVerified || rgbDataPin == 8,
              "This example's reviewed candidate layout only supports GPIO8.");
static_assert(rgbVerified || rgbDataPin == -1,
              "Do not assign an unverified GPIO.");
}
