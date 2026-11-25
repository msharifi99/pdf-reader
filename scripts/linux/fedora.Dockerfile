# Fedora build image for the Quire .rpm (see build-fedora.sh). Links against Fedora's own WebKitGTK and glibc,
# so the package runs on this Fedora release and newer.
FROM fedora:latest
RUN dnf install -y --setopt=install_weak_deps=False \
      webkit2gtk4.1-devel gtk3-devel librsvg2-devel libxdo-devel openssl-devel \
      gcc gcc-c++ make pkgconf-pkg-config rust cargo nodejs npm \
 && dnf clean all
WORKDIR /build
