FROM node:18-alpine

WORKDIR /app

# Copy Yarn 3 release binary and config first
COPY .yarnrc.yml ./
COPY .yarn/releases/ .yarn/releases/

# Copy package manifest and lockfile for layer caching
COPY package.json yarn.lock ./

# Install all deps (including devDependencies needed for the build step)
RUN yarn install --immutable

# Copy TypeScript sources and compiler config
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/

# Compile TypeScript to build/
RUN yarn build

# Remove source and dev artifacts; keep only the compiled output
RUN rm -rf src/ tsconfig*.json .yarn/

EXPOSE 9990

CMD ["node", "build/server.js"]
