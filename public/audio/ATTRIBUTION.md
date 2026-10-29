# Naval gun audio attribution

## navy-mk45-report.wav — CC BY 3.0

- Work: **Torpedo and 5" Gun Exercise aboard USS Curtis Wilbur (DDG 54)**.
- Author/credit: **U.S. Navy / Mass Communication Specialist 1st Class Alexandra Seeley**.
- VIRIN: **190312-N-HI376-1001**. Filmed March 12, 2019, Philippine Sea.
- Source and license evidence: <https://commons.wikimedia.org/wiki/File:Torpedo_and_5%22_Gun_Exercise_aboard_USS_Curtis_Wilbur_%28DDG_54%29.webm>
- Original Navy publication: <https://www.youtube.com/watch?v=4M1g0rxlq20>
- Source media: <https://upload.wikimedia.org/wikipedia/commons/6/6d/Torpedo_and_5%22_Gun_Exercise_aboard_USS_Curtis_Wilbur_%28DDG_54%29.webm>
- License: **Creative Commons Attribution 3.0 Unported**, <https://creativecommons.org/licenses/by/3.0/>.
  Commons records review of the YouTube CC license on June 6, 2020. This file is
  distributed under that explicit license, not relabeled as public domain.
- No endorsement by the U.S. Navy or the photographer is implied.

### Modifications by this game

Extracted **25.575–28.150 seconds** (2.575s), mono 48 kHz 16-bit PCM WAV.
The video shows Mk45 firing/muzzle smoke at approximately 25.5s and the strong
acoustic onset is approximately 25.58s. This excludes the torpedo sequence
(approximately 0–20s) and the next strong transient at approximately 28.35s.
Scene/frame and waveform inspection establish gun-event correspondence; they
are not a claim of subjective listening or perfect absence of background sound.
The source contains deck/wind noise and microphone limiting/AGC artifacts.

Processing: ffmpeg highpass 110 Hz and lowpass 9500 Hz; 3ms fade-in; 250ms
fade-out; after 250ms an exp(-0.65*(t-0.25)) gain taper reduces persistent wind/deck
noise; fixed peak scaling to 0.85. No time stretching, pitch shift, AI generation,
added music, other game samples or additional third-party audio. Natural recorded decay is
retained within this window; source microphone damage cannot be reconstructed.

Runtime: DD/secondary versions shorten and fade the excerpt and use lower gain.
BB version retains the longer recorded decay and adds a low-level original
67/103/163 Hz damped pressure layer and quiet late stereo reflections. This is
**game-designed composite audio based on a 5-inch Mk45 recording, NOT an actual
16-inch/356mm/406mm recording**. Playback stays at native pitch/rate.

Reproduce with `python tools/prepare-naval-audio.py --extract` (numpy, Pillow,
imageio-ffmpeg required). `--inspect` produces frame contact sheets and waveform
in the preapproved temporary directory; source video is not shipped with game.

- Source size: 9,781,879 bytes.
- Source SHA256: `c7e6f136794635dc170afd53187c2ce8a905bdfd344180f89bb01d992bd2e753`.
- Excerpt size: 247,244 bytes.
- Excerpt SHA256: `7195bf6cd68dfdf7fbb4f87f91d065b7dd31f6c9c1f4447f88140935fa7266fb`.

Keep this attribution with redistributed audio and retain the license link and
modification notice in the game's third-party credits.
