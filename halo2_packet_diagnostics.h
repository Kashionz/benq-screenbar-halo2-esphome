#pragma once
#include <array>
#include <cstdint>
#include <cstdio>
#include <string>

namespace bm5602_halo2 {
struct PacketEngineResult {
  uint8_t irq=0, fifo_status=0, mode=0;
  uint8_t fifo_before_flush=0, fifo_after_flush=0, fifo_after_write=0;
  bool attempted=false;
  bool sent() const { return attempted && (irq&0x20U) && !(irq&0x10U) && (fifo_status&0x10U); }
};

struct PacketTrace {
  PacketEngineResult result;
  // A stage also identifies which readings exist; zero is a valid register value.
  enum class Stage { Guard, Flush, Queue, Terminal } stage{Stage::Guard};
  uint8_t command=0, control=0, irq_before=0, rt2_before=0, rt2_after=0;
  uint32_t elapsed_us=0;
  bool logic_recovery=false, config_valid=false, cleanup_valid=false;
  std::array<uint8_t,8> config{}; // CFG, RC1, MASK, PKT, RFCH, DM1, RT1, CE
  uint8_t cleanup_fifo=0, cleanup_rc1=0;
  bool ack_config_valid=false, address_match=false;
  std::array<uint8_t,3> ack_config{}; // DPL1, DPL2, ENAA; post-terminal readback
};

struct PacketSnapshot {
  bool valid=false;
  uint32_t sequence=0;
  uint64_t uptime_ms=0;
  PacketTrace trace;
  std::string json() const {
    if(!valid)return "{\"available\":false}";
    const auto &t=trace; const auto &r=t.result;
    const char *stage=t.stage==PacketTrace::Stage::Guard?"guard":
      t.stage==PacketTrace::Stage::Flush?"flush":t.stage==PacketTrace::Stage::Queue?"queue":"terminal";
    char text[768];
    std::snprintf(text,sizeof(text),
      "{\"available\":true,\"seq\":%u,\"uptime_ms\":%llu,\"stage\":\"%s\","
      "\"cmd\":%u,\"control\":%u,\"attempted\":%s,\"sent\":%s,"
      "\"irq\":%u,\"fifo\":%u,\"mode\":%u,\"fifo_steps\":[%u,%u,%u],"
      "\"irq_before\":%u,\"rt2\":[%u,%u],\"elapsed_us\":%u,\"logic_recovery\":%s,"
      "\"config_valid\":%s,\"config\":[%u,%u,%u,%u,%u,%u,%u,%u],"
      "\"cleanup_valid\":%s,\"cleanup_fifo\":%u,\"cleanup_rc1\":%u,"
      "\"ack_config_valid\":%s,\"ack_config\":[%u,%u,%u],\"address_match\":%s}",
      static_cast<unsigned>(sequence),static_cast<unsigned long long>(uptime_ms),stage,
      t.command,t.control,r.attempted?"true":"false",r.sent()?"true":"false",
      r.irq,r.fifo_status,r.mode,r.fifo_before_flush,r.fifo_after_flush,r.fifo_after_write,
      t.irq_before,t.rt2_before,t.rt2_after,static_cast<unsigned>(t.elapsed_us),t.logic_recovery?"true":"false",
      t.config_valid?"true":"false",t.config[0],t.config[1],t.config[2],t.config[3],
      t.config[4],t.config[5],t.config[6],t.config[7],t.cleanup_valid?"true":"false",t.cleanup_fifo,t.cleanup_rc1,
      t.ack_config_valid?"true":"false",t.ack_config[0],t.ack_config[1],t.ack_config[2],t.address_match?"true":"false");
    return text;
  }
};

struct PacketDiagnostics {
  PacketSnapshot last, failure;
  void record(const PacketTrace &trace,uint64_t uptime_ms) {
    last={true,last.sequence+1,uptime_ms,trace};
    if(!trace.result.sent())failure=last;
  }
};
} // namespace bm5602_halo2
