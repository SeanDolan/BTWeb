#pragma once
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "BTWebProtocol.h"

// One persistent instance per device. BTWeb owns NimBLE; other libraries must
// not independently initialise/deinitialise it. Public methods run on loop task.
class BTWeb final : private NimBLEServerCallbacks,
                    private NimBLECharacteristicCallbacks {
public:
    static constexpr const char* serviceUuid = "fb8c0001-7b3a-4d0c-a8d5-83f46571c901";
    static constexpr const char* commandUuid = "fb8c0002-7b3a-4d0c-a8d5-83f46571c901";
    static constexpr const char* stateUuid = "fb8c0003-7b3a-4d0c-a8d5-83f46571c901";
    using ColorHandler = bool (*)(btweb::Color color, void* context);
    BTWeb() = default;
    BTWeb(const BTWeb&) = delete;
    BTWeb& operator=(const BTWeb&) = delete;
    bool begin(const char* name, ColorHandler handler, void* context = nullptr);
    void poll();
    bool connected() const { return connected_.load(); }
    // Report colours changed by local application logic, from the loop task only.
    void setColor(btweb::Color color);
    btweb::Color color() const { return color_; }

private:
    struct Event {
        btweb::Command command;
        btweb::Result result;
        uint32_t session;
    };
    static constexpr size_t queueDepth = 8;
    StaticQueue_t queueControl_{};
    uint8_t queueStorage_[queueDepth * sizeof(Event)]{};
    QueueHandle_t queue_ = nullptr;
    NimBLEServer* server_ = nullptr;
    NimBLECharacteristic* state_ = nullptr;
    ColorHandler handler_ = nullptr;
    void* context_ = nullptr;
    std::atomic<bool> connected_{false};
    std::atomic<uint32_t> session_{0};
    std::atomic<uint32_t> dropped_{0};
    btweb::Color color_{};
    uint8_t sequence_ = 0;
    btweb::Result result_ = btweb::Result::Ok;
    uint32_t lastNotify_ = 0;
    uint32_t publishedDrops_ = 0;
    bool dirty_ = true;
    void publish(bool notify);
    void onConnect(NimBLEServer*, NimBLEConnInfo&) override;
    void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override;
    void onWrite(NimBLECharacteristic*, NimBLEConnInfo&) override;
};
