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
  // Capture the idle radio before setup_exact_pico changes mode/configuration.
  bool pre_init_valid=false, pre_init_mode_valid=false;
  std::array<uint8_t,7> pre_init{}; // CFG, RC1, IRQ, FIFO, CE, RFCH, bank-0 STA1
  bool init_fifo_valid=false;
  // First setup only: sleep, PRX, address, PTX, DPL1, DPL2, CRC, ACK/retries.
  std::array<uint8_t,8> init_fifo{};
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
    char text[1024];
    std::snprintf(text,sizeof(text),
      "{\"available\":true,\"seq\":%u,\"uptime_ms\":%llu,\"stage\":\"%s\","
      "\"cmd\":%u,\"control\":%u,\"attempted\":%s,\"sent\":%s,"
      "\"irq\":%u,\"fifo\":%u,\"mode\":%u,\"fifo_steps\":[%u,%u,%u],"
      "\"irq_before\":%u,\"rt2\":[%u,%u],\"elapsed_us\":%u,\"logic_recovery\":%s,"
      "\"config_valid\":%s,\"config\":[%u,%u,%u,%u,%u,%u,%u,%u],"
      "\"cleanup_valid\":%s,\"cleanup_fifo\":%u,\"cleanup_rc1\":%u,"
      "\"ack_config_valid\":%s,\"ack_config\":[%u,%u,%u],\"address_match\":%s,"
      "\"pre_init_valid\":%s,\"pre_init_mode_valid\":%s,\"pre_init\":[%u,%u,%u,%u,%u,%u,%u],"
      "\"init_fifo_valid\":%s,\"init_fifo\":[%u,%u,%u,%u,%u,%u,%u,%u]}",
      static_cast<unsigned>(sequence),static_cast<unsigned long long>(uptime_ms),stage,
      t.command,t.control,r.attempted?"true":"false",r.sent()?"true":"false",
      r.irq,r.fifo_status,r.mode,r.fifo_before_flush,r.fifo_after_flush,r.fifo_after_write,
      t.irq_before,t.rt2_before,t.rt2_after,static_cast<unsigned>(t.elapsed_us),t.logic_recovery?"true":"false",
      t.config_valid?"true":"false",t.config[0],t.config[1],t.config[2],t.config[3],
      t.config[4],t.config[5],t.config[6],t.config[7],t.cleanup_valid?"true":"false",t.cleanup_fifo,t.cleanup_rc1,
      t.ack_config_valid?"true":"false",t.ack_config[0],t.ack_config[1],t.ack_config[2],t.address_match?"true":"false",
      t.pre_init_valid?"true":"false",t.pre_init_mode_valid?"true":"false",
      t.pre_init[0],t.pre_init[1],t.pre_init[2],t.pre_init[3],t.pre_init[4],t.pre_init[5],t.pre_init[6],
      t.init_fifo_valid?"true":"false",t.init_fifo[0],t.init_fifo[1],t.init_fifo[2],t.init_fifo[3],
      t.init_fifo[4],t.init_fifo[5],t.init_fifo[6],t.init_fifo[7]);
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

// Control byte bits the bridge decodes: power (bit 0), lamp mode (bits 4:3)
// and ultrasonic presence (bit 5). Anything else is not yet understood.
constexpr uint8_t KNOWN_CONTROL_BITS=0x39;

// One passive-RX capture and why it was or was not taken as remote state.
// Kept so undecoded controller features (such as auto-dimming) can be
// identified from logs. The frame never contains the pairing address.
struct RxFrameTrace {
  enum class Verdict { Length, Shape, Range, SeedLearning, Crc, LampReply, Accepted };
  Verdict verdict{Verdict::Length};
  uint8_t length=0;
  std::array<uint8_t,13> frame{}; // PCF, ten payload bytes, CRC; raw bytes on Length
  bool event=false;
  std::string line() const {
    static const char *names[]{"length","shape","range","seed-learning","crc","lamp-reply","accepted"};
    char bytes[13*3]{};
    size_t used=0;
    for(size_t i=0;i<frame.size();++i)
      used+=std::snprintf(bytes+used,sizeof(bytes)-used,"%02X%s",frame[i],i+1<frame.size()?" ":"");
    char text[128];
    std::snprintf(text,sizeof(text),"verdict=%s len=%u CMD=%02X CONTROL=%02X UNKNOWN_BITS=%02X frame=%s",
      names[static_cast<int>(verdict)],length,frame[1],frame[2],
      static_cast<unsigned>(frame[2]&~KNOWN_CONTROL_BITS)&0xFFU,bytes);
    return text;
  }
};
} // namespace bm5602_halo2
