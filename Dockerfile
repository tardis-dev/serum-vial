from node:15-slim
# version arg contains current git tag
ARG VERSION_ARG
# install git
RUN apt-get update && apt-get install -y git

# install serum-vial globally (exposes serum-vial command)
RUN npm install --global --unsafe-perm serum-vial@$VERSION_ARG
# run it
CMD serum-vial