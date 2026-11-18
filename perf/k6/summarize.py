#!/usr/bin/env python3
"""Recompute endpoint statistics from raw k6 points and retain threshold evidence.

SSE stream durations are deliberately separate from ordinary HTTP. Percentiles
use linear interpolation at (n-1)*q, matching k6's trend summaries.
"""
import argparse
import collections
import datetime
import json
import math
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

GROUPS = ('catalog', 'search', 'detail', 'auth', 'cart', 'checkout')


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def percentile(values, quantile):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def stats(values):
    return {'count': len(values), 'p50_ms': percentile(values, .5),
            'p90_ms': percentile(values, .9), 'p95_ms': percentile(values, .95),
            'p99_ms': percentile(values, .99), 'max_ms': max(values) if values else None}


def interval(points, start, end, seconds):
    durations = collections.defaultdict(list)
    errors = collections.defaultdict(list)
    requests = collections.Counter()
    endpoints = collections.defaultdict(list)
    for metric, time, value, tags in points:
        if not start <= time <= end:
            continue
        group = tags.get('endpoint_group')
        if metric == 'endpoint_duration':
            durations[group].append(value)
        elif metric == 'unexpected_errors':
            errors[group].append(value)
        elif metric == 'endpoint_requests':
            requests[group] += value
        elif metric == 'http_req_duration' and group != 'sse':
            endpoints[tags.get('name')].append(value)
    return {
        'seconds': seconds,
        'groups': {g: {**stats(durations[g]), 'requests': requests[g],
                       'rps': requests[g] / seconds if seconds else None,
                       'unexpected_errors': sum(errors[g]), 'error_samples': len(errors[g]),
                       'error_rate': sum(errors[g]) / len(errors[g]) if errors[g] else None}
                   for g in GROUPS},
        'endpoint_statistics': {name: stats(values) for name, values in sorted(endpoints.items())},
    }


def resource_summary(directory, start=-math.inf, end=math.inf):
    file = directory / 'samples/samples.jsonl'
    samples = [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []
    values = collections.defaultdict(list)
    names = ('hikaricp_connections_active', 'hikaricp_connections_idle', 'hikaricp_connections_pending',
             'hikaricp_connections_max', 'hikaricp_connections_timeout_total',
             'hikaricp_connections_acquire_seconds_max', 'tomcat_threads_busy_threads',
             'tomcat_threads_current_threads', 'process_cpu_usage', 'pliego_sse_active',
             'pliego_sse_reads_deferred_total', 'jvm_threads_live_threads', 'jvm_gc_pause_seconds_max',
             'jvm_gc_pause_seconds_count', 'jvm_gc_pause_seconds_sum')
    included = 0
    scrape_errors = 0
    previous = None
    for sample in samples:
        if not start <= timestamp(sample['utc']) <= end:
            continue
        included += 1
        scrape_errors += int('scrape_error' in sample)
        heap_used = heap_committed = 0
        for line in sample.get('metrics', []):
            match = re.match(r'([^ {]+)(\{[^}]*\})?\s+(\S+)', line)
            if not match:
                continue
            name, labels, raw = match.groups()
            try:
                value = float(raw)
            except ValueError:
                continue
            if not math.isfinite(value):
                continue
            labels = labels or ''
            if name in names or name.startswith('pliego_sse_'):
                # Preserve both Hikari pools and the connector names.
                values[name + labels].append(value)
            if name == 'jvm_memory_used_bytes' and 'area="heap"' in labels:
                heap_used += value
            if name == 'jvm_memory_committed_bytes' and 'area="heap"' in labels:
                heap_committed += value
        if 'metrics' in sample:
            values['heap_used_bytes'].append(heap_used)
            values['heap_committed_bytes'].append(heap_committed)
        memory = re.search(r'^MemAvailable:\s+(\d+)', sample.get('meminfo', ''), re.M)
        if memory:
            values['host_mem_available_kib'].append(int(memory.group(1)))
        current = {}
        pg_clients = 0
        for pid, proc in sample.get('processes', {}).items():
            # proc.stat starts with pid and a parenthesized name that can contain
            # spaces. Field 14/15 are user/system ticks, field 22 is start time.
            fields = proc['stat'].rsplit(')', 1)[1].split()
            current[pid] = (proc['comm'], fields[19], int(fields[11]) + int(fields[12]))
            if proc['comm'] == 'postgres' and 'pliego_app pliego_benchmark' in proc.get('cmdline', ''):
                pg_clients += 1
            if proc['comm'] != 'java':
                continue
            for field in ('VmRSS', 'VmSize', 'Threads'):
                match = re.search('^' + field + r':\s+(\d+)', proc['status'], re.M)
                if match:
                    values['java_' + field + ('_kib' if field != 'Threads' else '')].append(int(match.group(1)))
        if any('cmdline' in proc for proc in sample.get('processes', {}).values()):
            values['postgres_runtime_client_backends'].append(pg_clients)
        if previous:
            elapsed = sample['monotonic'] - previous[0]
            consumed = collections.defaultdict(float)
            for pid, (name, started, ticks) in current.items():
                prior = previous[1].get(pid)
                if prior and prior[1] == started and elapsed > 0:
                    consumed[name] += max(0, ticks - prior[2]) / os.sysconf('SC_CLK_TCK') / elapsed
            values['java_cpu_cores_from_proc_delta'].append(consumed['java'])
            values['postgres_cpu_cores_from_proc_delta'].append(consumed['postgres'])
            values['java_plus_postgres_cpu_fraction_of_two_cores'].append((consumed['java'] + consumed['postgres']) / 2)
        previous = (sample['monotonic'], current)
    return {'samples': included, 'scrape_errors': scrape_errors,
            'measurements': {k: {'min': min(v), 'max': max(v), 'first': v[0], 'last': v[-1]}
                             for k, v in sorted(values.items()) if v}}


def summarize(directory):
    summary = json.loads((directory / 'summary.json').read_text())
    run = json.loads((directory / 'run.json').read_text())
    points = []
    vus = []
    for line in (directory / 'raw.json').read_text().splitlines():
        item = json.loads(line)
        if item['type'] != 'Point':
            continue
        data = item['data']
        time = timestamp(data['time'])
        points.append((item['metric'], time, data['value'], data.get('tags', {})))
        if item['metric'] == 'vus':
            vus.append((time, data['value']))
    seconds = summary['state']['testRunDurationMs'] / 1000
    result = {**run, **interval(points, -math.inf, math.inf, seconds),
              'thresholds': {name: value['thresholds'] for name, value in summary['metrics'].items()
                             if 'thresholds' in value},
              'resources': resource_summary(directory),
              'sse': {name: value for name, value in summary['metrics'].items() if name.startswith('sse_')},
              'raw_files': {'k6_summary': str(directory / 'summary.json'), 'k6_points': str(directory / 'raw.json'),
                            'samples': str(directory / 'samples/samples.jsonl'),
                            'pidstat': str(directory / 'pidstat.txt'), 'vmstat': str(directory / 'vmstat.txt')}}
    # A healthy threshold failure is valid bottleneck evidence. A native crash
    # or interrupted/harness failure cannot certify a sustained load window.
    result['measurement_valid'] = bool(run.get('valid_for_capacity', True) and run['exit_status'] in (0, 99))
    exclusions = directory.parent.parent / 'qualification-exclusions.json'
    if exclusions.exists():
        result['qualification_exclusions'] = json.loads(exclusions.read_text())
        result['measurement_valid'] = False
    flags = [flag['ok'] for thresholds in result['thresholds'].values() for flag in thresholds.values()]
    result['all_thresholds_passed'] = bool(flags) and all(flags)
    result['slo_accepted'] = result['measurement_valid'] and result['all_thresholds_passed'] and run['exit_status'] == 0
    result['summary_reconciliation'] = {}
    for group in GROUPS:
        expected = summary['metrics'].get('endpoint_duration{endpoint_group:' + group + '}', {}).get('values', {})
        actual = result['groups'][group]
        result['summary_reconciliation'][group] = {
            name: abs(actual[key] - expected[name]) if actual[key] is not None and name in expected else None
            for key, name in [('p50_ms', 'med'), ('p90_ms', 'p(90)'), ('p95_ms', 'p(95)'), ('p99_ms', 'p(99)')]}
    if result['measurement_valid']:
        differences = [delta for group in result['summary_reconciliation'].values()
                       for delta in group.values() if delta is not None]
        if any(delta > 1e-6 for delta in differences):
            raise ValueError('Valid-run raw quantiles disagree with primary k6 summary')
    # Steady windows are defined by sampled actual VU counts, excluding transitions.
    # Take the longest contiguous plateau for each requested stage; boundaries
    # have about one second of VU sampling resolution.
    requested = run.get('stress_steps') or ((25, 40, 60, 100, 160) if run['stress'] else (run['vus'] * (2 if run['sse'] else 1),))
    steady = {}
    for stage in requested:
        plateaus = []
        window = []
        for point in vus:
            if point[1] == stage:
                window.append(point[0])
            elif window:
                plateaus.append(window)
                window = []
        if window:
            plateaus.append(window)
        if not plateaus:
            continue
        longest = max(plateaus, key=lambda w: w[-1] - w[0])
        start, end = longest[0], longest[-1]
        if end - start < 10:
            continue
        steady[str(stage)] = {**interval(points, start, end, end - start),
                              'start_utc': datetime.datetime.fromtimestamp(start, datetime.timezone.utc).isoformat(),
                              'end_utc': datetime.datetime.fromtimestamp(end, datetime.timezone.utc).isoformat(),
                              'resources': resource_summary(directory, start, end)}
    result['steady_windows_from_vu_samples'] = steady
    result['steady_window_vus_definition'] = 'Aggregate k6 VUs; SSE comparison has 30 k6 VUs = 15 HTTP workers plus 15 streams for 15 logical accounts.'
    result['peak_actual_k6_vus'] = max((point[1] for point in vus), default=0)
    (directory / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('runs', type=Path)
    parser.add_argument('--recursive', action='store_true', help='Discover all nested run directories beneath this evidence root')
    args = parser.parse_args()
    if args.recursive:
        paths = sorted({path.parent for path in args.runs.rglob('summary.json')
                        if path.parent.parent.name == 'runs' and (path.parent / 'run.json').exists()})
        output = args.runs
        stem = 'results-all'
    else:
        paths = [path for path in sorted(args.runs.iterdir())
                 if (path / 'summary.json').exists() and (path / 'run.json').exists()]
        output = args.runs.parent
        stem = 'results'
    results = [summarize(path) for path in paths]
    (output / (stem + '.json')).write_text(json.dumps(results, indent=2) + '\n')
    rows = ['| Run | Exit | Interpretation | Group | Requests | RPS | p50 ms | p90 ms | p95 ms | p99 ms | Errors | Raw directory |',
            '| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |']
    for result in results:
        for group, value in result['groups'].items():
            numbers = ['—' if value[k] is None else f'{value[k]:.3f}' for k in ('rps', 'p50_ms', 'p90_ms', 'p95_ms', 'p99_ms')]
            error = '—' if value['error_rate'] is None else f'{100 * value["error_rate"]:.3f}%'
            interpretation = ('invalid/interrupted' if not result['measurement_valid']
                              else 'diagnostic ' + str(result.get('diagnostic_jvm_mode') or 'JVM') if result.get('diagnostic_jvm_mode') or result.get('diagnostic_compile_exclusion') else 'parity JVM')
            rows.append('| ' + ' | '.join([result['name'], str(result['exit_status']), interpretation, group,
                                          str(int(value['requests'])), *numbers, error, result['raw_dir']]) + ' |')
    (output / (stem + '.md')).write_text('\n'.join(rows) + '\n')
    print('Summarized', len(results), f'run summaries (including explicitly invalid interruptions); raw and k6 summary percentiles reconciled in {stem}.json')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Analysis only: retry once in a fresh interpreter, preserving both
        # outcomes. This never repeats API calls or modifies primary evidence.
        if os.environ.get('PLIEGO_PERF_REPORTER_RETRY') == '1':
            raise
        candidate = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
        output = candidate if '--recursive' in sys.argv else candidate.parent
        output.mkdir(parents=True, exist_ok=True)
        failed_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        prefix = output / ('reporter-failure-' + stamp)
        prefix.with_suffix('.stderr.txt').write_text(traceback.format_exc())
        command = [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]]
        result = subprocess.run(command, capture_output=True, text=True,
                                env={**os.environ, 'PLIEGO_PERF_REPORTER_RETRY': '1'})
        prefix.with_suffix('.retry.stdout.txt').write_text(result.stdout)
        prefix.with_suffix('.retry.stderr.txt').write_text(result.stderr)
        prefix.with_suffix('.commands.json').write_text(json.dumps({
            'failure_utc': failed_utc, 'retry_finished_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'original_argv': [sys.executable, *sys.argv], 'original_analysis_exit_status': 1,
            'retry_argv': command, 'retry_exit_status': result.returncode,
            'retry_control_environment': {'PLIEGO_PERF_REPORTER_RETRY': '1'},
            'raw_evidence_unchanged': True}, indent=2) + '\n')
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        sys.exit(result.returncode)
