#include "../components/halo2_api/dispatcher.h"
#include <cassert>
#include <cstdio>
#include <iostream>
using namespace halo2_protocol;
static Dispatcher ready() {
  Dispatcher d; d.boot = make_id("22222222-2222-4222-8222-222222222222");
  d.configure(Radio::Ready, Pairing::Ready, true, true); return d;
}
static Request req(const Dispatcher &d, unsigned id, Time now, uint8_t fields = POWER) {
  Request r; char value[37]; std::snprintf(value, sizeof(value), "aaaaaaaa-aaaa-4aaa-8aaa-%012x", id);
  r.command = make_id(value); r.client = make_id("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  r.boot = d.boot; r.revision = d.revision; r.deadline = now + 4000; r.patch.fields = fields; r.patch.values.power = true; return r;
}
static const TxResult SENT{true, true, 0x2e, 0x11, 2, nullptr};
int main() {
  {
    auto d = ready(); auto r = req(d, 1, 100); auto a = d.admit(r, 100); assert(a.http == 202);
    const auto revision = d.revision; assert(d.begin_frame(101) == 2); d.complete_frame(SENT, 180);
    assert(d.records[a.index].status == Status::Transmitted && d.records[a.index].attempted == 1);
    assert(d.admit(r, 10000).http == 200 && d.revision == revision && d.active == -1);
    auto changed = r; ++changed.deadline; assert(std::strcmp(d.admit(changed, 10000).error, "COMMAND_ID_REUSED") == 0);
    changed = r; changed.patch.fields |= BACK; assert(d.admit(changed, 10000).http == 409);
    changed = r; changed.boot[0] = 'f'; assert(std::strcmp(d.admit(changed, 10000).error, "BOOT_CHANGED") == 0);
    auto next = req(d, 2, 11000); d.admit(next, 11000); d.begin_frame(11001); d.complete_frame(SENT, 11080);
    d.expire_results(40000); assert(d.find(r.command) == -1); assert(std::strcmp(d.admit(r, 40000).error, "DEADLINE_EXPIRED") == 0);
  }
  {
    auto d = ready(); auto r = req(d, 1, 100); d.admit(r, 100);
    auto old = r; old.command[0] = 'c'; assert(std::strcmp(d.admit(old, 100).error, "REVISION_CONFLICT") == 0);
    auto busy = req(d, 2, 100); assert(std::strcmp(d.admit(busy, 100).error, "BUSY") == 0);
    auto remote = d.desired; remote.power = false; d.observe(remote, 101);
    assert(d.begin_frame(102) == 0); assert(d.records[d.last].status == Status::Superseded);
    const auto rev = d.revision; d.observe(remote, 103); assert(d.revision == rev);
  }
  {
    auto d = ready(); d.admit(req(d, 1, 0), 0); assert(d.begin_frame(4000) == 0);
    assert(d.records[d.last].status == Status::Expired && d.records[d.last].attempted == 0);
    d.admit(req(d, 2, 5000, POWER | BACK), 5000); assert(d.begin_frame(5001) == 3); d.complete_frame(SENT, 5080);
    assert(d.begin_frame(5081) == 2); d.complete_frame({true, false, 0x1f, 0x21, 2, "TX_MAX_RETRIES"}, 5160);
    assert(d.records[d.last].attempted == 2 && d.records[d.last].transmitted == 1 && d.records[d.last].status == Status::Failed);
    d.admit(req(d, 3, 6000), 6000); d.begin_frame(6001); d.complete_frame({false, false, 0, 0x21, 2, "TX_FIFO_STUCK"}, 6080);
    assert(d.records[d.last].attempted == 0 && d.records[d.last].status == Status::Failed);
    d.admit(req(d, 4, 7000, POWER | MODE), 7000); d.begin_frame(7001); d.complete_frame(SENT, 7080);
    assert(d.begin_frame(11000) == 0 && std::strcmp(d.records[d.last].error, "DEADLINE_DURING_TX") == 0);
    auto deadline = req(d, 5, 12000); deadline.deadline = 12010; d.admit(deadline, 12000);
    d.begin_frame(12001); d.complete_frame({true, false, 0x0e, 0x01, 5, "TX_TIMEOUT"}, 12251);
    assert(std::strcmp(d.records[d.last].error, "DEADLINE_DURING_TX") == 0);
  }
  {
    // Auto-dimming: turning it on uses the controller's button command 0x06,
    // other patches keep it, and a manual brightness change ends it.
    auto d = ready(); auto on = req(d, 1, 100, AUTO_DIM); on.patch.values.auto_dimming = true;
    assert(d.admit(on, 100).http == 202 && d.desired.auto_dimming);
    assert(d.begin_frame(101) == 0x06); d.complete_frame(SENT, 180);
    assert(d.records[d.last].status == Status::Transmitted && d.records[d.last].planned == 1);
    auto temperature = req(d, 2, 1000, TEMPERATURE); temperature.patch.values.temperature = 4000;
    d.admit(temperature, 1000); assert(d.desired.auto_dimming && d.begin_frame(1001) == 0x03); d.complete_frame(SENT, 1080);
    auto power = req(d, 3, 2000); d.admit(power, 2000); assert(d.desired.auto_dimming && d.begin_frame(2001) == 0x02);
    d.complete_frame(SENT, 2080);
    auto front = req(d, 4, 3000, FRONT); front.patch.values.front = 40;
    d.admit(front, 3000); assert(!d.desired.auto_dimming && d.begin_frame(3001) == 0x03); d.complete_frame(SENT, 3080);
    auto both = req(d, 5, 4000, BACK | AUTO_DIM); both.patch.values.back = 30; both.patch.values.auto_dimming = true;
    d.admit(both, 4000); assert(d.desired.auto_dimming && d.begin_frame(4001) == 0x06); d.complete_frame(SENT, 4080);
    auto off = req(d, 6, 5000, AUTO_DIM); off.patch.values.auto_dimming = false;
    d.admit(off, 5000); assert(!d.desired.auto_dimming && d.begin_frame(5001) == 0x03); d.complete_frame(SENT, 5080);
    // An observed remote auto-dimming change is a real target change.
    auto remote = d.desired; remote.auto_dimming = true; const auto rev = d.revision;
    d.observe(remote, 6000); assert(d.revision == rev + 1 && d.desired.auto_dimming);
    d.supported = ALL & ~AUTO_DIM; auto refused = req(d, 7, 7000, AUTO_DIM);
    assert(std::strcmp(d.admit(refused, 7000).error, "UNSUPPORTED_FEATURE") == 0);
  }
  {
    auto d = ready(); assert(d.begin_maintenance()); assert(!d.begin_maintenance());
    assert(std::strcmp(d.admit(req(d, 1, 100), 100).error, "BUSY") == 0); d.end_maintenance();
    auto r = req(d, 1, 100); r.patch.fields |= TEMPERATURE; r.patch.values.temperature = 3926; assert(d.admit(r, 100).http == 422);
    r = req(d, 1, 100); d.supported &= ~POWER; assert(d.admit(r, 100).http == 422); d.supported = ALL;
    d.admit(r, 100); assert(!d.begin_maintenance()); d.begin_frame(101); d.complete_frame(SENT, 180);
    assert(std::strcmp(d.admit(req(d, 2, 200), 200).error, "RATE_LIMITED") == 0);
  }
  {
    auto d = ready();
    // Artificially fill an unexpired ledger to test capacity independently of pacing.
    for (auto &r : d.records) { r.used = true; r.finished = true; r.finished_at = 100; }
    assert(std::strcmp(d.admit(req(d, 1, 100), 100).error, "RESULT_BUFFER_FULL") == 0);
    assert(d.admit(req(d, 1, 30100), 30100).http == 202);
  }
  std::cout << "dispatcher scenarios passed; ledger bytes=" << sizeof(Dispatcher) << '\n';
}
