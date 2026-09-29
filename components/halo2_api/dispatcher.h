#pragma once

// Platform-independent command arbitration. The owner serializes every call.
#include <array>
#include <cstdint>
#include <cstring>

namespace halo2_protocol {
using Time = uint64_t;
using Id = std::array<char, 37>;
constexpr Time MAX_SAFE = 9007199254740991ULL;
constexpr Time RETENTION_MS = 30000;
constexpr Time MIN_INTERVAL_MS = 500;
constexpr Time MAX_FUTURE_MS = 5000;
constexpr size_t CAPACITY = 64;

inline bool valid_id(const char *value) {
  if (!value || std::strlen(value) != 36) return false;
  for (size_t i = 0; i < 36; ++i) {
    const char c = value[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}
inline Id make_id(const char *value) { Id id{}; if (valid_id(value)) std::memcpy(id.data(), value, 36); return id; }

enum Field : uint8_t { POWER = 1, MODE = 2, FRONT = 4, BACK = 8, TEMPERATURE = 16, ULTRASONIC = 32, AUTO_DIM = 64, ALL = 127 };
enum class Mode : uint8_t { Front, Back, Both };
inline const char *mode_name(Mode mode) { return mode == Mode::Front ? "front" : mode == Mode::Back ? "back" : "both"; }
struct LightState {
  bool power{false};
  Mode mode{Mode::Both};
  uint8_t front{12}, back{91};
  uint16_t temperature{3925};
  bool ultrasonic{false};
  // Control bit 1. The lamp sets brightness from ambient light while it is on.
  bool auto_dimming{false};
  bool operator==(const LightState &b) const {
    return power == b.power && mode == b.mode && front == b.front && back == b.back &&
           temperature == b.temperature && ultrasonic == b.ultrasonic && auto_dimming == b.auto_dimming;
  }
};
struct Patch {
  uint8_t fields{0};
  LightState values{};
  LightState apply(LightState target) const {
    if (fields & POWER) target.power = values.power;
    if (fields & MODE) target.mode = values.mode;
    if (fields & FRONT) target.front = values.front;
    if (fields & BACK) target.back = values.back;
    if (fields & TEMPERATURE) target.temperature = values.temperature;
    if (fields & ULTRASONIC) target.ultrasonic = values.ultrasonic;
    // Like the original controller, a manual brightness change ends auto-dimming.
    if ((fields & (FRONT | BACK)) && !(fields & AUTO_DIM)) target.auto_dimming = false;
    if (fields & AUTO_DIM) target.auto_dimming = values.auto_dimming;
    return target;
  }
  bool valid() const {
    return fields && !(fields & ~ALL) && (!(fields & MODE) || values.mode <= Mode::Both) &&
      (!(fields & FRONT) || (values.front >= 1 && values.front <= 100)) &&
      (!(fields & BACK) || (values.back >= 1 && values.back <= 100)) &&
      (!(fields & TEMPERATURE) || (values.temperature >= 2700 && values.temperature <= 6500 && values.temperature % 25 == 0));
  }
  bool operator==(const Patch &b) const { return fields == b.fields && apply(LightState{}) == b.apply(LightState{}); }
};
struct Request {
  Id command{}, client{}, boot{};
  Time revision{0}, deadline{0};
  Patch patch{};
  bool operator==(const Request &b) const {
    return command == b.command && client == b.client && boot == b.boot && revision == b.revision &&
           deadline == b.deadline && patch == b.patch;
  }
};
enum class Status : uint8_t { Accepted, Executing, Transmitted, Failed, Expired, Superseded };
inline const char *status_name(Status s) {
  switch (s) {
    case Status::Accepted: return "accepted"; case Status::Executing: return "executing";
    case Status::Transmitted: return "transmitted"; case Status::Failed: return "failed";
    case Status::Expired: return "expired"; default: return "superseded";
  }
}
struct TxResult {
  bool attempted{false}, sent{false};
  uint8_t irq{0}, fifo{0}, mode{0};
  const char *error{"TX_TIMEOUT"};
  bool diagnostics{true};
};
struct Record {
  bool used{false}, started{false}, finished{false}, diagnostics{false};
  Request request{};
  LightState target{};
  Time revision{0}, accepted_at{0}, started_at{0}, finished_at{0};
  Status status{Status::Accepted};
  uint8_t planned{0}, attempted{0}, transmitted{0}, irq{0}, fifo{0}, mode{0};
  const char *error{nullptr};
};
struct Admission {
  int http{202};
  const char *error{nullptr};
  int index{-1};
};
enum class Radio : uint8_t { Initializing, Ready, Learning, Fault };
enum class Pairing : uint8_t { Unpaired, Learning, Ready };
inline const char *radio_name(Radio r) {
  return r == Radio::Ready ? "ready" : r == Radio::Learning ? "learning" : r == Radio::Fault ? "fault" : "initializing";
}
inline const char *pairing_name(Pairing p) { return p == Pairing::Ready ? "ready" : p == Pairing::Learning ? "learning" : "unpaired"; }

class Dispatcher {
 public:
  Id device{}, boot{}, desired_command{};
  LightState desired{}, observed{};
  const char *source{"boot_default"};
  Time revision{0}, version{0}, desired_at{0}, observed_at{0};
  bool has_observed{false}, persisted{false}, verified_power{false}, maintenance{false};
  uint8_t supported{ALL};
  Radio radio{Radio::Initializing};
  Pairing pairing{Pairing::Unpaired};
  const char *radio_error{nullptr};
  std::array<Record, CAPACITY> records{};
  int active{-1}, last{-1};

  void restore(LightState state, Time now) { desired = state; source = "restored"; desired_at = now; ++version; }
  void configure(Radio r, Pairing p, bool saved, bool verified, const char *error = nullptr, bool force = false) {
    if (!force && radio == r && pairing == p && persisted == saved && verified_power == verified && radio_error == error) return;
    radio = r; pairing = p; persisted = saved; verified_power = verified; radio_error = error;
    ++revision; ++version;
  }
  // Maintenance callers must end the lease even on early exits. No RF work may bypass this lease.
  bool begin_maintenance() {
    if (active >= 0 || maintenance) return false;
    maintenance = true; ++revision; ++version; return true;
  }
  void end_maintenance() { if (maintenance) { maintenance = false; ++revision; ++version; } }
  void observe(LightState state, Time now) {
    observed = state; observed_at = now; has_observed = true;
    if (!(desired == state)) {
      desired = state; desired_at = now; desired_command = {}; source = "remote"; ++revision;
    }
    ++version;
  }
  int find(const Id &id) const {
    for (size_t i = 0; i < records.size(); ++i) if (records[i].used && records[i].request.command == id) return static_cast<int>(i);
    return -1;
  }
  void expire_results(Time now) {
    for (size_t i = 0; i < records.size(); ++i) {
      auto &r = records[i];
      // Keep last_command until replaced, independently of the lookup retention minimum.
      if (r.used && r.finished && static_cast<int>(i) != last && now >= r.finished_at && now - r.finished_at >= RETENTION_MS) r.used = false;
    }
  }
  Admission admit(const Request &request, Time now, const char *origin = "app") {
    if (!valid_id(request.command.data()) || !valid_id(request.client.data()) || !valid_id(request.boot.data()) ||
        request.revision > MAX_SAFE || request.deadline > MAX_SAFE) return {400, "INVALID_REQUEST"};
    if (!request.patch.valid()) return {422, "INVALID_VALUE"};
    if (request.boot != boot) return {409, "BOOT_CHANGED"};
    expire_results(now);
    const int existing = find(request.command);
    if (existing >= 0) {
      const auto &r = records[existing];
      if (!(r.request == request)) return {409, "COMMAND_ID_REUSED"};
      return {r.finished ? 200 : 202, nullptr, existing};
    }
    if (request.deadline <= now) return {409, "DEADLINE_EXPIRED"};
    if (request.deadline - now > MAX_FUTURE_MS) return {409, "DEADLINE_TOO_FAR"};
    if (request.patch.fields & ~supported) return {422, "UNSUPPORTED_FEATURE"};
    if (pairing == Pairing::Learning) return {409, "PAIRING_IN_PROGRESS"};
    if (pairing != Pairing::Ready) return {409, "PAIRING_REQUIRED"};
    if (radio != Radio::Ready) return {503, "RADIO_UNAVAILABLE"};
    if (request.revision != revision) return {409, "REVISION_CONFLICT"};
    if (active >= 0 || maintenance) return {429, "BUSY"};
    if (has_admission_ && now - last_admission_ < MIN_INTERVAL_MS) return {429, "RATE_LIMITED"};
    int slot = -1;
    for (size_t i = 0; i < records.size(); ++i) if (!records[i].used) { slot = static_cast<int>(i); break; }
    // The last record may be reclaimed only after its retention period.
    if (slot < 0 && last >= 0 && now - records[last].finished_at >= RETENTION_MS) { slot = last; last = -1; }
    if (slot < 0) return {429, "RESULT_BUFFER_FULL"};
    if (revision >= MAX_SAFE - 8 || version >= MAX_SAFE - 8 || now >= MAX_SAFE - MAX_FUTURE_MS) return {503, "RADIO_UNAVAILABLE"};
    auto &r = records[slot]; r = Record{}; r.used = true; r.request = request;
    r.target = request.patch.apply(desired); r.revision = ++revision; r.accepted_at = now;
    r.planned = static_cast<uint8_t>((request.patch.fields & POWER ? 1 : 0) + (request.patch.fields & ~POWER ? 1 : 0));
    active = slot; desired = r.target; desired_command = request.command; desired_at = now; source = origin;
    last_admission_ = now; has_admission_ = true; ++version;
    return {202, nullptr, slot};
  }
  // Returns the next frame command. Caller releases its lock, sends once, then calls complete_frame.
  uint8_t begin_frame(Time now) {
    if (active < 0) return 0;
    auto &r = records[active];
    if (now >= r.request.deadline) { finish(r.attempted ? Status::Failed : Status::Expired, r.attempted ? "DEADLINE_DURING_TX" : "DEADLINE_EXPIRED", now); return 0; }
    if (revision != r.revision) { finish(r.attempted ? Status::Failed : Status::Superseded, "CONTROL_SUPERSEDED", now); return 0; }
    if (pairing != Pairing::Ready || radio != Radio::Ready) { finish(Status::Failed, pairing != Pairing::Ready ? "PAIRING_REQUIRED" : "RADIO_UNAVAILABLE", now); return 0; }
    if (r.started && now - r.started_at >= 1000) { finish(Status::Failed, "TX_TIMEOUT", now); return 0; }
    if (!r.started) { r.started = true; r.started_at = now; r.status = Status::Executing; ++version; }
    if (!(r.request.patch.fields & ~POWER) || r.transmitted != 0) return 0x02;
    // The original controller's auto-dimming button sends command 0x06.
    const auto &patch = r.request.patch;
    return (patch.fields & AUTO_DIM) && patch.values.auto_dimming ? 0x06 : 0x03;
  }
  void complete_frame(const TxResult &tx, Time now) {
    if (active < 0) return;
    auto &r = records[active];
    r.diagnostics = tx.diagnostics; r.irq = tx.irq; r.fifo = tx.fifo; r.mode = tx.mode;
    if (tx.attempted) ++r.attempted;
    if (tx.sent && tx.attempted) ++r.transmitted;
    ++version;
    if (r.attempted && now >= r.request.deadline) finish(Status::Failed, "DEADLINE_DURING_TX", now);
    else if (!tx.sent || !tx.attempted) finish(Status::Failed, tx.error, now);
    else if (now - r.started_at >= 1000) finish(Status::Failed, "TX_TIMEOUT", now);
    else if (r.transmitted == r.planned) finish(Status::Transmitted, nullptr, now);
  }

 private:
  Time last_admission_{0};
  bool has_admission_{false};
  void finish(Status status, const char *error, Time now) {
    auto &r = records[active]; r.status = status; r.error = error; r.finished = true; r.finished_at = now;
    last = active; active = -1; ++version;
  }
};
}  // namespace halo2_protocol
