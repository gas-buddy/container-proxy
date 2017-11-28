FROM gasbuddy/node-app:8-production

WORKDIR /pipeline/source

COPY . .

RUN npm install && npm run build && npm prune --production

EXPOSE 9990
