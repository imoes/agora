CC = gcc
PKG_CONFIG = pkg-config
CFLAGS = $(shell $(PKG_CONFIG) --cflags gtk+-3.0 json-glib-1.0 libsoup-2.4) -Wall -Wextra -O2
LDFLAGS = $(shell $(PKG_CONFIG) --libs gtk+-3.0 json-glib-1.0 libsoup-2.4) -lpthread

TARGET = agora-linux
SRCDIR = src
SOURCES = $(wildcard $(SRCDIR)/*.c)
OBJECTS = $(SOURCES:.c=.o)

PREFIX ?= /usr/local

.PHONY: all clean install uninstall

all: $(TARGET)

$(TARGET): $(OBJECTS)
	$(CC) $(OBJECTS) -o $@ $(LDFLAGS)

$(SRCDIR)/%.o: $(SRCDIR)/%.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJECTS) $(TARGET)

install: $(TARGET)
	install -d $(PREFIX)/bin
	install -m 755 $(TARGET) $(PREFIX)/bin/
	install -d $(PREFIX)/share/applications
	install -m 644 resources/agora.desktop $(PREFIX)/share/applications/

uninstall:
	rm -f $(PREFIX)/bin/$(TARGET)
	rm -f $(PREFIX)/share/applications/agora.desktop
