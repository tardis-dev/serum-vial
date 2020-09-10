from node:14-slim
# version arg contains current git tag
ARG VERSION_ARG
# install git
RUN apt-get update && apt-get install -y git
# install Serum Machine globally (exposes serum-machine command)
RUN npm install --global --unsafe-perm serum-machine@$VERSION_ARG
# run it
CMD serum-machine