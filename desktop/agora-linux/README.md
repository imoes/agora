# Agora Linux Desktop Client

Native GTK3 desktop client for the Agora collaboration platform, designed for Linux with X Server.

## Prerequisites

```bash
# Debian/Ubuntu
sudo apt install build-essential libgtk-3-dev libjson-glib-dev libsoup2.4-dev

# Fedora
sudo dnf install gcc make gtk3-devel json-glib-devel libsoup-devel

# Arch Linux
sudo pacman -S base-devel gtk3 json-glib libsoup
```

## Build

```bash
cd desktop/agora-linux
make
```

## Run

```bash
./agora-linux
```

## Install

```bash
sudo make install
```

This installs the binary to `/usr/local/bin/` and the `.desktop` file for application launchers.

## Uninstall

```bash
sudo make uninstall
```
