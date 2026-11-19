import type {
  CreateInviteRequest,
  MemberAccess,
  PhotoPart,
  StoredAlbum,
  StoredJoined,
  StoredPendingInvite,
  StoredPhoto,
  StoredProfilePhoto,
} from '@arcafold/types';

import { ApiError } from '../api';
import type { InviteApi, SpaceApi } from '../api';

/**
 * An in-memory stand-in for the storage API, holding exactly what the server would. A
 * member's share token reaches its owner's space, but not the owner-only routes. A token
 * given one album reaches only that album's listed photos; if it may edit, it can also add
 * photos to the album and take any out.
 */
export class FakeServer {
  photos = new Map<
    string,
    { token: string; photo: StoredPhoto; committed: boolean; trashed?: boolean }
  >();
  files = new Map<string, Uint8Array<ArrayBuffer>>();
  albums = new Map<string, { token: string; album: StoredAlbum; shared: string | null }>();
  /** By `album/photo`: a shared album's sealed copy of a photo's details. */
  items = new Map<string, { album: string; photo: string; meta: string }>();
  /** By `album/photo`: photos someone given the album took out, until the owner catches up. */
  removed = new Set<string>();
  /**
   * By share token: whose space it opens, the member record, its album if limited, and what
   * it may do.
   */
  members = new Map<
    string,
    { space: string; id: string; meta: string; album: string | null; access: MemberAccess }
  >();
  joined = new Map<string, { token: string; joined: StoredJoined }>();
  /** By space token. */
  profilePhotos = new Map<string, StoredProfilePhoto>();
  /** By record id: each space's invites in progress. */
  pending = new Map<string, { token: string; invite: StoredPendingInvite }>();
  /** By `token/id`: each space's sealed face segments and people. */
  faceSegments = new Map<string, { token: string; id: string; data: string }>();
  /** By `token/id`: each space's sealed search segments. */
  searchSegments = new Map<string, { token: string; id: string; data: string }>();
  people = new Map<string, { token: string; id: string; meta: string }>();
  /** By `token/id`: each space's sealed taught words. */
  words = new Map<string, { token: string; id: string; meta: string }>();
  /** By `token/id`: each space's sealed smart albums. */
  smartAlbums = new Map<string, { token: string; id: string; meta: string }>();
  /** By space token: its sealed upload key. */
  uploadKeys = new Map<string, string>();
  /** By upload-only token: the space it adds photos to, and the token's id. */
  uploadTokens = new Map<string, { space: string; id: string }>();

  /**
   * An upload-only token reaches only starting, uploading and committing photos, which are
   * marked as sealed for the owner.
   */
  private uploadOnly(api: SpaceApi): SpaceApi {
    const allowed = new Set<string>(['createPhoto', 'putFile', 'commitPhoto']);
    const refuse = () => Promise.reject(new ApiError(403, 'Upload only'));
    return Object.fromEntries(
      Object.entries(api).map(([name, call]) => [
        name,
        allowed.has(name)
          ? name === 'createPhoto'
            ? (photo: StoredPhoto) => {
                const created = api.createPhoto(photo);
                const entry = this.photos.get(photo.id);
                if (entry) entry.photo = { ...entry.photo, sealedForOwner: true };
                return created;
              }
            : call
          : refuse,
      ]),
    ) as SpaceApi;
  }

  api = (token: string): SpaceApi => {
    const uploader = this.uploadTokens.get(token);
    if (uploader) return this.uploadOnly(this.api(uploader.space));
    const member = this.members.get(token);
    const space = member?.space ?? token;
    const scope = member?.album ?? null;
    const ownerOnly = () => {
      if (member) throw new ApiError(403, 'Owner only');
    };
    const writable = () => {
      if (scope !== null) throw new ApiError(403, 'Album only');
      if (member?.access === 'view') throw new ApiError(403, 'View only');
    };
    /** Someone given one album who may edit it. */
    const albumEditor = scope !== null && member?.access === 'edit';
    /** Uploading: a library editor, or an album editor (photos sealed for the album). */
    const mayAdd = () => {
      if (!albumEditor) writable();
    };
    /** An upload an album editor started for their album and hasn't finished. */
    const ownUpload = (id: string) => {
      const entry = this.photos.get(id);
      if (entry?.token !== space || entry.committed || entry.photo.sealedForAlbum !== scope) {
        throw new ApiError(404, 'Not here');
      }
      return entry;
    };
    // Someone given one album sees only what it lists, and nothing in Recently deleted.
    const listed = (id: string) =>
      scope === null || (this.items.has(`${scope}/${id}`) && !this.photos.get(id)?.trashed);
    const editOnly = () => {
      if (member && (scope !== null || member.access === 'view')) {
        throw new ApiError(403, 'View only');
      }
    };
    const moveTrash = (photos: { id: string; meta: string }[], trashed: boolean) => {
      writable();
      const moved: string[] = [];
      for (const { id, meta } of photos) {
        const entry = this.photos.get(id);
        if (entry?.token !== space || !entry.committed || Boolean(entry.trashed) === trashed) {
          continue;
        }
        entry.trashed = trashed;
        entry.photo = { ...entry.photo, meta };
        delete entry.photo.sealedForOwner;
        delete entry.photo.sealedForAlbum;
        moved.push(id);
      }
      return Promise.resolve({ photoIds: moved });
    };
    const mine = (id: string) => {
      const entry = this.photos.get(id);
      if (entry?.token !== space || !listed(id)) throw new ApiError(404, 'Not here');
      return entry;
    };
    const ownAlbum = (id: string) => {
      const entry = this.albums.get(id);
      if (entry?.token !== space) throw new ApiError(404, 'Not here');
      return entry;
    };
    const unshare = (album: string) => {
      const entry = this.albums.get(album);
      if (entry) entry.shared = null;
      for (const [key, item] of this.items) if (item.album === album) this.items.delete(key);
      for (const key of this.removed) if (key.startsWith(`${album}/`)) this.removed.delete(key);
      for (const [key, each] of this.members) if (each.album === album) this.members.delete(key);
    };
    return {
      listPhotos: () =>
        Promise.resolve({
          photos: [...this.photos.values()]
            .filter(
              (entry) =>
                entry.token === space &&
                entry.committed &&
                !entry.trashed &&
                listed(entry.photo.id),
            )
            .map((entry) => {
              if (scope === null) return entry.photo;
              // The album's copy, as the server lists it: nothing about how the space keeps it.
              const { id, thumbSize, fullSize } = entry.photo;
              const meta = this.items.get(`${scope}/${id}`)?.meta ?? '';
              return { id, meta, thumbSize, fullSize };
            }),
          next: null,
        }),
      listAlbums: () =>
        Promise.resolve({
          albums: [...this.albums.values()]
            .filter((entry) =>
              scope === null ? entry.token === space : entry.album.id === scope && entry.shared,
            )
            .map((entry) => {
              if (scope !== null) return { id: entry.album.id, meta: entry.shared ?? '' };
              const removed = [...this.removed]
                .map((key) => key.split('/'))
                .filter(([album]) => album === entry.album.id)
                .map(([, photo]) => photo ?? '');
              return removed.length > 0 ? { ...entry.album, removed } : entry.album;
            }),
        }),
      createPhoto: (photo) => {
        mayAdd();
        const stored = scope === null ? photo : { ...photo, sealedForAlbum: scope };
        this.photos.set(photo.id, { token: space, photo: stored, committed: false });
        return Promise.resolve(undefined);
      },
      putFile: (id: string, part: PhotoPart, bytes: Uint8Array<ArrayBuffer>) => {
        if (albumEditor) ownUpload(id);
        else mine(id);
        this.files.set(`${id}/${part}`, bytes);
        // Like the server: the second file commits the photo.
        const entry = this.photos.get(id);
        const both = this.files.has(`${id}/thumb`) && this.files.has(`${id}/full`);
        const committed = Boolean(entry && both && !entry.committed);
        if (entry && committed) entry.committed = true;
        return Promise.resolve({ committed });
      },
      commitPhoto: (id) => {
        (albumEditor ? ownUpload(id) : mine(id)).committed = true;
        return Promise.resolve(undefined);
      },
      getFile: (id, part) => {
        mine(id);
        const file = this.files.get(`${id}/${part}`);
        return file ? Promise.resolve(file) : Promise.reject(new ApiError(404, 'Not here'));
      },
      getThumbs: (ids, onThumb) => {
        const parts = ids.map((id) => {
          const entry = this.photos.get(id);
          const visible = entry?.token === space && entry.committed && listed(id);
          return visible ? (this.files.get(`${id}/thumb`) ?? null) : null;
        });
        for (const [index, part] of parts.entries()) onThumb?.(index, part);
        return Promise.resolve(parts);
      },
      listTrash: () => {
        editOnly();
        return Promise.resolve({
          photos: [...this.photos.values()]
            .filter((entry) => entry.token === space && entry.trashed)
            .map((entry) => entry.photo),
          next: null,
        });
      },
      trashPhotos: (photos) => moveTrash(photos, true),
      restorePhotos: (photos) => moveTrash(photos, false),
      updatePhoto: (id, meta) => {
        writable();
        const entry = mine(id);
        entry.photo = { ...entry.photo, meta };
        delete entry.photo.sealedForOwner;
        delete entry.photo.sealedForAlbum;
        return Promise.resolve(undefined);
      },
      deletePhoto: (id) => {
        if (albumEditor) ownUpload(id);
        else {
          writable();
          mine(id);
        }
        this.photos.delete(id);
        for (const [key, item] of this.items) if (item.photo === id) this.items.delete(key);
        for (const key of this.removed) if (key.endsWith(`/${id}`)) this.removed.delete(key);
        this.files.delete(`${id}/thumb`);
        this.files.delete(`${id}/full`);
        return Promise.resolve(undefined);
      },
      createAlbum: async (album) => {
        writable();
        await Promise.resolve();
        this.albums.set(album.id, { token: space, album, shared: null });
      },
      updateAlbum: async (id, meta) => {
        writable();
        await Promise.resolve();
        ownAlbum(id).album.meta = meta;
      },
      deleteAlbum: async (id) => {
        writable();
        await Promise.resolve();
        ownAlbum(id);
        unshare(id);
        this.albums.delete(id);
      },
      shareAlbum: async (id, meta) => {
        writable();
        await Promise.resolve();
        ownAlbum(id).shared = meta;
      },
      unshareAlbum: async (id) => {
        ownerOnly();
        await Promise.resolve();
        unshare(id);
      },
      listAlbumItems: async (id) => {
        writable();
        await Promise.resolve();
        return {
          photoIds: [...this.items.values()]
            .filter((item) => item.album === id && this.albums.get(id)?.token === space)
            .map((item) => item.photo),
        };
      },
      putAlbumItem: async (id, photoId, meta) => {
        mayAdd();
        await Promise.resolve();
        if (scope !== null && id !== scope) throw new ApiError(403, 'Album only');
        const photo = this.photos.get(photoId);
        const key = `${id}/${photoId}`;
        const allowed =
          scope === null || (photo?.photo.sealedForAlbum === scope && !this.items.has(key));
        if (!ownAlbum(id).shared || photo?.token !== space || !photo.committed || !allowed) {
          throw new ApiError(404, 'Not here');
        }
        this.items.set(key, { album: id, photo: photoId, meta });
        this.removed.delete(key);
      },
      deleteAlbumItem: async (id, photoId) => {
        mayAdd();
        await Promise.resolve();
        if (scope !== null && id !== scope) throw new ApiError(403, 'Album only');
        if (this.albums.get(id)?.token !== space) return;
        const key = `${id}/${photoId}`;
        if (scope !== null && this.items.has(key)) this.removed.add(key);
        if (scope === null) this.removed.delete(key);
        this.items.delete(key);
      },
      forgetAlbumRemoved: async (id, photoId) => {
        writable();
        await Promise.resolve();
        if (this.albums.get(id)?.token === space) this.removed.delete(`${id}/${photoId}`);
      },
      wipe: async () => {
        ownerOnly();
        await Promise.resolve();
      },
      listMembers: async () => {
        ownerOnly();
        await Promise.resolve();
        return {
          members: [...this.members.values()]
            .filter((entry) => entry.space === space)
            .map(({ id, meta, album, access }) => ({ id, meta, album, access })),
        };
      },
      addMember: async ({ id, token: shareToken, meta, album, access }) => {
        ownerOnly();
        await Promise.resolve();
        if (album !== undefined && !this.albums.get(album)?.shared) {
          throw new ApiError(404, 'Not shared');
        }
        this.members.set(shareToken, {
          space,
          id,
          meta,
          album: album ?? null,
          access: access ?? 'view',
        });
      },
      updateMember: async (id, access) => {
        ownerOnly();
        await Promise.resolve();
        const entry = [...this.members.values()].find(
          (each) => each.space === space && each.id === id,
        );
        if (!entry) throw new ApiError(404, 'Not a member');
        entry.access = access;
      },
      membership: async () => {
        await Promise.resolve();
        if (!member) throw new ApiError(400, 'Not a member');
        return { access: member.access };
      },
      removeMember: async (id) => {
        ownerOnly();
        await Promise.resolve();
        for (const [key, entry] of this.members) {
          if (entry.space === space && entry.id === id) this.members.delete(key);
        }
      },
      leave: async () => {
        await Promise.resolve();
        if (!member) throw new ApiError(400, 'Not a member');
        this.members.delete(token);
      },
      listJoined: async () => {
        ownerOnly();
        await Promise.resolve();
        return {
          joined: [...this.joined.values()]
            .filter((entry) => entry.token === space)
            .map((entry) => entry.joined),
        };
      },
      addJoined: async (joined) => {
        ownerOnly();
        await Promise.resolve();
        this.joined.set(joined.id, { token: space, joined });
      },
      removeJoined: async (id) => {
        ownerOnly();
        await Promise.resolve();
        if (this.joined.get(id)?.token === space) this.joined.delete(id);
      },
      listPendingInvites: async () => {
        ownerOnly();
        await Promise.resolve();
        return {
          invites: [...this.pending.values()]
            .filter((entry) => entry.token === space)
            .map((entry) => entry.invite),
        };
      },
      addPendingInvite: async (invite) => {
        ownerOnly();
        await Promise.resolve();
        if (this.pending.has(invite.id)) throw new ApiError(409, 'Taken');
        this.pending.set(invite.id, { token: space, invite });
      },
      updatePendingInvite: async (id, meta) => {
        ownerOnly();
        await Promise.resolve();
        const entry = this.pending.get(id);
        if (entry?.token !== space) throw new ApiError(404, 'Not here');
        entry.invite = { id, meta };
      },
      removePendingInvite: async (id) => {
        ownerOnly();
        await Promise.resolve();
        if (this.pending.get(id)?.token === space) this.pending.delete(id);
      },
      getProfilePhoto: async () => {
        ownerOnly();
        await Promise.resolve();
        return { photo: this.profilePhotos.get(space) ?? null };
      },
      putProfilePhoto: async (photo) => {
        ownerOnly();
        await Promise.resolve();
        this.profilePhotos.set(space, photo);
      },
      deleteProfilePhoto: async () => {
        ownerOnly();
        await Promise.resolve();
        this.profilePhotos.delete(space);
      },
      listFaceSegments: async (after = '') => {
        ownerOnly();
        await Promise.resolve();
        const segments = [...this.faceSegments.values()]
          .filter((entry) => entry.token === space && entry.id > after)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map(({ id, data }) => ({ id, data }));
        return { segments, next: null };
      },
      putFaceSegment: async (id, data) => {
        ownerOnly();
        await Promise.resolve();
        if (this.faceSegments.has(`${space}/${id}`)) throw new ApiError(409, 'Taken');
        this.faceSegments.set(`${space}/${id}`, { token: space, id, data });
      },
      deleteFaceSegments: async (ids) => {
        ownerOnly();
        await Promise.resolve();
        for (const id of ids) this.faceSegments.delete(`${space}/${id}`);
      },
      deleteFaceData: async () => {
        ownerOnly();
        await Promise.resolve();
        for (const [key, entry] of this.faceSegments) {
          if (entry.token === space) this.faceSegments.delete(key);
        }
        for (const [key, entry] of this.people) if (entry.token === space) this.people.delete(key);
      },
      listPeople: async () => {
        ownerOnly();
        await Promise.resolve();
        const people = [...this.people.values()]
          .filter((entry) => entry.token === space)
          .map(({ id, meta }) => ({ id, meta }));
        return { people };
      },
      putPerson: async (id, meta) => {
        ownerOnly();
        await Promise.resolve();
        this.people.set(`${space}/${id}`, { token: space, id, meta });
      },
      deletePerson: async (id) => {
        ownerOnly();
        await Promise.resolve();
        if (!this.people.delete(`${space}/${id}`)) throw new ApiError(404, 'Not here');
      },
      listSearchSegments: async (after = '') => {
        ownerOnly();
        await Promise.resolve();
        const segments = [...this.searchSegments.values()]
          .filter((entry) => entry.token === space && entry.id > after)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map(({ id, data }) => ({ id, data }));
        return { segments, next: null };
      },
      putSearchSegment: async (id, data) => {
        ownerOnly();
        await Promise.resolve();
        if (this.searchSegments.has(`${space}/${id}`)) throw new ApiError(409, 'Taken');
        this.searchSegments.set(`${space}/${id}`, { token: space, id, data });
      },
      deleteSearchSegments: async (ids) => {
        ownerOnly();
        await Promise.resolve();
        for (const id of ids) this.searchSegments.delete(`${space}/${id}`);
      },
      deleteSearchData: async () => {
        ownerOnly();
        await Promise.resolve();
        for (const [key, entry] of this.searchSegments) {
          if (entry.token === space) this.searchSegments.delete(key);
        }
        for (const [key, entry] of this.words) if (entry.token === space) this.words.delete(key);
        for (const [key, entry] of this.smartAlbums) {
          if (entry.token === space) this.smartAlbums.delete(key);
        }
      },
      listWords: async () => {
        ownerOnly();
        await Promise.resolve();
        const words = [...this.words.values()]
          .filter((entry) => entry.token === space)
          .map(({ id, meta }) => ({ id, meta }));
        return { words };
      },
      putWord: async (id, meta) => {
        ownerOnly();
        await Promise.resolve();
        this.words.set(`${space}/${id}`, { token: space, id, meta });
      },
      deleteWord: async (id) => {
        ownerOnly();
        await Promise.resolve();
        if (!this.words.delete(`${space}/${id}`)) throw new ApiError(404, 'Not here');
      },
      listSmartAlbums: async () => {
        ownerOnly();
        await Promise.resolve();
        const albums = [...this.smartAlbums.values()]
          .filter((entry) => entry.token === space)
          .map(({ id, meta }) => ({ id, meta }));
        return { albums };
      },
      putSmartAlbum: async (id, meta) => {
        ownerOnly();
        await Promise.resolve();
        this.smartAlbums.set(`${space}/${id}`, { token: space, id, meta });
      },
      deleteSmartAlbum: async (id) => {
        ownerOnly();
        await Promise.resolve();
        if (!this.smartAlbums.delete(`${space}/${id}`)) throw new ApiError(404, 'Not here');
      },
      getUploadKey: async () => {
        ownerOnly();
        await Promise.resolve();
        return { meta: this.uploadKeys.get(space) ?? null };
      },
      putUploadKey: async (meta) => {
        ownerOnly();
        await Promise.resolve();
        if (this.uploadKeys.has(space)) throw new ApiError(409, 'Taken');
        this.uploadKeys.set(space, meta);
      },
      listUploadTokens: async () => {
        ownerOnly();
        await Promise.resolve();
        const ids = [...this.uploadTokens.values()]
          .filter((entry) => entry.space === space)
          .map((entry) => entry.id)
          .sort();
        return { ids };
      },
      addUploadToken: async ({ id, token: uploadToken }) => {
        ownerOnly();
        await Promise.resolve();
        if (this.uploadTokens.has(uploadToken)) throw new ApiError(409, 'Taken');
        this.uploadTokens.set(uploadToken, { space, id });
      },
      removeUploadToken: async (id) => {
        ownerOnly();
        await Promise.resolve();
        for (const [key, entry] of this.uploadTokens) {
          if (entry.space === space && entry.id === id) this.uploadTokens.delete(key);
        }
      },
    };
  };
}

interface FakeInvite {
  handle: string;
  link: string;
  commitment: string;
  joinerKey: string | null;
  inviterKey: string | null;
  intro: string | null;
  hello: string | null;
  grant: string | null;
}

/**
 * An in-memory invite rendezvous with the server's rules: each step once, in order. Invites
 * are kept by code, and the joiner can name one by its code or its link. Tests can edit
 * `invites` directly to play a server in the middle.
 */
export class FakeInvites {
  invites = new Map<string, FakeInvite>();

  private byHandle(handle: string): FakeInvite {
    for (const invite of this.invites.values()) if (invite.handle === handle) return invite;
    throw new ApiError(404, 'Gone');
  }

  private byCode(ref: string): FakeInvite {
    const invite =
      this.invites.get(ref) ?? [...this.invites.values()].find((each) => each.link === ref);
    if (!invite) throw new ApiError(404, 'Gone');
    return invite;
  }

  private static fill(ready: boolean, done: boolean, set: () => void): Promise<undefined> {
    if (!ready || done) return Promise.reject(new ApiError(409, 'Out of order'));
    set();
    return Promise.resolve(undefined);
  }

  api: InviteApi = {
    create: ({ code, link, handle, commitment }: CreateInviteRequest) => {
      if (this.invites.has(code)) return Promise.reject(new ApiError(409, 'Taken'));
      this.invites.set(code, {
        handle,
        link,
        commitment,
        joinerKey: null,
        inviterKey: null,
        intro: null,
        hello: null,
        grant: null,
      });
      return Promise.resolve(undefined);
    },
    inviterView: async (handle) => {
      await Promise.resolve();
      const { joinerKey, inviterKey, hello } = this.byHandle(handle);
      return { joinerKey, revealed: inviterKey !== null, hello };
    },
    reveal: async (handle, inviterKey, intro) => {
      const invite = this.byHandle(handle);
      return FakeInvites.fill(invite.joinerKey !== null, invite.inviterKey !== null, () => {
        invite.inviterKey = inviterKey;
        invite.intro = intro;
      });
    },
    grant: async (handle, grant) => {
      const invite = this.byHandle(handle);
      return FakeInvites.fill(invite.hello !== null, invite.grant !== null, () => {
        invite.grant = grant;
      });
    },
    cancel: async (handle) => {
      await Promise.resolve();
      for (const [code, invite] of this.invites) {
        if (invite.handle === handle) this.invites.delete(code);
      }
    },
    joinerView: async (code) => {
      await Promise.resolve();
      const { commitment, inviterKey, intro, hello, grant } = this.byCode(code);
      return { commitment, inviterKey, intro, helloSent: hello !== null, grant };
    },
    join: async (code, joinerKey) => {
      const invite = this.byCode(code);
      return FakeInvites.fill(true, invite.joinerKey !== null, () => {
        invite.joinerKey = joinerKey;
      });
    },
    hello: async (code, hello) => {
      const invite = this.byCode(code);
      return FakeInvites.fill(invite.inviterKey !== null, invite.hello !== null, () => {
        invite.hello = hello;
      });
    },
    finish: async (ref) => {
      await Promise.resolve();
      for (const [code, invite] of this.invites) {
        if (code === ref || invite.link === ref) this.invites.delete(code);
      }
    },
  };
}
