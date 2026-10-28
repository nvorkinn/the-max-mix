/**
 * Collaborative Party Queue Manager
 * Manages tracks queued by party guests, tracks upvotes, and determines playback order
 */

export class QueueManager {
  constructor() {
    this.queue = [];
    this.playedHistory = [];
  }

  getQueue() {
    // Return queue sorted by votes (descending), then addedAt (ascending)
    return [...this.queue].sort((a, b) => {
      if (b.votes !== a.votes) {
        return b.votes - a.votes;
      }
      return a.addedAt - b.addedAt;
    });
  }

  addTrack(track, guest = { id: 'host', name: 'Host' }) {
    // Check if track is already in queue
    const existingIndex = this.queue.findIndex(item => item.id === track.id);
    if (existingIndex !== -1) {
      // If already in queue, automatically count as an upvote from this guest
      return this.upvoteTrack(track.id, guest.id);
    }

    const queueItem = {
      id: track.id || `track_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      uri: track.uri || `spotify:track:${track.id}`,
      title: track.title || track.name || 'Unknown Title',
      artist: track.artist || (track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist'),
      album: track.album?.name || track.album || 'Unknown Album',
      albumArt: track.albumArt || track.album?.images?.[0]?.url || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=400&auto=format&fit=crop&q=80',
      duration_ms: track.duration_ms || 180000,
      addedBy: {
        id: guest.id,
        name: guest.name || 'Party Animal',
        avatar: guest.avatar || '🎉'
      },
      addedAt: Date.now(),
      votes: 1,
      voters: [guest.id]
    };

    this.queue.push(queueItem);
    return { success: true, item: queueItem, queue: this.getQueue() };
  }

  upvoteTrack(trackId, guestId) {
    const item = this.queue.find(t => t.id === trackId);
    if (!item) {
      return { success: false, error: 'Track not found in queue' };
    }

    if (!item.voters.includes(guestId)) {
      item.voters.push(guestId);
      item.votes = item.voters.length;
      return { success: true, action: 'upvoted', item, queue: this.getQueue() };
    } else {
      // Toggle upvote off if already voted (or keep vote - keep vote is friendlier for parties)
      return { success: true, action: 'already_voted', item, queue: this.getQueue() };
    }
  }

  removeTrack(trackId) {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter(t => t.id !== trackId);
    return { success: this.queue.length < initialLen, queue: this.getQueue() };
  }

  popNextTrack() {
    const sorted = this.getQueue();
    if (sorted.length === 0) return null;

    const nextTrack = sorted[0];
    this.queue = this.queue.filter(t => t.id !== nextTrack.id);
    this.playedHistory.unshift(nextTrack);
    if (this.playedHistory.length > 50) {
      this.playedHistory.pop();
    }
    return nextTrack;
  }

  clear() {
    this.queue = [];
    return this.getQueue();
  }
}

export const partyQueue = new QueueManager();
