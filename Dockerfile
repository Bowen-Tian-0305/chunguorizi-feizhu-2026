FROM node:22-bookworm-slim
RUN npm install --global --no-audit --no-fund @fly-ai/flyai-cli@1.0.16
WORKDIR /app
COPY --chown=node:node server.mjs model-quota.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node data/evidence.json ./data/evidence.json
COPY --chown=node:node data/ranking.json ./data/ranking.json
COPY --chown=node:node data/hotel_policy.json ./data/hotel_policy.json
COPY --chown=node:node data/hotel_breakfast_official.json ./data/hotel_breakfast_official.json
COPY --chown=node:node data/breakfast_spots.json ./data/breakfast_spots.json
COPY --chown=node:node data/demo_hotel.json ./data/demo_hotel.json
COPY --chown=node:node data/cities.json ./data/cities.json
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 ./docker-entrypoint.sh && mkdir -p /app/state && chown node:node /app/state
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 FLYAI_BIN=/usr/local/bin/flyai
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./docker-entrypoint.sh"]
