FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY src ./src

ENV NODE_ENV=production
ENV PORT=4180

EXPOSE 4180

USER node

CMD ["node", "src/server.js"]
