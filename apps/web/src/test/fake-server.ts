import type {
  CreateInviteRequest,
  PhotoPart,
  StoredAlbum,
  StoredJoined,
  StoredPhoto,
  StoredProfilePhoto,
} from '@twofold/types';

import { ApiError } from '../lib/api';
import type { InviteApi, SpaceApi } from '../lib/api';

/**
 * An in-memory stand-in for the storage API, holding exactly what the server would. A
 * member's share token reaches its owner's space, but not the owner-only routes. A token
 * given one album reaches only that album's listed photos, read-only.
 */
export class FakeServer {
  photos = new Map<string, { token: string; photo: StoredPhoto; committed: boolean }>();
  files = new Map<string, Uint8Array<ArrayBuffer>>();
  albums = new Map<string, { token: string; album: StoredAlbum; shared: string | null }>();
  /** By `album/photo`: a shared album's sealed copy of a photo's details. */
  items = new Map<string, { album: string; photo: string; meta: string }>();
  /** By share token: whose space it opens, the member record, and its album, if limited. */
  members = new Map<string, { space: string; id: string; meta: string; album: string | null }>();
  joined = new Map<string, { token: string; joined: StoredJoined }>();
  /** By space token. */
  profilePhotos = new Map<string, StoredProfilePhoto>();

  api = (token: string): SpaceApi => {
    const member = this.members.get(token);
    const space = member?.space ?? token;
    const scope = member?.album ?? null;
    const ownerOnly = () => {
      if (member) throw new ApiError(403, 'Owner only');
    };
    const writable = () => {
      if (scope !== null) throw new ApiError(403, 'Album only');
    };
    const listed = (id: string) => scope === null || this.items.has(`${scope}/${id}`);
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
      for (const [key, each] of this.members) if (each.album === album) this.members.delete(key);
    };
    return {
      listPhotos: () =>
        Promise.resolve({
          photos: [...this.photos.values()]
            .filter((entry) => entry.token === space && entry.committed && listed(entry.photo.id))
            .map((entry) =>
              scope === null
                ? entry.photo
                : {
                    ...entry.photo,
                    meta: this.items.get(`${scope}/${entry.photo.id}`)?.meta ?? '',
                  },
            ),
          next: null,
        }),
      listAlbums: () =>
        Promise.resolve({
          albums: [...this.albums.values()]
            .filter((entry) =>
              scope === null ? entry.token === space : entry.album.id === scope && entry.shared,
            )
            .map((entry) =>
              scope === null ? entry.album : { id: entry.album.id, meta: entry.shared ?? '' },
            ),
        }),
      createPhoto: (photo) => {
        writable();
        this.photos.set(photo.id, { token: space, photo, committed: false });
        return Promise.resolve(undefined);
      },
      putFile: (id: string, part: PhotoPart, bytes: Uint8Array<ArrayBuffer>) => {
        mine(id);
        this.files.set(`${id}/${part}`, bytes);
        return Promise.resolve();
      },
      commitPhoto: (id) => {
        mine(id).committed = true;
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
      updatePhoto: (id, meta) => {
        writable();
        mine(id).photo.meta = meta;
        return Promise.resolve(undefined);
      },
      deletePhoto: (id) => {
        writable();
        mine(id);
        this.photos.delete(id);
        for (const [key, item] of this.items) if (item.photo === id) this.items.delete(key);
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
        writable();
        await Promise.resolve();
        const photo = this.photos.get(photoId);
        if (!ownAlbum(id).shared || photo?.token !== space || !photo.committed) {
          throw new ApiError(404, 'Not here');
        }
        this.items.set(`${id}/${photoId}`, { album: id, photo: photoId, meta });
      },
      deleteAlbumItem: async (id, photoId) => {
        writable();
        await Promise.resolve();
        if (this.albums.get(id)?.token === space) this.items.delete(`${id}/${photoId}`);
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
            .map(({ id, meta, album }) => ({ id, meta, album })),
        };
      },
      addMember: async ({ id, token: shareToken, meta, album }) => {
        ownerOnly();
        await Promise.resolve();
        if (album !== undefined && !this.albums.get(album)?.shared) {
          throw new ApiError(404, 'Not shared');
        }
        this.members.set(shareToken, { space, id, meta, album: album ?? null });
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
    };
  };
}

interface FakeInvite {
  handle: string;
  commitment: string;
  joinerKey: string | null;
  inviterKey: string | null;
  hello: string | null;
  grant: string | null;
}

/**
 * An in-memory invite rendezvous with the server's rules: each step once, in order. Tests
 * can edit `invites` directly to play a server in the middle.
 */
export class FakeInvites {
  invites = new Map<string, FakeInvite>();

  private byHandle(handle: string): FakeInvite {
    for (const invite of this.invites.values()) if (invite.handle === handle) return invite;
    throw new ApiError(404, 'Gone');
  }

  private byCode(code: string): FakeInvite {
    const invite = this.invites.get(code);
    if (!invite) throw new ApiError(404, 'Gone');
    return invite;
  }

  private static fill(ready: boolean, done: boolean, set: () => void): Promise<undefined> {
    if (!ready || done) return Promise.reject(new ApiError(409, 'Out of order'));
    set();
    return Promise.resolve(undefined);
  }

  api: InviteApi = {
    create: ({ code, handle, commitment }: CreateInviteRequest) => {
      if (this.invites.has(code)) return Promise.reject(new ApiError(409, 'Taken'));
      this.invites.set(code, {
        handle,
        commitment,
        joinerKey: null,
        inviterKey: null,
        hello: null,
        grant: null,
      });
      return Promise.resolve(undefined);
    },
    inviterView: async (handle) => {
      await Promise.resolve();
      const { joinerKey, hello } = this.byHandle(handle);
      return { joinerKey, hello };
    },
    reveal: async (handle, inviterKey) => {
      const invite = this.byHandle(handle);
      return FakeInvites.fill(invite.joinerKey !== null, invite.inviterKey !== null, () => {
        invite.inviterKey = inviterKey;
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
      const { commitment, inviterKey, grant } = this.byCode(code);
      return { commitment, inviterKey, grant };
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
    finish: async (code) => {
      await Promise.resolve();
      this.invites.delete(code);
    },
  };
}
