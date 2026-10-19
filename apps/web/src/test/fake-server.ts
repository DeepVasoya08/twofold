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
 * member's share token reaches its owner's space, but not the owner-only routes.
 */
export class FakeServer {
  photos = new Map<string, { token: string; photo: StoredPhoto; committed: boolean }>();
  files = new Map<string, Uint8Array<ArrayBuffer>>();
  albums = new Map<string, { token: string; album: StoredAlbum }>();
  /** By share token: whose space it opens, and the member record. */
  members = new Map<string, { space: string; id: string; meta: string }>();
  joined = new Map<string, { token: string; joined: StoredJoined }>();
  /** By space token. */
  profilePhotos = new Map<string, StoredProfilePhoto>();

  api = (token: string): SpaceApi => {
    const member = this.members.get(token);
    const space = member?.space ?? token;
    const ownerOnly = () => {
      if (member) throw new ApiError(403, 'Owner only');
    };
    const mine = (id: string) => {
      const entry = this.photos.get(id);
      if (entry?.token !== space) throw new ApiError(404, 'Not here');
      return entry;
    };
    return {
      listPhotos: () =>
        Promise.resolve({
          photos: [...this.photos.values()]
            .filter((entry) => entry.token === space && entry.committed)
            .map((entry) => entry.photo),
          next: null,
        }),
      listAlbums: () =>
        Promise.resolve({
          albums: [...this.albums.values()]
            .filter((entry) => entry.token === space)
            .map((entry) => entry.album),
        }),
      createPhoto: (photo) => {
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
      getThumbs: (ids) =>
        Promise.resolve(
          ids.map((id) => {
            const entry = this.photos.get(id);
            const visible = entry?.token === space && entry.committed;
            return visible ? (this.files.get(`${id}/thumb`) ?? null) : null;
          }),
        ),
      updatePhoto: (id, meta) => {
        mine(id).photo.meta = meta;
        return Promise.resolve(undefined);
      },
      deletePhoto: (id) => {
        mine(id);
        this.photos.delete(id);
        this.files.delete(`${id}/thumb`);
        this.files.delete(`${id}/full`);
        return Promise.resolve(undefined);
      },
      createAlbum: (album) => {
        this.albums.set(album.id, { token: space, album });
        return Promise.resolve(undefined);
      },
      updateAlbum: (id, meta) => {
        const entry = this.albums.get(id);
        if (entry?.token !== space) return Promise.reject(new ApiError(404, 'Not here'));
        entry.album.meta = meta;
        return Promise.resolve(undefined);
      },
      deleteAlbum: (id) => {
        if (this.albums.get(id)?.token !== space) {
          return Promise.reject(new ApiError(404, 'Not here'));
        }
        this.albums.delete(id);
        return Promise.resolve(undefined);
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
            .map(({ id, meta }) => ({ id, meta })),
        };
      },
      addMember: async ({ id, token: shareToken, meta }) => {
        ownerOnly();
        await Promise.resolve();
        this.members.set(shareToken, { space, id, meta });
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
