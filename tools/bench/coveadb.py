"""What the startup benches share: a Cove server's API (login, videos), the mpv-test app on an Android device over
adb (open a video through its deep link, wait for the first frame, read logcat).

Environment: COVE_SERVER (default http://127.0.0.1:5073; the device reaches it as COVE_DEVICE_SERVER, default
http://10.0.2.2:5073 — an emulator), COVE_USER / COVE_PASSWORD (default admin / adminadmin), ADB_SERIAL for one device
among several.
"""
import json, os, re, subprocess, time, urllib.parse, urllib.request

SERVER = os.environ.get('COVE_SERVER', 'http://127.0.0.1:5073')
DEVICE_SERVER = os.environ.get('COVE_DEVICE_SERVER', 'http://10.0.2.2:5073')
USER, PASSWORD = os.environ.get('COVE_USER', 'admin'), os.environ.get('COVE_PASSWORD', 'adminadmin')
ADB = ['adb'] + (['-s', os.environ['ADB_SERIAL']] if os.environ.get('ADB_SERIAL') else [])
PACKAGE = 'com.rnmpv.test'
CHUNK = 1 << 20
TAGS = ['MpvRead:*', 'MpvHttp:*', 'MpvStartup:*', 'MpvVideoView:*', 'MpvPlayer:*', 'mpv:E', 'ReactNativeJS:*']

# One per container / codec: large files where the index's place matters, and the odd ones
DEFAULT_IDS = [77, 95, 130, 22, 37, 87, 106, 142, 45, 41, 133, 120, 148, 39, 93, 153, 124, 140, 145, 118, 110, 107,
               113, 108, 129, 117, 152, 134, 126]

# logcat -v epoch: "  1760000000.123  1234  1250 I Tag     : message"
LINE = re.compile(r'^\s*(\d+\.\d+)\s+\d+\s+\d+\s+\w\s+(\w+)\s*:\s*(.*)$')


def call(path, body, token=None):
    req = urllib.request.Request(SERVER + '/api' + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    return json.load(urllib.request.urlopen(req, timeout=30))


def login():
    return call('/auth/login', {'username': USER, 'password': PASSWORD})['token']


def adb(*args, check=True):
    return subprocess.run(ADB + list(args), capture_output=True, text=True, encoding='utf-8', errors='replace',
                          check=check).stdout


def setprop(name, value):
    adb('shell', 'setprop', f'debug.mpv.{name}', value if value else '""', check=False)


def videos(token, ids):
    found, page = {}, 1
    while True:
        items = call('/videos/find', {'findFilter': {'q': '', 'page': page, 'perPage': 100}}, token)['items']
        for v in items:
            if v['id'] in ids:
                found[v['id']] = v
        if len(items) < 100:
            return [found[i] for i in ids if i in found]
        page += 1


def link(v, token, size=True):
    """The deep link that opens v's first file in mpv-test (with its size: the cache's warm knows the tail)."""
    f = v['files'][0]
    url = f"{DEVICE_SERVER}/api/stream/video/{v['id']}?fileId={f['id']}"
    q = 'url=' + urllib.parse.quote(url, safe='') + '&auth=' + urllib.parse.quote('Bearer ' + token, safe='')
    if size and f.get('size'):
        q += f"&size={f['size']}"
    return 'mpvtest://open?' + q


def stop():
    adb('shell', 'am', 'force-stop', PACKAGE)


def play(deep_link, wait_s=30, after_s=2.0):
    """Starts mpv-test cold on deep_link; returns logcat (epoch times) up to after_s past the first frame, or wait_s."""
    stop()
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f"'{deep_link}'", PACKAGE)
    t0, text = time.time(), ''
    while time.time() - t0 < wait_s:
        time.sleep(1.0)
        text = adb('logcat', '-d', '-v', 'epoch', '-s', *TAGS)
        if 'first frame' in text:
            time.sleep(after_s)
            return adb('logcat', '-d', '-v', 'epoch', '-s', *TAGS)
    return text


def lines(text):
    """(epoch seconds, tag, message) per logcat line."""
    for line in text.splitlines():
        m = LINE.match(line)
        if m:
            yield float(m.group(1)), m.group(2), m.group(3)
