# syntax=docker/dockerfile:1
from node:16-slim
# version arg contains current git tag
ARG VERSION_ARG
# install git
RUN apt-get update && apt-get install -y git

# install serum-vial globally (exposes serum-vial command)
RUN npm install --global --unsafe-perm serum-vial@$VERSION_ARG
# custom markets so we can use cheaper infrastructure
# https://github.com/project-serum/serum-ts/blob/master/packages/serum/src/markets.json
COPY markets.json .
CMD serum-vial --markets-json "./markets.json"
