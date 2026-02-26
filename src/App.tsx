/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Home,
  Search,
  Library,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Heart,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Download,
  Settings,
  User,
  ChevronLeft,
  CloudDownload,
  FolderDown,
  Headphones,
  Layout,
  Activity,
  Database,
  Globe,
  Info,
  Github,
  ArrowDownToLine,
  LibraryBig,
  Plus,
  History,
  ChevronDown,
  Shuffle,
  Clock,
  MonitorSpeaker,
  Share2,
  ListMusic,
  GripVertical,
  Trash2,
  ArrowUp,
  ArrowDown,
  X,
  Copy,
  ExternalLink,
  PlaySquare,
  ArrowUpDown,
  Edit2,
  Image as ImageIcon,
  Type as TypeIcon,
  Menu,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';
import { ViewType, Song } from './types';

// Toast Notification
function Toast({ message, type }: { message: string, type: 'success' | 'error' | 'info' }) {
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-rose-500' : 'bg-zinc-700';
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      className={`fixed bottom-32 left-1/2 -translate-x-1/2 z-[200] ${bg} text-white px-5 py-3 rounded-full text-sm font-semibold shadow-2xl whitespace-nowrap`}
    >
      {message}
    </motion.div>
  );
}

// Main App Component
export default function App() {
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [prevView, setPrevView] = useState<ViewType>('home');
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState<Song[]>([]);
  const [isShuffle, setIsShuffle] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [sleepTimeLeft, setSleepTimeLeft] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<{ id: string, name: string, songs: Song[] }[]>([]);
  const [recents, setRecents] = useState<Song[]>([]);
  const [likedSongs, setLikedSongs] = useState<string[]>([]);
  const [contextSong, setContextSong] = useState<Song | null>(null);
  const [playlistModalSong, setPlaylistModalSong] = useState<Song | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showAddSong, setShowAddSong] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<{ active: boolean; type: string; current: number; total: number; track: string; songs: Song[]; error: string; done: boolean } | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const importPlaylist = async (type: 'youtube' | 'spotify', url: string) => {
    setImportProgress({ active: true, type, current: 0, total: 0, track: '', songs: [], error: '', done: false });
    const endpoint = type === 'youtube' ? '/api/import/youtube-playlist' : '/api/import/spotify-playlist';
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      if (!res.body) throw new Error('No response body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'total') setImportProgress(p => p ? { ...p, total: data.total } : p);
            else if (data.type === 'progress') setImportProgress(p => p ? { ...p, current: data.current, total: data.total, track: data.song?.title || '', songs: [...(p.songs || []), data.song] } : p);
            else if (data.type === 'searching') setImportProgress(p => p ? { ...p, current: data.current, total: data.total, track: data.track } : p);
            else if (data.type === 'done') {
              setImportProgress(p => p ? { ...p, done: true, songs: data.songs || [] } : p);
              if (data.songs?.length) { setAllSongs(prev => { const ids = new Set(prev.map((s: Song) => s.id)); return [...prev, ...data.songs.filter((s: Song) => !ids.has(s.id))]; }); setQueue(prev => { const ids = new Set(prev.map((s: Song) => s.id)); return [...prev, ...data.songs.filter((s: Song) => !ids.has(s.id))]; }); }
              showToast(`Imported ${data.songs?.length || 0} songs!`, 'success');
            }
            else if (data.type === 'error') setImportProgress(p => p ? { ...p, error: data.message, done: true } : p);
          } catch { }
        }
      }
    } catch (e: any) {
      setImportProgress(p => p ? { ...p, error: e.message, done: true } : p);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const playAudio = async () => {
      if (isPlaying) {
        try {
          await audio.play();
        } catch (e: any) {
          // Ignore AbortError which happens when play() is interrupted by pause() or a src change
          if (e.name !== 'AbortError') {
            console.error("Playback failed", e);
          }
        }
      } else {
        audio.pause();
      }
    };

    playAudio();
  }, [isPlaying, currentSong]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSongEnd = () => {
    skipNext();
  };

  const seek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const songsRes = await fetch('/api/songs');
        if (!songsRes.ok) throw new Error(`Songs fetch failed: ${songsRes.status}`);
        const ct = songsRes.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Invalid response type for /api/songs');
        const songsData: Song[] = await songsRes.json();
        setAllSongs(songsData);
        if (!currentSong && songsData.length > 0) {
          setCurrentSong(songsData[0]);
          setQueue(songsData);
        }

        const playlistsRes = await fetch('/api/playlists');
        if (!playlistsRes.ok) return;
        const plData = await playlistsRes.json();
        setPlaylists(plData);
      } catch (error) {
        console.error("Failed to fetch data", error);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (sleepTimeLeft === null || sleepTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          setIsPlaying(false);
          return null;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [sleepTimeLeft]);

  const navigateTo = (view: ViewType) => {
    setPrevView(activeView);
    setActiveView(view);
  };

  const playSong = (song: Song) => {
    setCurrentSong(song);
    setIsPlaying(true);
    setRecents(prev => {
      const filtered = prev.filter(s => s.id !== song.id);
      return [song, ...filtered].slice(0, 10);
    });
  };

  const skipNext = () => {
    if (!currentSong) return;
    const currentIndex = queue.findIndex(s => s.id === currentSong.id);
    const nextIndex = (currentIndex + 1) % queue.length;
    playSong(queue[nextIndex]);
  };

  const skipPrevious = () => {
    if (!currentSong) return;
    const currentIndex = queue.findIndex(s => s.id === currentSong.id);
    const prevIndex = (currentIndex - 1 + queue.length) % queue.length;
    playSong(queue[prevIndex]);
  };

  const toggleShuffle = () => {
    setIsShuffle(!isShuffle);
    if (!isShuffle) {
      const shuffled = [...queue].sort(() => Math.random() - 0.5);
      setQueue(shuffled);
    } else {
      setQueue(allSongs);
    }
  };

  const addToQueue = (song: Song) => {
    setQueue(prev => [...prev, song]);
    showToast(`Added "${song.title}" to queue`, 'success');
  };

  const playNext = (song: Song) => {
    if (!currentSong) {
      playSong(song);
      return;
    }
    setQueue(prev => {
      const currentIndex = prev.findIndex(s => s.id === currentSong.id);
      const newQueue = [...prev];
      newQueue.splice(currentIndex + 1, 0, song);
      return newQueue;
    });
    showToast(`"${song.title}" plays next`, 'info');
  };

  const addNewSong = async (song: { title: string, artist: string, album: string, audioUrl: string, coverUrl: string, youtubeId?: string }) => {
    try {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(song)
      });
      if (!res.ok) throw new Error(await res.text());
      const newSong: Song = await res.json();
      setAllSongs(prev => [...prev, newSong]);
      setQueue(prev => [...prev, newSong]);
      showToast(`"${newSong.title}" added!`, 'success');
      setShowAddSong(false);
    } catch (err: any) {
      showToast('Failed to add song: ' + err.message, 'error');
    }
  };

  const deleteSong = async (id: string) => {
    try {
      await fetch(`/api/songs/${id}`, { method: 'DELETE' });
      setAllSongs(prev => prev.filter(s => s.id !== id));
      setQueue(prev => prev.filter(s => s.id !== id));
      if (currentSong?.id === id) { setCurrentSong(null); setIsPlaying(false); }
      showToast('Song removed', 'info');
    } catch {
      showToast('Failed to remove song', 'error');
    }
  };

  const toggleLike = (id: string) => {
    setLikedSongs(prev =>
      prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
    );
  };

  const addToPlaylist = async (playlistId: string, song: Song) => {
    try {
      await fetch(`/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id })
      });
      setPlaylists(prev => prev.map(p =>
        p.id === playlistId ? { ...p, songs: p.songs.find(s => s.id === song.id) ? p.songs : [...p.songs, song] } : p
      ));
      setPlaylistModalSong(null);
      showToast('Added to playlist', 'success');
    } catch (error) {
      showToast('Failed to add to playlist', 'error');
    }
  };

  const updatePlaylistName = async (id: string, newName: string) => {
    try {
      await fetch(`/api/playlists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p));
    } catch (error) {
      console.error("Failed to update playlist name", error);
    }
  };

  const removeSongFromPlaylist = async (playlistId: string, songId: string) => {
    try {
      await fetch(`/api/playlists/${playlistId}/songs/${songId}`, {
        method: 'DELETE'
      });
      setPlaylists(prev => prev.map(p =>
        p.id === playlistId ? { ...p, songs: p.songs.filter(s => s.id !== songId) } : p
      ));
    } catch (error) {
      console.error("Failed to remove song from playlist", error);
    }
  };


  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(s => s.id !== id));
  };

  const moveInQueue = (index: number, direction: 'up' | 'down') => {
    const newQueue = [...queue];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < newQueue.length) {
      [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];
      setQueue(newQueue);
    }
  };

  const handleCreatePlaylist = async (name: string, selectedSongs: Song[]) => {
    const newPlaylist = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      songs: selectedSongs
    };
    try {
      await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlaylist)
      });
      setPlaylists(prev => [...prev, newPlaylist]);
      navigateTo('library');
    } catch (error) {
      console.error("Failed to create playlist", error);
    }
  };

  const renderView = () => {
    const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId);

    switch (activeView) {
      case 'home':
        return <HomeView onPlaySong={playSong} onProfileClick={() => navigateTo('profile-menu')} songs={allSongs} onAddSong={() => setShowAddSong(true)} onDeleteSong={deleteSong} />;
      case 'search':
        return <SearchView onPlaySong={playSong} onProfileClick={() => navigateTo('profile-menu')} songs={allSongs} onContextMenu={(s) => setContextSong(s)} />;
      case 'library':
        return (
          <LibraryView
            onPlaySong={playSong}
            onProfileClick={() => navigateTo('profile-menu')}
            onAddPlaylist={() => navigateTo('create-playlist')}
            playlists={playlists}
            onOpenPlaylist={(id) => { setSelectedPlaylistId(id); navigateTo('playlist-detail'); }}
            onOpenArtist={(artist) => { setSelectedArtist(artist); navigateTo('artist-detail'); }}
            onOpenAlbum={(album) => { setSelectedAlbum(album); navigateTo('album-detail'); }}
            songs={allSongs}
            likedSongs={likedSongs}
            onLikedSongs={() => navigateTo('liked-songs')}
          />
        );
      case 'downloads':
        return (
          <DownloadsView
            onPlaySong={playSong}
            onProfileClick={() => navigateTo('profile-menu')}
            onBrowse={() => navigateTo('search')}
          />
        );
      case 'profile-menu':
        return (
          <ProfileMenuView
            onClose={() => navigateTo(prevView)}
            onViewProfile={() => navigateTo('profile')}
            onSettings={() => navigateTo('settings')}
            recents={recents}
            onPlayRecent={(song) => {
              playSong(song);
              navigateTo('player');
            }}
          />
        );
      case 'profile':
        return <ProfileView onBack={() => navigateTo('profile-menu')} />;
      case 'settings':
        return <SettingsView onBack={() => navigateTo('profile-menu')} />;
      case 'player':
        return (
          <PlayerView
            song={currentSong}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
            onBack={() => navigateTo(prevView)}
            onOpenQueue={() => navigateTo('queue')}
            onOpenSleepTimer={() => setShowSleepTimer(true)}
            sleepTimeLeft={sleepTimeLeft}
            onSkipNext={skipNext}
            onSkipPrevious={skipPrevious}
            onToggleShuffle={toggleShuffle}
            isShuffle={isShuffle}
            onMore={() => setContextSong(currentSong)}
            onAddToPlaylist={() => setPlaylistModalSong(currentSong)}
            currentTime={currentTime}
            duration={duration}
            onSeek={seek}
            isLiked={likedSongs.includes(currentSong?.id || '')}
            onToggleLike={() => currentSong && toggleLike(currentSong.id)}
            queue={queue}
          />
        );
      case 'liked-songs':
        return (
          <LikedSongsView
            songs={allSongs.filter(s => likedSongs.includes(s.id))}
            onPlaySong={playSong}
            onBack={() => navigateTo('library')}
            onToggleLike={toggleLike}
          />
        );
      case 'queue':
        return (
          <QueueView
            queue={queue}
            onBack={() => navigateTo('player')}
            onRemove={removeFromQueue}
            onMove={moveInQueue}
            onPlay={playSong}
          />
        );
      case 'create-playlist':
        return (
          <CreatePlaylistView
            onBack={() => navigateTo('library')}
            onCreate={handleCreatePlaylist}
            availableSongs={allSongs}
          />
        );
      case 'playlist-detail':
        return selectedPlaylist ? (
          <PlaylistDetailView
            playlist={selectedPlaylist}
            onBack={() => navigateTo('library')}
            onPlaySong={playSong}
            onMore={() => setShowPlaylistMenu(true)}
            onRemoveSong={(sId) => removeSongFromPlaylist(selectedPlaylist.id, sId)}
            onAddSongs={() => navigateTo('create-playlist')} // Reuse create playlist for adding
            onShuffle={() => { toggleShuffle(); playSong(selectedPlaylist.songs[0]); }}
            onPlayAll={() => playSong(selectedPlaylist.songs[0])}
          />
        ) : null;
      case 'artist-detail':
        return selectedArtist ? (
          <ArtistDetailView
            artist={selectedArtist}
            onBack={() => navigateTo('library')}
            onPlaySong={playSong}
            songs={allSongs.filter(s => s.artist === selectedArtist)}
          />
        ) : null;
      case 'album-detail':
        return selectedAlbum ? (
          <AlbumDetailView
            album={selectedAlbum}
            onBack={() => navigateTo('library')}
            onPlaySong={playSong}
            songs={allSongs.filter(s => s.album === selectedAlbum)}
          />
        ) : null;
      default:
        return <HomeView onPlaySong={playSong} onProfileClick={() => navigateTo('profile-menu')} songs={allSongs} onAddSong={() => setShowAddSong(true)} onDeleteSong={deleteSong} />;
    }
  };

  return (
    <div className="flex h-screen bg-transparent text-white overflow-hidden">
      <audio key={currentSong?.id} ref={audioRef} src={currentSong?.audioUrl || ''} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleSongEnd} />

      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <Sidebar
            activeView={activeView}
            onNavigate={(v) => { navigateTo(v); setSidebarOpen(false); }}
            onClose={() => setSidebarOpen(false)}
            onImport={() => { setSidebarOpen(false); setShowAddSong(true); }}
            onProfile={() => { navigateTo('profile-menu'); setSidebarOpen(false); }}
            songs={allSongs}
            playlists={playlists}
            onOpenPlaylist={(id) => { setSelectedPlaylistId(id); navigateTo('playlist-detail'); setSidebarOpen(false); }}
          />
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-32 no-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div key={activeView} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}
              className={activeView === 'settings' || activeView === 'profile-menu' || activeView === 'player' || activeView === 'queue' || activeView === 'create-playlist' ? '' : 'p-6'}>
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Player Bar */}
        {activeView !== 'settings' && activeView !== 'profile' && activeView !== 'profile-menu' && activeView !== 'player' && activeView !== 'queue' && activeView !== 'create-playlist' && (
          <div className="fixed bottom-24 left-0 right-0 px-3 z-50">
            <PlayerBar
              song={currentSong}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying(!isPlaying)}
              onClick={() => navigateTo('player')}
              isLiked={likedSongs.includes(currentSong?.id || '')}
              onToggleLike={() => currentSong && toggleLike(currentSong.id)}
              onSkipNext={skipNext}
              onSkipPrev={skipPrevious}
              currentTime={currentTime}
              duration={duration}
              onSeek={seek}
            />
          </div>
        )}

        {/* Bottom Nav */}
        {activeView !== 'player' && activeView !== 'queue' && activeView !== 'create-playlist' && (
          <nav className="fixed bottom-0 left-0 right-0 h-20 glass-dark bottom-nav-bar flex items-center justify-around px-6 z-50">
            <NavButton icon={<Home size={24} />} label="Home" active={activeView === 'home'} onClick={() => navigateTo('home')} isPill />
            <NavButton icon={<LibraryBig size={24} />} label="Library" active={activeView === 'library'} onClick={() => navigateTo('library')} />
            <NavButton icon={<Search size={24} />} label="Search" active={activeView === 'search'} onClick={() => navigateTo('search')} />
            <button onClick={() => setSidebarOpen(true)} className={`flex flex-col items-center gap-1 transition-colors ${sidebarOpen ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <Menu size={24} />
            </button>
          </nav>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>{showSleepTimer && <SleepTimerModal onClose={() => setShowSleepTimer(false)} onSetTimer={(mins) => { setSleepTimeLeft(mins); setShowSleepTimer(false); }} />}</AnimatePresence>
      <AnimatePresence>{contextSong && <SongContextMenu song={contextSong} onClose={() => setContextSong(null)} onPlayNext={() => { playNext(contextSong); setContextSong(null); }} onAddToQueue={() => { addToQueue(contextSong); setContextSong(null); }} onToggleLike={() => { toggleLike(contextSong.id); setContextSong(null); }} isLiked={likedSongs.includes(contextSong.id)} onAddToPlaylist={() => { setPlaylistModalSong(contextSong); setContextSong(null); }} />}</AnimatePresence>
      <AnimatePresence>{playlistModalSong && <AddToPlaylistModal song={playlistModalSong} playlists={playlists} onClose={() => setPlaylistModalSong(null)} onSelect={(pId) => addToPlaylist(pId, playlistModalSong)} onCreateNew={() => { setPlaylistModalSong(null); navigateTo('create-playlist'); }} />}</AnimatePresence>
      <AnimatePresence>{showPlaylistMenu && selectedPlaylistId && <PlaylistContextMenu playlist={playlists.find(p => p.id === selectedPlaylistId)!} onClose={() => setShowPlaylistMenu(false)} onEditName={() => { const n = prompt('Playlist name:', playlists.find(p => p.id === selectedPlaylistId)?.name); if (n) updatePlaylistName(selectedPlaylistId, n); setShowPlaylistMenu(false); }} onAddCover={() => setShowPlaylistMenu(false)} onDelete={() => { if (confirm('Delete playlist?')) { setPlaylists(prev => prev.filter(p => p.id !== selectedPlaylistId)); navigateTo('library'); } setShowPlaylistMenu(false); }} />}</AnimatePresence>
      <AnimatePresence>{toast && <Toast message={toast.message} type={toast.type} />}</AnimatePresence>
      <AnimatePresence>{showAddSong && <AddSongModal onClose={() => setShowAddSong(false)} onAdd={addNewSong} onImportPlaylist={importPlaylist} />}</AnimatePresence>
      <AnimatePresence>{importProgress && <ImportProgressModal progress={importProgress} onClose={() => setImportProgress(null)} />}</AnimatePresence>
    </div>
  );
}

function NavButton({ icon, label, active, onClick, isPill = false }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, isPill?: boolean }) {
  if (isPill && active) {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-2 nav-pill-active px-5 py-2.5 rounded-full transition-all shadow-sm"
      >
        {icon}
        <span className="text-sm font-bold">{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors ${active ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
    >
      {icon}
    </button>
  );
}

function PlayerBar({
  song, isPlaying, onTogglePlay, onClick,
  isLiked, onToggleLike, onSkipNext, onSkipPrev,
  currentTime, duration, onSeek
}: {
  song: Song | null; isPlaying: boolean; onTogglePlay: () => void; onClick: () => void;
  isLiked: boolean; onToggleLike: () => void; onSkipNext: () => void; onSkipPrev: () => void;
  currentTime: number; duration: number; onSeek: (t: number) => void;
}) {
  if (!song) return null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

  return (
    <motion.div initial={{ y: 100 }} animate={{ y: 0 }} className="glass rounded-3xl overflow-hidden shadow-2xl border border-white/7">
      {/* Thin progress bar at top */}
      <div className="h-0.5 w-full bg-white/8 cursor-pointer group" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width * duration); }}>
        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-100" style={{ width: `${pct}%` }} />
      </div>
      {/* Main bar */}
      <div className="flex items-center px-3 py-2.5 gap-3">
        {/* Cover + Info — clickable → player view */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          <div className="relative shrink-0">
            <img src={song.coverUrl} alt={song.title} className="w-11 h-11 rounded-xl object-cover shadow-lg" referrerPolicy="no-referrer" />
            {isPlaying && (
              <div className="absolute inset-0 rounded-xl flex items-end justify-center pb-1.5 gap-0.5">
                {[1, 1.5, 0.8].map((h, i) => (
                  <motion.div key={i} className="w-0.5 bg-emerald-400 rounded-full"
                    animate={{ scaleY: [h, h * 1.8, h] }} transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold truncate leading-tight">{song.title}</span>
            <span className="text-xs text-zinc-500 truncate">{song.artist}{song.album && song.album !== 'YouTube' && song.album !== 'Unknown Album' ? ` · ${song.album}` : ''}</span>
          </div>
        </div>
        {/* Time */}
        <span className="text-[10px] text-zinc-600 font-mono shrink-0 hidden sm:block">{fmt(currentTime)}/{fmt(duration)}</span>
        {/* Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={e => { e.stopPropagation(); onToggleLike(); }}
            className={`p-1.5 rounded-full transition-all ${isLiked ? 'text-emerald-400' : 'text-zinc-600 hover:text-zinc-300'}`}>
            <ThumbsUp size={15} fill={isLiked ? 'currentColor' : 'none'} />
          </button>
          <button onClick={e => { e.stopPropagation(); onSkipPrev(); }} className="p-1.5 text-zinc-400 hover:text-white transition-colors">
            <SkipBack size={16} fill="currentColor" />
          </button>
          <button onClick={e => { e.stopPropagation(); onTogglePlay(); }}
            className="w-9 h-9 bg-white text-black rounded-full flex items-center justify-center hover:bg-zinc-100 transition-colors shadow-lg">
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={e => { e.stopPropagation(); onSkipNext(); }} className="p-1.5 text-zinc-400 hover:text-white transition-colors">
            <SkipForward size={16} fill="currentColor" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

function HomeView({ onPlaySong, onProfileClick, songs, onAddSong, onDeleteSong }: {
  onPlaySong: (song: Song) => void,
  onProfileClick: () => void,
  songs: Song[],
  onAddSong: () => void,
  onDeleteSong: (id: string) => void
}) {
  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden border border-white/10 shrink-0"
          >
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
          <div>
            <p className="text-xs text-zinc-500 font-medium">{getGreeting()}</p>
            <h1 className="text-xl font-black tracking-tight leading-tight">Your Music</h1>
          </div>
        </div>
        <button
          onClick={onAddSong}
          className="flex items-center gap-1.5 bg-emerald-500 text-black px-3.5 py-2 rounded-full text-xs font-bold hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-900/30"
        >
          <Plus size={14} /> Add Song
        </button>
      </header>

      {songs.length === 0 ? (
        /* ── Empty State ── */
        <div className="flex flex-col items-center justify-center py-20 text-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-red-600/20 to-emerald-500/15 flex items-center justify-center border border-white/8">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="white" opacity="0.6"><path d="M21.543 6.498C22 8.28 22 12 22 12s0 3.72-.457 5.502c-.254.985-.997 1.76-1.938 2.022C17.896 20 12 20 12 20s-5.896 0-7.605-.476c-.945-.266-1.687-1.04-1.938-2.022C2 15.72 2 12 2 12s0-3.72.457-5.502c.254-.985.997-1.76 1.938-2.022C6.104 4 12 4 12 4s5.896 0 7.605.476c.945.266 1.687 1.04 1.938 2.022zM10 15.5l6-3.5-6-3.5v7z" /></svg>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-black">Your library is empty</h2>
            <p className="text-zinc-600 text-sm max-w-[240px]">Import from YouTube or Spotify to get started.</p>
          </div>
          <button
            onClick={onAddSong}
            className="flex items-center gap-2 bg-emerald-500 text-black px-6 py-3 rounded-full font-bold text-sm hover:bg-emerald-400 transition-colors shadow-xl shadow-emerald-900/30"
          >
            <Plus size={16} /> Add your first song
          </button>
        </div>
      ) : (
        <>
          <section>
            <h2 className="text-base font-bold mb-3 text-zinc-300">Jump back in</h2>
            <div className="grid grid-cols-2 gap-3">
              {songs.slice(0, 4).map(song => (
                <div
                  key={song.id}
                  onClick={() => onPlaySong(song)}
                  className="glass-card rounded-2xl p-2.5 flex items-center gap-2.5 cursor-pointer group"
                >
                  <img src={song.coverUrl} alt={song.title} className="w-12 h-12 rounded-xl object-cover shrink-0" referrerPolicy="no-referrer" />
                  <span className="text-xs font-semibold line-clamp-2 leading-snug">{song.title}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold mb-3 text-zinc-300">Your Library</h2>
            <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {songs.map(song => (
                <div
                  key={song.id}
                  className="flex-shrink-0 w-36 space-y-2 cursor-pointer group relative"
                >
                  <div className="relative aspect-square rounded-2xl overflow-hidden" onClick={() => onPlaySong(song)}>
                    <img src={song.coverUrl} alt={song.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-11 h-11 bg-emerald-500 rounded-full flex items-center justify-center shadow-xl shadow-emerald-900/50">
                        <Play size={20} fill="white" className="ml-0.5 text-white" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-1 px-0.5">
                    <div className="flex flex-col min-w-0" onClick={() => onPlaySong(song)}>
                      <span className="text-xs font-semibold truncate">{song.title}</span>
                      <span className="text-[11px] text-zinc-500 truncate">{song.artist}</span>
                    </div>
                    <button
                      onClick={() => onDeleteSong(song.id)}
                      className="shrink-0 p-0.5 text-zinc-700 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SearchView({ onPlaySong, onProfileClick, songs, onContextMenu }: {
  onPlaySong: (song: Song) => void,
  onProfileClick: () => void,
  songs: Song[],
  onContextMenu: (song: Song) => void
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const categories = ['Pop', 'Rock', 'Hip-Hop', 'Jazz', 'Electronic', 'Classical', 'Indie', 'R&B'];
  const colors = ['bg-emerald-600', 'bg-blue-600', 'bg-purple-600', 'bg-pink-600', 'bg-orange-600', 'bg-red-600', 'bg-indigo-600', 'bg-yellow-600'];

  const filteredSongs = songs.filter(song =>
    song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    song.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
    song.album.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden border border-white/10 shrink-0"
          >
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Search</h1>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Songs, artists, albums…"
          className="w-full glass border border-white/8 text-white py-3.5 pl-11 pr-4 rounded-2xl text-sm font-medium placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
        />
      </div>

      {searchQuery ? (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-zinc-300">Results</h2>
          {filteredSongs.map(song => (
            <div
              key={song.id}
              onClick={() => onPlaySong(song)}
              className="glass-card p-3 rounded-2xl flex items-center gap-3.5 cursor-pointer hover:bg-white/6 transition-colors group"
            >
              <div className="relative w-14 h-14 shrink-0">
                <img src={song.coverUrl} alt={song.title} className="w-full h-full rounded-xl object-cover shadow-lg" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                  <Play size={18} fill="white" className="text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate group-hover:text-emerald-400 transition-colors">{song.title}</div>
                <div className="text-xs text-zinc-500 truncate flex items-center gap-1">
                  <span>{song.artist}</span>
                  {song.album && song.album !== 'Unknown Album' && song.album !== 'YouTube' && <><span className="opacity-30">·</span><span className="truncate opacity-70">{song.album}</span></>}
                </div>
              </div>
              <button
                className="p-2 text-zinc-600 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onContextMenu(song); }}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          ))}
          {filteredSongs.length === 0 && (
            <div className="text-center py-10 text-zinc-600 text-sm">No results for "{searchQuery}"</div>
          )}
        </section>
      ) : (
        <section>
          <h2 className="text-base font-bold mb-3 text-zinc-300">Browse by genre</h2>
          <div className="grid grid-cols-2 gap-3">
            {categories.map((cat, i) => (
              <div
                key={cat}
                className={`${colors[i % colors.length]} bg-opacity-70 aspect-video rounded-2xl p-4 relative overflow-hidden cursor-pointer hover:scale-[1.02] active:scale-[0.99] transition-transform border border-white/10`}
              >
                <span className="text-sm font-bold">{cat}</span>
                <div className="absolute -right-3 -bottom-3 w-14 h-14 bg-black/20 rotate-15 rounded-xl" />
                <Music2 size={32} className="absolute right-3 bottom-2 opacity-20" />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LibraryView({ onPlaySong, onProfileClick, onAddPlaylist, playlists, onOpenPlaylist, onOpenArtist, onOpenAlbum, songs, likedSongs, onLikedSongs }: {
  onPlaySong: (song: Song) => void,
  onProfileClick: () => void,
  onAddPlaylist: () => void,
  playlists: { id: string, name: string, songs: Song[] }[],
  onOpenPlaylist: (id: string) => void,
  onOpenArtist: (artist: string) => void,
  onOpenAlbum: (album: string) => void,
  songs: Song[],
  likedSongs: string[],
  onLikedSongs: () => void,
}) {
  const [activeTab, setActiveTab] = useState('Playlists');
  const tabs = ['Playlists', 'Artists', 'Albums', 'Podcasts'];

  const uniqueArtists = Array.from(new Set(songs.map(s => s.artist)));
  const uniqueAlbums = Array.from(new Set(songs.map(s => s.album)));

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden border border-white/10 shrink-0"
          >
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Your Library</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onAddPlaylist}
            className="p-2 hover:bg-white/8 rounded-full transition-colors text-zinc-400 hover:text-white"
          >
            <Plus size={22} />
          </button>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
              activeTab === tab
                ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-900/40'
                : 'bg-white/5 border border-white/8 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <section className="space-y-6">
        {activeTab === 'Playlists' && (
          <>
            {/* Liked Songs Card */}
            <button onClick={onLikedSongs}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-emerald-600/20 via-emerald-900/10 to-transparent border border-emerald-500/20 hover:border-emerald-500/40 hover:from-emerald-600/30 transition-all group">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-900/30 shrink-0 group-hover:scale-105 transition-transform">
                <ThumbsUp size={22} fill="white" className="text-white" />
              </div>
              <div className="flex flex-col text-left flex-1 min-w-0">
                <span className="font-bold text-base">Liked Music</span>
                <span className="text-sm text-zinc-400">{likedSongs.length} liked songs • Auto playlist</span>
              </div>
              <ChevronLeft size={18} className="text-zinc-500 rotate-180 group-hover:text-white transition-colors" />
            </button>

            {playlists.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Your Playlists</h2>
                {playlists.map(playlist => (
                  <div
                    key={playlist.id}
                    onClick={() => onOpenPlaylist(playlist.id)}
                    className="flex items-center gap-4 glass-card p-3 rounded-xl cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    <div className="w-14 h-14 rounded-lg bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {playlist.songs.length >= 4 ? (
                        <div className="grid grid-cols-2 w-full h-full">
                          {playlist.songs.slice(0, 4).map(s => (
                            <img key={s.id} src={s.coverUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ))}
                        </div>
                      ) : (
                        <Music2 size={24} className="text-zinc-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="text-base font-semibold block">{playlist.name}</span>
                      <span className="text-sm text-zinc-400">{playlist.songs.length} songs</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-4">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">All Songs</h2>
              {songs.map(song => (
                <div
                  key={song.id}
                  onClick={() => onPlaySong(song)}
                  className="flex items-center justify-between group cursor-pointer p-2 rounded-xl hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <img src={song.coverUrl} alt={song.title} className="w-14 h-14 rounded-lg object-cover" referrerPolicy="no-referrer" />
                    <div className="flex flex-col">
                      <span className="text-base font-semibold group-hover:text-emerald-400 transition-colors">{song.title}</span>
                      <span className="text-sm text-zinc-400">{song.artist}</span>
                    </div>
                  </div>
                  <button className="text-zinc-500 hover:text-white"><MoreHorizontal size={20} /></button>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === 'Artists' && (
          <div className="space-y-4">
            {uniqueArtists.map(artist => (
              <div
                key={artist}
                onClick={() => onOpenArtist(artist)}
                className="flex items-center gap-4 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
              >
                <div className="w-16 h-16 rounded-full bg-zinc-800 overflow-hidden border border-white/10">
                  <img
                    src={`https://picsum.photos/seed/${artist}/200/200`}
                    alt={artist}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-bold">{artist}</span>
                  <span className="text-sm text-zinc-400">Artist</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Albums' && (
          <div className="grid grid-cols-2 gap-4">
            {uniqueAlbums.map(album => {
              const albumSong = songs.find(s => s.album === album);
              return (
                <div
                  key={album}
                  onClick={() => onOpenAlbum(album)}
                  className="glass-card p-3 rounded-2xl space-y-3 cursor-pointer hover:bg-white/5 transition-all group"
                >
                  <div className="aspect-square rounded-xl overflow-hidden relative">
                    <img
                      src={albumSong?.coverUrl || `https://picsum.photos/seed/${album}/300/300`}
                      alt={album}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold truncate">{album}</h3>
                    <p className="text-xs text-zinc-400 truncate">{albumSong?.artist}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'Podcasts' && (
          <div className="text-center py-20 text-zinc-500 italic">
            No podcasts followed yet.
          </div>
        )}
      </section>
    </div>
  );
}

function CreatePlaylistView({ onBack, onCreate, availableSongs }: {
  onBack: () => void,
  onCreate: (name: string, songs: Song[]) => void,
  availableSongs: Song[]
}) {
  const [name, setName] = useState('');
  const [selectedSongs, setSelectedSongs] = useState<string[]>([]);

  const toggleSong = (id: string) => {
    setSelectedSongs(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    const songs = availableSongs.filter(s => selectedSongs.includes(s.id));
    onCreate(name, songs);
  };

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <header className="flex items-center p-6 gap-6">
        <button onClick={onBack} className="p-1">
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-2xl font-semibold">New Playlist</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Playlist Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Playlist"
            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-lg focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="space-y-4">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Add Songs</label>
          <div className="space-y-3">
            {availableSongs.map(song => (
              <div
                key={song.id}
                onClick={() => toggleSong(song.id)}
                className={`p-3 rounded-xl flex items-center gap-4 border transition-all cursor-pointer ${selectedSongs.includes(song.id)
                  ? 'glass border-emerald-500/50 bg-emerald-500/5'
                  : 'glass-card border-transparent'
                  }`}
              >
                <img src={song.coverUrl} alt={song.title} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
                <div className="flex-1">
                  <div className="font-medium text-sm">{song.title}</div>
                  <div className="text-xs text-zinc-400">{song.artist}</div>
                </div>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedSongs.includes(song.id) ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-700'
                  }`}>
                  {selectedSongs.includes(song.id) && <Plus size={16} className="text-white rotate-45" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6">
        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="w-full bg-white text-black py-4 rounded-full font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          Create Playlist
        </button>
      </div>
    </div>
  );
}

function DownloadsView({ onPlaySong, onProfileClick, onBrowse }: {
  onPlaySong: (song: Song) => void,
  onProfileClick: () => void,
  onBrowse: () => void
}) {
  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onProfileClick}
            className="w-9 h-9 rounded-full overflow-hidden border border-white/10 shrink-0"
          >
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
          <h1 className="text-xl font-black tracking-tight">Downloads</h1>
        </div>
      </header>

      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center text-zinc-600 border border-white/6">
          <FolderDown size={32} />
        </div>
        <div>
          <h3 className="text-base font-bold">No downloads yet</h3>
          <p className="text-sm text-zinc-600 mt-1">Songs you download will appear here.</p>
        </div>
        <button
          onClick={onBrowse}
          className="bg-white text-black px-5 py-2 rounded-full font-bold text-sm hover:bg-zinc-100 transition-colors"
        >
          Browse Music
        </button>
      </div>
    </div>
  );
}

function PlayerView({
  song, isPlaying, onTogglePlay, onBack, onOpenQueue, onOpenSleepTimer,
  sleepTimeLeft, onSkipNext, onSkipPrevious, onToggleShuffle, isShuffle,
  onMore, onAddToPlaylist, currentTime, duration, onSeek, isLiked, onToggleLike,
  queue
}: {
  song: Song | null; isPlaying: boolean; onTogglePlay: () => void; onBack: () => void;
  onOpenQueue: () => void; onOpenSleepTimer: () => void; sleepTimeLeft: number | null;
  onSkipNext: () => void; onSkipPrevious: () => void; onToggleShuffle: () => void;
  isShuffle: boolean; onMore: () => void; onAddToPlaylist: () => void;
  currentTime: number; duration: number; onSeek: (t: number) => void;
  isLiked: boolean; onToggleLike: () => void;
  queue: Song[];
}) {
  if (!song) return null;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Build carousel: 5 songs centered at current song
  const currentIdx = queue.findIndex(s => s.id === song.id);
  const carouselOffsets = [-2, -1, 0, 1, 2];
  const carouselSongs = carouselOffsets.map(offset => {
    const idx = currentIdx + offset;
    if (idx < 0 || idx >= queue.length) return null;
    return queue[idx];
  });

  // Per-offset style params
  const cardStyle = (offset: number) => {
    const abs = Math.abs(offset);
    const translateX = offset * 100;
    const rotate = offset * 9;
    const scale = abs === 0 ? 1 : abs === 1 ? 0.82 : 0.68;
    const opacity = abs === 0 ? 1 : abs === 1 ? 0.55 : 0.28;
    const zIndex = 10 - abs * 3;
    return {
      transform: `translateX(${translateX}px) rotate(${rotate}deg) scale(${scale})`,
      opacity,
      zIndex,
    };
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Dynamic blurred background from album art */}
      <div className="absolute inset-0 -z-10">
        <img
          src={song.coverUrl}
          alt=""
          className="w-full h-full object-cover scale-150"
          style={{ filter: 'blur(60px)', opacity: 0.45 }}
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,5,8,0.55) 0%, rgba(5,5,8,0.80) 50%, rgba(5,5,8,0.96) 100%)' }} />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-2">
        <button onClick={onBack} className="p-2.5 hover:bg-white/10 rounded-full transition-colors">
          <ChevronDown size={24} />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase font-bold tracking-[0.18em] text-zinc-500">Now Playing</span>
          <span className="text-sm font-semibold truncate max-w-[180px] text-zinc-300">{song.album && song.album !== 'YouTube' && song.album !== 'Unknown Album' ? song.album : 'SonicStream'}</span>
        </div>
        <button onClick={onMore} className="p-2.5 hover:bg-white/10 rounded-full transition-colors">
          <MoreVertical size={20} />
        </button>
      </header>

      {/* Carousel */}
      <div className="flex-1 flex items-center justify-center py-4">
        <div className="relative w-56 h-56" style={{ perspective: '800px' }}>
          {carouselOffsets.map((offset, i) => {
            const carouselSong = carouselSongs[i];
            if (!carouselSong) return null;
            const style = cardStyle(offset);
            const isCenter = offset === 0;
            const isClickableLeft = offset === -1;
            const isClickableRight = offset === 1;
            return (
              <motion.div
                key={carouselSong.id + offset}
                className={`absolute inset-0 rounded-2xl overflow-hidden cursor-pointer select-none ${isCenter ? 'carousel-card-center' : 'carousel-card-side'}`}
                style={{ ...style, width: '100%', height: '100%' }}
                animate={style}
                transition={{ type: 'spring', damping: 24, stiffness: 220 }}
                onClick={isClickableLeft ? onSkipPrevious : isClickableRight ? onSkipNext : undefined}
                whileHover={isClickableLeft || isClickableRight ? { opacity: style.opacity * 1.4 } : {}}
              >
                <img
                  src={carouselSong.coverUrl || `https://picsum.photos/seed/${carouselSong.id}/400/400`}
                  alt={carouselSong.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                {isCenter && isPlaying && (
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-0.5 bg-white/70 rounded-full sound-bar"
                        style={{ height: '14px', animationDelay: `${i * 0.18}s` }} />
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Song Info + Action Row */}
      <div className="px-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-black truncate leading-tight text-shadow-sm">{song.title}</h2>
          <p className="text-sm text-zinc-400 truncate mt-0.5">{song.artist}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-1">
          <motion.button
            whileTap={{ scale: 0.8 }}
            onClick={onToggleLike}
            className={`p-2 rounded-full transition-all ${isLiked ? 'text-emerald-400' : 'text-zinc-500 hover:text-white'}`}
          >
            <ThumbsUp size={20} fill={isLiked ? 'currentColor' : 'none'} />
          </motion.button>
          <button onClick={onAddToPlaylist} className="p-2 text-zinc-500 hover:text-white transition-colors">
            <Plus size={20} />
          </button>
        </div>
      </div>

      {/* Seek bar */}
      <div className="px-6 mt-4 space-y-1.5">
        <div
          className="seek-track h-1.5 w-full bg-white/12 rounded-full relative cursor-pointer group"
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek((e.clientX - r.left) / r.width * duration);
          }}
        >
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-100"
            style={{ width: `${pct}%` }}
          />
          <div
            className="seek-thumb opacity-0"
            style={{ left: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] font-bold text-zinc-600 font-mono">
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-6 mt-4">
        <button
          onClick={onToggleShuffle}
          className={`p-2 transition-colors ${isShuffle ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Shuffle size={20} />
        </button>
        <button onClick={onSkipPrevious} className="p-2 text-white hover:scale-110 transition-transform">
          <SkipBack size={28} fill="currentColor" />
        </button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onTogglePlay}
          className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center shadow-2xl hover:bg-zinc-100 transition-colors"
        >
          {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-0.5" />}
        </motion.button>
        <button onClick={onSkipNext} className="p-2 text-white hover:scale-110 transition-transform">
          <SkipForward size={28} fill="currentColor" />
        </button>
        <button
          onClick={onOpenSleepTimer}
          className={`p-2 relative transition-colors ${sleepTimeLeft !== null ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Clock size={20} />
          {sleepTimeLeft !== null && (
            <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold bg-emerald-500 text-black rounded-full w-4 h-4 flex items-center justify-center">
              {sleepTimeLeft}
            </span>
          )}
        </button>
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between px-6 py-5 mt-1">
        <button className="p-2 text-zinc-600 hover:text-zinc-400 transition-colors">
          <MonitorSpeaker size={18} />
        </button>
        <div className="flex items-center gap-6">
          <button className="p-2 text-zinc-600 hover:text-zinc-400 transition-colors">
            <Share2 size={18} />
          </button>
          <button onClick={onOpenQueue} className="p-2 text-zinc-500 hover:text-white transition-colors">
            <ListMusic size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Liked Songs View ──────────────────────────────────────────────────────────
function LikedSongsView({ songs, onPlaySong, onBack, onToggleLike }: {
  songs: Song[]; onPlaySong: (s: Song) => void; onBack: () => void; onToggleLike: (id: string) => void;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="relative h-52 flex flex-col justify-end p-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-600/40 via-emerald-900/30 to-black/60" />
        <button onClick={onBack} className="absolute top-5 left-4 p-2 hover:bg-white/10 rounded-full transition-colors z-10">
          <ChevronLeft size={26} />
        </button>
        <div className="relative z-10 space-y-1">
          <div className="flex items-center gap-2">
            <ThumbsUp size={18} fill="currentColor" className="text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Auto Playlist</span>
          </div>
          <h1 className="text-3xl font-black">Liked Music</h1>
          <p className="text-sm text-zinc-400">{songs.length} songs</p>
        </div>
      </div>

      {/* Play all */}
      {songs.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-4">
          <button onClick={() => onPlaySong(songs[0])}
            className="w-12 h-12 bg-emerald-500 text-black rounded-full flex items-center justify-center shadow-lg hover:bg-emerald-400 transition-colors">
            <Play size={22} fill="currentColor" className="ml-0.5" />
          </button>
          <span className="text-sm font-bold text-zinc-400">Play all</span>
        </div>
      )}

      {/* Song list */}
      <div className="flex-1 overflow-y-auto px-4 pb-32 space-y-1 no-scrollbar">
        {songs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-zinc-600">
            <ThumbsUp size={48} className="opacity-30" />
            <p className="text-base font-semibold">No liked songs yet</p>
            <p className="text-sm text-center">Tap the 👍 button on any song to add it here</p>
          </div>
        ) : songs.map((song, i) => (
          <div key={song.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group cursor-pointer"
            onClick={() => onPlaySong(song)}>
            <span className="text-xs text-zinc-600 w-5 text-right shrink-0">{i + 1}</span>
            <img src={song.coverUrl} alt={song.title} className="w-11 h-11 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-semibold truncate">{song.title}</span>
              <span className="text-xs text-zinc-500 truncate">{song.artist}</span>
            </div>
            <button onClick={e => { e.stopPropagation(); onToggleLike(song.id); }}
              className="p-2 text-emerald-400 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0">
              <ThumbsUp size={16} fill="currentColor" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function QueueView({ queue, onBack, onRemove, onMove, onPlay }: {
  queue: Song[],
  onBack: () => void,
  onRemove: (id: string) => void,
  onMove: (index: number, direction: 'up' | 'down') => void,
  onPlay: (song: Song) => void
}) {
  return (
    <div className="min-h-screen flex flex-col pb-20">
      <header className="flex items-center p-6 gap-6">
        <button onClick={onBack} className="p-1">
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-2xl font-semibold">Queue</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 space-y-4">
        <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Now Playing</div>
        {queue.length > 0 && (
          <div className="p-4 glass rounded-2xl flex items-center gap-4 border-emerald-500/30 border">
            <img src={queue[0].coverUrl} alt={queue[0].title} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
            <div className="flex-1">
              <div className="font-bold text-emerald-400">{queue[0].title}</div>
              <div className="text-xs text-zinc-400">{queue[0].artist}</div>
            </div>
            <Music2 size={20} className="text-emerald-500 animate-pulse" />
          </div>
        )}

        <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-8 mb-2">Next In Queue</div>
        <div className="space-y-3">
          {queue.slice(1).map((song, i) => (
            <div key={song.id} className="glass-card p-3 rounded-xl flex items-center gap-4 group">
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => onMove(i + 1, 'up')}
                  disabled={i === 0}
                  className="text-zinc-500 hover:text-white disabled:opacity-0"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => onMove(i + 1, 'down')}
                  disabled={i === queue.length - 2}
                  className="text-zinc-500 hover:text-white disabled:opacity-0"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
              <img
                src={song.coverUrl}
                alt={song.title}
                className="w-12 h-12 rounded-lg object-cover cursor-pointer"
                onClick={() => onPlay(song)}
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 cursor-pointer" onClick={() => onPlay(song)}>
                <div className="font-medium text-sm">{song.title}</div>
                <div className="text-xs text-zinc-400">{song.artist}</div>
              </div>
              <button
                onClick={() => onRemove(song.id)}
                className="p-2 text-zinc-500 hover:text-rose-500 transition-colors"
              >
                <Trash2 size={18} />
              </button>
              <div className="cursor-grab active:cursor-grabbing text-zinc-600">
                <GripVertical size={20} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SleepTimerModal({ onClose, onSetTimer }: { onClose: () => void, onSetTimer: (mins: number | null) => void }) {
  const options = [
    { label: 'Off', value: null },
    { label: '5 minutes', value: 5 },
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '45 minutes', value: 45 },
    { label: '1 hour', value: 60 },
    { label: 'End of track', value: 0 },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="relative w-full max-w-md glass-dark rounded-3xl overflow-hidden"
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <h3 className="text-xl font-bold">Sleep Timer</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => onSetTimer(opt.value)}
              className="w-full text-left p-4 rounded-xl hover:bg-white/5 transition-colors font-medium"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ArtistDetailView({ artist, onBack, onPlaySong, songs }: {
  artist: string,
  onBack: () => void,
  onPlaySong: (song: Song) => void,
  songs: Song[]
}) {
  return (
    <div className="min-h-screen flex flex-col pb-32">
      <header className="p-6 flex items-center justify-between sticky top-0 z-10 bg-black/40 backdrop-blur-md">
        <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <ChevronLeft size={32} />
        </button>
      </header>

      <div className="px-6 flex flex-col items-center space-y-6">
        <div className="w-64 h-64 rounded-full overflow-hidden shadow-2xl border border-white/10 bg-zinc-900">
          <img
            src={`https://picsum.photos/seed/${artist}/400/400`}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="w-full space-y-4 text-center">
          <h1 className="text-5xl font-black tracking-tighter">{artist}</h1>
          <p className="text-zinc-400 font-medium">1,234,567 monthly listeners</p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <button className="px-8 py-3 rounded-full border border-white/20 font-bold hover:bg-white/5 transition-colors">
              Follow
            </button>
            <button onClick={() => onPlaySong(songs[0])} className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
              <Play size={32} fill="black" className="text-black ml-1" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 space-y-4">
        <h2 className="text-xl font-bold mb-4">Popular</h2>
        {songs.map((song, i) => (
          <div
            key={song.id}
            onClick={() => onPlaySong(song)}
            className="flex items-center gap-4 group cursor-pointer p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <span className="w-4 text-zinc-500 font-medium">{i + 1}</span>
            <img src={song.coverUrl} alt={song.title} className="w-12 h-12 rounded-lg object-cover" referrerPolicy="no-referrer" />
            <div className="flex-1">
              <span className="text-base font-bold group-hover:text-emerald-400 transition-colors">{song.title}</span>
              <span className="text-sm text-zinc-400 block">{song.artist}</span>
            </div>
            <button className="p-2 text-zinc-500 hover:text-white">
              <MoreVertical size={20} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlbumDetailView({ album, onBack, onPlaySong, songs }: {
  album: string,
  onBack: () => void,
  onPlaySong: (song: Song) => void,
  songs: Song[]
}) {
  const albumArtist = songs[0]?.artist;
  const albumCover = songs[0]?.coverUrl;

  return (
    <div className="min-h-screen flex flex-col pb-32">
      <header className="p-6 flex items-center justify-between sticky top-0 z-10 bg-black/40 backdrop-blur-md">
        <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <ChevronLeft size={32} />
        </button>
      </header>

      <div className="px-6 flex flex-col items-center space-y-6">
        <div className="w-64 h-64 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900">
          <img
            src={albumCover}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>

        <div className="w-full space-y-4">
          <h1 className="text-4xl font-black tracking-tighter">{album}</h1>

          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full overflow-hidden">
              <img src={`https://picsum.photos/seed/${albumArtist}/100/100`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <span className="text-sm font-bold">{albumArtist}</span>
            <span className="text-zinc-500">•</span>
            <span className="text-sm text-zinc-400">2024</span>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex items-center gap-6">
              <button className="p-2 text-zinc-400 hover:text-white transition-colors">
                <ArrowDownToLine size={28} />
              </button>
              <button className="p-2 text-zinc-400 hover:text-white transition-colors">
                <Share2 size={28} />
              </button>
            </div>
            <button onClick={() => onPlaySong(songs[0])} className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
              <Play size={32} fill="black" className="text-black ml-1" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 space-y-4">
        {songs.map((song, i) => (
          <div
            key={song.id}
            onClick={() => onPlaySong(song)}
            className="flex items-center gap-4 group cursor-pointer p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <span className="w-4 text-zinc-500 font-medium">{i + 1}</span>
            <div className="flex-1">
              <span className="text-base font-bold group-hover:text-emerald-400 transition-colors">{song.title}</span>
              <span className="text-sm text-zinc-400 block">{song.artist}</span>
            </div>
            <button className="p-2 text-zinc-500 hover:text-white">
              <MoreVertical size={20} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaylistDetailView({ playlist, onBack, onPlaySong, onMore, onRemoveSong, onAddSongs, onShuffle, onPlayAll }: {
  playlist: { id: string, name: string, songs: Song[] },
  onBack: () => void,
  onPlaySong: (song: Song) => void,
  onMore: () => void,
  onRemoveSong: (id: string) => void,
  onAddSongs: () => void,
  onShuffle: () => void,
  onPlayAll: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col pb-32">
      <header className="p-6 flex items-center justify-between sticky top-0 z-10 bg-black/40 backdrop-blur-md">
        <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <ChevronLeft size={32} />
        </button>
      </header>

      <div className="px-6 flex flex-col items-center space-y-6">
        <div className="w-64 h-64 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-zinc-900">
          {playlist.songs.length >= 4 ? (
            <div className="grid grid-cols-2 w-full h-full">
              {playlist.songs.slice(0, 4).map(s => (
                <img key={s.id} src={s.coverUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ))}
            </div>
          ) : playlist.songs.length > 0 ? (
            <img src={playlist.songs[0].coverUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 size={64} className="text-zinc-700" />
            </div>
          )}
        </div>

        <div className="w-full space-y-4">
          <h1 className="text-5xl font-black tracking-tighter">{playlist.name}</h1>

          <div className="flex items-center gap-3">
            <div className="flex items-center -space-x-2">
              <button className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-black">
                <Plus size={16} className="text-black" />
              </button>
              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-black">
                <img src="https://picsum.photos/seed/user/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
            </div>
            <span className="text-sm font-semibold text-zinc-400">You</span>
          </div>

          <div className="flex items-center gap-2 text-zinc-500">
            <Globe size={14} />
            <span className="text-sm">
              {(() => {
                const totalSec = playlist.songs.reduce((sum, s) => sum + (s.duration || 0), 0);
                if (totalSec < 60) return `${playlist.songs.length} songs`;
                const h = Math.floor(totalSec / 3600);
                const m = Math.floor((totalSec % 3600) / 60);
                return h > 0 ? `${h}h ${m}min` : `${m} min`;
              })()}
            </span>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg overflow-hidden border border-white/10">
                <img src={playlist.songs[0]?.coverUrl || "https://picsum.photos/seed/playlist/100/100"} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </div>
              <button className="p-2 text-zinc-400 hover:text-white transition-colors">
                <ArrowDownToLine size={24} />
              </button>
              <button className="p-2 text-zinc-400 hover:text-white transition-colors">
                <Share2 size={24} />
              </button>
              <button onClick={onMore} className="p-2 text-zinc-400 hover:text-white transition-colors">
                <MoreVertical size={24} />
              </button>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={onShuffle} className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors">
                <Shuffle size={28} />
              </button>
              <button onClick={onPlayAll} className="w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform">
                <Play size={28} fill="black" className="text-black ml-1" />
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar pt-4">
            <button onClick={onAddSongs} className="flex items-center gap-2 bg-zinc-800/60 px-4 py-2 rounded-full text-sm font-bold border border-white/5 hover:bg-zinc-700 transition-colors">
              <Plus size={18} /> Add
            </button>
            <button onClick={onMore} className="flex items-center gap-2 bg-zinc-800/60 px-4 py-2 rounded-full text-sm font-bold border border-white/5 hover:bg-zinc-700 transition-colors">
              <Edit2 size={18} /> Edit
            </button>
            <button className="flex items-center gap-2 bg-zinc-800/60 px-4 py-2 rounded-full text-sm font-bold border border-white/5 hover:bg-zinc-700 transition-colors">
              <ArrowUpDown size={18} /> Sort
            </button>
            <button onClick={onMore} className="flex items-center gap-2 bg-zinc-800/60 px-4 py-2 rounded-full text-sm font-bold border border-white/5 hover:bg-zinc-700 transition-colors">
              <TypeIcon size={18} /> Name & details
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 space-y-4">
        {playlist.songs.map(song => (
          <div
            key={song.id}
            className="flex items-center justify-between group cursor-pointer p-2 rounded-xl hover:bg-white/5 transition-colors"
          >
            <div onClick={() => onPlaySong(song)} className="flex items-center gap-4 flex-1">
              <img src={song.coverUrl} alt={song.title} className="w-14 h-14 rounded-lg object-cover" referrerPolicy="no-referrer" />
              <div className="flex flex-col">
                <span className="text-base font-bold group-hover:text-emerald-400 transition-colors">{song.title}</span>
                <span className="text-sm text-zinc-400">{song.artist}</span>
              </div>
            </div>
            <button onClick={() => onRemoveSong(song.id)} className="p-2 text-zinc-500 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 size={20} />
            </button>
            <button className="p-2 text-zinc-500 hover:text-white">
              <MoreVertical size={20} />
            </button>
          </div>
        ))}
        {playlist.songs.length === 0 && (
          <div className="text-center py-20 text-zinc-500 italic">
            This playlist is empty. Add some songs!
          </div>
        )}
      </div>
    </div>
  );
}

function PlaylistContextMenu({ playlist, onClose, onEditName, onAddCover, onDelete }: {
  playlist: { name: string },
  onClose: () => void,
  onEditName: () => void,
  onAddCover: () => void,
  onDelete: () => void
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative w-full glass-dark rounded-t-[32px] overflow-hidden pb-10"
      >
        <div className="p-6 border-b border-white/5">
          <h3 className="text-xl font-bold">{playlist.name}</h3>
        </div>
        <div className="p-4 space-y-1">
          <button onClick={onEditName} className="w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-colors group">
            <Edit2 size={24} className="text-zinc-400 group-hover:text-white" />
            <span className="text-base font-medium">Edit playlist</span>
          </button>
          <button onClick={onEditName} className="w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-colors group">
            <TypeIcon size={24} className="text-zinc-400 group-hover:text-white" />
            <span className="text-base font-medium">Name and details</span>
          </button>
          <button onClick={onAddCover} className="w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-colors group">
            <ImageIcon size={24} className="text-zinc-400 group-hover:text-white" />
            <span className="text-base font-medium">Add cover art</span>
          </button>
          <button onClick={onDelete} className="w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-colors group text-rose-500">
            <Trash2 size={24} />
            <span className="text-base font-medium">Delete playlist</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function SongContextMenu({ song, onClose, onPlayNext, onAddToQueue, onToggleLike, isLiked, onAddToPlaylist }: {
  song: Song,
  onClose: () => void,
  onPlayNext: () => void,
  onAddToQueue: () => void,
  onToggleLike: () => void,
  isLiked: boolean,
  onAddToPlaylist: () => void
}) {
  const menuItems = [
    { icon: <PlaySquare size={24} />, label: 'Play Next', onClick: onPlayNext },
    { icon: <ListMusic size={24} />, label: 'Add to Queue', onClick: onAddToQueue },
    { icon: <Heart size={24} fill={isLiked ? "currentColor" : "none"} className={isLiked ? "text-rose-500" : ""} />, label: isLiked ? 'Remove from Favorites' : 'Add to Favorites', onClick: onToggleLike },
    { icon: <Plus size={24} />, label: 'Add to Playlist', onClick: onAddToPlaylist },
    { icon: <Share2 size={24} />, label: 'Share', onClick: () => alert('Sharing...') },
    { icon: <Download size={24} />, label: 'Download', onClick: () => alert('Downloading...') },
    { icon: <ExternalLink size={24} />, label: 'Open original link', onClick: () => alert('Opening link...') },
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative w-full glass-dark rounded-t-[32px] overflow-hidden pb-10"
      >
        <div className="p-6 flex items-center gap-4 border-b border-white/5">
          <div className="relative">
            <img src={song.coverUrl} alt={song.title} className="w-16 h-16 rounded-xl object-cover" referrerPolicy="no-referrer" />
            <div className="absolute -left-2 top-1/2 -translate-y-1/2">
              <Play size={16} fill="white" className="text-white" />
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <h3 className="text-lg font-bold truncate">{song.title}</h3>
            <p className="text-sm text-zinc-400 truncate">{song.artist}</p>
          </div>
          <div className="flex gap-4">
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <Copy size={20} />
            </button>
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <Info size={20} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-1">
          {menuItems.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              className="w-full flex items-center gap-6 p-4 rounded-2xl hover:bg-white/5 transition-colors group"
            >
              <div className="text-zinc-400 group-hover:text-white transition-colors">
                {item.icon}
              </div>
              <span className="text-base font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function AddToPlaylistModal({ song, playlists, onClose, onSelect, onCreateNew }: {
  song: Song,
  playlists: { id: string, name: string, songs: Song[] }[],
  onClose: () => void,
  onSelect: (id: string) => void,
  onCreateNew: () => void
}) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="relative w-full max-w-sm glass-dark rounded-[32px] overflow-hidden p-6 space-y-6"
      >
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold">Add to Playlist</h3>
          <p className="text-sm text-zinc-400">Select a playlist for "{song.title}"</p>
        </div>

        <div className="max-h-[300px] overflow-y-auto no-scrollbar space-y-2">
          {playlists.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-colors border border-white/5"
            >
              <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
                <Music2 size={20} className="text-zinc-500" />
              </div>
              <div className="flex flex-col items-start">
                <span className="font-bold">{p.name}</span>
                <span className="text-xs text-zinc-500">{p.songs.length} songs</span>
              </div>
            </button>
          ))}
          {playlists.length === 0 && (
            <div className="text-center py-8 text-zinc-500 italic">No playlists found</div>
          )}
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={onCreateNew}
            className="w-full bg-emerald-500 text-black py-4 rounded-full font-bold transition-transform active:scale-95"
          >
            Create New Playlist
          </button>
          <button
            onClick={onClose}
            className="w-full bg-white/5 py-4 rounded-full font-bold transition-transform active:scale-95"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ProfileMenuView({ onClose, onViewProfile, onSettings, recents, onPlayRecent }: {
  onClose: () => void,
  onViewProfile: () => void,
  onSettings: () => void,
  recents: Song[],
  onPlayRecent: (song: Song) => void
}) {
  return (
    <div className="min-h-screen glass-dark flex flex-col">
      <header className="flex items-center p-6 gap-6">
        <button onClick={onClose} className="p-1">
          <ChevronLeft size={28} />
        </button>
      </header>

      <div className="px-6 py-4 flex items-center gap-4 border-b border-white/5 pb-8">
        <div className="w-16 h-16 rounded-full overflow-hidden border border-white/10">
          <img src="https://picsum.photos/seed/user/100/100" alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>
        <div className="flex flex-col">
          <h2 className="text-xl font-bold">You</h2>
          <button onClick={onViewProfile} className="text-sm text-zinc-400 text-left hover:text-white transition-colors">
            View profile
          </button>
        </div>
      </div>

      <div className="flex-1 px-6 py-8 space-y-8 overflow-y-auto no-scrollbar">
        <div className="space-y-4">
          <div className="flex items-center gap-6 w-full group">
            <History size={28} className="text-zinc-400" />
            <span className="text-lg font-medium">Recents</span>
          </div>
          <div className="space-y-2 pl-12">
            {recents.map(song => (
              <div
                key={song.id}
                onClick={() => onPlayRecent(song)}
                className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors"
              >
                <img src={song.coverUrl} alt={song.title} className="w-8 h-8 rounded object-cover" referrerPolicy="no-referrer" />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium truncate">{song.title}</span>
                  <span className="text-[10px] text-zinc-500 truncate">{song.artist}</span>
                </div>
              </div>
            ))}
            {recents.length === 0 && (
              <div className="text-xs text-zinc-600 italic">No recent tracks</div>
            )}
          </div>
        </div>

        <button onClick={onSettings} className="flex items-center gap-6 w-full group">
          <Settings size={28} className="text-zinc-400 group-hover:text-white transition-colors" />
          <span className="text-lg font-medium">Settings and privacy</span>
        </button>
      </div>
    </div>
  );
}

function SettingsView({ onBack }: { onBack: () => void }) {
  const settingsItems = [
    { icon: <CloudDownload size={24} />, title: 'Updates', desc: 'Check for new updates' },
    { icon: <FolderDown size={24} />, title: 'Downloads', desc: 'Download Path, Download Quality and more...' },
    { icon: <Headphones size={24} />, title: 'Player Settings', desc: 'Stream quality, Auto Play, etc.' },
    { icon: <Layout size={24} />, title: 'UI Elements & Services', desc: 'Auto slide, Source Engines etc.' },
    { icon: <Activity size={24} />, title: 'Last.FM Settings', desc: 'API Key, Secret, and Scrobbling settings.' },
    { icon: <Database size={24} />, title: 'Storage', desc: 'Backup, Cache, History, Restore and more...' },
    { icon: <Globe size={24} />, title: 'Language & Country', desc: 'Select your language and country.' },
    { icon: <Github size={24} />, title: 'About', desc: 'About the app, version, developer, etc.' },
  ];

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <header className="flex items-center p-6 gap-6">
        <button onClick={onBack} className="p-1">
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-2xl font-semibold">Settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 space-y-4">
        {settingsItems.map((item, i) => (
          <div key={i} className="flex items-start gap-6 p-4 rounded-2xl glass-card cursor-pointer group">
            <div className="text-zinc-200 mt-1">
              {item.icon}
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-medium group-hover:text-rose-400 transition-colors">{item.title}</span>
              <span className="text-sm text-zinc-500">{item.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileView({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-8">
      <header className="flex items-center gap-6">
        <button onClick={onBack} className="p-1">
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-2xl font-semibold">Profile</h1>
      </header>

      <div className="flex flex-col items-center gap-4 py-6">
        <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-emerald-500/20 shadow-2xl">
          <img src="https://picsum.photos/seed/user/200/200" alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold">John Doe</h2>
          <p className="text-zinc-400 text-sm">Premium Member</p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <div className="glass-card p-4 rounded-2xl">
          <span className="text-zinc-500 text-xs uppercase font-bold tracking-wider">Hours Listened</span>
          <div className="text-2xl font-bold mt-1">124.5</div>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <span className="text-zinc-500 text-xs uppercase font-bold tracking-wider">Top Artist</span>
          <div className="text-2xl font-bold mt-1">M83</div>
        </div>
      </section>

      <section className="glass-card p-6 rounded-2xl space-y-4">
        <h3 className="text-lg font-semibold">Listening Progress</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-400">Monthly Goal</span>
              <span>75%</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 w-3/4" />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-zinc-400">Daily Streak</span>
              <span>12 days</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500 w-1/2" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


function AddSongModal({ onClose, onAdd, onImportPlaylist }: {
  onClose: () => void;
  onAdd: (song: { title: string; artist: string; album: string; audioUrl: string; coverUrl: string; youtubeId?: string }) => void;
  onImportPlaylist: (type: 'youtube' | 'spotify', url: string) => void;
}) {
  const [tab, setTab] = React.useState<'yt-video' | 'yt-playlist' | 'spotify' | 'manual'>('yt-video');
  const [ytUrl, setYtUrl] = React.useState('');
  const [ytLoading, setYtLoading] = React.useState(false);
  const [ytError, setYtError] = React.useState('');
  const [ytInfo, setYtInfo] = React.useState<any>(null);
  const [plUrl, setPlUrl] = React.useState('');
  const [plError, setPlError] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [artist, setArtist] = React.useState('');
  const [album, setAlbum] = React.useState('');
  const [audioUrl, setAudioUrl] = React.useState('');
  const [coverUrl, setCoverUrl] = React.useState('');
  const [previewing, setPreviewing] = React.useState(false);
  const previewRef = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => { previewRef.current = new Audio(); return () => { previewRef.current?.pause(); }; }, []);

  const fetchYtInfo = async () => {
    if (!ytUrl.trim()) return;
    setYtLoading(true); setYtError(''); setYtInfo(null);
    try {
      const res = await fetch('/api/youtube/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: ytUrl.trim() }) });
      const text = await res.text();
      if (!text) throw new Error('Empty response');
      let data: any; try { data = JSON.parse(text); } catch { throw new Error('Invalid response'); }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setYtInfo(data);
    } catch (e: any) { setYtError(e.message); } finally { setYtLoading(false); }
  };

  const handleImportPlaylist = () => {
    if (!plUrl.trim()) { setPlError('Please enter a URL'); return; }
    const type = tab === 'spotify' ? 'spotify' : 'youtube';
    if (tab === 'yt-playlist' && !plUrl.includes('list=')) { setPlError('Enter a YouTube playlist URL (must contain ?list=...)'); return; }
    if (tab === 'spotify' && !plUrl.includes('spotify.com/playlist')) { setPlError('Enter a Spotify playlist URL'); return; }
    onImportPlaylist(type, plUrl.trim());
    onClose();
  };

  const ic = 'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-zinc-600';
  const tabs = [
    { id: 'yt-video', label: '▶ Video', color: 'bg-red-600 text-white' },
    { id: 'yt-playlist', label: '≡ YT Playlist', color: 'bg-red-600 text-white' },
    { id: 'spotify', label: '● Spotify', color: 'bg-green-500 text-black' },
    { id: 'manual', label: '+ Manual', color: 'bg-emerald-500 text-black' },
  ] as const;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 26, stiffness: 220 }} className="relative w-full max-w-lg glass-dark rounded-t-[32px] overflow-hidden pb-10">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-bold">Add Music</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={18} /></button>
        </div>
        <div className="px-4 pt-3 pb-1">
          <div className="flex gap-1.5 bg-white/5 p-1 rounded-xl overflow-x-auto no-scrollbar">
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setYtError(''); setPlError(''); setYtInfo(null); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap px-2 ${tab === t.id ? t.color + ' shadow-lg' : 'text-zinc-500 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh] no-scrollbar">
          {tab === 'yt-video' && (<>
            <p className="text-xs text-zinc-500">Paste a YouTube video URL or youtu.be link</p>
            <div className="flex gap-2">
              <input value={ytUrl} onChange={e => { setYtUrl(e.target.value); setYtInfo(null); setYtError(''); }} onKeyDown={e => e.key === 'Enter' && fetchYtInfo()} placeholder="https://youtube.com/watch?v=..." className={ic + ' flex-1'} />
              <button onClick={fetchYtInfo} disabled={!ytUrl.trim() || ytLoading} className="px-4 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-500 disabled:opacity-40 whitespace-nowrap">{ytLoading ? '...' : 'Fetch'}</button>
            </div>
            {ytLoading && <div className="flex items-center gap-3 py-6 justify-center text-zinc-400"><div className="w-5 h-5 border-2 border-zinc-600 border-t-red-500 rounded-full animate-spin" /><span className="text-sm">Fetching...</span></div>}
            {ytError && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-sm text-rose-400">⚠ {ytError}</div>}
            {ytInfo && !ytLoading && (
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                <div className="flex gap-3 p-4">
                  <img src={ytInfo.coverUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0" referrerPolicy="no-referrer" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{ytInfo.title}</div>
                    <div className="text-xs text-zinc-400 truncate">{ytInfo.artist}</div>
                    <div className="text-xs text-zinc-500 mt-1">{Math.floor(ytInfo.duration / 60)}:{String(ytInfo.duration % 60).padStart(2, '0')}</div>
                    <div className="flex items-center gap-1 text-xs text-emerald-400 mt-1"><span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />Ready</div>
                  </div>
                </div>
                <div className="border-t border-white/5 p-3">
                  <button onClick={() => { onAdd({ title: ytInfo.title, artist: ytInfo.artist, album: ytInfo.album, coverUrl: ytInfo.coverUrl, audioUrl: ytInfo.audioUrl, youtubeId: ytInfo.videoId }); }} className="w-full bg-red-600 text-white py-2.5 rounded-xl font-bold hover:bg-red-500 transition-all">Import to Library</button>
                </div>
              </div>
            )}
            {!ytInfo && !ytLoading && !ytError && (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-600 gap-2">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" opacity="0.5"><path d="M21.543 6.498C22 8.28 22 12 22 12s0 3.72-.457 5.502c-.254.985-.997 1.76-1.938 2.022C17.896 20 12 20 12 20s-5.896 0-7.605-.476c-.945-.266-1.687-1.04-1.938-2.022C2 15.72 2 12 2 12s0-3.72.457-5.502c.254-.985.997-1.76 1.938-2.022C6.104 4 12 4 12 4s5.896 0 7.605.476c.945.266 1.687 1.04 1.938 2.022zM10 15.5l6-3.5-6-3.5v7z" /></svg>
                <p className="text-sm">Paste a YouTube URL and click Fetch</p>
              </div>
            )}
          </>)}
          {tab === 'yt-playlist' && (<>
            <p className="text-xs text-zinc-500">Import all songs from a YouTube playlist at once.</p>
            <input value={plUrl} onChange={e => { setPlUrl(e.target.value); setPlError(''); }} placeholder="https://youtube.com/playlist?list=..." className={ic} />
            {plError && <p className="text-xs text-rose-400">{plError}</p>}
            <div className="bg-white/4 rounded-xl p-4 text-xs text-zinc-500 space-y-1">
              <p className="font-bold text-zinc-400">How it works:</p>
              <p>• Songs are imported in the background via a progress tracker</p>
              <p>• Works with public playlists (Watch Later won't work)</p>
              <p>• Audio streams directly — no files stored on disk</p>
            </div>
            <button onClick={handleImportPlaylist} disabled={!plUrl.trim()} className="w-full bg-red-600 text-white py-3 rounded-full font-bold hover:bg-red-500 disabled:opacity-40 transition-all">Start Import</button>
          </>)}
          {tab === 'spotify' && (<>
            <p className="text-xs text-zinc-500">Import a Spotify playlist — we find each song on YouTube automatically.</p>
            <input value={plUrl} onChange={e => { setPlUrl(e.target.value); setPlError(''); }} placeholder="https://open.spotify.com/playlist/..." className={ic} />
            {plError && <p className="text-xs text-rose-400">{plError}</p>}
            <div className="bg-white/4 rounded-xl p-4 text-xs text-zinc-500 space-y-1">
              <p className="font-bold text-zinc-400">Requirements:</p>
              <p>• Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env</p>
              <p>• The playlist must be public</p>
              <p>• Each track is matched to the best YouTube result</p>
            </div>
            <button onClick={handleImportPlaylist} disabled={!plUrl.trim()} className="w-full py-3 rounded-full font-bold disabled:opacity-40 transition-all bg-green-500 text-black hover:bg-green-400">Start Spotify Import</button>
          </>)}
          {tab === 'manual' && (<>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Song Title *</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Blinding Lights" className={ic} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Artist *</label><input value={artist} onChange={e => setArtist(e.target.value)} placeholder="e.g. The Weeknd" className={ic} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Album</label><input value={album} onChange={e => setAlbum(e.target.value)} placeholder="e.g. After Hours" className={ic} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Audio URL *</label>
              <div className="flex gap-2">
                <input value={audioUrl} onChange={e => { setAudioUrl(e.target.value); if (previewing) { previewRef.current?.pause(); setPreviewing(false); } }} placeholder="https://example.com/song.mp3" className={ic + ' flex-1'} />
                <button onClick={() => { const a = previewRef.current; if (!a || !audioUrl) return; if (previewing) { a.pause(); setPreviewing(false); } else { a.src = audioUrl; a.play().then(() => setPreviewing(true)).catch(() => setPreviewing(false)); } }} disabled={!audioUrl.trim()} className={'px-3 rounded-xl border transition-colors disabled:opacity-40 ' + (previewing ? 'bg-emerald-500 border-emerald-500 text-black' : 'bg-white/5 border-white/10 hover:bg-white/10')}>
                  {previewing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
              </div>
            </div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Cover URL</label>
              <div className="flex gap-2 items-center">
                <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)} placeholder="https://example.com/cover.jpg" className={ic + ' flex-1'} />
                {coverUrl && <img src={coverUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 border border-white/10" referrerPolicy="no-referrer" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />}
              </div>
            </div>
            <button onClick={() => { if (!title.trim() || !artist.trim() || !audioUrl.trim()) return; previewRef.current?.pause(); onAdd({ title: title.trim(), artist: artist.trim(), album: album.trim() || 'Unknown Album', audioUrl: audioUrl.trim(), coverUrl: coverUrl.trim() }); }} disabled={!title.trim() || !artist.trim() || !audioUrl.trim()} className="w-full bg-emerald-500 text-black py-3.5 rounded-full font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-400 transition-all">Add to Library</button>
          </>)}
        </div>
      </motion.div>
    </div>
  );
}
// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ activeView, onNavigate, onClose, onImport, onProfile, songs, playlists, onOpenPlaylist }: {
  activeView: string; onNavigate: (v: any) => void; onClose: () => void; onImport: () => void; onProfile: () => void;
  songs: any[]; playlists: any[]; onOpenPlaylist: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="relative w-72 h-full glass-dark flex flex-col overflow-hidden border-r border-white/5">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg">
              <Music2 size={18} className="text-black" />
            </div>
            <span className="text-lg font-black tracking-tight">SonicStream</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={18} /></button>
        </div>

        {/* Profile */}
        <button onClick={onProfile} className="flex items-center gap-3 mx-4 mt-4 p-3 rounded-2xl glass-card hover:bg-white/10 transition-colors group">
          <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-emerald-500/40 shrink-0">
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col text-left min-w-0">
            <span className="font-bold text-sm">Your Profile</span>
            <span className="text-xs text-zinc-500 truncate">{songs.length} songs in library</span>
          </div>
          <ChevronLeft size={16} className="ml-auto rotate-180 text-zinc-500 group-hover:text-white transition-colors" />
        </button>

        {/* Nav */}
        <div className="px-4 mt-4 space-y-0.5">
          {[
            { icon: <Home size={18} />, label: 'Home', view: 'home' },
            { icon: <Search size={18} />, label: 'Search', view: 'search' },
            { icon: <LibraryBig size={18} />, label: 'Library', view: 'library' },
            { icon: <FolderDown size={18} />, label: 'Downloads', view: 'downloads' },
            { icon: <Settings size={18} />, label: 'Settings', view: 'settings' },
          ].map(({ icon, label, view }) => (
            <button key={view} onClick={() => onNavigate(view)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeView === view
                  ? 'bg-emerald-500/12 text-emerald-400 border-l-2 border-emerald-500'
                  : 'text-zinc-400 hover:bg-white/6 hover:text-white border-l-2 border-transparent'
              }`}>
            </button>
          ))}
        </div>

        {/* Import Section */}
        <div className="px-4 mt-5">
          <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest mb-2 px-2">Import Music</p>
          <button onClick={onImport}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-red-600/20 to-transparent border border-red-600/20 hover:from-red-600/30 transition-all text-red-400 hover:text-red-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.543 6.498C22 8.28 22 12 22 12s0 3.72-.457 5.502c-.254.985-.997 1.76-1.938 2.022C17.896 20 12 20 12 20s-5.896 0-7.605-.476c-.945-.266-1.687-1.04-1.938-2.022C2 15.72 2 12 2 12s0-3.72.457-5.502c.254-.985.997-1.76 1.938-2.022C6.104 4 12 4 12 4s5.896 0 7.605.476c.945.266 1.687 1.04 1.938 2.022zM10 15.5l6-3.5-6-3.5v7z" /></svg>
            YouTube / Spotify
          </button>
        </div>

        {/* Recent Playlists */}
        {playlists.length > 0 && (
          <div className="px-4 mt-5 flex-1 overflow-y-auto no-scrollbar">
            <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest mb-2 px-2">Your Playlists</p>
            <div className="space-y-1">
              {playlists.slice(0, 8).map(pl => (
                <button key={pl.id} onClick={() => onOpenPlaylist(pl.id)}
                  className="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-sm text-zinc-400 hover:bg-white/8 hover:text-white transition-all">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                    {pl.songs?.[0]?.coverUrl
                      ? <img src={pl.songs[0].coverUrl} alt="" className="w-full h-full object-cover rounded-lg" referrerPolicy="no-referrer" />
                      : <Music2 size={14} className="text-zinc-600" />}
                  </div>
                  <div className="flex flex-col text-left min-w-0">
                    <span className="font-semibold text-xs truncate">{pl.name}</span>
                    <span className="text-xs text-zinc-600">{pl.songs?.length || 0} songs</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.aside>
    </div>
  );
}

// ─── Import Progress Modal ─────────────────────────────────────────────────────
function ImportProgressModal({ progress, onClose }: {
  progress: { active: boolean; type: string; current: number; total: number; track: string; songs: any[]; error: string; done: boolean };
  onClose: () => void;
}) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const icon = progress.type === 'spotify'
    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
    : <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000"><path d="M21.543 6.498C22 8.28 22 12 22 12s0 3.72-.457 5.502c-.254.985-.997 1.76-1.938 2.022C17.896 20 12 20 12 20s-5.896 0-7.605-.476c-.945-.266-1.687-1.04-1.938-2.022C2 15.72 2 12 2 12s0-3.72.457-5.502c.254-.985.997-1.76 1.938-2.022C6.104 4 12 4 12 4s5.896 0 7.605.476c.945.266 1.687 1.04 1.938 2.022zM10 15.5l6-3.5-6-3.5v7z" /></svg>;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={progress.done ? onClose : undefined} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="relative w-full max-w-lg glass-dark rounded-t-[32px] overflow-hidden pb-8">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            {icon}
            <h2 className="text-lg font-bold">Importing {progress.type === 'spotify' ? 'Spotify' : 'YouTube'} Playlist</h2>
          </div>
          {progress.done && <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={18} /></button>}
        </div>
        <div className="p-6 space-y-5">
          {progress.error ? (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 text-center">
              <p className="text-rose-400 font-semibold mb-1">Import Failed</p>
              <p className="text-sm text-zinc-400">{progress.error}</p>
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">{progress.done ? 'Complete!' : 'Importing...'}</span>
                  <span className="font-bold">{progress.current}/{progress.total || '?'}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div className={`h-full rounded-full ${progress.type === 'spotify' ? 'bg-green-500' : 'bg-red-500'}`}
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.3 }} />
                </div>
                <p className="text-xs text-zinc-500 truncate">{progress.done ? `✓ ${progress.songs.length} songs imported` : (progress.track || 'Fetching playlist...')}</p>
              </div>

              {/* Recent imports */}
              {progress.songs.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                  {[...progress.songs].reverse().slice(0, 8).map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/4">
                      <img src={s.coverUrl || `https://picsum.photos/seed/${s.id}/40/40`} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" referrerPolicy="no-referrer" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold truncate">{s.title}</span>
                        <span className="text-xs text-zinc-500 truncate">{s.artist}</span>
                      </div>
                      <span className="text-emerald-400 text-xs shrink-0">✓</span>
                    </div>
                  ))}
                </div>
              )}

              {!progress.done && (
                <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm">
                  <div className="w-4 h-4 border-2 border-zinc-700 border-t-emerald-500 rounded-full animate-spin" />
                  <span>This may take a few minutes for large playlists</span>
                </div>
              )}
              {progress.done && (
                <button onClick={onClose} className="w-full bg-emerald-500 text-black py-3 rounded-full font-bold hover:bg-emerald-400 transition-all">
                  Done — {progress.songs.length} songs added
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
