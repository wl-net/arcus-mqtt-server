# The node image is pinned by digest so Dependabot opens a PR when it's rebuilt
# (Node or Alpine fixes); keep both stages on the same digest.
# Compile on the build machine's own platform: the output is plain JavaScript,
# so multi-platform builds don't run tsc under emulation
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Runtime: production dependencies and the compiled output only
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist dist/
# Starts as root, since the Home Assistant app's options file is readable only by root,
# and switches to the node user once it has read it (src/index.ts)
CMD ["node", "dist/index.js"]
