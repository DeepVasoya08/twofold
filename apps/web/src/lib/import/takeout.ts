/**
 * Works out what a Google Takeout export holds, from file names and sizes alone: which files
 * are photos, which albums each is in, which JSON file next to it carries its details, and
 * what is skipped (videos, and everything else). Nothing is read until the import runs.
 *
 * In a Takeout export, Google Photos is a folder per year ("Photos from 2019") plus a folder
 * per album. A photo in an album is in both, so photos are matched across folders by name and
 * size and imported once, in every album they were in. Most photos have a JSON "sidecar"
 * whose name Google builds from the photo's, sometimes cut short or with a "(1)" moved.
 */

/** One file in an export: in a zip or a picked folder, read only when needed. */
export interface ImportSource {
  /** Its path inside the export, with forward slashes. */
  path: string;
  size: number;
  /** The file's own date, where there is one (a picked folder's files have it). */
  lastModified?: number;
  read: () => Promise<Uint8Array<ArrayBuffer>>;
}

export interface ImportItem {
  name: string;
  size: number;
  /** Its media type, from its extension. */
  type: string;
  /** The year folder it was in, if any. */
  year: number | null;
  /** Titles of the albums it was in. */
  albums: string[];
  source: ImportSource;
  /** Google's JSON details for it, if found. */
  sidecar?: ImportSource;
  /** When it was taken, where the export's own records say (in ms). */
  takenAt?: number;
  /** Whether it was a favorite, where the export's own records say. */
  favorite?: boolean;
  /** Whether it was hidden in the app it came from. */
  hidden?: boolean;
}

export interface ImportPlan {
  items: ImportItem[];
  /** Videos found, which Twofold can't store yet (Live Photos' clips aren't counted). */
  videos: number;
  /** Album titles, in the order found. */
  albums: string[];
}

const PHOTO_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
};

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'm4v',
  '3gp',
  'avi',
  'mkv',
  'webm',
  'mts',
  'm2ts',
  'wmv',
  'mpg',
  'mpeg',
]);

/** Year folders, in the languages Takeout names them in most often. */
const YEAR_FOLDER =
  /^(?:Photos from|Fotos von|Fotos de|Photos de|Foto dal|Foto's uit|Fotos från|Zdjęcia z) ((?:19|20)\d\d)$/;

/** Folders that hold photos but aren't albums. */
const NOT_ALBUMS = new Set(['Archive', 'Google Photos', 'Takeout']);
/** Folders whose photos were deleted or hidden; never imported. */
const SKIPPED_FOLDERS = new Set(['Trash', 'Bin', 'Locked Folder']);

const SUPPLEMENTAL = 'supplemental-metadata';
/** Google cuts a sidecar's name, before ".json", to this many characters at most. */
const SIDECAR_STEM_MAX = 46;
/** A cut-short sidecar name still has at least this much of the photo's name. */
const SIDECAR_STEM_MIN = 30;

export function splitPath(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const folderPath = slash < 0 ? '' : path.slice(0, slash);
  const folder = folderPath.slice(folderPath.lastIndexOf('/') + 1);
  return { folder, name };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The media type of a photo file, by its extension; null if it isn't one. */
export function photoTypeOf(name: string): string | null {
  return PHOTO_EXTENSIONS[extensionOf(name)] ?? null;
}

export function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(name));
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot <= 0 ? name : name.slice(0, dot)).toLowerCase();
}

/** The names, without extensions, of the photos among a folder's files. */
export function photoStems(names: Iterable<string>): Set<string> {
  const stems = new Set<string>();
  for (const name of names) if (photoTypeOf(name) !== null) stems.add(stemOf(name));
  return stems;
}

/**
 * Whether a video is the moving part of a Live Photo (or a motion photo): a clip next to a
 * photo with the same name, such as IMG_0001.MOV beside IMG_0001.HEIC. The still comes in;
 * the clip is left out, and not counted as a video.
 */
export function isLiveClip(name: string, stems: ReadonlySet<string>): boolean {
  return isVideo(name) && stems.has(stemOf(name));
}

/** "IMG(1).jpg" is the second "IMG.jpg": its name without the number, and the number. */
function splitDuplicate(name: string): { base: string; copy: string } {
  const match = /^(.*)(\(\d+\))(\.[^.]+)$/.exec(name);
  return match
    ? { base: `${match[1] ?? ''}${match[3] ?? ''}`, copy: match[2] ?? '' }
    : {
        base: name,
        copy: '',
      };
}

/** A sidecar's name, reduced to the photo name it was made from (maybe cut short). */
function sidecarStem(jsonName: string): { stem: string; copy: string } {
  let stem = jsonName.slice(0, -'.json'.length);
  const copy = /\(\d+\)$/.exec(stem)?.[0] ?? '';
  stem = stem.slice(0, stem.length - copy.length);
  const dot = stem.lastIndexOf('.');
  const tail = dot < 0 ? '' : stem.slice(dot + 1);
  if (tail.length > 0 && SUPPLEMENTAL.startsWith(tail)) stem = stem.slice(0, dot);
  return { stem, copy };
}

/** Finds a photo's sidecar among the JSON files in its folder. */
function findSidecar(
  name: string,
  sidecars: readonly { stem: string; copy: string; source: ImportSource }[],
): ImportSource | undefined {
  const { base, copy } = splitDuplicate(name);
  // An edited copy shares the original's details.
  const original = base.replace(/-edited(\.[^.]+)$/, '$1');
  const withoutExtension = original.replace(/\.[^.]+$/, '');
  const candidates = sidecars.filter((sidecar) => sidecar.copy === copy);
  return (
    candidates.find((sidecar) => sidecar.stem === original) ??
    candidates.find((sidecar) => sidecar.stem === withoutExtension) ??
    candidates.find(
      (sidecar) =>
        sidecar.stem.length >= SIDECAR_STEM_MIN &&
        sidecar.stem.length <= SIDECAR_STEM_MAX &&
        original.startsWith(sidecar.stem),
    )
  )?.source;
}

/** Plans an import from the files of one or more Takeout exports. */
export function planTakeout(sources: readonly ImportSource[]): ImportPlan {
  const folders = new Map<string, ImportSource[]>();
  for (const source of sources) {
    const slash = source.path.lastIndexOf('/');
    const folderPath = slash < 0 ? '' : source.path.slice(0, slash);
    folders.set(folderPath, [...(folders.get(folderPath) ?? []), source]);
  }

  const items = new Map<string, ImportItem>();
  const albums: string[] = [];
  let videos = 0;
  for (const files of folders.values()) {
    const folder = splitPath(files[0]?.path ?? '').folder;
    if (SKIPPED_FOLDERS.has(folder)) continue;
    const year = YEAR_FOLDER.exec(folder)?.[1];
    const album = year === undefined && folder !== '' && !NOT_ALBUMS.has(folder) ? folder : null;
    const sidecars = files
      .filter((file) => file.path.toLowerCase().endsWith('.json'))
      .map((source) => ({ ...sidecarStem(splitPath(source.path).name), source }));
    const names = new Set(files.map((file) => splitPath(file.path).name));
    const stems = photoStems(names);
    let photosHere = 0;
    for (const source of files) {
      const { name } = splitPath(source.path);
      if (isVideo(name)) {
        if (!isLiveClip(name, stems)) videos += 1;
        continue;
      }
      const type = photoTypeOf(name);
      if (!type) continue;
      // Where Google kept an edited copy, that's the one to keep.
      const edited = name.replace(/(\.[^.]+)$/, '-edited$1');
      if (edited !== name && names.has(edited)) continue;
      photosHere += 1;
      const key = `${name}\u0000${String(source.size)}`;
      const existing = items.get(key);
      const sidecar = findSidecar(name, sidecars);
      if (existing) {
        if (album && !existing.albums.includes(album)) existing.albums.push(album);
        if (year !== undefined) existing.year = Number(year);
        if (sidecar && !existing.sidecar) existing.sidecar = sidecar;
        continue;
      }
      const item: ImportItem = {
        name,
        size: source.size,
        type,
        year: year === undefined ? null : Number(year),
        albums: album ? [album] : [],
        source,
      };
      if (sidecar) item.sidecar = sidecar;
      items.set(key, item);
    }
    if (album && photosHere > 0 && !albums.includes(album)) albums.push(album);
  }
  return { items: [...items.values()], videos, albums };
}

/** What Google's JSON details say about a photo. */
export interface SidecarDetails {
  /** When it was taken (`photoTakenTime.timestamp`, in seconds), in ms. */
  takenAt?: number;
  favorite?: boolean;
}

/** Reads Google's JSON details for a photo; anything missing or unreadable is left out. */
export function sidecarDetails(bytes: Uint8Array): SidecarDetails {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
  if (typeof json !== 'object' || json === null) return {};
  const details: SidecarDetails = {};
  if ('favorited' in json && typeof json.favorited === 'boolean') details.favorite = json.favorited;
  if (!('photoTakenTime' in json)) return details;
  const taken = json.photoTakenTime;
  if (typeof taken !== 'object' || taken === null || !('timestamp' in taken)) return details;
  const seconds = Number(taken.timestamp);
  if (Number.isFinite(seconds) && seconds > 0) details.takenAt = seconds * 1000;
  return details;
}
