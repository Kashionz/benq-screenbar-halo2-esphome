#pragma once

// BenQ ScreenBar HALO 2 radio bridge for BM5602 + M5Stack ATOM Lite.
// Proven wiring: G22=CSN, G23=SCK, G19=SDIO/MOSI, G33=GIO2/MISO,
// G25=GIO3/TBCLK. The seventh TBCLK wire is required for direct TX.

#include <array>
#include <cstddef>
#include <cstdint>
#include "halo2_address_learning.h"
#include "driver/gpio.h"
#include "esp_rom_sys.h"
#include "esp_cpu.h"
#include "freertos/FreeRTOS.h"

namespace bm5602_halo2 {
constexpr gpio_num_t CSN=GPIO_NUM_22, SCK=GPIO_NUM_23;
constexpr gpio_num_t MOSI=GPIO_NUM_19, MISO=GPIO_NUM_33;
constexpr gpio_num_t TBCLK=GPIO_NUM_25; // BCT pin 9 / GIO3 after seventh wire
constexpr std::array<uint8_t,4> RADIO_ADDRESS{0x9C,0xEA,0xBB,0x86};
constexpr uint8_t RADIO_CHANNEL=5;
inline std::array<uint8_t,4> active_radio_address=RADIO_ADDRESS;
inline AddressVotes address_votes;
inline bool address_learning=false;
inline uint32_t learning_captures=0,learning_rejected=0;
inline uint32_t learning_session=0;
inline std::array<uint8_t,32> learning_last_raw{};
inline uint8_t learning_last_length=0;
inline uint32_t normal_rx_session=0;
inline uint32_t normal_rx_captures=0,normal_rx_rejected=0;
inline std::array<uint8_t,32> normal_rx_last_raw{};
inline uint8_t normal_rx_last_length=0;
inline uint16_t active_crc_seed=0xEFDF;
inline bool crc_seed_ready=true;
inline bool tx_pcf_prefix_zero=false;
inline CrcSeedVotes crc_seed_votes;
inline uint16_t normal_rx_last_seed=0;
inline uint8_t normal_rx_last_seed_votes=0;
inline bool normal_rx_seed_found_event=false;
inline uint8_t halo_app_pid=0;
inline std::array<uint8_t,13> captured_remote_off{};
inline bool captured_remote_off_valid=false;
inline bool captured_remote_off_event=false;
inline portMUX_TYPE tbclk_mux=portMUX_INITIALIZER_UNLOCKED;

inline void half() { esp_rom_delay_us(5); } // Pico reference uses 100 kHz SPI.
inline void begin() {
  gpio_set_direction(CSN,GPIO_MODE_OUTPUT); gpio_set_level(CSN,1);
  gpio_set_direction(SCK,GPIO_MODE_OUTPUT); gpio_set_level(SCK,0);
  gpio_set_direction(MOSI,GPIO_MODE_OUTPUT); gpio_set_level(MOSI,0);
  gpio_set_direction(MISO,GPIO_MODE_INPUT);
}
inline uint8_t xfer(uint8_t out) {
  uint8_t in=0;
  for(int i=7;i>=0;--i) {
    gpio_set_level(MOSI,(out>>i)&1U); half();
    gpio_set_level(SCK,1);
    in=static_cast<uint8_t>((in<<1U)|(gpio_get_level(MISO)&1U)); half();
    gpio_set_level(SCK,0);
  }
  return in;
}
inline void select(){gpio_set_level(CSN,0);half();}
inline void release(){half();gpio_set_level(CSN,1);gpio_set_level(SCK,0);}
inline void command(uint8_t cmd){select();xfer(cmd);release();}
inline void write_reg(uint8_t reg,uint8_t value){select();xfer(0x40U|reg);xfer(value);release();}
inline uint8_t read_reg(uint8_t reg){select();xfer(0xC0U|reg);uint8_t v=xfer(0);release();return v;}
inline std::array<uint8_t,3> version(){
  std::array<uint8_t,3> v{}; select();xfer(0x9F);for(auto &b:v)b=xfer(0);release();return v;
}
inline void write_bytes(uint8_t cmd,const uint8_t *p,size_t n){select();xfer(cmd);for(size_t i=0;i<n;++i)xfer(p[i]);release();}
inline void read_bytes(uint8_t cmd,uint8_t *p,size_t n){select();xfer(cmd);for(size_t i=0;i<n;++i)p[i]=xfer(0);release();}
inline void set_bank(uint8_t bank){write_reg(0x00,static_cast<uint8_t>((read_reg(0x00)&0xFCU)|(bank&3U)));}

inline std::array<uint8_t,3> setup_exact_pico(const std::array<uint8_t,4>& address,uint8_t channel=5){
  begin();
  // First transaction is write-only and works before GIO2 becomes SDO.
  write_reg(0x06,0x48); // PADDS=01, GIO2S=001: 4-wire SPI SDO.
  command(0x0C);        // Light sleep, exactly like Pico reference.
  esp_rom_delay_us(1000);
  auto v=version();
  // Literal Pico lifecycle: no software reset during normal initialization.
  // Hidden packet/PID/RF state is allowed to continue from hardware POR.
  set_bank(0);
  write_reg(0x03,static_cast<uint8_t>(read_reg(0x03)|0x01U)); // PRM_RX initially 1.
  const uint8_t rc1=read_reg(0x01);
  if(rc1&0x80U) write_reg(0x01,static_cast<uint8_t>(rc1&0x7FU));

  command(0x0C);
  write_reg(0x06,0x48);
  write_reg(0x10,channel);
  write_reg(0x11,0x82); // 125 kbps, 4-byte address.
  write_bytes(0x10,address.data(),address.size());
  write_reg(0x03,static_cast<uint8_t>(read_reg(0x03)&0xFEU)); // PTX / PRM_RX=0.
  write_reg(0x2A,0x01); // Dynamic payload pipe 0.
  write_reg(0x2B,0x04); // Exact Pico reference: EN_DPL only.
  write_reg(0x09,0x20); // CRC enabled, Pico exact value.
  write_reg(0x32,0x3F); // Auto-ACK all pipes.
  write_reg(0x13,0x72); // 2 ms, 2 retransmissions.
  return v;
}

inline uint8_t send_no_ack(const uint8_t *payload,size_t n){
  command(0x0C);
  write_reg(0x04,0x70);
  command(0x09);
  esp_rom_delay_us(1000);
  write_bytes(0x13,payload,n); // W_TX_PAYLD_NO_ACK; requires DPL2.EN_DYN_ACK
  command(0x0E);
  esp_rom_delay_us(7000);
  return read_reg(0x05);
}

inline void prepare_halo_receive(){
  command(0x0C); write_reg(0x06,0x48); set_bank(0);
  write_reg(0x10,RADIO_CHANNEL); write_reg(0x11,0x82);
  write_bytes(0x10,active_radio_address.data(),active_radio_address.size());
  write_reg(0x03,static_cast<uint8_t>(read_reg(0x03)|0x01U)); // PRX
  write_reg(0x2A,0x00); write_reg(0x2B,0x00); write_reg(0x2C,14);
  write_reg(0x09,0x00); write_reg(0x32,0x00); // passive: CRC/AutoACK off
  command(0x89); write_reg(0x04,0x40); command(0x8E);
}

inline void start_address_learning(){
  address_votes.reset(); address_learning=true;
  ++learning_session;
  learning_captures=0; learning_rejected=0;
  learning_last_raw={}; learning_last_length=0;
  command(0x0C); write_reg(0x06,0x48); set_bank(0);
  write_reg(0x10,RADIO_CHANNEL);
  write_reg(0x11,0x42); // 125 kbps and 3-byte sync address.
  write_bytes(0x10,LEARNING_SYNC.data(),LEARNING_SYNC.size());
  write_reg(0x03,static_cast<uint8_t>(read_reg(0x03)|0x01U));
  write_reg(0x2A,0x00); write_reg(0x2B,0x00); write_reg(0x2C,16);
  write_reg(0x09,0x00); write_reg(0x32,0x00); // passive, CRC and ACK disabled
  command(0x89); write_reg(0x04,0x40); command(0x8E);
}

inline void stop_address_learning(){
  address_learning=false;
  prepare_halo_receive();
}

inline AddressVotes::Result poll_address_learning(){
  if(!address_learning || (read_reg(0x05)&0x01U))return {};
  ++learning_captures;
  const uint8_t length=read_reg(0x0C);
  std::array<uint8_t,32> raw{};
  if(length && length<=raw.size())read_bytes(0xBF,raw.data(),length);
  command(0x89); write_reg(0x04,0x40); command(0x8E);
  learning_last_raw=raw; learning_last_length=length;
  const auto candidate=extract_address_candidate(raw.data(),length);
  if(!candidate.valid)++learning_rejected;
  return address_votes.add(candidate);
}

inline bool apply_found_address(){
  if(!address_votes.found())return false;
  active_radio_address=address_votes.address();
  ++normal_rx_session;
  normal_rx_captures=0; normal_rx_rejected=0;
  normal_rx_last_raw={}; normal_rx_last_length=0;
  active_crc_seed=0xEFDF;
  crc_seed_ready=(active_radio_address==RADIO_ADDRESS);
  tx_pcf_prefix_zero=false;
  crc_seed_votes.reset();
  normal_rx_last_seed=0; normal_rx_last_seed_votes=0;
  normal_rx_seed_found_event=false;
  halo_app_pid=0;
  captured_remote_off={}; captured_remote_off_valid=false;
  captured_remote_off_event=false;
  stop_address_learning();
  return true;
}

inline uint16_t halo_crc(uint8_t pcf,const uint8_t* payload,size_t length){
  // The CRC state before the four on-air address bytes is pair-specific.
  uint16_t crc=active_crc_seed;
  auto feed=[&](uint8_t b){
    crc^=static_cast<uint16_t>(b)<<8U;
    for(int i=0;i<8;++i)crc=(crc&0x8000U)
      ?static_cast<uint16_t>((crc<<1U)^0x1021U)
      :static_cast<uint16_t>(crc<<1U);
  };
  for(size_t i=active_radio_address.size();i>0;--i)feed(active_radio_address[i-1]);
  feed(pcf); for(size_t i=0;i<length;++i)feed(payload[i]); return crc;
}

struct HaloRxState {
  bool valid=false,power=false,pir=false,front=false,back=false;
  uint8_t command=0,front_brightness=0,back_brightness=0,pcf=0;
  uint16_t color_temperature=0;
};
inline bool poll_halo_receive(HaloRxState& s){
  normal_rx_last_seed_votes=0;
  normal_rx_seed_found_event=false;
  captured_remote_off_event=false;
  if(read_reg(0x05)&0x01U)return false;
  if(normal_rx_session)++normal_rx_captures;
  const uint8_t length=read_reg(0x0C);
  std::array<uint8_t,32> raw{};
  if(normal_rx_session){normal_rx_last_length=length;normal_rx_last_raw={};}
  if(!length||length>24){
    if(normal_rx_session)++normal_rx_rejected;
    command(0x89);command(0x8E);return false;
  }
  read_bytes(0xBF,raw.data(),length);
  write_reg(0x04,0x40); command(0x8E);
  if(normal_rx_session)normal_rx_last_raw=raw;
  std::array<uint8_t,13> frame{};
  if(!align_normal_rx(raw.data(),length,frame) ||
     (frame[0]&0xF8U)!=0x50U || frame[1]>0x05 ||
     frame[9]!=0x01 || frame[10]!=0x02){
    if(normal_rx_session)++normal_rx_rejected;
    return false;
  }
  const uint8_t control=frame[2];
  const uint8_t mode=static_cast<uint8_t>((control&0x18U)>>3U);
  const uint16_t temperature=static_cast<uint16_t>((frame[4]<<8U)|frame[5]);
  if(mode>2||frame[3]<1||frame[3]>100||frame[6]<1||frame[6]>100||
     temperature<2700||temperature>6500){
    if(normal_rx_session)++normal_rx_rejected;
    return false;
  }
  const uint16_t received_crc=static_cast<uint16_t>((frame[11]<<8U)|frame[12]);
  if(!crc_seed_ready){
    const uint16_t candidate=recover_crc_seed(received_crc,active_radio_address,
                                               frame[0],frame.data()+1,10);
    const auto vote=crc_seed_votes.add(candidate);
    if(vote.accepted){
      normal_rx_last_seed=candidate;
      normal_rx_last_seed_votes=vote.votes;
    }
    if(vote.found){
      active_crc_seed=candidate;
      tx_pcf_prefix_zero=(crc_with_zero_before_pcf(active_radio_address,
        frame[0],frame.data()+1,10)==received_crc);
      crc_seed_ready=true;
      normal_rx_seed_found_event=true;
    }
  }
  if(!crc_seed_ready)return false;
  const uint16_t expected_crc=halo_crc(frame[0],frame.data()+1,10);
  if(expected_crc!=received_crc){
    if(normal_rx_session)++normal_rx_rejected;
    return false;
  }
  // Odd PIDs are lamp replies; their control byte is not authoritative state.
  if(frame[0]&0x01U){
    if(normal_rx_session)++normal_rx_rejected;
    return false;
  }
  if(frame[1]==0x02 && !(control&0x01U) && !captured_remote_off_valid){
    captured_remote_off=frame;
    captured_remote_off_valid=true;
    captured_remote_off_event=true;
  }
  s.pcf=frame[0];s.command=frame[1];
  s.power=control&1U;s.pir=control&0x20U;
  s.front=(mode==0||mode==2);s.back=(mode==1||mode==2);
  s.front_brightness=frame[3];s.color_temperature=temperature;
  s.back_brightness=frame[6];s.valid=true;return true;
}


inline void append_byte(std::array<uint8_t,256>& bits,size_t& n,uint8_t v){
  for(int i=7;i>=0;--i)bits[n++]=(v>>i)&1U;
}

inline bool wait_clock_edge(int target_level,uint32_t timeout_cycles=2400000){
  const uint32_t start=esp_cpu_get_cycle_count();
  while(gpio_get_level(TBCLK)==target_level)
    if(static_cast<uint32_t>(esp_cpu_get_cycle_count()-start)>timeout_cycles)return false;
  while(gpio_get_level(TBCLK)!=target_level)
    if(static_cast<uint32_t>(esp_cpu_get_cycle_count()-start)>timeout_cycles)return false;
  return true;
}

// Clock-synchronous direct replay. update_level chooses which TBCLK edge
// changes data; BM samples it on the opposite edge. Both phases are exposed
// because the public datasheet omits the direct-mode timing diagram.
inline bool send_direct_stock_clocked(int update_level,bool invert=false,
                                      bool reverse_air=false,bool lsb_first=false,
                                      const uint8_t* payload_override=nullptr,
                                      uint8_t pcf=0x54,
                                      uint8_t channel=RADIO_CHANNEL){
  setup_exact_pico(active_radio_address,channel);
  gpio_set_direction(TBCLK,GPIO_MODE_INPUT);
  set_bank(2); write_reg(0x34,0xAF); write_reg(0x35,0x21);
  set_bank(0); write_reg(0x38,0x15); write_reg(0x20,0x08);
  for(int i=0;i<200 && (read_reg(0x20)&0x08U);++i)esp_rom_delay_us(100);
  write_reg(0x07,0x08); // GIO3 selector 8 = TBCLK_OUTPUT.
  write_reg(0x06,0x58); // GIO2 selector 3 = DIRECT_TXD.
  write_reg(0x00,0x50); // AGC + DIR_EN.

  std::array<uint8_t,256> bits{}; size_t n=0;
  auto add=[&](uint8_t v){
    if(lsb_first)for(int i=0;i<8;++i)bits[n++]=(v>>i)&1U;
    else append_byte(bits,n,v);
  };
  // Extra alternating symbols let the receiver settle before the address.
  add(0xAA); add(0xAA); add(0xAA); add(0xAA);
  if(reverse_air)for(uint8_t b:active_radio_address)add(b);
  else for(size_t i=active_radio_address.size();i>0;--i)add(active_radio_address[i-1]);
  // Learned 9-bit PCF framing requires a zero bit before the canonical PCF.
  // The original validated pair uses the legacy eight-bit direct frame.
  if(tx_pcf_prefix_zero)bits[n++]=0;
  add(pcf);
  const uint8_t stock_payload[10]{0x04,0x10,0x0C,0x0F,0x55,0x5B,0x0F,0x55,0x01,0x02};
  const uint8_t* payload=payload_override?payload_override:stock_payload;
  for(size_t i=0;i<10;++i)add(payload[i]);
  const uint16_t crc=halo_crc(pcf,payload,10);
  add(static_cast<uint8_t>(crc>>8U)); add(static_cast<uint8_t>(crc));

  gpio_set_direction(MISO,GPIO_MODE_OUTPUT); gpio_set_level(MISO,bits[0]^invert);
  write_reg(0x20,0x03); esp_rom_delay_us(50); write_reg(0x20,0x07);
  bool ok=true;
  taskENTER_CRITICAL(&tbclk_mux);
  if(!wait_clock_edge(update_level)) ok=false;
  for(size_t i=1;ok && i<n;++i){
    if(!wait_clock_edge(update_level^1)){ok=false;break;}
    if(!wait_clock_edge(update_level)){ok=false;break;}
    gpio_set_level(MISO,bits[i]^invert);
  }
  if(ok)ok=wait_clock_edge(update_level^1);
  taskEXIT_CRITICAL(&tbclk_mux);

  gpio_set_level(MISO,0); write_reg(0x20,0x03); esp_rom_delay_us(20); write_reg(0x20,0x00);
  gpio_set_direction(MISO,GPIO_MODE_INPUT); write_reg(0x06,0x48); write_reg(0x07,0x00); write_reg(0x00,0x40);
  return ok;
}

inline uint8_t halo_last_pcf=0;
inline uint16_t halo_last_crc=0;
inline bool halo_last_tx_packet_engine=false;
inline uint8_t halo_last_tx_irq=0;
inline uint8_t halo_last_tx_fifo_status=0;

struct PacketEngineResult {
  uint8_t irq=0;
  uint8_t fifo_status=0;
  uint8_t mode=0;
  bool attempted=false;
  bool sent() const { return attempted && (irq&0x20U) && !(irq&0x10U) && (fifo_status&0x10U); }
};

inline PacketEngineResult send_packet_engine(const uint8_t* payload,size_t length){
  PacketEngineResult result;
  if(address_learning||!crc_seed_ready||!tx_pcf_prefix_zero||
     !payload||length==0||length>32)return result;
  setup_exact_pico(active_radio_address,RADIO_CHANNEL);
  command(0x09); // Flush TX FIFO.
  write_reg(0x04,0x70); // Clear TX_DS, MAX_RT and RX_DR.
  write_bytes(0x11,payload,length); // Hardware 9-bit PCF and CRC, with ACK.
  result.attempted=true;
  command(0x0E); // Trigger TX, including configured hardware retries.
  esp_rom_delay_us(10000);
  result.irq=read_reg(0x04);
  result.fifo_status=read_reg(0x05);
  result.mode=read_reg(0x26)&0x07U;
  prepare_halo_receive();
  return result;
}

inline bool send_halo_state(uint8_t command,bool power,bool pir,bool front,bool back,
                            uint8_t front_brightness,uint8_t back_brightness,
                            uint16_t color_temperature){
  if(address_learning||!crc_seed_ready)return false;
  uint8_t lamp_mode=0;
  if(front && back)lamp_mode=2;
  else if(back)lamp_mode=1;
  else lamp_mode=0;
  const uint8_t control=static_cast<uint8_t>((pir?0x20U:0U)|(lamp_mode<<3U)|(power?1U:0U));
  const uint8_t payload[10]{command,control,front_brightness,
    static_cast<uint8_t>(color_temperature>>8U),static_cast<uint8_t>(color_temperature),
    back_brightness,static_cast<uint8_t>(color_temperature>>8U),
    static_cast<uint8_t>(color_temperature),0x01,0x02};
  if(tx_pcf_prefix_zero){
    const auto result=send_packet_engine(payload,sizeof(payload));
    halo_last_tx_packet_engine=true;
    halo_last_tx_irq=result.irq;
    halo_last_tx_fifo_status=result.fifo_status;
    return result.sent();
  }
  halo_last_tx_packet_engine=false;
  halo_last_tx_irq=0;
  halo_last_tx_fifo_status=0;
  halo_last_pcf=static_cast<uint8_t>(0x50U|((halo_app_pid++&3U)<<1U));
  halo_last_crc=halo_crc(halo_last_pcf,payload,sizeof(payload));
  const bool ok=send_direct_stock_clocked(0,false,false,false,payload,halo_last_pcf);
  prepare_halo_receive();
  return ok;
}

inline bool replay_captured_remote_off(int update_level=0,bool invert=false,
                                       bool fresh_pcf=false,uint8_t channel=RADIO_CHANNEL){
  if(address_learning||!crc_seed_ready||!captured_remote_off_valid)return false;
  const auto &frame=captured_remote_off;
  const uint16_t captured_crc=static_cast<uint16_t>((frame[11]<<8U)|frame[12]);
  if(halo_crc(frame[0],frame.data()+1,10)!=captured_crc)return false;
  halo_last_pcf=frame[0];
  if(fresh_pcf){
    halo_last_pcf=static_cast<uint8_t>(0x50U|((halo_app_pid++&3U)<<1U));
    if(halo_last_pcf==frame[0])
      halo_last_pcf=static_cast<uint8_t>(0x50U|((halo_app_pid++&3U)<<1U));
  }
  halo_last_crc=fresh_pcf?halo_crc(halo_last_pcf,frame.data()+1,10):captured_crc;
  const bool ok=send_direct_stock_clocked(update_level,invert,false,false,
                                          frame.data()+1,halo_last_pcf,channel);
  prepare_halo_receive();
  return ok;
}

inline PacketEngineResult send_captured_off_packet_engine(){
  PacketEngineResult result;
  if(address_learning||!crc_seed_ready||!captured_remote_off_valid||
     !tx_pcf_prefix_zero)return result;
  const auto &frame=captured_remote_off;
  const uint16_t captured_crc=static_cast<uint16_t>((frame[11]<<8U)|frame[12]);
  if(halo_crc(frame[0],frame.data()+1,10)!=captured_crc)return result;
  return send_packet_engine(frame.data()+1,10);
}

} // namespace bm5602_halo2
