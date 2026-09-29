# Tracks

Drop WAV/AIFF masters and square artwork here, then list them in `tracks.json`:

    {
      "tracks": [{
        "id": "sunset-drive",
        "title": "Sunset Drive",
        "artist": "Zach Farrell",
        "file": "sunset-drive.wav",
        "artwork": "sunset-drive.jpg",
        "bpm": 124.0,
        "key": "8A",
        "firstBeatSec": 0.052,
        "memoryCues": [32, 96],
        "surf": true
      }]
    }

- `bpm` must be exact and constant; `firstBeatSec` is the time of the first downbeat.
- `key` uses Camelot notation (1A–12B). `memoryCues` are beat numbers counted from the first downbeat.
- `surf: true` adds the track to the surf game soundtrack.
- Run `npm run tracks` (also runs automatically before `npm run dev` / `npm run build`).
- Audio masters are git-ignored; only this JSON and artwork are committed.
- While this list is empty, synthesized placeholder tracks are used.
