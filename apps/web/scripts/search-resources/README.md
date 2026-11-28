# Smart search resources

Smart search runs OpenCLIP ViT-B/32 in the browser: a photo half that turns a photo into a
search vector and a text half that does the same for typed words. The weights are the
LAION-2B ones (`laion2b_s34b_b79k`), published under the MIT licence. They're too big to
commit, so `build.py` makes them at deploy time:

1. Downloads the ONNX export at `immich-app/ViT-B-32__laion2b-s34b-b79k` on Hugging Face, at a
   pinned revision, and checks each file's SHA-256.
2. Stores the weights as 8-bit numbers with `../face-models/weight_only_int8.py`, the same
   way as People's SFace. Maths stays in 32-bit floats, so search results match the full
   model (on 300 Flickr30k test photos the right photo came first 80.5% of the time, the same
   as at full size). ONNX Runtime's standard 8-bit mode was ruled out: it made the text half
   much worse (60%).
3. Checks the result's SHA-256 against the value the app pins in `src/lib/search/resources.ts`.
4. Splits each file into 24 MiB chunks (static assets are limited to 25 MiB) in
   `public/resources/search/`, which is not committed.

| Resource | Size       | SHA-256                                                            |
| -------- | ---------- | ------------------------------------------------------------------ |
| Photo    | 88,985,490 | `eea088f1c6f18bd3e8dfffa1471a0713e972760341e048cfcec1b4f81f713c71` |
| Text     | 64,807,819 | `a5136c3569a8f2ea25bcc88c010bafb1ab390f00c4d1cf502b52288698e2ec1a` |
| Words    | 524,619    | `9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a` |

Words is the text half's `merges.txt`, used as it is: `src/lib/search/tokenizer.ts` builds
CLIP's tokenizer from it.

To build them locally (needs Python 3 and about 1 GB of disk for the download):

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/search-resources/requirements.txt
.venv/bin/python scripts/search-resources/build.py public/resources/search
```

The requirements pin every package by the hashes of its published files, so pip installs
nothing else; take a new version's hashes from `https://pypi.org/pypi/<package>/<version>/json`.
The deploy workflow does the same before building the web app. Without them the app still
works; anything that needs Smart search says its resources couldn't be downloaded.
