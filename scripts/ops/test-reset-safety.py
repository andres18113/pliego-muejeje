"""Local regression checks for the operator recipe and helper environment.

No PostgreSQL server is started. Production recipe commands are shell stubs;
its input files and lock live in a temporary directory. Requires the built JAR
only because the rehearsal freezes it during initialization.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


class ResetSafetyTest(unittest.TestCase):
    def test_helpers_inherit_only_sanitized_environment(self):
        spec = importlib.util.spec_from_file_location('reset_rehearsal', HERE / 'rehearse-reset.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = os.environ.copy()
        driver = None
        try:
            # A different loopback address/proxy: this test never connects to it.
            os.environ.update(PGHOSTADDR='127.0.0.2', PGSERVICE='not-a-service',
                              PGOPTIONS='-c default_transaction_read_only=on',
                              HTTP_PROXY='http://127.0.0.2:9', HTTPS_PROXY='http://127.0.0.2:9')
            driver = module.Rehearsal(argparse.Namespace(
                pg_bin='/usr/lib/postgresql/18/bin',
                jar=ROOT / 'backend/target/pliego-backend-0.1.0-SNAPSHOT.jar', keep_cluster=False))
            output = subprocess.check_output([sys.executable, '-c',
                "import os; print(any(k in os.environ for k in "
                "('PGHOSTADDR','PGSERVICE','PGOPTIONS','HTTP_PROXY','HTTPS_PROXY')))"], text=True)
            self.assertEqual(output.strip(), 'False')
            self.assertEqual(os.environ['PGHOST'], '127.0.0.1')
        finally:
            if driver:
                driver.close()
            os.environ.clear()
            os.environ.update(original)

    def test_recipe_failure_never_reaches_commit(self):
        text = (ROOT / 'docs/testing/data-reset.md').read_text()
        recipe = re.findall(r'```bash\n(.*?)\n```', text, re.S)[-1]
        stubs = r'''
flock() { [[ "$FAIL_AT" != lock ]]; }
systemctl() {
 if [[ "$*" == *MainPID*--value* ]]; then
  if [[ "$FAIL_AT" == drain ]]; then printf '123\n'; else printf '0\n'; fi
 elif [[ "$*" == *ActiveState*--value* ]]; then printf 'inactive\n'; fi
}
runuser() {
 case "$*" in
 *pg_dump*) [[ "$FAIL_AT" != backup ]] || return 1; printf 'fictional dump\n';;
 *confirm=RESET*) printf 'COMMIT\n' >> "$OBSERVATION";;
 *psql*)
  local reset=false line
  if [[ "$*" == *reset-customer-data.sql* ]]; then reset=true
  elif [[ "$*" != *' -f '* ]]; then read -r line || true; [[ "$line" != RESET ]] || reset=true; fi
  if [[ "$reset" == true && "$FAIL_AT" == dryrun ]]; then return 1; fi;;
 *) return 99;;
 esac
}
'''
        with tempfile.TemporaryDirectory(prefix='pliego-reset-recipe-', dir='/tmp') as directory:
            work = Path(directory)
            (work / 'reset-customer-data.sql').write_text('RESET\n')
            (work / 'reset-customer-data-inventory.sql').write_text('INVENTORY\n')
            recipe = recipe.replace('/run/lock/pliego-deploy.lock', str(work / 'lock'))
            recipe = recipe.replace('/opt/pliego/deployment/data-reset', str(work))
            for case in ('lock', 'backup', 'dryrun', 'drain', 'none'):
                with self.subTest(failure=case):
                    observation = work / (case + '.log')
                    env = os.environ.copy()
                    env.update(FAIL_AT=case, OBSERVATION=str(observation))
                    result = subprocess.run(['bash', '-c', stubs + '\n' + recipe], env=env,
                                            cwd=work, text=True, capture_output=True)
                    committed = observation.exists() and 'COMMIT' in observation.read_text()
                    self.assertEqual(committed, case == 'none')
                    self.assertEqual(result.returncode == 0, case == 'none')


if __name__ == '__main__':
    unittest.main()
