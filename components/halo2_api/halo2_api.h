#pragma once
#include "esphome/core/component.h"
#include "dispatcher.h"
#include <esp_http_server.h>
#include <functional>
#include <mutex>
#include <string>

namespace esphome::halo2_api {
class Halo2Api : public Component {
 public:
  void setup() override;
  void loop() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }
  void set_credentials(const std::string &username, const std::string &password);
  void set_port(uint16_t port) { port_ = port; }
  void set_sender(std::function<halo2_protocol::TxResult(uint8_t, const halo2_protocol::LightState &)> sender) { sender_ = std::move(sender); }
  void set_publisher(std::function<void(const halo2_protocol::LightState &)> publisher) { publisher_ = std::move(publisher); }
  void set_reporter(std::function<void(const char *)> reporter) { reporter_ = std::move(reporter); }
  void restore(const halo2_protocol::LightState &state);
  void observe(const halo2_protocol::LightState &state);
  void configure(halo2_protocol::Radio radio, halo2_protocol::Pairing pairing, bool persisted, bool verified, const char *error = nullptr, bool force = false);
  bool initialized() const { return initialized_; }
  void set_power(bool value);
  void set_lamp(bool front, bool value);
  void set_mode(halo2_protocol::Mode value);
  void set_number(uint8_t field, float value);
  void set_ultrasonic(bool value);
  void resend();
  bool begin_maintenance();
  void end_maintenance();

 private:
  halo2_protocol::Dispatcher dispatcher_;
  std::mutex mutex_;
  httpd_handle_t server_{nullptr};
  std::string authorization_;
  uint16_t port_{8080};
  bool initialized_{false};
  bool radio_fault_latched_{false};
  uint64_t published_revision_{UINT64_MAX};
  std::function<halo2_protocol::TxResult(uint8_t, const halo2_protocol::LightState &)> sender_;
  std::function<void(const halo2_protocol::LightState &)> publisher_;
  std::function<void(const char *)> reporter_;
  static esp_err_t route_(httpd_req_t *request);
  esp_err_t handle_(httpd_req_t *request);
  void legacy_(halo2_protocol::Patch patch);
};

// Scope-bound lease for legacy diagnostic lambdas, including early returns.
class Maintenance {
 public:
  explicit Maintenance(Halo2Api *api) : api_(api), acquired_(api->begin_maintenance()) {}
  ~Maintenance() { if (acquired_) api_->end_maintenance(); }
  explicit operator bool() const { return acquired_; }
 private:
  Halo2Api *api_;
  bool acquired_;
};
}  // namespace esphome::halo2_api
