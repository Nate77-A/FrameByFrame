# Build status

Measured on 6 Nov 2026 on a Mac, using the production build where noted.

## Results

| Check | Target | Result |
| --- | --- | --- |
| Unit tests | Pass | 15 of 15 |
| Browser tests, Chromium | Pass | 25 of 25 |
| Browser tests, WebKit | Pass | 24 of 24 (the fake-microphone test is Chromium only) |
| Lighthouse Performance | ≥ 90 | 97 |
| Lighthouse Accessibility | ≥ 90 | 100 |
| Lighthouse Best Practices | ≥ 90 | 100 |
| Total download | < 3 MB gzipped | About 0.4 MB, including lazy-loaded export code |
| Offline | Works | Reloads with the network off, fonts included |
| 1080p, 50 objects, 60 FPS project | 60 FPS | Display kept 58 FPS and showed about 49 unique frames per second (headless Chromium, dev build, no GPU) |

An exported 12-frame test MP4 was decoded back and contained H.264 video, exactly 12 frames and an AAC audio track.

GitHub Pages was simulated by serving the production build only at `/FrAnimator/`. In Chromium and WebKit there were no failed requests or errors, drawing and all three exports worked, and the app reloaded offline. The real GitHub workflow has not run yet.

## Not yet verified

These need a real device or a person:

- **Real iPad and Apple Pencil.** Pen pressure, palm rejection and pinch were tested with simulated pointer events in desktop browser engines, and iPad layouts at iPad screen sizes. Nothing has run on an actual iPad, and tilt has no automated test.
- **Browser tests on Linux.** The workflow's browser test job has never run. It may report differences such as WebM instead of MP4, and it does not block publishing.
- **Firefox.** Playwright's Firefox build would not start on this Mac ("Could not find profile folder"), so Firefox is untested. Run it with `E2E_FIREFOX=1 npm run test:e2e`.
- **60 FPS target.** Unique frames per second fell a little short in the measurement above. That was a software-rendered dev build, so measure again on a real device.
- **Saving with the system file dialog.** The project format and the save and reopen round trip are tested, but not the browser's own Save dialog.
- **Exports in other players.** Files were checked by decoding them, not by opening them in VLC, QuickTime or similar.
- **How the sound effects actually sound.** They are generated correctly, but nobody has listened to them.

## Known limits

- MP4 sound on Safari older than version 26 is left out, with a notice, because those versions cannot encode audio.
- Guides can only be cleared all at once, by double-clicking a ruler.
- There is no drag-a-box selection. Use Shift+click or Select All.
- The Shape tool has no rotation setting before drawing; rotate the shape after placing it.
- `npm run lint` is a strict TypeScript check, not ESLint.
