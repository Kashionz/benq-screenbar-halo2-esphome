#include "halo2_api.h"
#include "codec.h"
#include "esphome/core/log.h"
#include "esphome/core/preferences.h"
#include <esp_random.h>
#include <esp_timer.h>
#include <mbedtls/base64.h>
#include <cmath>
#include <cctype>
#include <sys/socket.h>
#include <unistd.h>

namespace esphome::halo2_api {
using namespace halo2_protocol;
static const char *const TAG = "halo2_api";
static Time now_ms() { return static_cast<Time>(esp_timer_get_time()) / 1000; }
static Id uuid() {
  std::array<uint8_t, 16> bytes{}; esp_fill_random(bytes.data(), bytes.size());
  bytes[6] = (bytes[6] & 15) | 0x40; bytes[8] = (bytes[8] & 63) | 0x80;
  Id result{}; size_t offset = 0;
  for (size_t i = 0; i < bytes.size(); ++i) {
    if (i == 4 || i == 6 || i == 8 || i == 10) result[offset++] = '-';
    std::snprintf(result.data() + offset, result.size() - offset, "%02x", bytes[i]); offset += 2;
  }
  return result;
}
void Halo2Api::set_credentials(const std::string &username, const std::string &password) {
  const std::string plain = username + ":" + password;
  std::string encoded(4 * ((plain.size() + 2) / 3) + 1, '\0'); size_t size = 0;
  if (mbedtls_base64_encode(reinterpret_cast<unsigned char *>(&encoded[0]), encoded.size(), &size,
      reinterpret_cast<const unsigned char *>(plain.data()), plain.size()) == 0) {
    encoded.resize(size); authorization_ = "Basic " + encoded;
  }
}
void Halo2Api::setup() {
  dispatcher_.boot = uuid();
  auto preference = global_preferences->make_preference<Id>(0x48415031, true); // HAP1, separate from RF pairing.
  if (!preference.load(&dispatcher_.device) || dispatcher_.device.back() != '\0' || !valid_id(dispatcher_.device.data())) {
    dispatcher_.device = uuid();
    if (!preference.save(&dispatcher_.device) || !global_preferences->sync()) { ESP_LOGE(TAG, "Device identity persistence failed"); mark_failed(); return; }
  }
  if (authorization_.empty()) { mark_failed(); return; }
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = port_; config.ctrl_port = 32769;
  config.stack_size = 8192; config.max_open_sockets = 3; config.lru_purge_enable = true;
  config.recv_wait_timeout = 2; config.send_wait_timeout = 2;
  // Match ESPHome's server: stop incoming traffic before closing a socket to
  // avoid the ESP32 lwIP close/receive race under short-lived HTTP requests.
  config.close_fn = [](httpd_handle_t, int fd) { shutdown(fd, SHUT_RD); close(fd); };
  config.uri_match_fn = httpd_uri_match_wildcard;
  if (httpd_start(&server_, &config) != ESP_OK) { ESP_LOGE(TAG, "API server start failed"); mark_failed(); return; }
  httpd_uri_t route{}; route.uri = "/*"; route.method = static_cast<httpd_method_t>(HTTP_ANY); route.handler = route_; route.user_ctx = this;
  if (httpd_register_uri_handler(server_, &route) != ESP_OK) { httpd_stop(server_); server_ = nullptr; mark_failed(); return; }
  ESP_LOGI(TAG, "App protocol v1 listening on port %u (polling)", port_);
}
void Halo2Api::restore(const LightState &state) {
  std::lock_guard<std::mutex> lock(mutex_); dispatcher_.restore(state, now_ms()); initialized_ = true;
}
void Halo2Api::observe(const LightState &state) {
  std::lock_guard<std::mutex> lock(mutex_); dispatcher_.observe(state, now_ms());
}
void Halo2Api::configure(Radio radio, Pairing pairing, bool persisted, bool verified, const char *error, bool force) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (force) radio_fault_latched_ = false;  // Explicit maintenance establishes a new control context.
  if (radio_fault_latched_) { radio = Radio::Fault; error = "TX_FIFO_STUCK"; }
  dispatcher_.configure(radio, pairing, persisted, verified, error, force);
}
bool Halo2Api::begin_maintenance() {
  bool acquired;
  { std::lock_guard<std::mutex> lock(mutex_); acquired = dispatcher_.begin_maintenance(); }
  if (!acquired && reporter_) reporter_("BUSY: COMMAND ACTIVE");
  return acquired;
}
void Halo2Api::end_maintenance() { std::lock_guard<std::mutex> lock(mutex_); dispatcher_.end_maintenance(); }
void Halo2Api::legacy_(Patch patch) {
  Admission result;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    Request request; request.command = uuid(); request.client = dispatcher_.device; request.boot = dispatcher_.boot;
    request.revision = dispatcher_.revision; request.deadline = now_ms() + 4000; request.patch = patch;
    result = dispatcher_.admit(request, now_ms(), "legacy");
    // Republish the authoritative target even when the template entity rejects a write.
    published_revision_ = UINT64_MAX;
  }
  if (result.error && reporter_) reporter_(result.error);
}
void Halo2Api::set_power(bool value) { Patch p; p.fields = POWER; p.values.power = value; legacy_(p); }
void Halo2Api::set_ultrasonic(bool value) { Patch p; p.fields = ULTRASONIC; p.values.ultrasonic = value; legacy_(p); }
void Halo2Api::set_mode(Mode value) { Patch p; p.fields = MODE; p.values.mode = value; legacy_(p); }
void Halo2Api::set_number(uint8_t field, float value) {
  if (!std::isfinite(value) || value != std::floor(value) || value < 0 || value > 65535) { if (reporter_) reporter_("INVALID_VALUE"); return; }
  Patch p; p.fields = field;
  if (field == TEMPERATURE) p.values.temperature = static_cast<uint16_t>(value);
  else if (value > 100) { if (reporter_) reporter_("INVALID_VALUE"); return; }
  else if (field == FRONT) p.values.front = static_cast<uint8_t>(value);
  else if (field == BACK) p.values.back = static_cast<uint8_t>(value);
  else return;
  legacy_(p);
}
void Halo2Api::set_lamp(bool front, bool value) {
  // Resolve the legacy pair of switches into one valid mode while holding admission's lock.
  Admission result;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto state = dispatcher_.desired;
    bool f = state.mode != Mode::Back, b = state.mode != Mode::Front;
    if (front) f = value; else b = value;
    Request request; request.command = uuid(); request.client = dispatcher_.device; request.boot = dispatcher_.boot;
    request.revision = dispatcher_.revision; request.deadline = now_ms() + 4000;
    request.patch.fields = MODE;
    request.patch.values.mode = f && b ? Mode::Both : b ? Mode::Back : f ? Mode::Front : state.mode;
    if (value || (!f && !b)) { request.patch.fields |= POWER; request.patch.values.power = value; }
    result = dispatcher_.admit(request, now_ms(), "legacy"); published_revision_ = UINT64_MAX;
  }
  if (result.error && reporter_) reporter_(result.error);
}
void Halo2Api::resend() {
  // One atomic snapshot/admission; use the normal command pipeline, not direct RF.
  Admission result;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    Request request; request.command = uuid(); request.client = dispatcher_.device; request.boot = dispatcher_.boot;
    request.revision = dispatcher_.revision; request.deadline = now_ms() + 4000;
    request.patch.fields = ALL; request.patch.values = dispatcher_.desired;
    result = dispatcher_.admit(request, now_ms(), "legacy");
  }
  if (result.error && reporter_) reporter_(result.error);
}
void Halo2Api::loop() {
  LightState target; uint8_t command = 0; bool publish = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (initialized_ && published_revision_ != dispatcher_.revision) {
      published_revision_ = dispatcher_.revision; target = dispatcher_.desired; publish = true;
    }
  }
  if (publish && publisher_) publisher_(target);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (sender_) command = dispatcher_.begin_frame(now_ms());
    if (command) target = dispatcher_.records[dispatcher_.active].target;
  }
  if (!command) return;
  // The only production TX entry, running on ESPHome's main task, outside the HTTP mutex.
  const auto result = sender_(command, target);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    dispatcher_.complete_frame(result, now_ms());
    if (!result.attempted && result.error && std::strcmp(result.error, "TX_FIFO_STUCK") == 0) {
      radio_fault_latched_ = true;
      dispatcher_.configure(Radio::Fault, dispatcher_.pairing, dispatcher_.persisted, dispatcher_.verified_power, "TX_FIFO_STUCK");
    }
  }
  if (reporter_) {
    char status[96];
    const char *action = command == 2 ? (target.power ? "ON" : "OFF") : "STATE";
    if (result.diagnostics) std::snprintf(status, sizeof(status), "%s PACKET IRQ=%02X FIFO=%02X %s",
      action, result.irq, result.fifo, result.sent ? "TX_DS" : "TX FAILED");
    else std::snprintf(status, sizeof(status), "%s DIRECT %s", action, result.sent ? "sent" : "TX FAILED");
    reporter_(status);
  }
}

static std::string header(httpd_req_t *request, const char *name) {
  const size_t len = httpd_req_get_hdr_value_len(request, name);
  if (!len || len > 1024) return {};
  std::string result(len + 1, '\0');
  if (httpd_req_get_hdr_value_str(request, name, &result[0], result.size()) != ESP_OK) return {};
  result.resize(len); return result;
}
static const char *http_status(int code) {
  switch (code) {
    case 200: return "200 OK"; case 202: return "202 Accepted"; case 400: return "400 Bad Request";
    case 401: return "401 Unauthorized"; case 404: return "404 Not Found"; case 405: return "405 Method Not Allowed";
    case 409: return "409 Conflict"; case 413: return "413 Payload Too Large"; case 415: return "415 Unsupported Media Type";
    case 422: return "422 Unprocessable Entity"; case 429: return "429 Too Many Requests"; default: return "503 Service Unavailable";
  }
}
static esp_err_t respond(httpd_req_t *request, int code, JsonDocument &doc) {
  std::string body; serializeJson(doc, body);
  if (doc.overflowed() || body.size() > 8192) return ESP_FAIL;
  httpd_resp_set_status(request, http_status(code)); httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  // Always close: unread rejected bodies cannot become a subsequent request.
  httpd_resp_set_hdr(request, "Connection", "close");
  if (code == 401) httpd_resp_set_hdr(request, "WWW-Authenticate", "Basic realm=\"Halo2 Bridge\"");
  if (code == 429) httpd_resp_set_hdr(request, "Retry-After", "1");
  const esp_err_t result = httpd_resp_send(request, body.data(), body.size());
  httpd_sess_trigger_close(request->handle, httpd_req_to_sockfd(request));
  return result;
}
esp_err_t Halo2Api::route_(httpd_req_t *request) { return static_cast<Halo2Api *>(request->user_ctx)->handle_(request); }
esp_err_t Halo2Api::handle_(httpd_req_t *request) {
  auto error = [&](int code, const char *name) {
    JsonDocument doc;
    { std::lock_guard<std::mutex> lock(mutex_); encode_error(doc.to<JsonObject>(), dispatcher_, code, name); }
    return respond(request, code, doc);
  };
  const auto provided = header(request, "Authorization");
  unsigned mismatch = static_cast<unsigned>(provided.size() ^ authorization_.size());
  for (size_t i = 0; i < authorization_.size(); ++i) mismatch |= static_cast<unsigned char>(authorization_[i]) ^ (i < provided.size() ? static_cast<unsigned char>(provided[i]) : 0);
  if (mismatch) return error(401, "UNAUTHORIZED");
  const std::string uri = request->uri;
  const size_t question = uri.find('?'); const std::string path = uri.substr(0, question);
  const bool command_path = path == "/api/v1/commands";
  const bool lookup = path.rfind("/api/v1/commands/", 0) == 0;
  if (!command_path && !lookup && path != "/api/v1/info" && path != "/api/v1/state") return error(404, "NOT_FOUND");
  if (request->method != (command_path ? HTTP_POST : HTTP_GET)) {
    httpd_resp_set_hdr(request, "Allow", command_path ? "POST" : "GET"); return error(405, "METHOD_NOT_ALLOWED");
  }
  if (!lookup && question != std::string::npos) return error(400, "INVALID_REQUEST");
  if (request->content_len > 1024) return error(413, "PAYLOAD_TOO_LARGE");
  if (!header(request, "Content-Encoding").empty() || !header(request, "Transfer-Encoding").empty()) return error(415, "UNSUPPORTED_MEDIA_TYPE");
  if (command_path) {
    auto type = header(request, "Content-Type");
    for (auto &c : type) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (type != "application/json" && type != "application/json; charset=utf-8") return error(415, "UNSUPPORTED_MEDIA_TYPE");
    std::string body(request->content_len, '\0'); size_t received = 0;
    while (received < body.size()) {
      const int count = httpd_req_recv(request, &body[received], body.size() - received);
      if (count <= 0) return error(400, "INVALID_REQUEST");
      received += static_cast<size_t>(count);
    }
    Request command; auto result = decode_request(body, command);
    if (result.error) return error(result.http, result.error);
    JsonDocument doc;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      result = dispatcher_.admit(command, now_ms());
      if (result.error) encode_error(doc.to<JsonObject>(), dispatcher_, result.http, result.error);
      else encode_record(doc.to<JsonObject>(), dispatcher_.records[result.index]);
    }
    return respond(request, result.http, doc);
  }
  if (request->content_len != 0) return error(400, "INVALID_REQUEST");
  JsonDocument doc; int code = 200;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (path == "/api/v1/info") encode_info(doc.to<JsonObject>(), dispatcher_);
    else if (path == "/api/v1/state") encode_snapshot(doc.to<JsonObject>(), dispatcher_, now_ms());
    else {
      const std::string id = path.substr(std::strlen("/api/v1/commands/"));
      const std::string query = question == std::string::npos ? "" : uri.substr(question + 1);
      const char *failure = nullptr;
      if (!valid_id(id.c_str()) || query.rfind("boot_id=", 0) != 0 || !valid_id(query.substr(8).c_str())) { code = 400; failure = "INVALID_REQUEST"; }
      else if (make_id(query.substr(8).c_str()) != dispatcher_.boot) { code = 409; failure = "BOOT_CHANGED"; }
      else {
        dispatcher_.expire_results(now_ms()); const int index = dispatcher_.find(make_id(id.c_str()));
        if (index < 0) { code = 404; failure = "COMMAND_NOT_FOUND"; }
        else encode_record(doc.to<JsonObject>(), dispatcher_.records[index]);
      }
      if (failure) encode_error(doc.to<JsonObject>(), dispatcher_, code, failure);
    }
  }
  return respond(request, code, doc);
}
}  // namespace esphome::halo2_api
