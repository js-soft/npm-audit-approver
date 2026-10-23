FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build

WORKDIR /app

COPY package.json tsconfig.json ./
COPY package-lock.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:26.12.1-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
