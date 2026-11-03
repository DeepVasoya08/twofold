# Document looks

`build.py` writes `src/lib/file-sort/look-prompts.ts`: the descriptions that document photos
are compared with, as search vectors from the text half of OpenCLIP ViT-B/32 (LAION-2B,
MIT licence). Shipping the vectors means a device never downloads the text half just to
find document photos. Run it after changing `PROMPTS`, then format the output with
`pnpm exec prettier --write src/lib/file-sort/look-prompts.ts`.

```
pip install open_clip_torch torch
python build.py
```

## How a photo is judged

`documentLook` in `src/lib/file-sort/looks.ts` scores a photo's vector against every
description. Each score is the similarity scaled by 100 (CLIP's logit scale). It then turns
the scores into shares of 1 (softmax). A photo is a document photo when the document
descriptions take at least 80% of the share (`DOCUMENT_SHARE`). It gets the look of its
closest document description:

- receipt goes to Receipts and invoices
- id goes to IDs and travel
- notes goes to Notes
- paper and screen don't get a category

## Tuning (2026-11-03)

The images were embedded with the same model at full size, from a 640 px preview as the app
uses.

| Set                                                                | Pictures | Counted as documents |
| ------------------------------------------------------------------ | -------- | -------------------- |
| Flickr30k test (everyday photos)                                   | 300      | 0%                   |
| TextVQA validation (street photos full of signs, books, packaging) | 200      | 8%                   |
| CORD v2 (photos of receipts)                                       | 80       | 100%                 |
| FUNSD (scanned forms)                                              | 60       | 100%                 |
| DocVQA (scanned documents)                                         | 60       | 87%                  |
| ScreenSpot (phone and web screenshots)                             | 40       | 95%                  |

The 8% from TextVQA are mostly open book pages, whiteboards and handwritten notes, which
are documents in their own right. Adding everyday descriptions for things that carry text
(book and magazine covers, phones, laptops, posters, products, bottles, bookshelves,
calculators) cut it from 29% at the start. ID cards weren't in any test set.

`src/lib/file-sort/looks.fixtures.ts` keeps six of these vectors for the unit tests.
