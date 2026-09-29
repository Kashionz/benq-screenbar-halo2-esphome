#pragma once
#define ARDUINOJSON_ENABLE_STD_STRING 1
#define ARDUINOJSON_USE_LONG_LONG 1
#include <ArduinoJson.h>
#include "dispatcher.h"
#include <string>

namespace halo2_protocol {
// ArduinoJson replaces duplicate keys. Count lexical members before decoding so
// escaped duplicate names are rejected too. Only the root and patch may be objects.
class JsonShape {
 public:
  explicit JsonShape(const std::string &input) : input_(input) {}
  size_t root_members{0}, patch_members{0};
  bool valid() { whitespace(); return object(1) && (whitespace(), at_ == input_.size()); }
 private:
  const std::string &input_;
  size_t at_{0};
  char peek() const { return at_ < input_.size() ? input_[at_] : '\0'; }
  void whitespace() { while (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') ++at_; }
  bool take(char c) { if (peek() != c) return false; ++at_; return true; }
  bool string() {
    if (!take('"')) return false;
    while (at_ < input_.size()) {
      const unsigned char c = input_[at_++];
      if (c == '"') return true;
      if (c < 0x20) return false;
      if (c != '\\') continue;
      const char escape = peek(); if (!escape) return false; ++at_;
      if (escape == 'u') {
        for (int i = 0; i < 4; ++i) {
          const char h = peek();
          if (!((h >= '0' && h <= '9') || (h >= 'a' && h <= 'f') || (h >= 'A' && h <= 'F'))) return false;
          ++at_;
        }
      } else if (escape != '"' && escape != '\\' && escape != '/' && escape != 'b' && escape != 'f' && escape != 'n' && escape != 'r' && escape != 't') return false;
    }
    return false;
  }
  bool digit() const { return peek() >= '0' && peek() <= '9'; }
  bool digits() { if (!digit()) return false; do { ++at_; } while (digit()); return true; }
  bool value(int depth) {
    if (peek() == '{') return depth < 2 && object(depth + 1);
    if (peek() == '"') return string();
    for (const char *word : {"true", "false", "null"}) {
      const size_t length = std::strlen(word);
      if (input_.compare(at_, length, word) == 0) { at_ += length; return true; }
    }
    take('-');
    if (!take('0') && !digits()) return false;
    if (take('.') && !digits()) return false;
    if (take('e') || take('E')) { if (!take('+')) take('-'); if (!digits()) return false; }
    return true;
  }
  bool object(int depth) {
    if (!take('{')) return false;
    whitespace(); if (take('}')) return true;
    do {
      whitespace(); if (!string()) return false;
      whitespace(); if (!take(':')) return false;
      if (depth == 1) ++root_members; else ++patch_members;
      whitespace(); if (!value(depth)) return false;
      whitespace(); if (take('}')) return true;
    } while (take(','));
    return false;
  }
};
inline bool lexical_shape(const std::string &body, size_t &root_members, size_t &patch_members) {
  JsonShape shape(body); const bool valid = shape.valid();
  root_members = shape.root_members; patch_members = shape.patch_members; return valid;
}
inline bool is_uint(JsonVariantConst value) { return !value.is<bool>() && value.is<uint64_t>() && value.as<uint64_t>() <= MAX_SAFE; }
inline Admission decode_request(const std::string &body, Request &request) {
  if (body.size() > 1024) return {413, "PAYLOAD_TOO_LARGE"};
  size_t root_members = 0, patch_members = 0;
  if (!lexical_shape(body, root_members, patch_members)) return {400, "INVALID_REQUEST"};
  JsonDocument doc;
  if (deserializeJson(doc, body, DeserializationOption::NestingLimit(2))) return {400, "INVALID_REQUEST"};
  auto root = doc.as<JsonObjectConst>();
  auto patch = root["patch"].as<JsonObjectConst>();
  if (root.isNull() || root.size() != 7 || root_members != 7 || patch.isNull() ||
      patch.size() != patch_members || patch.size() == 0) return {400, "INVALID_REQUEST"};
  for (const char *key : {"command_id", "client_id", "boot_id", "expected_revision", "not_after_uptime_ms", "type", "patch"})
    if (root[key].isNull()) return {400, "INVALID_REQUEST"};
  if (!root["type"].is<const char *>() || root["type"].as<std::string>() != "set_state" ||
      !is_uint(root["expected_revision"]) || !is_uint(root["not_after_uptime_ms"])) return {400, "INVALID_REQUEST"};
  for (const char *key : {"command_id", "client_id", "boot_id"})
    if (!root[key].is<const char *>() || (root[key].as<JsonString>().size() != 36 || !valid_id(root[key]))) return {400, "INVALID_REQUEST"};
  request = Request{};
  request.command = make_id(root["command_id"]); request.client = make_id(root["client_id"]); request.boot = make_id(root["boot_id"]);
  request.revision = root["expected_revision"]; request.deadline = root["not_after_uptime_ms"];
  for (JsonPairConst entry : patch) {
    const std::string key(entry.key().c_str(), entry.key().size()); auto value = entry.value();
    if (key == "power" || key == "ultrasonic_enabled" || key == "auto_dimming") {
      if (!value.is<bool>()) return {400, "INVALID_REQUEST"};
      if (key == "power") { request.patch.fields |= POWER; request.patch.values.power = value; }
      else if (key == "ultrasonic_enabled") { request.patch.fields |= ULTRASONIC; request.patch.values.ultrasonic = value; }
      else { request.patch.fields |= AUTO_DIM; request.patch.values.auto_dimming = value; }
    } else if (key == "mode") {
      if (!value.is<const char *>()) return {400, "INVALID_REQUEST"};
      const std::string mode = value.as<std::string>();
      if (mode != "front" && mode != "back" && mode != "both") return {422, "INVALID_VALUE"};
      request.patch.fields |= MODE;
      request.patch.values.mode = mode == "front" ? Mode::Front : mode == "back" ? Mode::Back : Mode::Both;
    } else if (key == "front_brightness" || key == "back_brightness" || key == "temperature_k") {
      if (value.is<bool>() || !value.is<int64_t>()) return {400, "INVALID_REQUEST"};
      const int64_t number = value;
      if (key == "temperature_k") {
        if (number < 2700 || number > 6500 || number % 25) return {422, "INVALID_VALUE"};
        request.patch.fields |= TEMPERATURE; request.patch.values.temperature = static_cast<uint16_t>(number);
      } else {
        if (number < 1 || number > 100) return {422, "INVALID_VALUE"};
        if (key == "front_brightness") { request.patch.fields |= FRONT; request.patch.values.front = static_cast<uint8_t>(number); }
        else { request.patch.fields |= BACK; request.patch.values.back = static_cast<uint8_t>(number); }
      }
    } else return {400, "INVALID_REQUEST"};
  }
  return {202, nullptr};
}
inline void encode_light(JsonObject out, const LightState &state) {
  out["power"] = state.power; out["mode"] = mode_name(state.mode);
  out["front_brightness"] = state.front; out["back_brightness"] = state.back;
  out["temperature_k"] = state.temperature; out["ultrasonic_enabled"] = state.ultrasonic;
  out["auto_dimming"] = state.auto_dimming;
}
inline void encode_record(JsonObject out, const Record &r) {
  out["boot_id"] = std::string(r.request.boot.data()); out["command_id"] = std::string(r.request.command.data()); out["client_id"] = std::string(r.request.client.data());
  out["accepted_revision"] = r.revision; encode_light(out["target"].to<JsonObject>(), r.target);
  out["status"] = status_name(r.status); out["effect"] = r.attempted ? "unconfirmed" : "not_attempted";
  out["accepted_at_uptime_ms"] = r.accepted_at;
  out["started_at_uptime_ms"] = nullptr; if (r.started) out["started_at_uptime_ms"] = r.started_at;
  out["finished_at_uptime_ms"] = nullptr; if (r.finished) out["finished_at_uptime_ms"] = r.finished_at;
  out["error"] = nullptr;
  if (r.error) { out["error"]["code"] = r.error; out["error"]["message"] = r.error; }
  auto tx = out["tx"].to<JsonObject>();
  tx["frames_planned"] = r.planned; tx["frames_attempted"] = r.attempted; tx["frames_transmitted"] = r.transmitted;
  tx["irq"] = nullptr; tx["fifo"] = nullptr; tx["mode"] = nullptr;
  if (r.diagnostics) { tx["irq"] = r.irq; tx["fifo"] = r.fifo; tx["mode"] = r.mode; }
}
inline void encode_snapshot(JsonObject out, const Dispatcher &d, Time now) {
  out["device_id"] = std::string(d.device.data()); out["boot_id"] = std::string(d.boot.data()); out["uptime_ms"] = now;
  out["state_version"] = d.version; out["control_revision"] = d.revision;
  auto desired = out["desired"].to<JsonObject>(); encode_light(desired["values"].to<JsonObject>(), d.desired);
  desired["source"] = d.source; desired["updated_at_uptime_ms"] = d.desired_at;
  desired["command_id"] = nullptr; if (d.desired_command[0]) desired["command_id"] = std::string(d.desired_command.data());
  out["observed_remote"] = nullptr;
  if (d.has_observed) {
    auto observed = out["observed_remote"].to<JsonObject>();
    encode_light(observed["values"].to<JsonObject>(), d.observed); observed["received_at_uptime_ms"] = d.observed_at;
  }
  out["lamp_confirmation"] = "unavailable"; out["radio_status"] = radio_name(d.radio);
  out["radio_error_code"] = d.radio_error; out["pairing_status"] = pairing_name(d.pairing); out["pairing_persisted"] = d.persisted;
  out["active_command"] = nullptr; out["last_command"] = nullptr;
  if (d.active >= 0) encode_record(out["active_command"].to<JsonObject>(), d.records[d.active]);
  if (d.last >= 0) encode_record(out["last_command"].to<JsonObject>(), d.records[d.last]);
  auto features = out["features"].to<JsonObject>();
  const char *names[]{"power", "mode", "front_brightness", "back_brightness", "temperature_k", "ultrasonic_enabled", "auto_dimming"};
  for (uint8_t i = 0; i < 7; ++i) features[names[i]] = !(d.supported & (1 << i)) ? "unsupported" : i == 0 && d.verified_power ? "verified" : "experimental";
}
inline void encode_info(JsonObject out, const Dispatcher &d) {
  out["device_id"] = std::string(d.device.data()); out["boot_id"] = std::string(d.boot.data());
  auto protocol = out["protocol"].to<JsonObject>(); protocol["name"] = "halo2-bridge"; protocol["major"] = 1; protocol["minor"] = 0;
  out["firmware_version"] = "app-protocol-1.0.0-dev"; out["lamp_model"] = "ScreenBar Halo 2";
  auto capabilities = out["capabilities"].to<JsonObject>();
  capabilities["state_events"] = false; capabilities["command_lookup"] = true; capabilities["lamp_confirmation"] = false;
  auto limits = out["limits"].to<JsonObject>();
  limits["max_request_bytes"] = 1024; limits["max_response_bytes"] = 8192; limits["max_inflight_commands"] = 1;
  limits["min_command_interval_ms"] = MIN_INTERVAL_MS; limits["max_command_future_ms"] = MAX_FUTURE_MS;
  limits["result_capacity"] = CAPACITY; limits["result_retention_ms"] = RETENTION_MS;
  limits["max_event_subscribers"] = 0; limits["heartbeat_ms"] = 10000; limits["snapshot_coalesce_ms"] = 250;
}
inline void encode_error(JsonObject out, const Dispatcher &d, int http, const char *code) {
  out["error"]["code"] = code; out["error"]["message"] = code;
  out["error"]["retryable"] = http == 429 || http == 503;
  out["boot_id"] = nullptr; out["control_revision"] = nullptr;
  if (http != 401) { out["boot_id"] = std::string(d.boot.data()); out["control_revision"] = d.revision; }
}
}  // namespace halo2_protocol
