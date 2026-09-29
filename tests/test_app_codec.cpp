#include "../components/halo2_api/codec.h"
#include <cassert>
#include <iostream>
using namespace halo2_protocol;
static std::string command(const std::string &patch) {
  return "{\"command_id\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"client_id\":\"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\","
         "\"boot_id\":\"22222222-2222-4222-8222-222222222222\",\"expected_revision\":0,\"not_after_uptime_ms\":4000,\"type\":\"set_state\",\"patch\":" + patch + "}";
}
int main(int argc, char **argv) {
  Request r, r2;
  assert(!decode_request(command("{\"power\":true}"), r).error);
  assert(!decode_request(command("{\"mode\":\"back\",\"power\":true}"), r).error);
  assert(!decode_request(command("{\"power\":true,\"mode\":\"back\"}"), r2).error && r == r2);
  assert(!decode_request(command("{\"auto_dimming\":true}"), r2).error &&
         r2.patch.fields == AUTO_DIM && r2.patch.values.auto_dimming);
  for (const char *patch : {"{}", "null", "[]", "{\"power\":1}", "{\"power\":null}", "{\"front_brightness\":true}",
       "{\"unknown\":true}", "{\"power\":true,\"power\":false}", "{\"power\":true,\"powe\\u0072\":false}",
       "{\"power\":{\"bad\":true}}", "{\"power\":true,}", "{power:true}", "{\"power\\u0000extra\":true}",
       "{\"power\":True}", "{\"power\":true /* comment */}", "{\"front_brightness\":01}",
       "{\"temperature_k\":3925.0}", "{\"temperature_k\":3.925e3}", "{\"auto_dimming\":1}",
       "{\"auto_dimming\":null}"}) {
    if (decode_request(command(patch), r).http != 400) { std::cerr << "Unexpected acceptance: " << patch << '\n'; return 1; }
  }
  for (const char *patch : {"{\"front_brightness\":0}", "{\"back_brightness\":101}", "{\"temperature_k\":3926}", "{\"mode\":\"none\"}"})
    assert(decode_request(command(patch), r).http == 422);
  auto valid = command("{\"power\":false}");
  assert(decode_request(valid + "{}", r).http == 400);
  auto duplicate = valid; duplicate.insert(1, "\"expected_revision\":0,"); assert(decode_request(duplicate, r).http == 400);
  auto nul_id = valid; nul_id.insert(nul_id.find("aaaaaaaaaaaa\"") + 12, "\\u0000extra"); assert(decode_request(nul_id, r).http == 400);
  assert(decode_request(command("{\"mode\":\"back\\u0000extra\"}"), r).http == 422);
  auto unknown = valid; unknown.replace(unknown.find("expected_revision"), 17, "unexpected_fieldx"); assert(decode_request(unknown, r).http == 400);
  assert(!decode_request(valid + " \r\n", r).error);
  assert(decode_request(std::string(1025, ' '), r).http == 413);
  // Emit real C++ encoder output for the existing JSON Schema validator.
  if (argc > 1 && std::string(argv[1]) == "--fixtures") {
    Dispatcher d; d.boot = r.boot; d.device = r.client; d.configure(Radio::Ready, Pairing::Ready, true, true);
    JsonDocument doc;
    auto root = doc.to<JsonObject>(); encode_info(root["DeviceInfo"].to<JsonObject>(), d);
    r.revision = d.revision; const auto a = d.admit(r, 0);
    encode_record(root["Accepted"].to<JsonObject>(), d.records[a.index]);
    d.begin_frame(1); d.complete_frame({true, true, 46, 17, 2, nullptr}, 81);
    encode_record(root["CommandRecord"].to<JsonObject>(), d.records[d.last]);
    encode_snapshot(root["Snapshot"].to<JsonObject>(), d, 82);
    encode_error(root["Error"].to<JsonObject>(), d, 401, "UNAUTHORIZED");
    std::string output; serializeJson(doc, output); std::cout << output << '\n';
  } else std::cout << "codec scenarios passed\n";
}
