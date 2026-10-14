"""What a cold start reads, per container and codec: plays Cove videos in the mpv-test app (Android, adb) with the
HTTP cache's read log on, and reports mpv's reads up to the first frame on screen — as runs of contiguous bytes,
where they are in the file, and which of the cache's chunks they touch — and the chunks the cache downloaded.

    python tools/bench/startup-reads.py [video ids...]       (default: one video per container / codec)

Needs: mpv-test installed (apps/mpv-test, yarn start:test for Metro), a Cove server and adb (see coveadb.py for
the environment). Each video starts cold: the app is stopped (the RAM tier goes) and the disk tier is off (debug.mpv.cache=ram). Results in
tools/bench/out/startup-reads-<time>/ (a log per video and summary.md). MINIMAL=1: mpv reads no further ahead than the
first frame needs (debug.mpv.readahead=0), so what is read before it is close to what starting needs.
"""
import json, os, re, sys, time

from coveadb import CHUNK, DEFAULT_IDS, adb, lines, link, login, play, setprop, stop, videos


def run_one(v, token, out):
    f = v['files'][0]
    text = play(link(v, token))
    stop()
    name = re.sub(r'[^\w.-]+', '_', f['basename'])
    open(os.path.join(out, f"{v['id']}-{name}.log"), 'w', encoding='utf-8').write(text)
    return analyze(v, text)


def analyze(v, text):
    f = v['files'][0]
    size = f['size']
    reads, first_at, first_ms, chunks = [], None, None, []
    for at, tag, msg in lines(text):
        if tag == 'MpvRead':
            r = re.search(r' t=(\d+) read (\d+) \+(\d+)', msg)
            if r:
                reads.append((at, int(r.group(1)), int(r.group(2)), int(r.group(3))))
        elif tag == 'MpvStartup' and 'first frame' in msg and first_at is None:
            first_at = at
            ms = re.search(r'first frame (\d+) ms', msg)
            first_ms = int(ms.group(1)) if ms else None
        elif tag == 'MpvHttp':
            c = re.search(r' chunk (\d+): (\w+(?: \(joined\))?) (\d+) KB, waited (\d+) ms', msg)
            if c and (first_at is None or at <= first_at):
                chunks.append((int(c.group(1)), c.group(2), int(c.group(4))))
    before = [r for r in reads if first_at is None or r[0] <= first_at]
    runs = []
    for _, t, pos, n in before:
        if runs and pos == runs[-1][1] + runs[-1][2]:
            runs[-1][2] += n
        else:
            runs.append([t, pos, n])
    touched = sorted({c for _, pos, n in [(0, r[1], r[2]) for r in runs] for c in range(pos // CHUNK, (pos + max(n, 1) - 1) // CHUNK + 1)})
    return {
        'id': v['id'], 'name': f['basename'], 'format': f.get('format'), 'video': f.get('videoCodec'), 'audio': f.get('audioCodec'),
        'size': size, 'first_ms': first_ms, 'started': first_at is not None, 'runs': runs,
        'bytes': sum(r[2] for r in runs), 'chunks_touched': touched, 'chunks_fetched': chunks,
        'last_chunk': (size - 1) // CHUNK,
    }


def where(pos, size):
    if pos < 4 * CHUNK:
        return f'{pos / 1024:.0f} KB'
    if size - pos < 4 * CHUNK:
        return f'end−{(size - pos) / 1024:.0f} KB'
    return f'{pos / CHUNK:.1f} MB ({pos * 100 / size:.0f}%)'


def summary(results):
    rows = ['| Video | Container · codecs | Size | First frame | Read before it | Runs (offset +length) | Chunks touched (1 MB) |',
            '|---|---|---|---|---|---|---|']
    for r in results:
        runs = '; '.join(f"{where(pos, r['size'])} +{n / 1024:.0f} KB" for _, pos, n in r['runs'][:8])
        if len(r['runs']) > 8:
            runs += f"; … {len(r['runs']) - 8} more"
        last = r['last_chunk']
        chunks = ', '.join(('last' if c == last else f'last−{last - c}' if last - c < 4 and c > 3 else str(c)) for c in r['chunks_touched'])
        rows.append(f"| {r['id']} {r['name']} | {r['format']} · {r['video']}{' + ' + r['audio'] if r['audio'] else ''} | {r['size'] / CHUNK:.1f} MB "
                    f"| {str(r['first_ms']) + ' ms' if r['started'] else 'did not start'} | {r['bytes'] / 1024:.0f} KB | {runs} | {chunks} |")
    return '\n'.join(rows)


def main():
    ids = [int(a) for a in sys.argv[1:]] or DEFAULT_IDS
    token = login()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'startup-reads-' + time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(out, exist_ok=True)
    setprop('read_log', '1')
    setprop('http_log', '1')
    setprop('cache', 'ram')
    minimal = os.environ.get('MINIMAL') == '1'
    setprop('readahead', '0' if minimal else '')
    if minimal:
        out += '-minimal'
        os.makedirs(out, exist_ok=True)
    results = []
    try:
        for v in videos(token, ids):
            r = run_one(v, login(), out)  # a fresh token: Cove's lasts minutes, the run takes longer
            results.append(r)
            print(f"{r['id']:4} {r['format']:5} {r['video'] or '':11} first frame {r['first_ms']} ms, read {r['bytes'] / 1024:.0f} KB in {len(r['runs'])} runs, chunks {r['chunks_touched']} of {r['last_chunk'] + 1}", flush=True)
    finally:
        for prop in ['read_log', 'http_log', 'cache', 'readahead']:
            setprop(prop, '')
    json.dump(results, open(os.path.join(out, 'results.json'), 'w'), indent=1)
    open(os.path.join(out, 'summary.md'), 'w', encoding='utf-8').write(summary(results) + '\n')
    print('DONE', out)


main()
