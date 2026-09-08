#pragma once
#include <BTWebProtocol.h>
#include <driver/rmt.h>

// One WS2812-compatible pixel. Loop-task-only; reserves RMT TX channel 0.
// Owns its symbol buffer for the full lifetime of each asynchronous transfer.
class RgbLed {
public:
    bool begin(int pin, uint8_t brightness) {
        brightness_ = brightness;
        rmt_config_t config{};
        config.rmt_mode = RMT_MODE_TX;
        config.channel = RMT_CHANNEL_0;
        config.gpio_num = static_cast<gpio_num_t>(pin);
        config.clk_div = 2; // 80 MHz APB / 2 = 25 ns per tick.
        config.mem_block_num = 1;
        config.tx_config.idle_output_en = true;
        config.tx_config.idle_level = RMT_IDLE_LEVEL_LOW;
        if (rmt_config(&config) != ESP_OK) return false;
        if (rmt_driver_install(RMT_CHANNEL_0, 0, 0) != ESP_OK) return false;
        uint32_t clock = 0;
        available_ = rmt_get_counter_clock(RMT_CHANNEL_0, &clock) == ESP_OK && clock == 40000000;
        return available_;
    }
    bool set(btweb::Color colour) {
        if (!available_) return false;
        desired_ = colour;
        pending_ = true; // Latest desired colour replaces any not-yet-started frame.
        return true;
    }
    void poll() {
        if (!available_ || !pending_) return;
        const auto idle = rmt_wait_tx_done(RMT_CHANNEL_0, 0);
        if (idle == ESP_ERR_TIMEOUT) return;
        if (idle != ESP_OK) { available_ = false; return; }
        const uint8_t grb[] = {scale(desired_.green), scale(desired_.red), scale(desired_.blue)};
        unsigned index = 0;
        for (uint8_t value : grb) {
            for (int bit = 7; bit >= 0; --bit) {
                const bool one = (value & (1u << bit)) != 0;
                auto& symbol = symbols_[index++];
                symbol.level0 = 1;
                symbol.duration0 = one ? 32 : 16; // 800 / 400 ns high.
                symbol.level1 = 0;
                symbol.duration1 = one ? 18 : 34; // Total 1.25 us per bit.
            }
        }
        symbols_[24].level0 = 0;
        symbols_[24].duration0 = 12000; // 300 us reset/latch, generated in hardware.
        symbols_[24].level1 = 0;
        symbols_[24].duration1 = 1;
        // Only this object owns channel 0, and the zero-timeout check found it idle.
        available_ = rmt_write_items(RMT_CHANNEL_0, symbols_, 25, false) == ESP_OK;
        pending_ = false;
    }
private:
    uint8_t scale(uint8_t value) const { return (uint16_t(value) * brightness_ + 127) / 255; }
    rmt_item32_t symbols_[25]{};
    btweb::Color desired_{};
    uint8_t brightness_ = 24;
    bool available_ = false;
    bool pending_ = false;
};
