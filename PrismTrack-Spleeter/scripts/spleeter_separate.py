import argparse
import json
import os
import sys
import wave

import numpy as np
from spleeter.audio.adapter import AudioAdapter
from spleeter.separator import Separator


def save_wav(path: str, data: np.ndarray, sample_rate: int) -> None:
    audio = np.asarray(data, dtype=np.float32)
    if audio.ndim == 1:
        audio = np.expand_dims(audio, axis=1)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16)

    with wave.open(path, "wb") as wav_file:
        wav_file.setnchannels(int(pcm.shape[1]))
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


def main() -> int:
    parser = argparse.ArgumentParser(description="PrismTrack Spleeter wrapper")
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", dest="input_path", required=True)
    parser.add_argument("--output", dest="output_dir", required=True)
    args = parser.parse_args()

    audio_loader = AudioAdapter.default()
    waveform, sample_rate = audio_loader.load(args.input_path, sample_rate=44100)
    separator = Separator(args.model)
    prediction = separator.separate(waveform)

    base_name = os.path.splitext(os.path.basename(args.input_path))[0]
    target_dir = os.path.join(args.output_dir, base_name)
    os.makedirs(target_dir, exist_ok=True)

    written = {}
    for stem_name, stem_data in prediction.items():
        stem_path = os.path.join(target_dir, f"{stem_name}.wav")
        save_wav(stem_path, stem_data, sample_rate)
        written[stem_name] = stem_path

    print(
        json.dumps(
            {
                "ok": True,
                "model": args.model,
                "input": args.input_path,
                "output": args.output_dir,
                "written": written,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
