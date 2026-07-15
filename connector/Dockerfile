FROM node:lts-alpine

RUN apk add --no-cache yt-dlp

WORKDIR /app

COPY connector/package.json ./package.json
COPY connector/server.mjs ./server.mjs

EXPOSE 8091

CMD ["node", "./server.mjs"]
