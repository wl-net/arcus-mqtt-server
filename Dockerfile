# The node image is pinned by digest so Dependabot opens a PR when it's rebuilt
# (Node or Alpine fixes); keep both stages on the same digest.
# Compile on the build machine's own platform: the output is plain JavaScript,
# so multi-platform builds don't run tsc under emulation
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Runtime: production dependencies and the compiled output only
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist dist/
CMD ["node", "dist/index.js"]
