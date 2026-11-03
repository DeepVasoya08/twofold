"""Usage: python build.py

Works out the search vectors of the descriptions document photos are compared with, and
writes them to src/lib/file-sort/look-prompts.ts. Run it again after changing PROMPTS.

The vectors come from the text half of OpenCLIP ViT-B/32 (LAION-2B weights, MIT licence),
the model Smart search uses. Shipping them saves every device the text half's download
just to tell document photos apart. The app's 8-bit copy of the text half gives the same
vectors (cosine 0.999+ against these full-size ones; see docs/ai-search.md).

Needs: pip install open_clip_torch torch
"""
import base64
import os
import struct

import open_clip
import torch

# What each kind of picture looks like. A photo whose vector is closest to a document
# description, by a wide margin over the everyday ones, is a document photo.
PROMPTS = {
    'receipt': ['a photo of a receipt', 'a photo of a shop receipt', 'a photo of a bill'],
    'id': ['a photo of an ID card', 'a photo of a passport', 'a photo of a driving licence'],
    'paper': [
        'a photo of a document',
        'a scanned document',
        'a photo of a printed page of text',
        'a photo of a form',
        'a photo of a letter',
    ],
    'screen': [
        'a screenshot of a phone screen',
        'a screenshot of a website',
        'a screenshot of text',
    ],
    'notes': ['a photo of handwritten notes', 'a photo of a whiteboard'],
    'photo': [
        'a photo of people',
        'a photo of a person',
        'a photo of a landscape',
        'a photo of food',
        'a photo of an animal',
        'a photo of a city street',
        'a photo of a room',
        'a photo of an object',
        'a selfie',
        'a photo of a building',
        'a photo of a car',
        'a photo of a sign',
        'a photo of a book cover',
        'a photo of a phone',
        'a photo of a laptop',
        'a photo of a poster',
        'a photo of a product',
        'a photo of a bottle',
        'a photo of bookshelves',
        'a photo of a calculator',
        'a photo of a magazine cover',
    ],
}

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lib', 'file-sort', 'look-prompts.ts')


def pack(vector):
    """As src/lib/search/segment.ts packs a vector: a scale (f32) and 512 signed bytes."""
    largest = max(abs(v) for v in vector)
    scale = largest / 127 if largest > 0 else 1
    out = struct.pack('>f', scale)
    return out + bytes((round(v / scale) & 0xFF) for v in vector)


def main():
    model, _, _ = open_clip.create_model_and_transforms('ViT-B-32', pretrained='laion2b_s34b_b79k')
    model.eval()
    tokenizer = open_clip.get_tokenizer('ViT-B-32')
    rows = [(look, prompt) for look, prompts in PROMPTS.items() for prompt in prompts]
    with torch.no_grad():
        vectors = model.encode_text(tokenizer([prompt for _, prompt in rows]))
        vectors = torch.nn.functional.normalize(vectors, dim=-1).tolist()
    packed = b''.join(pack(vector) for vector in vectors)
    encoded = base64.urlsafe_b64encode(packed).decode().rstrip('=')
    lines = [
        '// Written by scripts/document-looks/build.py. Don\'t edit by hand.',
        "import type { Look } from './looks';",
        '',
        '/** The descriptions document photos are compared with, in the order of LOOK_VECTORS. */',
        'export const LOOK_PROMPTS: readonly { look: Look; prompt: string }[] = [',
        *[f"  {{ look: '{look}', prompt: '{prompt}' }}," for look, prompt in rows],
        '];',
        '',
        '/** Their search vectors, packed as search segments pack them (base64url). */',
        'export const LOOK_VECTORS =',
        *[f"  '{encoded[i:i + 96]}'" + (' +' if i + 96 < len(encoded) else ';') for i in range(0, len(encoded), 96)],
        '',
    ]
    with open(OUT, 'w', encoding='utf-8') as out:
        out.write('\n'.join(lines))
    print(f'Wrote {len(rows)} descriptions to {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
