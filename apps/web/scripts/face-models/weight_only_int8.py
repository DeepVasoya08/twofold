"""Usage: python weight_only_int8.py face_recognition_sface_2021dec.onnx sface-2021dec-w8.onnx

Stores Conv/Gemm/MatMul weights as per-channel int8 plus a DequantizeLinear node, so the
file is ~4x smaller while maths stays fp32 (the runtime folds the dequantize at load)."""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src)
if model.opset_import[0].version < 13:
    from onnx import version_converter
    model = version_converter.convert_version(model, 13)
g = model.graph
inits = {i.name: i for i in g.initializer}
graph_inputs = {i.name for i in g.input}
targets = {}
for node in g.node:
    if node.op_type in ('Conv', 'Gemm', 'MatMul') and len(node.input) > 1 and node.input[1] in inits:
        targets[node.input[1]] = node.op_type
new_nodes = []
for name, op in targets.items():
    w = numpy_helper.to_array(inits[name]).astype(np.float32)
    if w.size < 1024:
        continue
    axis = 0 if op == 'Conv' or w.ndim != 2 else (0 if op == 'Gemm' else 1)
    red = tuple(i for i in range(w.ndim) if i != axis)
    scale = np.abs(w).max(axis=red) / 127.0
    scale[scale == 0] = 1.0
    shape = [1] * w.ndim; shape[axis] = -1
    q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
    g.initializer.remove(inits[name])
    g.initializer.extend([
        numpy_helper.from_array(q, name + '_q'),
        numpy_helper.from_array(scale.astype(np.float32), name + '_scale'),
        numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + '_zero'),
    ])
    new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_scale', name + '_zero'], [name], axis=axis))
# Initializers listed as graph inputs (old exporters) must not stay inputs.
for inp in list(g.input):
    if inp.name in targets or inp.name in inits:
        g.input.remove(inp)
for n in reversed(new_nodes):
    g.node.insert(0, n)
onnx.checker.check_model(model)
onnx.save(model, dst)
print('quantized', len(new_nodes), 'opset', [o.version for o in model.opset_import])
