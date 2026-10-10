FROM python:3.12-slim
WORKDIR /app
COPY gatekeeper /app/gatekeeper
COPY server.py /app/server.py
RUN chmod 755 /app/gatekeeper /app/server.py \
    && useradd -r -u 10001 ctf \
    && chown -R ctf:ctf /app
USER ctf
EXPOSE 31337
ENV PORT=31337
CMD ["python3","/app/server.py"]
