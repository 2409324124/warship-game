"""Reproduce the CC BY 3.0 Navy excerpt. Requires numpy, Pillow, imageio-ffmpeg.

python tools/prepare-naval-audio.py --inspect
python tools/prepare-naval-audio.py --extract
Source video is cached ONLY in the preapproved temporary directory.
"""
import argparse
import hashlib
import io
from pathlib import Path
import subprocess
import urllib.request
import wave

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

URL = 'https://upload.wikimedia.org/wikipedia/commons/6/6d/Torpedo_and_5%22_Gun_Exercise_aboard_USS_Curtis_Wilbur_%28DDG_54%29.webm'
TEMP = Path('C:/Users/Administrator/AppData/Local/Temp/opencode')
ROOT = Path(__file__).resolve().parents[1]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def run(*args):
    return subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', *args], check=True, capture_output=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--extract', action='store_true')
    args = parser.parse_args()
    assert TEMP.is_dir() and (ROOT / 'public').is_dir()
    source = TEMP / 'curtis-wilbur-190312-N-HI376-1001.webm'
    if not source.exists():
        request = urllib.request.Request(URL, headers={'User-Agent': 'WarshipAudioResearch/1.0 (CC-BY attribution preservation)'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(12_000_001)
        if len(data) > 12_000_000:
            raise ValueError('Unexpected source size; refusing oversized download')
        source.write_bytes(data)
    print('source', source.stat().st_size, 'SHA256', hashlib.sha256(source.read_bytes()).hexdigest())
    pcm = run('-i', str(source), '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1')
    samples = np.frombuffer(pcm, dtype='<f4')
    if args.inspect:
        # 50ms windows: enumerate transients, rather than guessing a gun timestamp.
        blocks = samples[:len(samples)//2400*2400].reshape(-1, 2400)
        rms = np.sqrt(np.mean(blocks**2, axis=1))
        candidates = sorted(np.argsort(rms)[-30:])
        print('50ms loud windows (seconds, RMS):', [(round(int(i)*.05, 2), round(float(rms[i]), 4)) for i in candidates])
        sheet = Image.new('RGB', (5*320, 6*200), '#202020')
        draw = ImageDraw.Draw(sheet)
        for t in range(30):
            png = run('-ss', str(t), '-i', str(source), '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1')
            sheet.paste(Image.open(io.BytesIO(png)), ((t%5)*320, (t//5)*200))
            draw.text(((t%5)*320+4, (t//5)*200+182), f'{t}s', fill='white')
        sheet.save(TEMP / 'naval-audio-contact-sheet.jpg')
        # Overview waveform, useful for detecting cuts/AGC/adjacent shots.
        plot = Image.new('RGB', (1500, 320), 'white')
        draw = ImageDraw.Draw(plot)
        for x in range(1500):
            chunk = samples[int(x/1500*len(samples)):int((x+1)/1500*len(samples))]
            peak = float(np.max(np.abs(chunk)))
            draw.line((x, 150-peak*140, x, 150+peak*140), fill='navy')
        for t in range(30):
            draw.text((t*50, 300), str(t), fill='black')
        plot.save(TEMP / 'naval-audio-waveform.png')
        detail = Image.new('RGB', (5*320, 5*200), '#202020')
        draw = ImageDraw.Draw(detail)
        for j in range(25):
            t = 24.3 + j*.1
            png = run('-ss', str(t), '-i', str(source), '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1')
            detail.paste(Image.open(io.BytesIO(png)), ((j%5)*320, (j//5)*200))
            draw.text(((j%5)*320+4, (j//5)*200+182), f'{t:.2f}s', fill='white')
        detail.save(TEMP / 'naval-audio-gun-detail.jpg')
    if args.extract:
        if hashlib.sha256(source.read_bytes()).hexdigest() != 'c7e6f136794635dc170afd53187c2ce8a905bdfd344180f89bb01d992bd2e753':
            raise ValueError('Source changed; inspect before extracting')
        # Visible Mk45 muzzle smoke at 25.5s, acoustic onset ~25.58s.
        # Exclude the next transient at ~28.35s and all torpedo footage.
        pcm = run('-i', str(source), '-ss', '25.575', '-t', '2.575', '-vn',
                  '-ac', '1', '-ar', '48000', '-af', 'highpass=f=110,lowpass=f=9500',
                  '-f', 'f32le', 'pipe:1')
        excerpt = np.frombuffer(pcm, dtype='<f4').copy()
        t = np.arange(len(excerpt))/48000
        # Retain recorded tail, but reduce persistent deck/wind noise after blast.
        envelope = np.exp(-np.maximum(0, t-.25)*.65)
        envelope *= np.minimum(1, t/.003) * np.clip((2.575-t)/.25, 0, 1)
        excerpt *= envelope
        excerpt *= .85 / np.max(np.abs(excerpt))
        target = ROOT / 'public' / 'audio'
        target.mkdir(exist_ok=True)
        path = target / 'navy-mk45-report.wav'
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(48000)
            wav.writeframes((excerpt*32767).round().astype('<i2').tobytes())
        print('asset', path, path.stat().st_size, 'SHA256', hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()
