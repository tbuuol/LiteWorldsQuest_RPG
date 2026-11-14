#!/usr/bin/env python3
"""film.py <out-dir> <W>x<H> <fps> <seconds> [first-frame] [last-frame] -- LiteWorldsQuest in film mode (real Firefox on
the GPU desktop, see wdg.sh): the camera path below, frame by frame at a fixed time step, as JPEGs."""
import base64, json, os, subprocess, sys, time, urllib.request
out, size, fps, secs = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
first = int(sys.argv[5]) if len(sys.argv) > 5 else 0
n = int(fps * secs)
last = int(sys.argv[6]) if len(sys.argv) > 6 else n - 1
w, h = (int(x) for x in size.split('x'))
URL = 'http://127.0.0.1:8096/client/?ws=ws://127.0.0.1:8095&as=film&film=1&q=' + os.environ.get('FILM_Q', '4')
# (time s, camera x, z, height above ground, target x, z, target height above ground)
KEYS = json.loads(os.environ['FILM_KEYS']) if os.environ.get('FILM_KEYS') else [
    (0.0, 30, 56, 9.0, 0, 16, 3.0),
    (4.0, 7, 36, 3.8, 0, 18, 2.2),
    (7.0, 0, 21, 2.3, 0, 3, 1.5),
    (10.0, 2.5, 6, 2.0, -1, -3, 1.3),
    (12.5, -3, -1, 3.2, -8, -13, 3.0),
    (15.0, -6, -8, 8.5, -2, -70, 14.0),
]
def pose(t):
    t = max(KEYS[0][0], min(KEYS[-1][0], t))
    i = max(j for j in range(len(KEYS) - 1) if KEYS[j][0] <= t)
    p0, p1, p2, p3 = KEYS[max(i - 1, 0)], KEYS[i], KEYS[i + 1], KEYS[min(i + 2, len(KEYS) - 1)]
    u = (t - p1[0]) / (p2[0] - p1[0])
    def cr(a, b, c, d):  # Catmull-Rom
        return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u)
    return [cr(p0[k], p1[k], p2[k], p3[k]) for k in range(1, 7)]
env = dict(os.environ, HOME='/tmp', MOZ_DISABLE_CONTENT_SANDBOX='1', MOZ_DISABLE_GMP_SANDBOX='1',
           MOZ_DISABLE_RDD_SANDBOX='1', MOZ_DISABLE_SOCKET_PROCESS_SANDBOX='1')
gd = subprocess.Popen(['geckodriver', '--port', '4444', '--binary', '/usr/bin/firefox-esr'], env=env,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
def call(method, path, body=None, timeout=300):
    req = urllib.request.Request('http://127.0.0.1:4444' + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=timeout))['value']
sid = None
os.makedirs(out, exist_ok=True)
try:
    for _ in range(50):
        try: urllib.request.urlopen('http://127.0.0.1:4444/status', timeout=1); break
        except Exception: time.sleep(0.2)
    s = call('POST', '/session', {'capabilities': {'alwaysMatch': {'moz:firefoxOptions': {'args': ['--kiosk', f'--width={w}', f'--height={h}'], 'prefs': {}}}}})
    sid = s['sessionId']
    call('POST', f'/session/{sid}/window/rect', {'width': w, 'height': h})
    call('POST', f'/session/{sid}/url', {'url': URL})
    ih = call('POST', f'/session/{sid}/execute/sync', {'script': 'return innerHeight', 'args': []})
    if ih < h:
        subprocess.run(['wlr-randr', '--output', 'HEADLESS-1', '--custom-mode', f'{w}x{h + h - ih}'], env=env)
        time.sleep(1)
    for _ in range(240):
        if call('POST', f'/session/{sid}/execute/sync', {'script': 'return !!window.LWQ_READY', 'args': []}): break
        time.sleep(0.5)
    print('ready', call('POST', f'/session/{sid}/execute/sync', {'script': 'return [innerWidth, innerHeight]', 'args': []}), flush=True)
    # warm up at the first pose (shaders, tiles, trees), then the frames
    for _ in range(20):
        call('POST', f'/session/{sid}/execute/sync', {'script': 'LWQ.filmFrame(0, ...arguments); return 1', 'args': pose(0)})
    t0 = time.time()
    for i in range(first, last + 1):
        url = call('POST', f'/session/{sid}/execute/sync', {'script': 'return LWQ.filmFrame(...arguments)', 'args': [0 if os.environ.get('FILM_FREEZE') else i / fps] + pose(i / fps) + [0.9, float(os.environ.get('FILM_GSTEP') or '0') * i]})
        open(os.path.join(out, f'f{i:04d}.jpg'), 'wb').write(base64.b64decode(url.split(',', 1)[1]))
        if i % 30 == 0:
            print(f'frame {i}/{n} ({(time.time() - t0) / (i - first + 1):.2f} s/frame)', flush=True)
    call('DELETE', f'/session/{sid}')
    sid = None
finally:
    try:
        if sid: call('DELETE', f'/session/{sid}')
    except Exception:
        pass
    gd.terminate()
    subprocess.run(['pkill', '-9', '-P', str(gd.pid)], stderr=subprocess.DEVNULL)
