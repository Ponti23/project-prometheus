"""Cuts the recorded clips to the voiceover: waits on the model play fast (labelled), then audio is laid over."""
import json, subprocess, sys
from pathlib import Path

S = Path(__file__).parent
CLIPS, VO, OUT = S / "clips", S / "vo", S / "out"
OUT.mkdir(exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
WAIT_SPEED = 4.0
SCENES = ["1-meet", "2-prepare", "3-auto", "4-survive", "5-sos", "6-rebuild", "7-proof"]


def dur(f):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))


def run(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, a)], check=True)


def scene(name):
    meta = json.loads((CLIPS / f"{name}.json").read_text())
    clip, vo = CLIPS / f"{name}.mp4", VO / f"{name}.wav"
    L, V = dur(clip), dur(vo)
    waits = [(a, min(b, L)) for a, b in meta["waits"] if a < L]
    wait_len = sum(b - a for a, b in waits)
    target = V + 2.0
    # The rest of the clip plays at normal speed unless the scene would overrun its narration; never faster than 1.35x.
    rest = L - wait_len
    rest_speed = min(1.35, max(1.0, rest / max(1.0, target - wait_len / WAIT_SPEED)))
    cuts, t = [], 0.0
    for a, b in waits:
        if a > t: cuts.append((t, a, rest_speed, False))
        cuts.append((a, b, WAIT_SPEED, True))
        t = b
    if t < L: cuts.append((t, L, rest_speed, False))
    parts = []
    label = (f"drawtext=fontfile={FONT}:text='Waiting for the model  ·  sped up {WAIT_SPEED:g}x':fontsize=30:fontcolor=white:"
             "box=1:boxcolor=black@0.6:boxborderw=14:x=40:y=h-th-120")
    for i, (a, b, sp, lab) in enumerate(cuts):
        f = f"trim={a}:{b},setpts=(PTS-STARTPTS)/{sp}" + ("," + label if lab else "")
        parts.append(f"[0:v]{f}[v{i}]")
    graph = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(cuts))) + f"concat=n={len(cuts)}:v=1:a=0[cat]"
    video_len = sum((b - a) / sp for a, b, sp, _ in cuts)
    final = max(video_len, V + 1.2)
    graph += f";[cat]tpad=stop_mode=clone:stop_duration={final - video_len + 0.1:.2f},fps=30,format=yuv420p[v]"
    graph += f";[1:a]adelay=400|400,apad,atrim=0:{final:.2f},aformat=sample_rates=48000:channel_layouts=stereo[a]"
    out = OUT / f"{name}.mp4"
    run("-i", clip, "-i", vo, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", f"{final:.2f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", out)
    print(f"{name}: clip {L:.1f}s ({wait_len:.1f}s waiting) · voice {V:.1f}s · rest x{rest_speed:.2f} → {final:.1f}s")
    return out


outs = [scene(n) for n in (sys.argv[1:] or SCENES)]
if not sys.argv[1:]:
    lst = OUT / "list.txt"
    lst.write_text("".join(f"file '{o}'\n" for o in outs))
    run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", OUT / "prometheus-demo.mp4")
    print("total", round(dur(OUT / "prometheus-demo.mp4"), 1), "s")
