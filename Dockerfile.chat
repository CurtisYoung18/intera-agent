# Dockerfile.chat — Intera Chat App (customer-facing agent conversation)
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/chat/package.json ./apps/chat/
COPY apps/console/package.json ./apps/console/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci

FROM deps AS builder
COPY . .

# Build-time env vars (can be overridden by Railway)
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CHAT_API_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CHAT_API_URL=$NEXT_PUBLIC_CHAT_API_URL

# Generate Prisma client
RUN npx prisma generate --schema=./packages/shared/prisma/schema.prisma

# Build the chat app
RUN npm run build -w apps/chat

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Install prisma CLI for db push at startup
RUN npm install -g prisma@6.6.0

# Copy standalone output
COPY --from=builder /app/apps/chat/public ./apps/chat/public
COPY --from=builder /app/apps/chat/.next/standalone ./
COPY --from=builder /app/apps/chat/.next/static ./apps/chat/.next/static

# Copy Prisma artifacts for runtime
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/packages/shared/prisma ./packages/shared/prisma

# Copy entrypoint
COPY apps/chat/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["./entrypoint.sh"]
