FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
# Mount a volume at /app/data to keep the imported timetable between deploys.
CMD ["node", "src/server/main.ts"]
