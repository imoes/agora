FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    libmicrohttpd-dev libjansson-dev libssl-dev libsrtp2-dev \
    libsofia-sip-ua-dev libglib2.0-dev libopus-dev libogg-dev \
    libcurl4-openssl-dev liblua5.3-dev libconfig-dev pkg-config \
    libnice-dev libwebsockets-dev cmake git automake libtool \
    gengetopt sudo make gcc g++ && \
    rm -rf /var/lib/apt/lists/*

# Build Janus from source
RUN cd /tmp && \
    git clone --depth 1 --branch v1.2.4 https://github.com/meetecho/janus-gateway.git && \
    cd janus-gateway && \
    sh autogen.sh && \
    ./configure --prefix=/opt/janus --disable-rabbitmq --disable-mqtt --disable-nanomsg && \
    make && make install && \
    rm -rf /tmp/janus-gateway

# Copy config
COPY janus.jcfg /opt/janus/etc/janus/janus.jcfg
COPY janus.transport.http.jcfg /opt/janus/etc/janus/janus.transport.http.jcfg
COPY janus.transport.websockets.jcfg /opt/janus/etc/janus/janus.transport.websockets.jcfg
COPY janus.plugin.videoroom.jcfg /opt/janus/etc/janus/janus.plugin.videoroom.jcfg

EXPOSE 8088 7088 10000-10100/udp

CMD ["/opt/janus/bin/janus"]
