#include "../halo2_address_learning.h"

#include <array>
#include <cassert>
#include <cstdint>

using bm5602_halo2::AddressVotes;
using bm5602_halo2::CrcSeedVotes;
using bm5602_halo2::align_normal_rx;
using bm5602_halo2::crc_with_zero_before_pcf;
using bm5602_halo2::extract_address_candidate;
using bm5602_halo2::recover_crc_seed;

static std::array<uint8_t, 16> fifo_from_aligned(std::array<uint8_t, 16> aligned) {
  std::array<uint8_t, 16> raw{};
  for (size_t i = 0; i < raw.size(); ++i) {
    raw[i] = static_cast<uint8_t>((aligned[i] << 1U) |
        (i + 1 < raw.size() ? aligned[i + 1] >> 7U : 0U));
  }
  return raw;
}

int main() {
  // Previous request: rear brightness 0A, 3925 K, tail 01 02, CRC 9FDA.
  // Next repeated request: preamble AA, air address 86 BB EA 9C.
  const std::array<uint8_t, 16> aligned{
      0x01, 0x02, 0x9F, 0xDA, 0xAA, 0xAA, 0xAA, 0xAA,
      0x86, 0xBB, 0xEA, 0x9C, 0x54, 0x04, 0x10, 0x0C};
  const auto raw = fifo_from_aligned(aligned);
  const auto candidate = extract_address_candidate(raw.data(), raw.size());
  assert(candidate.valid);
  assert((candidate.register_order == std::array<uint8_t, 4>{0x9C, 0xEA, 0xBB, 0x86}));
  assert(extract_address_candidate(raw.data(), 12).valid);
  assert(!extract_address_candidate(raw.data(), 11).valid);
  assert(!extract_address_candidate(raw.data(), 33).valid);
  assert(!extract_address_candidate(nullptr, raw.size()).valid);

  auto invalid = aligned;
  invalid[7] = 0;
  assert(!extract_address_candidate(fifo_from_aligned(invalid).data(), 16).valid);
  auto variable_tail = aligned;
  variable_tail[0] = 0;
  variable_tail[12] = 0;
  assert(extract_address_candidate(fifo_from_aligned(variable_tail).data(), 16).valid);

  AddressVotes votes;
  auto noise = candidate;
  noise.register_order = {0x11, 0x22, 0x33, 0x44};
  assert(votes.add(noise).votes == 1);
  for (uint8_t i = 1; i <= 5; ++i) {
    const auto result = votes.add(candidate);
    assert(result.accepted);
    assert(result.votes == i);
    assert(result.found == (i == 5));
  }
  assert(votes.found());
  assert(votes.address() == candidate.register_order);
  votes.reset();
  assert(!votes.found());

  // User's BM5602 FIFO is shifted one bit. The 14th byte supplies the
  // otherwise missing low bit of the CRC (E72D here).
  const std::array<uint8_t, 14> normal_raw{
      0x2A, 0x82, 0x04, 0x8B, 0x07, 0xAA, 0x85,
      0x07, 0xAA, 0x80, 0x81, 0x73, 0x96, 0x80};
  std::array<uint8_t, 13> frame{};
  assert(align_normal_rx(normal_raw.data(), normal_raw.size(), frame));
  assert((frame == std::array<uint8_t, 13>{
      0x55, 0x04, 0x09, 0x16, 0x0F, 0x55, 0x0A,
      0x0F, 0x55, 0x01, 0x02, 0xE7, 0x2D}));
  assert(!align_normal_rx(normal_raw.data(), 13, frame));
  const std::array<uint8_t, 4> learned_address{0xB0, 0x1E, 0xE8, 0xE6};
  assert(recover_crc_seed(0xE72D, learned_address, 0x55,
                          frame.data() + 1, 10) == 0xCC88);
  assert(recover_crc_seed(0xCE90, learned_address, 0x52,
                          frame.data() + 1, 10) == 0xCC88);
  // The same observed CRCs use 0xFFFF when the missing ninth PCF bit is
  // modeled as a zero before the canonical eight-bit PCF representation.
  const std::array<std::array<uint16_t, 2>, 4> crc_vectors{{
      {0x52, 0xCE90}, {0x54, 0x3F64}, {0x56, 0x9FD7}, {0x50, 0x6E23}}};
  for (const auto &vector : crc_vectors) {
    assert(crc_with_zero_before_pcf(learned_address,
                                    static_cast<uint8_t>(vector[0]),
                                    frame.data() + 1, 10) == vector[1]);
  }
  const std::array<uint8_t, 10> captured_off{
      0x02, 0x08, 0x16, 0x0F, 0x55, 0x0A, 0x0F, 0x55, 0x01, 0x02};
  assert(crc_with_zero_before_pcf(learned_address, 0x54,
                                  captured_off.data(), captured_off.size()) == 0xA7F8);
  auto web_on = captured_off;
  web_on[1] = 0x09;
  assert(crc_with_zero_before_pcf(learned_address, 0x52,
                                  web_on.data(), web_on.size()) == 0xBD2F);
  const std::array<uint8_t, 4> old_address{0x9C, 0xEA, 0xBB, 0x86};
  const std::array<uint8_t, 10> old_request{
      0x04, 0x10, 0x0C, 0x0F, 0x55, 0x5B, 0x0F, 0x55, 0x01, 0x02};
  assert(crc_with_zero_before_pcf(old_address, 0x54,
                                  old_request.data(), old_request.size()) != 0x20B9);

  CrcSeedVotes seed_votes;
  assert(seed_votes.add(0xEFDF).votes == 1);
  for (uint8_t i = 1; i <= 5; ++i) {
    const auto result = seed_votes.add(0xCC88);
    assert(result.accepted);
    assert(result.votes == i);
    assert(result.found == (i == 5));
  }
  assert(seed_votes.found() && seed_votes.seed() == 0xCC88);
}
