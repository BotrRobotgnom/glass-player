// Two playback engines with the same interface:
//   load(track), play(), pause(), seek(sec), setVolume(0..100)
// Callbacks: onState('playing'|'paused'|'ended'|'buffering'), onTime(cur, dur), onError(code)
(() => {
  'use strict';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src + ' (no internet?)'));
      document.head.appendChild(s);
    });
  }

  // ---------- YouTube (official IFrame Player API) ----------
  class YouTubeEngine {
    constructor(mountId, handlers) {
      this.mountId = mountId;
      this.h = handlers;
      this.player = null;
      this.ready = null;
      this.volume = 80;
      this.timer = null;
    }

    init() {
      if (!this.ready) {
        this.ready = this._init().catch((err) => {
          this.ready = null;
          throw err;
        });
      }
      return this.ready;
    }

    async _init() {
      if (!(window.YT && window.YT.Player)) {
        await new Promise((resolve, reject) => {
          window.onYouTubeIframeAPIReady = resolve;
          loadScript('https://www.youtube.com/iframe_api').catch(reject);
        });
      }
      await new Promise((resolve) => {
        this.player = new window.YT.Player(this.mountId, {
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            modestbranding: 1,
            enablejsapi: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              this.player.setVolume(this.volume);
              resolve();
            },
            onStateChange: (e) => this._onState(e.data),
            onError: (e) => this.h.onError && this.h.onError(e.data),
          },
        });
      });
    }

    _onState(code) {
      // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
      if (code === 1) {
        if (this.player.setVolume) this.player.setVolume(this.volume);
        this._startPoll();
        this.h.onState('playing');
      } else if (code === 2) {
        this._stopPoll();
        this.h.onState('paused');
      } else if (code === 0) {
        this._stopPoll();
        this.h.onState('ended');
      } else if (code === 3) {
        this.h.onState('buffering');
      }
    }

    _startPoll() {
      this._stopPoll();
      this._tick();
      this.timer = setInterval(() => this._tick(), 250);
    }

    _stopPoll() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    _tick() {
      const p = this.player;
      if (!p || !p.getCurrentTime) return;
      this.h.onTime(p.getCurrentTime() || 0, p.getDuration() || 0);
    }

    async load(track, startAt = 0) {
      await this.init();
      this.player.loadVideoById({ videoId: track.id, startSeconds: Math.max(0, Math.floor(startAt)) });
      this.player.setVolume(this.volume); // keep the chosen volume for every new track
    }

    play() {
      this.player && this.player.playVideo && this.player.playVideo();
    }

    pause() {
      this.player && this.player.pauseVideo && this.player.pauseVideo();
    }

    seek(sec) {
      this.player && this.player.seekTo && this.player.seekTo(sec, true);
    }

    setVolume(v) {
      this.volume = v;
      this.player && this.player.setVolume && this.player.setVolume(v);
    }
  }

  // ---------- SoundCloud (official Widget API) ----------
  class SoundCloudEngine {
    constructor(frameId, handlers) {
      this.frame = document.getElementById(frameId);
      this.h = handlers;
      this.widget = null;
      this.volume = 80;
      this.duration = 0;
      this.pendingSeek = 0;
      this.wanted = false; // whether this engine is the one that should be playing right now
    }

    _opts() {
      return {
        auto_play: true,
        visual: false,
        show_comments: false,
        show_user: false,
        show_reposts: false,
        show_teaser: false,
        hide_related: true,
        buying: false,
        sharing: false,
        download: false,
      };
    }

    _src(url) {
      const params = new URLSearchParams({ url, ...Object.fromEntries(Object.entries(this._opts()).map(([k, v]) => [k, String(v)])) });
      return 'https://w.soundcloud.com/player/?' + params.toString();
    }

    _bind() {
      const E = window.SC.Widget.Events;
      const w = this.widget;
      w.bind(E.READY, () => {
        w.setVolume(this.volume);
        if (this.wanted) w.play();
      });
      w.bind(E.PLAY, () => {
        w.setVolume(this.volume); // the widget resets its volume whenever a new track loads
        if (this.pendingSeek > 0) {
          w.seekTo(this.pendingSeek * 1000);
          this.pendingSeek = 0;
        }
        w.getDuration((ms) => {
          this.duration = (ms || 0) / 1000;
        });
        this.h.onState('playing');
      });
      w.bind(E.PAUSE, () => this.h.onState('paused'));
      w.bind(E.FINISH, () => this.h.onState('ended'));
      w.bind(E.PLAY_PROGRESS, (e) => this.h.onTime((e.currentPosition || 0) / 1000, this.duration));
      w.bind(E.ERROR, () => this.h.onError && this.h.onError('soundcloud'));
    }

    async load(track, startAt = 0) {
      this.pendingSeek = startAt;
      if (!(window.SC && window.SC.Widget)) await loadScript('https://w.soundcloud.com/player/api.js');
      this.wanted = true;
      this.duration = track.durationSec || 0;
      if (!this.widget) {
        this.frame.src = this._src(track.url);
        this.widget = window.SC.Widget(this.frame);
        this._bind();
      } else {
        this.widget.load(track.url, { ...this._opts(), callback: () => this.widget.setVolume(this.volume) });
      }
    }

    play() {
      this.wanted = true;
      this.widget && this.widget.play();
    }

    pause() {
      this.wanted = false;
      this.widget && this.widget.pause();
    }

    seek(sec) {
      this.widget && this.widget.seekTo(sec * 1000);
    }

    setVolume(v) {
      this.volume = v;
      this.widget && this.widget.setVolume(v);
    }
  }

  window.Engines = { YouTubeEngine, SoundCloudEngine };
})();
