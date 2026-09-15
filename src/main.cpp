#include <Arduino.h>
#include "RgbLed.h"
#include <BTWeb.h>
#include "BoardConfig.h"

BTWeb bt;
RgbLed pixel;
bool started = false;
bool wasConnected = false;
uint32_t lastStatus = 0;
bool statusOn = false;

bool applyColor(btweb::Color color, void*) {
    if (!BoardConfig::rgbVerified) return false;
    return pixel.set(color);
}

void showStatus(btweb::Color color) {
    if (applyColor(color, nullptr)) bt.setColor(color);
}

void setup() {
    Serial.begin(115200); // Never wait for a USB monitor to attach.
    const bool ledReady = BoardConfig::rgbVerified &&
        pixel.begin(BoardConfig::rgbDataPin, BoardConfig::brightness);
    if (ledReady) { showStatus({12, 0, 0}); pixel.poll(); }
    started = bt.begin("MNQ-BT-0001", ledReady ? applyColor : nullptr);
    if (!ledReady) Serial.println("RGB unavailable: check pin confirmation and RMT setup");
    Serial.println(started ? "BTWeb advertising" : "BTWeb failed to start; reset to retry");
    if (!BoardConfig::rgbVerified) Serial.println("RGB disabled: board pinout confirmation required");
}

void loop() {
    if (started) {
        const bool connected = bt.connected();
        if (connected != wasConnected) {
            wasConnected = connected;
            if (connected) showStatus({0, 32, 0});
            else lastStatus = millis() - 500;
        }
        if (!connected && static_cast<uint32_t>(millis() - lastStatus) >= 500) {
            lastStatus = millis();
            statusOn = !statusOn;
            showStatus(statusOn ? btweb::Color{0, 0, 32} : btweb::Color{});
        }
        bt.poll(); // Commands override connected status until disconnection.
    }
    pixel.poll(); // Starts a pending LED frame only when the hardware is idle.
    // Add bounded application work here. Queue ESP-NOW callbacks before processing.
    yield();
}
