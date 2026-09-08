#pragma once
#include <stddef.h>
#include <stdint.h>

namespace btweb {
constexpr uint8_t version = 1;
constexpr size_t commandSize = 6;
constexpr size_t stateSize = 10;
enum class Result : uint8_t { Ok = 0, Invalid = 1, Busy = 2, Unavailable = 3 };
enum class Operation : uint8_t { Color = 1, Status = 2 };
struct Color {
    uint8_t red, green, blue;
    constexpr Color(uint8_t r = 0, uint8_t g = 0, uint8_t b = 0)
        : red(r), green(g), blue(b) {}
};
struct Command {
    uint8_t sequence = 0;
    Operation operation = Operation::Status;
    Color color;
};
// Exact length and reserved fields are checked before a command enters the queue.
inline bool decode(const uint8_t* data, size_t size, Command& out) {
    if (!data || size != commandSize || data[0] != version) return false;
    if (data[2] != static_cast<uint8_t>(Operation::Color) &&
        data[2] != static_cast<uint8_t>(Operation::Status)) return false;
    if (data[2] == static_cast<uint8_t>(Operation::Status) &&
        (data[3] || data[4] || data[5])) return false;
    out.sequence = data[1];
    out.operation = static_cast<Operation>(data[2]);
    out.color = {data[3], data[4], data[5]};
    return true;
}
}
