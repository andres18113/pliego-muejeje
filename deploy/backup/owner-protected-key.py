#!/usr/bin/env python3
"""Check v4 RSA exported secret packets are S2K-encrypted; print metadata only."""
from pathlib import Path
import sys


def check(data):
    cursor = 0
    secret = []
    while cursor < len(data):
        header = data[cursor]
        cursor += 1
        if not header & 0x80:
            raise ValueError('packet header')
        if header & 0x40:
            tag = header & 0x3f
            first = data[cursor]
            cursor += 1
            if first < 192:
                size = first
            elif first < 224:
                size = (first - 192) * 256 + data[cursor] + 192
                cursor += 1
            elif first == 255:
                size = int.from_bytes(data[cursor:cursor + 4], 'big')
                cursor += 4
            else:
                raise ValueError('partial packet unsupported for this export')
        else:
            tag = (header >> 2) & 15
            size_bytes = (1, 2, 4, 0)[header & 3]
            if not size_bytes:
                raise ValueError('indeterminate packet')
            size = int.from_bytes(data[cursor:cursor + size_bytes], 'big')
            cursor += size_bytes
        packet = data[cursor:cursor + size]
        if len(packet) != size:
            raise ValueError('truncated packet')
        cursor += size
        if tag not in (5, 7):
            continue
        if packet[0] != 4 or packet[5] not in (1, 2, 3):
            raise ValueError('expected v4 RSA')
        offset = 6
        for _ in range(2):  # RSA public n and e, then secret-key S2K usage octet.
            bits = int.from_bytes(packet[offset:offset + 2], 'big')
            offset += 2 + (bits + 7) // 8
        if packet[offset] not in (254, 255) or packet[offset + 1] not in (7, 8, 9):
            raise ValueError('secret packet is not AES passphrase-protected')
        if packet[offset + 2] != 3:
            raise ValueError('expected iterated and salted S2K')
        secret.append(tag)
    if sorted(secret) != [5, 7]:
        raise ValueError('expected exactly one primary and one encryption secret subkey')


if __name__ == '__main__':
    try:
        check(Path(sys.argv[1]).read_bytes())
        print('Protected export check PASS: primary + subkey; AES, iterated/salted S2K')
    except Exception:
        print('Protected export check FAILED; retain key home and stop ceremony.', file=sys.stderr)
        sys.exit(1)
