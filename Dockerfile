FROM node:26-alpine AS build

WORKDIR /app

COPY package.json tsconfig.json ./
COPY package-lock.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:26-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
