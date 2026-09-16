# iPhone audio repair — 2026-09-16

## Defects addressed

The published player used an AudioContext without an explicit playback audio session;
it resumed only `suspended` contexts, not WebKit's `interrupted` state. The mute
control changed a gain value but could neither unlock audio nor leave silent-preview
mode. The initial UI said "Sound on" before a recording was loaded. The only shipped
codec was Ogg, and the local score had a 2.5-second network timeout. These are verified
code findings, not a remotely observed diagnosis of the user's speaker hardware.

The player now requests `navigator.audioSession.type = 'playback'` when available
before constructing/resuming AudioContext in the tap stack. Resume is bounded, both
non-running states are handled, and a zero-valued one-sample buffer primes the
context in the same gesture. This does not play music before consent. Failed,
interrupted, or undecodable audio produces an actionable overlay, not false success.
The Sound control can load, unmute and recover the soundtrack at the current scene.
The silent preview uses a monotonic wall clock and needs no audio permission.

GitHub Pages builds now encode a stereo 44.1 kHz MP3 from the verified credited Ogg,
check codec/duration/size, and publish and hash-check both formats. MP3 is tried first.
No uncredited substitute recording or synthesized imitation is used. A native media
player in Credits provides a separate sound check and pauses the film on playback.
Application/audio module URL revisions prevent reuse of the previous cached modules
when a freshly loaded index is served. The single-file edition is regenerated too.

## Validation

23 Node tests (19 audio-policy tests and 4 existing director tests), plus 13 Python
tests (10 deployment tests and 3 encoder tests) pass locally. Encoder testing uses
a generated temporary fixture only. Local browser navigation is administratively
blocked and the local GPU context is unavailable; it is not reported as a pass.

The Pages workflow additionally checks the *actual staged credited MP3* using pinned
Playwright 1.57.0 Chromium and WebKit, including nonzero Web Audio samples, mute,
pause/clock stability, resume after suspension, native media playback, and the real
app's recovery controls with only its renderer stubbed. See the current Actions run
summary for executed results; the presence of a test is not itself a pass.

No physical iPhone, Silent Mode switch, Bluetooth route, or in-app WKWebView was
tested remotely. Browser sample measurements cannot prove physical speaker output.

## Physical iPhone acceptance checklist

Open the fresh Pages URL in Safari. Tap Watch the film and check media volume.
Check Silent Mode on and off on an AudioSession-capable iOS version; test the Sound
button, pause/resume, a phone interruption, returning after backgrounding, and
headphones/Bluetooth/AirPlay. On older versions without AudioSession, Web Audio may
require Silent Mode off; the native player in Credits remains a separate diagnosis.
Verify that enabling sound during silent preview preserves the current scene and
that no sound begins before a user gesture.

## Primary references

- W3C Audio Session (Working Draft): https://www.w3.org/TR/audio-session/ — AudioContext
  defaults to ambient; HTMLMediaElement defaults to playback; interruption semantics.
- WebKit bug 237322: https://bugs.webkit.org/show_bug.cgi?id=237322 — Web Audio and
  the iOS ringer mute path.
- WebKit iOS media policies: https://webkit.org/blog/6784/new-video-policies-for-ios/
- WebKit Safari 18.4: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ —
  Ogg Vorbis/Opus support arrived on iOS 18.4; this is not an assumption that the
  user's current iOS lacks Ogg.
