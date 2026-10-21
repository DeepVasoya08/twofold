# Face models

The People feature runs two open models from the [OpenCV Zoo](https://github.com/opencv/opencv_zoo)
in the browser. Both are committed under `src/lib/people/models/`, with their licences, and the
app checks each file's SHA-256 before using it (`src/lib/people/models.ts`).

| File | Source | Licence | SHA-256 |
|---|---|---|---|
| `yunet-2023mar.onnx` | `models/face_detection_yunet/face_detection_yunet_2023mar.onnx`, unchanged | MIT | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `sface-2021dec-w8.onnx` | `models/face_recognition_sface/face_recognition_sface_2021dec.onnx`, converted as below | Apache 2.0 | `3cf74f70840d6016cefd988b06d6884bbef89583ba274121fec15988d1745f48` |

## Why SFace is converted

The full SFace model is 38.7 MB, too large to serve as one static asset (the limit is 25 MiB)
and a heavy download. The Zoo's own 8-bit version is 9.9 MB, but it runs about five times
slower in the browser's WASM runtime. `weight_only_int8.py` stores the weights as 8-bit numbers
with one scale per output channel and a `DequantizeLinear` in front of each layer, so the file
is 9.9 MB while the maths stays in 32-bit floats. ONNX Runtime folds the conversion away when
it loads the model, so it runs as fast as the full model. Fingerprints stay within 0.01 cosine
similarity of the full model's.

To rebuild it (the output is byte for byte the same):

```sh
python -m venv venv && ./venv/bin/pip install onnx==1.23.2
./venv/bin/python weight_only_int8.py face_recognition_sface_2021dec.onnx sface-2021dec-w8.onnx
sha256sum sface-2021dec-w8.onnx
```

The original's SHA-256 is `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`.
