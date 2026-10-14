"""Startup time with the HTTP cache's warm start against the old way (debug.mpv.cache_startup=legacy), cold and cached:
plays Cove videos in the mpv-test app (Android, adb) and times each from the app's open (its "mpvtest open" log line)
to the first frame on screen (MpvStartup).

    python tools/bench/startup-cache.py [video ids...]      (default: one video per container / codec)

For each video, REPEAT times (default 3), in both modes (legacy, then warm):
  cold    the disk tier cleared and the app stopped (RAM empty): everything from the network
  cached  right after: the app stopped again, so the media's chunks come from the disk tier

The deep link carries the file's size (prepareMedia), as the Cove app's player does. Needs what startup-reads.py needs
(coveadb.py: the server, adb, mpv-test with Metro). NETDELAY=umts (or gprs, edge, ...): the emulator's network delay
for the run (reset at the end), where saved round trips show more. Results in tools/bench/out/startup-cache-<time>/:
summary.md (medians per video, new vs legacy; averages per container), results.json, a log per run.
"""
import json, os, re, statistics, sys, time

from coveadb import DEFAULT_IDS, adb, lines, link, login, play, setprop, stop, videos

REPEAT = int(os.environ.get('REPEAT', '3'))
MODES = ['legacy', 'warm']
KINDS = ['cold', 'cached']


def clear_disk():
    adb('shell', 'run-as', 'com.rnmpv.test', 'rm', '-rf', 'cache/mpv-http', check=False)


def parse(text):
    opened = first = native = None
    tiers = {'http': 0, 'joined': 0, 'disk': 0, 'ram': 0}
    warm = False
    for at, tag, msg in lines(text):
        if tag == 'ReactNativeJS' and 'mpvtest open' in msg and opened is None:
            opened = at
        elif tag == 'MpvStartup' and 'first frame' in msg and first is None:
            first = at
            m = re.search(r'first frame (\d+) ms', msg)
            native = int(m.group(1)) if m else None
        elif tag == 'MpvHttp':
            if msg.startswith('warm '):
                warm = True
            c = re.search(r' chunk \d+: (ram|disk|http)( \(joined\))? ', msg)
            if c and first is None:
                tiers['joined' if c.group(2) else c.group(1)] += 1
    ms = round((first - opened) * 1000) if first and opened else None
    if ms is None and ' 401' in text:
        raise SystemExit('HTTP 401: the token was refused (expired?), stopping')
    return {'ms': ms, 'native_ms': native, 'tiers': tiers, 'warm_logged': warm}


def run(v, token, mode, kind, out, rep):
    setprop('cache_startup', 'legacy' if mode == 'legacy' else '')
    if kind == 'cold':
        stop()
        clear_disk()
    text = play(link(v, token))
    stop()
    name = re.sub(r'[^\w.-]+', '_', v['files'][0]['basename'])
    open(os.path.join(out, f"{v['id']}-{name}-{mode}-{kind}-{rep}.log"), 'w', encoding='utf-8').write(text)
    return parse(text)


def median(values):
    values = [x for x in values if x is not None]
    return round(statistics.median(values)) if values else None


def delta(new, old):
    if new is None or old is None:
        return ''
    return f"{new - old:+d} ms ({(new - old) * 100 / old:+.0f}%)" if old else f'{new - old:+d} ms'


def summary(rows, netdelay):
    out = [f"Startup: the app's open → first frame on screen, median of {REPEAT}; network: "
           f"{netdelay or 'emulator default'}. Chunks before the first frame (warm, cold): http / joined / disk / ram.",
           '',
           '| Video | Container · codec | Size | Cold legacy | Cold warm | Δ cold | Cached legacy | Cached warm | Δ cached '
           '| Chunks (warm, cold) |',
           '|---|---|---|---|---|---|---|---|---|---|']
    per_container = {}
    for r in rows:
        m = r['median']
        t = r['tiers_warm_cold']
        out.append(f"| {r['id']} {r['name']} | {r['format']} · {r['video']} | {r['size'] / (1 << 20):.1f} MB "
                   f"| {m['legacy-cold']} | {m['warm-cold']} | {delta(m['warm-cold'], m['legacy-cold'])} "
                   f"| {m['legacy-cached']} | {m['warm-cached']} | {delta(m['warm-cached'], m['legacy-cached'])} "
                   f"| {t['http']} / {t['joined']} / {t['disk']} / {t['ram']} |")
        c = per_container.setdefault(r['format'], {'cold': [], 'cached': []})
        for kind in KINDS:
            new, old = m[f'warm-{kind}'], m[f'legacy-{kind}']
            if new is not None and old is not None:
                c[kind].append((new, old))
    out += ['', '| Container | Videos | Cold legacy → warm (mean) | Cached legacy → warm (mean) |', '|---|---|---|---|']

    def mean(pairs):
        if not pairs:
            return '—'
        new, old = sum(p[0] for p in pairs) / len(pairs), sum(p[1] for p in pairs) / len(pairs)
        return f"{old:.0f} → {new:.0f} ms ({(new - old) * 100 / old:+.0f}%)"

    everything = {'cold': [], 'cached': []}
    for fmt, c in sorted(per_container.items()):
        out.append(f"| {fmt} | {max(len(c['cold']), len(c['cached']))} | {mean(c['cold'])} | {mean(c['cached'])} |")
        for kind in KINDS:
            everything[kind] += c[kind]
    out.append(f"| **all** | {len(rows)} | {mean(everything['cold'])} | {mean(everything['cached'])} |")
    return '\n'.join(out) + '\n'


def main():
    ids = [int(a) for a in sys.argv[1:]] or DEFAULT_IDS
    netdelay = os.environ.get('NETDELAY', '')
    token = login()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out',
                       'startup-cache-' + time.strftime('%Y%m%d-%H%M%S') + (f'-{netdelay}' if netdelay else ''))
    os.makedirs(out, exist_ok=True)
    setprop('http_log', '1')
    setprop('read_log', '')
    setprop('cache', '')
    setprop('readahead', '')
    if netdelay:
        adb('emu', 'network', 'delay', netdelay, check=False)
    rows = []
    try:
        for v in videos(token, ids):
            f = v['files'][0]
            token = login()  # afresh per video: Cove's access token lasts minutes, the run takes longer
            runs = {f'{mode}-{kind}': [] for mode in MODES for kind in KINDS}
            for rep in range(REPEAT):
                for mode in MODES:
                    for kind in KINDS: # cached right after cold: the disk tier has what the cold run fetched
                        runs[f'{mode}-{kind}'].append(run(v, token, mode, kind, out, rep))
            med = {key: median([r['ms'] for r in rs]) for key, rs in runs.items()}
            warm_cold = runs['warm-cold']
            tiers = {t: round(statistics.mean(r['tiers'][t] for r in warm_cold)) for t in warm_cold[0]['tiers']}
            row = {'id': v['id'], 'name': f['basename'], 'format': f.get('format'), 'video': f.get('videoCodec'),
                   'size': f['size'], 'median': med, 'tiers_warm_cold': tiers, 'runs': runs}
            rows.append(row)
            print(f"{v['id']:4} {f.get('format') or '':5} {f.get('videoCodec') or '':11} "
                  f"cold {med['legacy-cold']} → {med['warm-cold']} ms, cached {med['legacy-cached']} → "
                  f"{med['warm-cached']} ms", flush=True)
    finally:
        for prop in ['http_log', 'cache_startup']:
            setprop(prop, '')
        if netdelay:
            adb('emu', 'network', 'delay', 'none', check=False)
    json.dump(rows, open(os.path.join(out, 'results.json'), 'w'), indent=1)
    open(os.path.join(out, 'summary.md'), 'w', encoding='utf-8').write(summary(rows, netdelay))
    print('DONE', out)


main()
