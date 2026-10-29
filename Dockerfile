FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PROMETHEUS_DB=/data/prometheus.db
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY data ./data
COPY frontend ./frontend
# Some hosts run the container as a non-root user, so /data must be writable by anyone.
RUN mkdir -p /data && chmod 777 /data
VOLUME ["/data"]
EXPOSE 8000
# NEBIUS_API_KEY must be supplied at runtime as a secret env var, never baked into the image.
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
