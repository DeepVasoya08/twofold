"""Usage: python build.py OUT_DIR [CACHE_DIR]

Builds Smart search's two resources (the photo and text halves of OpenCLIP ViT-B/32,
LAION-2B weights, MIT licence) and writes them to OUT_DIR as chunks the Worker can serve.

1. Downloads the ONNX export at a pinned revision and checks its SHA-256.
2. Stores the weights as 8-bit numbers (see weight_only_int8.py in ../face-models).
3. Checks the result's SHA-256 against the value the app pins (src/lib/search/resources.ts).
4. Splits each file into chunks below the 25 MiB static asset limit.
"""
import hashlib
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'face-models'))
from weight_only_int8 import quantize  # noqa: E402

REPO = 'https://huggingface.co/immich-app/ViT-B-32__laion2b-s34b-b79k/resolve/19a057a0fb927cf239541300e74237cd56c7ffe2'
CHUNK = 24 * 1024 * 1024
FILES = {
    'photo': {
        'source': 'visual/model.onnx',
        'source_sha256': 'b9ce24b91a8c62ef8d40ea786051709c93140104cbf2b6b4a2cc270df3838f9c',
        'sha256': 'eea088f1c6f18bd3e8dfffa1471a0713e972760341e048cfcec1b4f81f713c71',
    },
    'text': {
        'source': 'textual/model.onnx',
        'source_sha256': '48c25be37b352398f2533c9426dab6f9340535e14e46f884cc894236a5060722',
        'sha256': 'a5136c3569a8f2ea25bcc88c010bafb1ab390f00c4d1cf502b52288698e2ec1a',
    },
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def fetch(url, path, expected):
    if not (os.path.exists(path) and sha256(path) == expected):
        print('downloading', url)
        urllib.request.urlretrieve(url, path)
    if sha256(path) != expected:
        sys.exit(f'{path}: SHA-256 does not match the pinned source')


def main():
    out = sys.argv[1]
    cache = sys.argv[2] if len(sys.argv) > 2 else os.path.join(out, '.cache')
    os.makedirs(out, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    for name, spec in FILES.items():
        source = os.path.join(cache, f'{name}-source.onnx')
        fetch(f"{REPO}/{spec['source']}", source, spec['source_sha256'])
        built = os.path.join(cache, f'{name}-w8.onnx')
        if not (os.path.exists(built) and sha256(built) == spec['sha256']):
            quantize(source, built)
        if sha256(built) != spec['sha256']:
            sys.exit(f'{name}: the built file does not match the SHA-256 the app pins')
        with open(built, 'rb') as f:
            data = f.read()
        for index in range(0, len(data), CHUNK):
            with open(os.path.join(out, f'{name}-{spec["sha256"][:12]}.{index // CHUNK}.bin'), 'wb') as part:
                part.write(data[index:index + CHUNK])
        print(name, len(data), 'bytes in', -(-len(data) // CHUNK), 'chunks')


if __name__ == '__main__':
    main()
