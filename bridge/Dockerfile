# Stage 1: shared base with pnpm
FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Stage 2: compile TypeScript to dist/ (pnpm build also copies src/proto, which
# grpc.ts loads at runtime relative to its own directory, into dist/proto).
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Stage 3: production dependencies only (no tsx / tsc / linters).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 4: minimal runtime image running compiled JS with plain node.
FROM gcr.io/distroless/nodejs24-debian13 AS runner
WORKDIR /app

ENV NODE_ENV=production

# package.json is needed at runtime for "type": "module".
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3001

CMD ["dist/index.js"]
