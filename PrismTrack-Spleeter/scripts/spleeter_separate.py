import argparse
import json
import os
import sys

from spleeter.separator import Separator


def main() -> int:
    parser = argparse.ArgumentParser(description="PrismTrack Spleeter wrapper")
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", dest="input_path", required=True)
    parser.add_argument("--output", dest="output_dir", required=True)
    args = parser.parse_args()

    separator = Separator(args.model)
    separator.separate_to_file(args.input_path, args.output_dir, synchronous=True)

    print(
        json.dumps(
            {
                "ok": True,
                "model": args.model,
                "input": args.input_path,
                "output": args.output_dir,
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
