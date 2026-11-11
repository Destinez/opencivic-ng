FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @opencivic/web...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV API_INTERNAL_URL=http://api:4000
RUN pnpm --filter @opencivic/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@opencivic/web", "start"]
