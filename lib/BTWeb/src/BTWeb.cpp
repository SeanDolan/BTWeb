#include "BTWeb.h"

bool BTWeb::begin(const char* name, ColorHandler handler, void* context) {
    if (server_ || !name || !name[0] || strlen(name) > 20) return false;
    handler_ = handler;
    context_ = context;
    queue_ = xQueueCreateStatic(queueDepth, sizeof(Event), queueStorage_, &queueControl_);
    if (!queue_ || !NimBLEDevice::init(name)) return false;
    server_ = NimBLEDevice::createServer();
    if (!server_) return false;
    server_->setCallbacks(this, false);
    server_->advertiseOnDisconnect(true);
    auto* service = server_->createService(serviceUuid);
    if (!service) return false;
    auto* command = service->createCharacteristic(commandUuid, NIMBLE_PROPERTY::WRITE, 20);
    state_ = service->createCharacteristic(stateUuid,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, btweb::stateSize);
    if (!command || !state_) return false;
    command->setCallbacks(this);
    publish(false);
    service->start();
    auto* advertising = NimBLEDevice::getAdvertising();
    advertising->addServiceUUID(serviceUuid);
    advertising->setName(name);
    advertising->enableScanResponse(true);
    return advertising->start();
}

void BTWeb::onConnect(NimBLEServer* server, NimBLEConnInfo& info) {
    session_.fetch_add(1);
    connected_.store(true);
    server->updateConnParams(info.getConnHandle(), 24, 48, 0, 400);
}

void BTWeb::onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) {
    connected_.store(false);
    session_.fetch_add(1); // Commands waiting in the queue belong to the old peer.
}

void BTWeb::onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) {
    const auto value = characteristic->getValue();
    Event event{};
    event.session = session_.load();
    event.result = btweb::decode(value.data(), value.size(), event.command)
        ? btweb::Result::Ok : btweb::Result::Invalid;
    if (value.size() >= 2) event.command.sequence = value.data()[1];
    if (xQueueSend(queue_, &event, 0) != pdTRUE) dropped_.fetch_add(1);
}

void BTWeb::setColor(btweb::Color color) {
    color_ = color;
    dirty_ = true;
}

void BTWeb::poll() {
    if (!state_) return;
    // At most one command and one publication per call. No waiting for a client.
    Event event{};
    if (xQueueReceive(queue_, &event, 0) == pdTRUE &&
        connected_.load() && event.session == session_.load()) {
        sequence_ = event.command.sequence;
        result_ = event.result;
        if (result_ == btweb::Result::Ok && event.command.operation == btweb::Operation::Color) {
            if (handler_ && handler_(event.command.color, context_)) color_ = event.command.color;
            else result_ = btweb::Result::Unavailable;
        }
        dirty_ = true;
    }
    const auto drops = dropped_.load();
    if (drops != publishedDrops_) {
        publishedDrops_ = drops;
        result_ = btweb::Result::Busy;
        dirty_ = true;
    }
    const uint32_t now = millis();
    if (dirty_ && static_cast<uint32_t>(now - lastNotify_) >= 30) {
        publish(connected_.load());
        lastNotify_ = now;
    }
}

void BTWeb::publish(bool notify) {
    const uint32_t drops = dropped_.load();
    const uint8_t bytes[btweb::stateSize] = {
        btweb::version, sequence_, static_cast<uint8_t>(result_),
        color_.red, color_.green, color_.blue,
        static_cast<uint8_t>(handler_ != nullptr),
        static_cast<uint8_t>(drops), static_cast<uint8_t>(drops >> 8), 0
    };
    state_->setValue(bytes, sizeof(bytes));
    // A missed notification can be recovered with READ. No unbounded retries.
    dirty_ = notify && !state_->notify();
}
