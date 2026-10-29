import json, subprocess
m = json.load(open('marks.json'))
start = next(x['t'] for x in m if x['type']=='start'); end = next(x['t'] for x in m if x['type']=='end')
fs = [x['t'] for x in m if x['type']=='fast_start']; fe = [x['t'] for x in m if x['type']=='fast_end']
segs, cur = [], start
for a, b in zip(fs, fe):
    a += 0.6  # keep the send click visible
    segs.append((cur, a, 1.0)); segs.append((a, b, max(1.0, (b-a)/2.5))); cur = b
segs.append((cur, end, 1.0))
parts, labels = [], []
for i, (a, b, f) in enumerate(segs):
    parts.append(f"[0:v]trim={a:.3f}:{b:.3f},setpts=(PTS-STARTPTS)/{f:.4f},fps=30,format=yuv420p[v{i}]"); labels.append(f"[v{i}]")
total = sum((b-a)/f for a,b,f in segs)
fc = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(segs)}:v=1:a=0,scale=1920:1200:flags=lanczos[out]"
print(f"final length {total:.1f}s")
subprocess.run(["ffmpeg","-y","-loglevel","error","-i","raw.webm","-filter_complex",fc,"-map","[out]","-c:v","libx264","-preset","slow","-crf","18","-movflags","+faststart","-r","30","demo.mp4"], check=True)
