#pragma once
#include <BTWeb.h>
#include <WiFi.h>

// Optional example extension. The reusable BTWeb core has no Wi-Fi dependency.
// Owns Arduino's scan results; do not start another scan while this is active.
class WifiScan final : private NimBLECharacteristicCallbacks {
public:
    explicit WifiScan(BTWeb& owner) : owner_(owner) {}
    static bool attach(NimBLEService* service, void* context) {
        return static_cast<WifiScan*>(context)->begin(service);
    }
    void poll() {
        const auto session = owner_.session();
        if (running_) {
            const int16_t result = WiFi.scanComplete();
            if (result != WIFI_SCAN_RUNNING) {
                running_ = false;
                count_ = result;
                if (scanSession_ != session || !owner_.connected()) {
                    WiFi.scanDelete(); count_ = WIFI_SCAN_FAILED;
                }
            }
        } else if (scanSession_ != session && count_ >= 0) {
            WiFi.scanDelete(); count_ = WIFI_SCAN_FAILED;
        }
        Request request{};
        if (!queue_ || xQueueReceive(queue_, &request, 0) != pdTRUE ||
            !owner_.connected() || request.session != session) return;
        uint8_t packet[40] = {1, request.sequence, 4, 0, 0, 0, 0, 0};
        size_t size = 8;
        if (request.operation == 1 && !running_) {
            scanSession_ = session;
            // Station mode was initialised in setup. No credentials or join.
            count_ = WiFi.scanNetworks(true, true, false, 300);
            running_ = count_ == WIFI_SCAN_RUNNING;
        }
        if (request.operation >= 1 && request.operation <= 3) {
            if (running_) packet[2] = 1;
            else if (count_ >= 0 && scanSession_ == session) {
                packet[2] = 2;
                packet[3] = static_cast<uint8_t>(count_);
                packet[4] = static_cast<uint8_t>(count_ >> 8);
                if (request.operation == 3) {
                    // Use the full index accessor; SSID(uint8_t) truncates >255.
                    const auto* ap = static_cast<const wifi_ap_record_t*>(
                        WiFiScanClass::getScanInfoByIndex(request.index));
                    if (ap && request.index < count_) {
                        packet[2] = 3;
                        packet[5] = static_cast<uint8_t>(ap->authmode);
                        packet[6] = static_cast<uint8_t>(ap->rssi);
                        packet[7] = strnlen(reinterpret_cast<const char*>(ap->ssid), 32);
                        memcpy(packet + 8, ap->ssid, packet[7]);
                        size += packet[7];
                    } else packet[2] = 4;
                }
            }
        }
        result_->setValue(packet, size);
    }
private:
    struct Request { uint32_t session; uint16_t index; uint8_t sequence; uint8_t operation; };
    BTWeb& owner_;
    StaticQueue_t queueControl_{};
    uint8_t queueStorage_[4 * sizeof(Request)]{};
    QueueHandle_t queue_ = nullptr;
    NimBLECharacteristic* result_ = nullptr;
    bool running_ = false;
    int16_t count_ = WIFI_SCAN_FAILED;
    uint32_t scanSession_ = 0;
    bool begin(NimBLEService* service) {
        queue_ = xQueueCreateStatic(4, sizeof(Request), queueStorage_, &queueControl_);
        auto* command = service->createCharacteristic("fb8c0004-7b3a-4d0c-a8d5-83f46571c901", NIMBLE_PROPERTY::WRITE, 5);
        result_ = service->createCharacteristic("fb8c0005-7b3a-4d0c-a8d5-83f46571c901", NIMBLE_PROPERTY::READ, 40);
        if (!queue_ || !command || !result_) return false;
        command->setCallbacks(this);
        const uint8_t initial[8] = {1, 0, 4, 0, 0, 0, 0, 0};
        result_->setValue(initial, sizeof(initial));
        return true;
    }
    void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
        const auto value = characteristic->getValue();
        if (value.size() != 5 || value.data()[0] != 1) return;
        const auto* bytes = value.data();
        Request request{owner_.session(), static_cast<uint16_t>(bytes[3] | (bytes[4] << 8)), bytes[1], bytes[2]};
        // BLE callback never runs a scan or waits for loop processing.
        xQueueSend(queue_, &request, 0);
    }
};
