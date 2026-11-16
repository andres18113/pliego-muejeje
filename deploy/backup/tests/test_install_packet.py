"""Release authentication and containment probes; never install or use root paths."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]


class InstallPacketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='pliego-packet-')
        self.root = Path(self.tmp.name)
        self.packet = self.root/'release'
        result = subprocess.run(['python3', str(KIT/'ops/packet.py'), 'build',
                                 '--output', str(self.packet)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.pin = json.loads(result.stdout)['manifest_sha256']

    def tearDown(self):
        self.tmp.cleanup()

    def verify(self, pin=None):
        return subprocess.run(['bash', str(KIT/'ops/install.sh'), '--release',
                               str(self.packet), '--manifest-sha256', pin or self.pin,
                               '--verify-only'], capture_output=True, text=True)

    def test_verified_packet_does_not_install_or_activate(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('packet_verified', result.stdout)
        self.assertFalse((self.packet/'install.json').exists())

    def test_wrong_independent_manifest_pin_refused(self):
        self.assertNotEqual(self.verify('0'*64).returncode, 0)

    def test_modified_helper_refused_before_execution(self):
        sentinel = self.root/'executed'
        (self.packet/'ops/packet.py').write_text('from pathlib import Path\nPath('+repr(str(sentinel))+').touch()\n')
        self.assertNotEqual(self.verify().returncode, 0)
        self.assertFalse(sentinel.exists())

    def test_unlisted_file_refused(self):
        (self.packet/'unlisted').write_text('extra')
        self.assertNotEqual(self.verify().returncode, 0)

    def test_symlink_payload_refused(self):
        target = self.packet/'backup.sh'
        content = target.read_bytes()
        target.unlink()
        external = self.root/'external'
        external.write_bytes(content)
        target.symlink_to(external)
        self.assertNotEqual(self.verify().returncode, 0)

    def test_even_pinned_manifest_cannot_escape_release_directory(self):
        manifest = self.packet/'SHA256SUMS'
        manifest.write_text(manifest.read_text()+'0'*64+'  ../external\n')
        pin = hashlib.sha256(manifest.read_bytes()).hexdigest()
        self.assertNotEqual(self.verify(pin).returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
