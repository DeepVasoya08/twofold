import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

import { distinctPhotos, goTo, signUp } from './helpers';

// A JPEG whose EXIF says it was taken on 14 July 2019.
const DATED = readFileSync(join(import.meta.dirname, 'fixtures/dated.jpg'));
// A PNG with no date of its own: Google's JSON details say 20 August 2016, noon UTC.
const [BEACH = Buffer.alloc(0), PORTO = Buffer.alloc(0), SECRET = Buffer.alloc(0)] =
  distinctPhotos(3);
const BEACH_DETAILS = Buffer.from(
  JSON.stringify({ title: 'beach.png', photoTakenTime: { timestamp: '1471694400' } }),
);

/** A zip as Takeout writes them: photos stored, JSON details deflated. */
function takeoutZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = Buffer.from(path);
    const deflate = path.endsWith('.json');
    const body = deflate ? deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    locals.push(header, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const ZIP = takeoutZip({
  'Takeout/Google Photos/Photos from 2016/beach.png': BEACH,
  'Takeout/Google Photos/Photos from 2016/beach.png.supplemental-metadata.json': BEACH_DETAILS,
  'Takeout/Google Photos/Summer Trip/beach.png': BEACH,
  'Takeout/Google Photos/Summer Trip/beach.png.supplemental-metadata.json': BEACH_DETAILS,
  'Takeout/Google Photos/Photos from 2019/holiday.jpg': DATED,
  'Takeout/Google Photos/Photos from 2019/clip.mp4': Buffer.from('not really a video'),
});

test('imports a Google Takeout export with its dates and albums, once', async ({ page }) => {
  await signUp(page);
  // An empty library offers it straight away.
  await page.getByRole('link', { name: 'Import from Google or Apple' }).click();
  await expect(page.getByRole('heading', { name: 'Import photos' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Google Photos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  const choose = async () => {
    await page.getByLabel('Choose export zip files').setInputFiles({
      name: 'takeout-20261030T000000Z-001.zip',
      mimeType: 'application/zip',
      buffer: ZIP,
    });
  };
  await choose();
  await expect(page.getByText('Found 2 photos in 1 album.')).toBeVisible();
  await expect(page.getByText('1 video will be skipped')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /2019/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /2016/ })).toBeChecked();
  await page.getByRole('button', { name: 'Import 2 photos' }).click();
  await expect(page.getByText('Import finished. 2 photos imported.')).toBeVisible();

  await goTo(page, 'Photos');
  await expect(page.getByRole('heading', { name: 'July 2019' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'August 2016' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Photo from Aug 20, 2016/ })).toBeVisible();

  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Summer Trip/ }).click();
  await expect(page.getByRole('link', { name: /^Photo from Aug 20, 2016/ })).toBeVisible();

  // The same export again brings in nothing new, and makes no second album. This time the
  // way in is the upload dialog, which every screen has.
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Add photos' })
    .getByRole('button', { name: /Moving from Google or Apple Photos/ })
    .click();
  await page.getByRole('button', { name: 'Import more' }).click();
  await choose();
  await page.getByRole('button', { name: 'Import 2 photos' }).click();
  await expect(page.getByText('Import finished. 0 photos imported, 2 already here.')).toBeVisible();
  await goTo(page, 'Albums');
  await expect(page.getByRole('link', { name: /Summer Trip/ })).toHaveCount(1);
});

const PART = 'iCloud Photos Part 1 of 1';
const APPLE_ZIP = takeoutZip({
  [`${PART}/Photos/IMG_0001.PNG`]: PORTO,
  [`${PART}/Photos/IMG_0001.MOV`]: Buffer.from('the moving part of a Live Photo'),
  [`${PART}/Photos/IMG_0002.PNG`]: SECRET,
  [`${PART}/Photos/IMG_0003.PNG`]: BEACH,
  [`${PART}/Photos/Photo Details.csv`]: Buffer.from(
    [
      'imgName,fileChecksum,favorite,hidden,deleted,originalCreationDate,viewCount,importDate',
      'IMG_0001.PNG,a,yes,no,no,"Wednesday May 3,2017 12:00 PM GMT",1,',
      'IMG_0002.PNG,b,no,yes,no,"Thursday May 4,2017 12:00 PM GMT",0,',
      'IMG_0003.PNG,c,no,no,yes,"Friday May 5,2017 12:00 PM GMT",0,',
      '',
    ].join('\n'),
  ),
  [`${PART}/Albums/Porto.csv`]: Buffer.from('Images\nIMG_0001.PNG\n'),
});

test('imports a copy of iCloud Photos with dates, albums and favorites', async ({ page }) => {
  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Import from Apple Photos' }).click();
  await expect(page.getByRole('tab', { name: 'Apple Photos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByText('Moving everything, with albums? Use a copy of your iCloud Photos').click();
  await expect(page.getByText('Export Unmodified Originals')).toBeVisible();

  await page.getByLabel('Choose export zip files').setInputFiles({
    name: 'iCloud Photos Part 1 of 1.zip',
    mimeType: 'application/zip',
    buffer: APPLE_ZIP,
  });
  // The Live Photo's clip isn't a video to skip, the deleted photo isn't offered, and the
  // hidden one waits for the private space.
  await expect(page.getByText('Found 1 photo in 1 album.')).toBeVisible();
  await expect(page.getByText('1 hidden photo will be left out')).toBeVisible();
  await expect(page.getByText(/video/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Import 1 photo' }).click();
  await expect(page.getByText('Import finished. 1 photo imported.')).toBeVisible();

  await goTo(page, 'Favorites');
  await expect(page.getByRole('link', { name: /^Photo from May 3, 2017/ })).toBeVisible();
  await goTo(page, 'Albums');
  await page.getByRole('link', { name: /Porto/ }).click();
  await expect(page.getByRole('link', { name: /^Photo from May 3, 2017/ })).toBeVisible();
});

/**
 * Plays Google's sign-in, Picker API, photo host and token revocation for `context`. Picking
 * finishes on the second check unless `picks` is false. Returns what reached Google, in order.
 */
async function playGoogle(context: BrowserContext, picks = true): Promise<{ events: string[] }> {
  const events: string[] = [];
  let polls = 0;
  await context.route('https://accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
    );
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.hash = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      access_token: 'e2e-token',
      token_type: 'Bearer',
    }).toString();
    await route.fulfill({ status: 302, headers: { Location: back.toString() } });
  });
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE',
  };
  const session = (mediaItemsSet: boolean) =>
    mediaItemsSet
      ? // As Google answers once picking is done: no picking link or polling settings.
        { id: 's1', mediaItemsSet, pickingConfig: { maxItemCount: '2000' } }
      : {
          id: 's1',
          pickerUri: 'https://photos.google.com/picker/s1',
          mediaItemsSet,
          pollingConfig: { pollInterval: '1s', timeoutIn: '600s' },
        };
  await context.route('https://photospicker.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    expect(request.headers().authorization).toBe('Bearer e2e-token');
    const { pathname } = new URL(request.url());
    let body: unknown = {};
    if (request.method() === 'POST') body = session(false);
    else if (request.method() === 'DELETE') events.push('session ended');
    else if (pathname === '/v1/sessions/s1') body = session(picks && (polls += 1) >= 2);
    else if (pathname === '/v1/mediaItems') {
      body = {
        mediaItems: [
          {
            id: 'p1',
            createTime: '2015-06-01T10:00:00Z',
            type: 'PHOTO',
            mediaFile: {
              baseUrl: 'https://lh3.googleusercontent.com/ppa/p1',
              mimeType: 'image/png',
              filename: 'lake.png',
            },
          },
          {
            id: 'v1',
            type: 'VIDEO',
            mediaFile: {
              baseUrl: 'https://lh3.googleusercontent.com/ppa/v1',
              mimeType: 'video/mp4',
            },
          },
        ],
      };
    }
    await route.fulfill({ status: 200, headers: cors, json: body });
  });
  await context.route('https://lh3.googleusercontent.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    expect(route.request().url()).toBe('https://lh3.googleusercontent.com/ppa/p1=d');
    expect(route.request().headers().authorization).toBe('Bearer e2e-token');
    await route.fulfill({ status: 200, headers: cors, body: SECRET, contentType: 'image/png' });
  });
  await context.route('https://oauth2.googleapis.com/**', async (route) => {
    const request = route.request();
    expect(request.url()).toBe('https://oauth2.googleapis.com/revoke');
    expect(request.method()).toBe('POST');
    // The token goes in the body, never the address.
    expect(request.postData()).toBe('token=e2e-token');
    events.push('token revoked');
    await route.fulfill({ status: 200, headers: cors, json: {} });
  });
  return { events };
}

test('connects Google Photos and imports the picked photos, straight from Google', async ({
  page,
  context,
}) => {
  const google = await playGoogle(context);

  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Import from Google Photos' }).click();
  const signInWindow = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect Google Photos' }).click();
  // The sign-in window hands the token back and closes itself.
  await (await signInWindow).waitForEvent('close');
  await expect(page.getByRole('link', { name: 'Choose photos in Google Photos' })).toHaveAttribute(
    'href',
    'https://photos.google.com/picker/s1/autoclose',
  );
  await expect(page.getByText('Import finished. 1 photo imported.')).toBeVisible();
  // Once the import is done, the session is ended at Google and the token revoked, so the
  // address the sign-in came back to, which the browser may keep, holds a dead token.
  await expect.poll(() => google.events).toEqual(['session ended', 'token revoked']);

  await goTo(page, 'Photos');
  await expect(page.getByRole('link', { name: /^Photo from Jun 1, 2015/ })).toBeVisible();
});

test('cancelling Google Photos while picking signs out of Google', async ({ page, context }) => {
  const google = await playGoogle(context, false);

  await signUp(page);
  await goTo(page, 'Settings');
  await page.getByRole('button', { name: 'Import from Google Photos' }).click();
  const signInWindow = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Connect Google Photos' }).click();
  await (await signInWindow).waitForEvent('close');
  await expect(page.getByRole('link', { name: 'Choose photos in Google Photos' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Photos' })).toBeVisible();
  await expect.poll(() => google.events).toEqual(['session ended', 'token revoked']);
});

test('the Apple tab offers the phone’s own photo picker first', async ({ page }) => {
  await signUp(page);
  await page
    .getByRole('button', { name: /^Upload/ })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Add photos' })
    .getByRole('button', { name: /Moving from Google or Apple Photos/ })
    .click();
  await page.getByRole('tab', { name: 'Apple Photos' }).click();
  await page.getByRole('button', { name: 'Upload photos' }).click();
  await expect(page.getByRole('dialog', { name: 'Add photos' })).toBeVisible();
});
