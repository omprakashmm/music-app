export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number; // in seconds
  audioUrl: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  songs: Song[];
}

export type ViewType = 'home' | 'search' | 'library' | 'downloads' | 'profile' | 'settings' | 'profile-menu' | 'player' | 'queue' | 'create-playlist' | 'playlist-detail' | 'artist-detail' | 'album-detail' | 'liked-songs';
