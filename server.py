"""Yerel Stem sunucusu: Demucs ile şarkıyı dört kanala ayırır."""
import email.parser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import io, json, os, re, shutil, subprocess, sys, threading, uuid, zipfile
import imageio_ffmpeg
import torch

ROOT = Path(__file__).parent.resolve()
UPLOADS, RESULTS = ROOT / "uploads", ROOT / "results"
JOBS = {}
for folder in (UPLOADS, RESULTS): folder.mkdir(exist_ok=True)
# imageio-ffmpeg ile gelen ikili dosyayı Demucs'un bulabilmesi için PATH'e ekle.
os.environ["PATH"] = str(Path(imageio_ffmpeg.get_ffmpeg_exe()).parent) + os.pathsep + os.environ["PATH"]

def separate(job_id, source, device_choice="auto"):
    if device_choice == "cuda":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    elif device_choice == "cpu":
        device = "cpu"
    else:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    job = JOBS[job_id]
    job.update(status="running", progress=0, message=f"Model hazırlanıyor ({'GPU' if device == 'cuda' else 'CPU'})…")
    try:
        target = RESULTS / job_id
        process = subprocess.Popen(
            [sys.executable, "-m", "demucs", "--device", device, "-n", "htdemucs", "--out", str(target), str(source)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        output, separating = "", False
        while True:
            char = process.stdout.read(1)
            if not char: break
            output = (output + char)[-800:]
            if not separating and "Separating track" in output:
                separating = True
                job.update(progress=0, message="4 kanal ayrılıyor…")
            if separating:
                matches = re.findall(r"(\d{1,3})%\|", output)
                if matches:
                    percent = min(99, int(matches[-1]))
                    if percent != job.get("progress"):
                        job.update(progress=percent, message="4 kanal ayrılıyor…")
        if process.wait() != 0:
            raise RuntimeError(output[-500:] or "Demucs işlemi hata verdi.")
        stems = target / "htdemucs" / source.stem
        files = {"vocal": "vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
        if not all((stems / filename).exists() for filename in files.values()):
            raise RuntimeError("Dört kanal oluşturulamadı.")
        job.update(status="complete", progress=100, stems={name: f"/api/stem-stream/{job_id}/{name}" for name in files.keys()})
    except Exception as error:
        detail = error.stderr[-500:] if isinstance(error, subprocess.CalledProcessError) and error.stderr else str(error)
        job.update(status="failed", error=detail)
        if source.exists():
            try: source.unlink(missing_ok=True)
            except Exception: pass

def parse_multipart(rfile, headers):
    content_type = headers.get("Content-Type", "")
    length = int(headers.get("Content-Length", 0))
    msg_bytes = b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + rfile.read(length)
    msg = email.parser.BytesParser().parsebytes(msg_bytes)
    fields, files = {}, {}
    for part in msg.walk():
        name = part.get_param("name", header="content-disposition")
        if not name: continue
        filename = part.get_filename()
        if filename:
            files[name] = (filename, part.get_payload(decode=True))
        else:
            payload = part.get_payload(decode=True)
            fields[name] = payload.decode(errors="ignore") if payload else ""
    return fields, files

class Handler(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ctype = super().guess_type(path)
        # Force UTF-8 charset for text-based files
        if isinstance(ctype, str):
            if ctype.startswith('text/html'):
                return 'text/html; charset=utf-8'
            if ctype.startswith('text/css'):
                return 'text/css; charset=utf-8'
            if ctype.startswith('application/javascript') or ctype.startswith('text/javascript'):
                return 'application/javascript; charset=utf-8'
        return ctype

    def json(self, payload, code=HTTPStatus.OK):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    
    def convert_wav_bytes_to_mp3(self, wav_bytes):
        temp_id = uuid.uuid4().hex
        wav_file = UPLOADS / f"{temp_id}.wav"
        mp3_file = UPLOADS / f"{temp_id}.mp3"
        try:
            wav_file.write_bytes(wav_bytes)
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
            cmd = [ffmpeg_exe, "-y", "-f", "wav", "-i", str(wav_file), "-b:a", "320k", str(mp3_file)]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if res.returncode != 0 or not mp3_file.exists() or mp3_file.stat().st_size == 0:
                print(f"FFmpeg note: {res.stderr.decode(errors='ignore')[:200]}")
                return wav_bytes
            return mp3_file.read_bytes()
        except Exception as e:
            print(f"convert_wav_bytes_to_mp3 exception: {e}")
            return wav_bytes
        finally:
            if wav_file.exists(): wav_file.unlink(missing_ok=True)
            if mp3_file.exists(): mp3_file.unlink(missing_ok=True)

    def do_POST(self):
        if self.path == "/api/convert-mp3":
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0:
                self.json({"error": "Geçersiz ses verisi."}, 400); return
            bytes_read = 0
            chunks = []
            while bytes_read < length:
                chunk = self.rfile.read(min(65536, length - bytes_read))
                if not chunk: break
                chunks.append(chunk)
                bytes_read += len(chunk)
            wav_bytes = b"".join(chunks)
            mp3_bytes = self.convert_wav_bytes_to_mp3(wav_bytes)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Disposition", 'attachment; filename="MixerUp-Mix.mp3"')
            self.send_header("Content-Length", str(len(mp3_bytes)))
            self.end_headers()
            self.wfile.write(mp3_bytes)
            return



        if self.path != "/api/separate":
            self.send_error(HTTPStatus.NOT_FOUND); return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.json({"error": "Ses dosyası bekleniyor."}, 400); return

        try:
            fields, files = parse_multipart(self.rfile, self.headers)
            song_file = files.get("song")
            if not song_file or not song_file[0]:
                self.json({"error": "Lütfen bir ses dosyası seç."}, 400); return
            
            filename, file_bytes = song_file
            ext = Path(filename).suffix.lower()
            if ext not in {".mp3", ".wav", ".m4a", ".flac", ".ogg"}:
                self.json({"error": "Desteklenmeyen ses biçimi."}, 400); return

            job_id = uuid.uuid4().hex
            source = UPLOADS / f"{job_id}{ext}"
            source.write_bytes(file_bytes)

            device_choice = fields.get("device", "auto")
            JOBS[job_id] = {"status": "queued", "progress": 0, "message": "Ayırma için hazırlanıyor…"}
            threading.Thread(target=separate, args=(job_id, source, device_choice), daemon=True).start()
            self.json({"jobId": job_id}, HTTPStatus.ACCEPTED)
        except Exception as e:
            self.json({"error": f"Yükleme hatası: {str(e)}"}, 500)

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)
        fmt = query.get("format", ["wav"])[0]

        if path.startswith("/api/download-zip/"):
            job_id = path.rsplit("/", 1)[-1]
            target = RESULTS / job_id
            stems_dirs = list(target.glob("htdemucs/*"))
            if stems_dirs and stems_dirs[0].is_dir():
                folder = stems_dirs[0]
                buf = io.BytesIO()
                ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                    for wav in folder.glob("*.wav"):
                        if fmt == "mp3":
                            tmp_mp3 = UPLOADS / f"{uuid.uuid4().hex}.mp3"
                            try:
                                subprocess.run([ffmpeg_exe, "-y", "-i", str(wav), "-b:a", "320k", str(tmp_mp3)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                                z.write(tmp_mp3, arcname=f"{wav.stem}.mp3")
                            finally:
                                if tmp_mp3.exists(): tmp_mp3.unlink(missing_ok=True)
                        else:
                            z.write(wav, arcname=wav.name)
                data = buf.getvalue()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="MixerUp-{job_id[:8]}.zip"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            self.json({"error": "Dosyalar bulunamadı."}, 404); return

        if path.startswith("/api/jobs/"):
            job = JOBS.get(path.rsplit("/", 1)[-1])
            self.json(job or {"error": "İş bulunamadı."}, 200 if job else 404); return

        if path.startswith("/api/stem-stream/"):
            parts = path.strip("/").split("/")
            if len(parts) >= 4:
                job_id, name = parts[2], parts[3]
                target = RESULTS / job_id
                stems_dirs = list(target.glob("htdemucs/*"))
                if stems_dirs and stems_dirs[0].is_dir():
                    filename = "vocals.wav" if name == "vocal" else f"{name}.wav"
                    wav_file = stems_dirs[0] / filename
                    if wav_file.exists():
                        self.send_response(HTTPStatus.OK)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Length", str(wav_file.stat().st_size))
                        self.end_headers()
                        with open(wav_file, "rb") as f:
                            shutil.copyfileobj(f, self.wfile)
                        return
            self.json({"error": "Kanal bulunamadı."}, 404); return

        return super().do_GET()

    def log_message(self, *_): pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Sunucu başlatıldı: http://0.0.0.0:{port}")
    server.serve_forever()
