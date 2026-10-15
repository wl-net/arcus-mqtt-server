# Compile on the build machine's own platform: the output is plain JavaScript,
# so multi-platform builds don't run tsc under emulation
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Runtime: production dependencies and the compiled output only
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist dist/
CMD ["node", "dist/index.js"]
