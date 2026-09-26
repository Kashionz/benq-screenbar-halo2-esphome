import unittest

RADIO_ADDRESS = bytes.fromhex("9C EA BB 86")
LEARNING_SYNC = bytes.fromhex("55 0F 0A")


def halo_crc(pcf: int, payload: bytes, address: bytes = RADIO_ADDRESS,
             seed: int = 0xEFDF) -> int:
    crc = seed
    for byte in (*reversed(address), pcf, *payload):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def extract_address_candidate(raw: bytes):
    if not 12 <= len(raw) <= 32:
        return None
    aligned = bytes((byte >> 1) | ((raw[i - 1] & 1) << 7 if i else 0)
                    for i, byte in enumerate(raw))
    if aligned[7] != 0xAA:
        return None
    return aligned[8:12][::-1]


def fifo_raw(aligned: bytes) -> bytes:
    """Encode a known aligned capture into BM5602's one-bit-offset FIFO form."""
    return bytes(((byte << 1) & 0xFF) | (aligned[i + 1] >> 7 if i + 1 < len(aligned) else 0)
                 for i, byte in enumerate(aligned))


def sample_capture(air_address=bytes.fromhex("86 BB EA 9C"), **changes):
    # Previous request used rear brightness 0A, so its CRC is 9FDA.
    aligned = bytearray(bytes.fromhex("01 02 9F DA AA AA AA AA") +
                        air_address + bytes.fromhex("54 04 10 0C"))
    for index, value in changes.items():
        aligned[int(index)] = value
    return fifo_raw(aligned)


class ProtocolVectors(unittest.TestCase):
    def test_stock_request(self):
        payload = bytes.fromhex("04 10 0C 0F 55 5B 0F 55 01 02")
        self.assertEqual(halo_crc(0x54, payload), 0x20B9)

    def test_direct_on(self):
        payload = bytes.fromhex("02 11 0C 0F 55 5B 0F 55 01 02")
        self.assertEqual(halo_crc(0x50, payload), 0xE962)

    def test_direct_off(self):
        payload = bytes.fromhex("02 10 0C 0F 55 5B 0F 55 01 02")
        self.assertEqual(halo_crc(0x50, payload), 0x0241)

    def test_learned_address_effective_crc_seed(self):
        address = bytes.fromhex("B0 1E E8 E6")
        payload = bytes.fromhex("04 09 16 0F 55 0A 0F 55 01 02")
        # Four CRCs copied from successive real learning captures.
        self.assertEqual(halo_crc(0x52, payload, address, 0xCC88), 0xCE90)
        self.assertEqual(halo_crc(0x54, payload, address, 0xCC88), 0x3F64)
        self.assertEqual(halo_crc(0x56, payload, address, 0xCC88), 0x9FD7)
        self.assertEqual(halo_crc(0x50, payload, address, 0xCC88), 0x6E23)
        self.assertNotEqual(halo_crc(0x52, payload, address), 0xCE90)
        web_off = bytes.fromhex("02 08 16 0F 55 0A 0F 55 01 02")
        web_on = bytes.fromhex("02 09 16 0F 55 0A 0F 55 01 02")
        self.assertEqual(halo_crc(0x54, web_off, address, 0xCC88), 0xA7F8)
        self.assertEqual(halo_crc(0x52, web_on, address, 0xCC88), 0xBD2F)

    def test_learning_sync_and_candidate_register_order(self):
        self.assertEqual(LEARNING_SYNC, bytes.fromhex("55 0F 0A"))
        self.assertEqual(halo_crc(0x54, bytes.fromhex("04 10 0C 0F 55 0A 0F 55 01 02")), 0x9FDA)
        self.assertEqual(extract_address_candidate(sample_capture()), RADIO_ADDRESS)

    def test_candidate_uses_on_air_to_register_reversal(self):
        air = bytes.fromhex("44 33 22 11")
        register = extract_address_candidate(sample_capture(air))
        self.assertEqual(register, bytes.fromhex("11 22 33 44"))
        self.assertEqual(register[::-1], air)
        self.assertNotEqual(halo_crc(0x50, bytes.fromhex("02 11 0C 0F 55 5B 0F 55 01 02"), register), 0xE962)

    def test_invalid_capture_rejected(self):
        self.assertIsNone(extract_address_candidate(sample_capture()[:11]))
        self.assertIsNone(extract_address_candidate(sample_capture() + bytes(17)))
        self.assertIsNone(extract_address_candidate(sample_capture(**{"7": 0})))

    def test_variable_fifo_length_and_unverified_fields(self):
        self.assertEqual(extract_address_candidate(sample_capture()[:12]), RADIO_ADDRESS)
        self.assertEqual(extract_address_candidate(sample_capture() + bytes(16)), RADIO_ADDRESS)
        self.assertEqual(extract_address_candidate(sample_capture(**{"0": 0, "1": 0,
                                                                         "12": 0, "13": 0, "15": 0})),
                         RADIO_ADDRESS)

    def test_five_matching_captures_required(self):
        votes = {}
        samples = [sample_capture(), sample_capture(bytes.fromhex("01 02 03 04")),
                   sample_capture(), sample_capture(), sample_capture(), sample_capture()]
        found = None
        for index, raw in enumerate(samples):
            address = extract_address_candidate(raw)
            votes[address] = votes.get(address, 0) + 1
            if votes[address] >= 5:
                found = address
            if index < 5:
                self.assertIsNone(found)
        self.assertEqual(votes[RADIO_ADDRESS], 5)
        self.assertEqual(found, RADIO_ADDRESS)


if __name__ == "__main__":
    unittest.main()
