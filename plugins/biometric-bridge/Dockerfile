FROM node:22-alpine
WORKDIR /bridge
COPY bridge.mjs main.mjs simulate.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV QUEUE_FILE=/data/queue.json PORT=8081
EXPOSE 8081
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8081/health >/dev/null || exit 1
CMD ["node", "main.mjs"]
