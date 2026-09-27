#include "../halo2_packet_diagnostics.h"
#include <cassert>
#include <iostream>

int main() {
  using namespace bm5602_halo2;
  PacketDiagnostics history;
  assert(history.last.json()=="{\"available\":false}");
  assert(history.failure.json()=="{\"available\":false}");
  PacketTrace failed;
  failed.stage=PacketTrace::Stage::Terminal;
  failed.result.attempted=true;
  failed.result.irq=0x1E;
  failed.result.fifo_status=0x01;
  failed.command=2; failed.control=1;
  failed.config_valid=true; failed.config[4]=5;
  failed.cleanup_valid=true; failed.cleanup_fifo=1;
  failed.rt2_after=0x10;
  failed.ack_config_valid=true;
  failed.ack_config={1,4,63};
  failed.address_match=false;
  history.record(failed,5000);
  const auto saved=history.failure.json();
  assert(history.failure.sequence==1);
  assert(saved.find("\"sent\":false")!=std::string::npos);
  assert(saved.find("\"stage\":\"terminal\"")!=std::string::npos);
  assert(saved.find("\"rt2\":[0,16]")!=std::string::npos);
  assert(saved.find("\"ack_config\":[1,4,63]")!=std::string::npos);
  assert(saved.find("\"address_match\":false")!=std::string::npos);
  PacketTrace passed;
  passed.stage=PacketTrace::Stage::Terminal;
  passed.result.attempted=true;
  passed.result.irq=0x2E; passed.result.fifo_status=0x11;
  history.record(passed,6000);
  assert(history.last.sequence==2);
  assert(history.last.trace.result.sent());
  assert(history.failure.json()==saved); // Success cannot erase a failure.
  assert(history.last.json().find("\"config_valid\":false")!=std::string::npos);
  assert(!history.last.trace.cleanup_valid); // No stale failure register data.
  assert(!history.last.trace.ack_config_valid && !history.last.trace.address_match);
  passed.ack_config_valid=true; passed.ack_config={1,4,63}; passed.address_match=true;
  PacketSnapshot matched{true,2,6000,passed};
  assert(matched.json().find("\"address_match\":true")!=std::string::npos);
  PacketTrace stuck;
  stuck.stage=PacketTrace::Stage::Flush; stuck.logic_recovery=true;
  history.record(stuck,7000);
  assert(history.failure.sequence==3);
  assert(!history.failure.trace.result.attempted);
  assert(!history.failure.trace.config_valid);
  assert(history.failure.trace.logic_recovery);
  // A newly booted bridge starts with no previous-boot evidence.
  history=PacketDiagnostics{};
  assert(!history.failure.valid && !history.last.valid);
  // Verify bounded output at the largest scalar/register values.
  failed.config.fill(255); failed.elapsed_us=UINT32_MAX;
  failed.ack_config.fill(255);
  history.last={true,UINT32_MAX,UINT64_MAX,failed};
  const auto large=history.last.json();
  assert(large.size()<768 && large.back()=='}');
  std::cout << "packet diagnostic retention tests passed\n";
}
