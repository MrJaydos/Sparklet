# Piper neural TTS sidecar. POST / {"text": "..."} -> WAV.
# Voice is baked into the image so startup needs no network.
FROM python:3.12-slim

RUN pip install --no-cache-dir piper-tts flask

# Explicit ORT thread count — avoids pthread affinity failures on hosts
# with restricted cpusets and keeps CPU use modest. See sitecustomize.py.
COPY sitecustomize.py /usr/local/lib/python3.12/site-packages/sitecustomize.py

WORKDIR /voices
RUN python -m piper.download_voices en_GB-cori-high --download-dir /voices

EXPOSE 5000
CMD ["python", "-m", "piper.http_server", "-m", "en_GB-cori-high", "--data-dir", "/voices"]
