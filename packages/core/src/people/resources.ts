/**
 * The face models, pinned: YuNet finds faces (OpenCV Zoo, MIT licence) and SFace
 * fingerprints them (OpenCV Zoo, Apache 2.0 licence, stored as 8-bit weights). They're
 * served whole from Arcafold's own origin under /resources/faces/ (apps/web/public), and
 * each app checks a file against the SHA-256 pinned here before it runs it. See
 * apps/web/scripts/face-models/README.md.
 */

export interface FaceResource {
  /** The file's name under /resources/faces/. A changed file gets a new name. */
  file: string;
  /** Size in bytes. */
  size: number;
  /** SHA-256, base64url. */
  sha256: string;
}

export const FACE_RESOURCES = {
  detector: {
    file: 'yunet-2023mar.onnx',
    size: 232_589,
    sha256: 'jyOD5N08-7RVPqhxgQf8BCMhDclk-fQoBgSATtJVL6Q',
  },
  recognizer: {
    file: 'sface-2021dec-w8.onnx',
    size: 9_935_199,
    sha256: 'PPdPcIQNYBbO_ZiLBtaIS774lYO6J0Eh_sFZiNF0X0g',
  },
} as const satisfies Record<'detector' | 'recognizer', FaceResource>;

/** Where the face models are served, on Arcafold's own origin. */
export const FACE_RESOURCE_PATH = '/resources/faces';
