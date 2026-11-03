"""Regression coverage for the production systemd drain-order incident."""
import unittest
from unittest.mock import patch

import service_state as S
from release_common import ReleaseError


class ServiceStateTest(unittest.TestCase):
    def test_named_properties_in_both_systemd_orders(self):
        for output in ('ActiveState=failed\nMainPID=0', 'MainPID=0\nActiveState=failed',
                       'MainPID=0\nResult=exit-code\nActiveState=failed'):
            with self.subTest(output=output):
                self.assertEqual(S.parse_state(output), {'ActiveState': 'failed', 'MainPID': '0'})
        for output in ('failed\n0', '0\nfailed', 'ActiveState=failed',
                       'ActiveState=failed\nMainPID=0\nMainPID=3'):
            with self.subTest(output=output), self.assertRaises(ReleaseError):
                S.parse_state(output)

    def test_named_and_separate_value_queries_cover_all_states(self):
        for active, pid, drained in [('failed', '0', True), ('inactive', '0', True),
                                     ('active', '321', False), ('failed', '321', False)]:
            for values in (False, True):
                for reverse in (False, True):
                    calls = []
                    def runner(args, **kwargs):
                        calls.append(args)
                        if '--value' in args:
                            self.assertNotIn('--property=ActiveState,MainPID', args)
                            return active if '--property=ActiveState' in args else pid
                        fields = [f'ActiveState={active}', f'MainPID={pid}']
                        return '\n'.join(reversed(fields) if reverse else fields)
                    with self.subTest(active=active, pid=pid, values=values, reverse=reverse):
                        result = S.state(runner=runner, values=values)
                        self.assertEqual(result, {'ActiveState': active, 'MainPID': pid})
                        self.assertIs(S.is_drained(result), drained)
                        self.assertEqual(len(calls), 2 if values else 1)

    def test_drain_accepts_failed_zero_and_stop_has_unit_timeout_budget(self):
        calls = []
        def runner(args, **kwargs):
            calls.append((args, kwargs))
            return 'MainPID=0\nActiveState=failed' if args[1] == 'show' else ''
        S.stop_and_drain(runner=runner)
        self.assertEqual(calls[0][0], ['systemctl', 'stop', 'pliego'])
        self.assertGreaterEqual(calls[0][1]['timeout'], 50)
        self.assertEqual(calls[1][0][1], 'show')

    def test_timeout_keeps_pointers_unchanged_and_never_starts(self):
        now = [0.0]
        calls = []
        def runner(args, **kwargs):
            calls.append(args)
            return 'MainPID=17\nActiveState=failed' if args[1] == 'show' else ''
        def sleep(seconds):
            now[0] += seconds
        with self.assertRaisesRegex(ReleaseError, 'did not drain'):
            S.stop_and_drain(timeout=2, runner=runner, clock=lambda: now[0], sleep=sleep)
        self.assertEqual(now[0], 2)
        self.assertTrue(all(args[1] in {'stop', 'show'} for args in calls))

    def test_start_resets_failed_first(self):
        calls = []
        S.start(runner=lambda args, **kwargs: calls.append(args))
        self.assertEqual(calls, [['systemctl', 'reset-failed', 'pliego'], ['systemctl', 'start', 'pliego']])

    def test_command_removes_inherited_pg_routes_and_forces_read_only(self):
        with patch.dict('os.environ', {'PGHOST': 'wrong-host', 'PGDATABASE': 'wrong-db'}), \
             patch('subprocess.run') as run:
            run.return_value.stdout = 'ok\n'
            run.return_value.returncode = 0
            self.assertEqual(S.command(['example']), 'ok')
            env = run.call_args.kwargs['env']
            self.assertNotIn('PGHOST', env)
            self.assertNotIn('PGDATABASE', env)
            self.assertIn('default_transaction_read_only=on', env['PGOPTIONS'])


if __name__ == '__main__':
    unittest.main()
