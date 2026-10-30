import { isLiveClip, isVideo, photoStems, photoTypeOf, splitPath } from './takeout';
import type { ImportItem, ImportPlan, ImportSource } from './takeout';

/**
 * Works out what an Apple Photos export holds. Apple has no way for other apps to read a
 * library, so people bring one of three exports:
 *
 * - A copy of their iCloud Photos from privacy.apple.com: zips ("iCloud Photos Part 1 of 3")
 *   holding the originals, a "Photo Details" CSV with each photo's date, favorite, hidden and
 *   deleted flags, and an "Albums" folder with a CSV per album listing its photos by name.
 * - Photos downloaded from iCloud.com, as a zip of originals.
 * - On a Mac, a folder from Photos' "Export Unmodified Originals".
 *
 * The last two have no records beside the photos, so only the photos themselves are planned
 * (their EXIF dates are read when imported). Other exports of plain photos, from any app,
 * are planned the same way.
 */

/** CSVs bigger than this aren't Apple's records; they're left alone. */
const MAX_CSV_BYTES = 32 * 1024 * 1024;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Parses CSV text: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  for (let at = 0; at < body.length; at++) {
    const char = body.charAt(at);
    if (quoted) {
      if (char === '"' && body[at + 1] === '"') {
        field += '"';
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[at + 1] === '\n') at += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((each) => each.some((value) => value.trim() !== ''));
}

/**
 * When a photo was taken, as Apple's details write it ("Monday March 26,2018 9:12 AM GMT"),
 * in ms. ISO dates are read too. Undefined if it can't be read.
 */
export function parseAppleDate(text: string): number | undefined {
  const match =
    /^(?:[A-Za-z]+,?\s+)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*(?:GMT|UTC)?$/.exec(
      text.trim(),
    );
  if (match) {
    const month = MONTHS.indexOf((match[1] ?? '').toLowerCase());
    let hour = Number(match[4]);
    const half = match[7]?.toLowerCase();
    if (half === 'pm' && hour < 12) hour += 12;
    if (half === 'am' && hour === 12) hour = 0;
    if (month < 0 || hour > 23) return undefined;
    return Date.UTC(
      Number(match[3]),
      month,
      Number(match[2]),
      hour,
      Number(match[5]),
      Number(match[6] ?? 0),
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(text.trim())) return undefined;
  const parsed = Date.parse(text.trim());
  return Number.isNaN(parsed) ? undefined : parsed;
}

interface PhotoDetails {
  takenAt?: number;
  favorite: boolean;
  hidden: boolean;
  deleted: boolean;
}

const yes = (value: string | undefined) => /^(yes|true|1)$/i.test(value?.trim() ?? '');

/** The top folder of a path: one part of a split export. */
function partOf(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** What the export's CSVs say: each photo's details, and which photos each album holds. */
interface Records {
  /** By part, then by file name. */
  details: Map<string, Map<string, PhotoDetails>>;
  /** Album titles, and the names of their photos, in the order found. */
  albums: Map<string, Set<string>>;
}

async function readRecords(csvs: readonly ImportSource[]): Promise<Records> {
  const records: Records = { details: new Map(), albums: new Map() };
  const decoder = new TextDecoder();
  for (const csv of csvs) {
    if (csv.size > MAX_CSV_BYTES) continue;
    let rows: string[][];
    try {
      rows = parseCsv(decoder.decode(await csv.read()));
    } catch {
      continue;
    }
    const [header = [], ...data] = rows;
    const column = (name: string) => header.findIndex((each) => each.trim() === name);
    const nameAt = column('imgName');
    const { folder, name } = splitPath(csv.path);
    if (nameAt >= 0 && column('originalCreationDate') >= 0) {
      const part = partOf(csv.path);
      const details = records.details.get(part) ?? new Map<string, PhotoDetails>();
      records.details.set(part, details);
      const [dateAt, favoriteAt, hiddenAt, deletedAt] = [
        'originalCreationDate',
        'favorite',
        'hidden',
        'deleted',
      ].map(column);
      for (const row of data) {
        const photo = row[nameAt]?.trim();
        if (!photo) continue;
        const takenAt = parseAppleDate(row[dateAt ?? -1] ?? '');
        const entry: PhotoDetails = {
          favorite: yes(row[favoriteAt ?? -1]),
          hidden: yes(row[hiddenAt ?? -1]),
          deleted: yes(row[deletedAt ?? -1]),
        };
        if (takenAt !== undefined) entry.takenAt = takenAt;
        details.set(photo, entry);
      }
    } else if (folder === 'Albums') {
      const title = name.replace(/\.csv$/i, '').trim();
      if (!title) continue;
      const photos = records.albums.get(title) ?? new Set<string>();
      records.albums.set(title, photos);
      // Album CSVs list a photo name per row, under a header ("Images").
      const first = header[0]?.trim();
      const listed = first && photoTypeOf(first) !== null ? rows : data;
      for (const row of listed) {
        const photo = row[0]?.trim();
        if (photo) photos.add(photo);
      }
    }
  }
  return records;
}

/** A photo's details from the records of its own part, or failing that, any part. */
function detailsFor(records: Records, path: string, name: string): PhotoDetails | undefined {
  const own = records.details.get(partOf(path))?.get(name);
  if (own) return own;
  for (const details of records.details.values()) {
    const found = details.get(name);
    if (found) return found;
  }
  return undefined;
}

/** Plans an import from the files of an Apple Photos export (or any folder of photos). */
export async function planApple(sources: readonly ImportSource[]): Promise<ImportPlan> {
  const records = await readRecords(
    sources.filter((source) => source.path.toLowerCase().endsWith('.csv')),
  );
  const folders = new Map<string, ImportSource[]>();
  for (const source of sources) {
    const slash = source.path.lastIndexOf('/');
    const folderPath = slash < 0 ? '' : source.path.slice(0, slash);
    folders.set(folderPath, [...(folders.get(folderPath) ?? []), source]);
  }

  const items = new Map<string, ImportItem>();
  let videos = 0;
  for (const files of folders.values()) {
    const stems = photoStems(files.map((file) => splitPath(file.path).name));
    for (const source of files) {
      const { name } = splitPath(source.path);
      if (isVideo(name)) {
        if (!isLiveClip(name, stems)) videos += 1;
        continue;
      }
      const type = photoTypeOf(name);
      if (!type) continue;
      const details = detailsFor(records, source.path, name);
      if (details?.deleted) continue;
      const key = `${name}\u0000${String(source.size)}`;
      if (items.has(key)) continue;
      // Only Apple's records give a year here: a file's own date is often when it was
      // exported. Photos without one are dated by their EXIF when they're imported.
      const takenAt = details?.takenAt;
      const item: ImportItem = {
        name,
        size: source.size,
        type,
        year: takenAt === undefined ? null : new Date(takenAt).getUTCFullYear(),
        albums: [],
        source,
      };
      if (takenAt !== undefined) item.takenAt = takenAt;
      if (details?.favorite) item.favorite = true;
      if (details?.hidden) item.hidden = true;
      items.set(key, item);
    }
  }

  const albums: string[] = [];
  const byName = new Map<string, ImportItem[]>();
  for (const item of items.values())
    byName.set(item.name, [...(byName.get(item.name) ?? []), item]);
  for (const [title, photos] of records.albums) {
    let used = false;
    for (const photo of photos) {
      for (const item of byName.get(photo) ?? []) {
        if (!item.albums.includes(title)) item.albums.push(title);
        used = true;
      }
    }
    if (used) albums.push(title);
  }
  return { items: [...items.values()], videos, albums };
}
