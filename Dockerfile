FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg yt-dlp
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
ENV HOST=0.0.0.0 PORT=8095 KODIYT_REMOTE_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8095
CMD ["node", "server/index.mjs"]
